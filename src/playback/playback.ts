import type { RecordedAction, RecordedSession } from './testability/types.js';
import { formatActionLabel } from '../simulator/actionFormatter.js';
import { STAR_CLOUD_ID, RAY_CLOUD_ID, MODE_TOGGLE_CLOUD_ID } from '../simulator/view/SeatManager.js';
import { isStarMenuAction, isCloudMenuAction } from '../simulator/therapistActions.js';
import { PlaybackReticle } from './playbackReticle.js';

const IS_LOCAL = typeof window !== 'undefined' && window.location.hostname === 'localhost';
const HOVER_PAUSE_MS = 0;
const SLICE_HOVER_PAUSE_MS = IS_LOCAL ? 100 : 1500;
const MOVE_BASE_DURATION_MS = IS_LOCAL ? 100 : 900;
const MOVE_BASE_DISTANCE = 300;
const INTER_ACTION_DELAY_MS = IS_LOCAL ? 100 : 1000;
const INTRA_ACTION_DELAY_MS = IS_LOCAL ? 100 : 800;

export interface ActionResult {
    success: boolean;
    error?: string;
    message?: string;
}

export interface ModelState {
    targets: string[];
    blended: string[];
}

export interface MenuSliceInfo {
    sliceIndex: number;
    itemCount: number;
}

export interface PlaybackViewState {
    getCloudPosition: (cloudId: string) => { x: number; y: number } | null;
    getMenuCenter: () => { x: number; y: number } | null;
    getSlicePosition: (sliceIndex: number, menuCenter: { x: number; y: number }, itemCount: number) => { x: number; y: number };
    isTransitioning: () => boolean;
    hasPendingBlends: () => boolean;
    hasActiveSpiralExits: () => boolean;
    findActionInOpenMenu: (actionId: string) => MenuSliceInfo | null;
    isMobile: () => boolean;
    getIsFullscreen: () => boolean;
}

export interface PlaybackInputSimulator {
    simulateHover: (x: number, y: number) => void;
    simulateClickAtPosition: (x: number, y: number) => ActionResult;
    simulateClickOnCloud: (cloudId: string) => ActionResult;
}

export interface PlaybackModelAccess {
    getMode: () => 'panorama' | 'foreground';
    getPartName: (cloudId: string) => string;
    getModelState: () => ModelState;
    getLastActionResult: () => ActionResult | null;
    clearLastActionResult: () => void;
}

export interface PlaybackTimeControl {
    pausePlayback: () => void;
    resumePlayback: () => void;
    advanceIntervals: (count: number) => void;
    executeSpontaneousBlend: (cloudId: string) => void;
}

export interface PlaybackLifecycle {
    onActionCompleted: (action: RecordedAction) => ActionResult;
    onPlaybackComplete: () => void;
    onPlaybackCancelled: () => void;
    onPlaybackError: () => void;
}

export interface PlaybackCallbacks extends
    PlaybackViewState,
    PlaybackInputSimulator,
    PlaybackModelAccess,
    PlaybackTimeControl,
    PlaybackLifecycle { }

type PlaybackState = 'idle' | 'waiting' | 'executing' | 'paused' | 'complete' | 'error';

export class PlaybackController {
    private state: PlaybackState = 'idle';
    private canResume: boolean = true;
    private currentActionIndex: number = 0;
    private waitCountdown: number = 0;
    private actions: RecordedAction[] = [];
    private callbacks: PlaybackCallbacks;
    private errorMessage: string = '';
    private reticle: PlaybackReticle;

    private controlPanel: HTMLDivElement | null = null;
    private countdownDisplay: HTMLSpanElement | null = null;
    private actionDisplay: HTMLSpanElement | null = null;
    private dismissButton: HTMLButtonElement | null = null;
    private resumeButton: HTMLButtonElement | null = null;
    private finalDismissButton: HTMLButtonElement | null = null;
    private advanceButton: HTMLButtonElement | null = null;
    private lastDisplayedCountdown: number = -1;
    private dismissConfirmMode: boolean = false;
    private static readonly LONG_WAIT_THRESHOLD = 10;

    constructor(
        private container: HTMLElement,
        private svgElement: SVGSVGElement,
        callbacks: PlaybackCallbacks
    ) {
        this.callbacks = callbacks;
        this.reticle = new PlaybackReticle(svgElement);
    }

    start(session: RecordedSession): void {
        console.log(`[Playback] Starting playback with ${session.actions.length} actions`);
        this.actions = session.actions;
        this.currentActionIndex = 0;
        this.state = 'waiting';
        this.canResume = true;
        this.waitCountdown = INTER_ACTION_DELAY_MS / 1000;

        this.reticle.create();
        this.createControlPanel();
        this.updateControlPanel();
        this.callbacks.pausePlayback();
    }

    pause(): void {
        if (this.state !== 'waiting' && this.state !== 'executing') return;
        this.state = 'paused';
        // Keep time effects paused to prevent blend timer drift
        this.updateControlPanel();
    }

    resume(): void {
        if (this.state !== 'paused' || !this.canResume) return;
        this.state = 'waiting';
        // Time effects should already be paused
        this.updateControlPanel();
    }

    advance(): void {
        if (this.state !== 'waiting') return;
        this.waitCountdown = 0;
    }

    cancel(): void {
        this.state = 'complete';
        this.cleanup();
        this.callbacks.onPlaybackCancelled();
    }

    onUserStateModification(): void {
        if (this.state === 'idle' || this.state === 'complete') return;
        this.canResume = false;
        this.cancel();
    }

    isPlaying(): boolean {
        return this.state === 'waiting' || this.state === 'executing';
    }

    isPaused(): boolean {
        return this.state === 'paused';
    }

    isActive(): boolean {
        return this.state !== 'idle' && this.state !== 'complete';
    }

    update(deltaTime: number): void {
        if (this.state === 'complete' || this.state === 'error') return;

        this.reticle.update(deltaTime);

        if (this.state === 'waiting') {
            this.waitCountdown -= deltaTime;
            this.updateControlPanel();

            if (this.waitCountdown <= 0) {
                this.executeNextAction();
            }
        }
    }

    private async executeNextAction(): Promise<void> {
        if (this.currentActionIndex >= this.actions.length) {
            this.completePlayback();
            return;
        }

        const action = this.actions[this.currentActionIndex];

        // Handle process_intervals action - no UI, just advance simulation
        if (action.action === 'process_intervals') {
            const count = action.count ?? 0;
            if (count > 0) {
                this.callbacks.advanceIntervals(count);
            }
            if (action.rngCounts) {
                const verifyResult = this.callbacks.onActionCompleted(action);
                if (!verifyResult.success) {
                    this.handleError(verifyResult.error ?? 'Sync verification failed', `action ${this.currentActionIndex}`);
                    return;
                }
            }
            this.currentActionIndex++;
            // Don't wait between interval processing and next action
            this.waitCountdown = 0;
            return;
        }

        // For spontaneous_blend: execute and wait for animation
        if (action.action === 'spontaneous_blend') {
            this.state = 'executing';
            this.callbacks.executeSpontaneousBlend(action.cloudId);
            await this.waitForSpiralExits();
            if (this.state !== 'executing') return;
            const verifyResult = this.callbacks.onActionCompleted(action);
            console.log(`[Playback] Action ${this.currentActionIndex} (${action.action}) executed. Sync check:`, verifyResult);
            if (!verifyResult.success) {
                this.handleError(verifyResult.error ?? 'Sync verification failed', `action ${this.currentActionIndex}`);
                return;
            }
            this.currentActionIndex++;
            this.advanceToNextAction();
            return;
        }

        this.state = 'executing';
        this.updateControlPanel();

        await this.executeAction(action);

        if (this.state !== 'executing') return;

        const verifyResult = this.callbacks.onActionCompleted(action);
        console.log(`[Playback] Action ${this.currentActionIndex} (${action.action}) completed. Sync check:`, verifyResult);
        if (!verifyResult.success) {
            this.handleError(verifyResult.error ?? 'Sync verification failed', `action ${this.currentActionIndex}`);
            return;
        }

        this.currentActionIndex++;
        this.advanceToNextAction();
    }

    private advanceToNextAction(): void {
        if (this.currentActionIndex < this.actions.length) {
            this.waitCountdown = INTER_ACTION_DELAY_MS / 1000;
            this.lastDisplayedCountdown = -1;
            this.state = 'waiting';
        } else {
            this.completePlayback();
        }
    }

    private async executeAction(action: RecordedAction): Promise<void> {
        console.log(`[Playback] executeAction #${this.currentActionIndex}: ${action.action} cloudId=${action.cloudId} targetCloudId=${action.targetCloudId}`);
        await this.waitForCanvasOnScreen();
        await this.waitForTransition();
        await this.waitForPendingBlends();

        switch (action.action) {
            case 'select_a_target':
                await this.executeSelectTarget(action);
                break;

            case 'ray_field_select':
                await this.executeRayFieldAction(action);
                break;

            case 'mode_change':
                await this.executeModeChange(action);
                break;

            default:
                if (isCloudMenuAction(action.action) || isStarMenuAction(action.action)) {
                    await this.executeCloudAction(action);
                } else {
                    console.warn(`[Playback] Unknown action: ${action.action}`);
                }
        }
    }

    private async executeSelectTarget(action: RecordedAction): Promise<void> {
        await this.toggleToPanorama();
        await this.hoverAndClickCloud(action.cloudId);
        await this.reticle.fadeOut();
    }

    private async executeCloudAction(action: RecordedAction): Promise<void> {
        if (isStarMenuAction(action.action)) {
            await this.executeStarMenuAction(action);
        } else {
            await this.executeCloudMenuAction(action);
        }
    }

    private async executeCloudMenuAction(action: RecordedAction): Promise<void> {
        console.log(`[Playback] executeCloudMenuAction: ${action.action} on ${action.cloudId} targetCloudId=${action.targetCloudId}, mode=${this.callbacks.getMode()}`);

        if (action.targetCloudId) {
            // Completing a pending action: just click the target cloud
            await this.hoverAndClickCloud(action.targetCloudId, `${action.action} target ${action.targetCloudId}`, true);
            await this.reticle.fadeOut();
            return;
        }

        const openSuccess = await this.hoverAndClickCloud(action.cloudId, `opening cloud menu for ${action.cloudId}`);
        if (!openSuccess) return;

        const sliceInfo = this.callbacks.findActionInOpenMenu(action.action);
        console.log(`[Playback] after cloud click: findActionInOpenMenu(${action.action})=`, sliceInfo, 'menuCenter=', this.callbacks.getMenuCenter());
        if (!sliceInfo) {
            this.handleError(`Action '${action.action}' not found in open menu`, action.cloudId);
            return;
        }

        await this.executeSliceSelection(action.cloudId, sliceInfo.sliceIndex, sliceInfo.itemCount);
    }

    private async executeStarMenuAction(action: RecordedAction): Promise<void> {
        console.log(`[Playback] executeStarMenuAction: ${action.action} targetCloudId=${action.targetCloudId}, mode=${this.callbacks.getMode()}`);

        if (action.targetCloudId) {
            // Completing a pending action: just click the target cloud
            await this.hoverAndClickCloud(action.targetCloudId, `${action.action} target ${action.targetCloudId}`, true);
            await this.reticle.fadeOut();
            return;
        }

        const openSuccess = await this.hoverAndClickCloud(STAR_CLOUD_ID, 'opening star menu');
        if (!openSuccess) return;

        const sliceInfo = this.callbacks.findActionInOpenMenu(action.action);
        console.log(`[Playback] after star click: findActionInOpenMenu(${action.action})=`, sliceInfo, 'menuCenter=', this.callbacks.getMenuCenter());
        if (!sliceInfo) {
            this.handleError(`Action '${action.action}' not found in star menu`, 'star');
            return;
        }

        await this.executeSliceSelection(STAR_CLOUD_ID, sliceInfo.sliceIndex, sliceInfo.itemCount);
    }

    private async executeSliceSelection(menuCloudId: string, sliceIndex: number, itemCount: number, fadeOut: boolean = true): Promise<void> {
        const menuCenter = this.callbacks.getMenuCenter();
        console.log(`[Playback] executeSliceSelection: menuCloudId=${menuCloudId} slice=${sliceIndex}/${itemCount} fadeOut=${fadeOut} menuCenter=`, menuCenter);
        if (!menuCenter) {
            console.error(`[Playback] Menu center not found for ${menuCloudId}`);
            this.handleError('Menu center not found', menuCloudId);
            return;
        }
        const slicePos = this.callbacks.getSlicePosition(sliceIndex, menuCenter, itemCount);
        await this.hoverOnSlice(slicePos.x, slicePos.y);

        const selectSuccess = await this.clickAtPosition(slicePos.x, slicePos.y, `selecting slice ${sliceIndex}`);
        if (!selectSuccess) return;

        if (fadeOut) {
            await this.reticle.fadeOut();
        }
    }

    private async executeRayFieldAction(action: RecordedAction): Promise<void> {
        const openSuccess = await this.hoverAndClickCloud(RAY_CLOUD_ID, 'opening ray menu');
        if (!openSuccess) return;

        const sliceInfo = this.callbacks.findActionInOpenMenu(action.field ?? '');
        if (!sliceInfo) {
            this.handleError(`Field '${action.field}' not found in ray menu`, action.cloudId);
            return;
        }

        await this.executeSliceSelection(RAY_CLOUD_ID, sliceInfo.sliceIndex, sliceInfo.itemCount);
    }


    private async hoverAndClickCloud(cloudId: string, context?: string, expectAction: boolean = false): Promise<boolean> {
        await this.showReticleAtCloud(cloudId);
        const pos = this.callbacks.getCloudPosition(cloudId);
        if (pos) this.callbacks.simulateHover(pos.x, pos.y);
        await this.trackCloudDelay(HOVER_PAUSE_MS, cloudId);
        return this.clickOnCloud(cloudId, context, expectAction);
    }

    private async trackCloudDelay(ms: number, cloudId: string): Promise<void> {
        const interval = 50;
        let remaining = ms;
        while (remaining > 0) {
            await this.delay(Math.min(interval, remaining));
            remaining -= interval;
            const pos = this.callbacks.getCloudPosition(cloudId);
            if (pos) this.reticle.setTarget(pos.x, pos.y);
        }
    }

    private async hoverOnSlice(x: number, y: number): Promise<void> {
        await this.reticle.moveTo(x, y);
        this.callbacks.simulateHover(x, y);
        await this.delay(SLICE_HOVER_PAUSE_MS);
    }

    private async clickAtPosition(x: number, y: number, context?: string, expectAction: boolean = false, retryCount: number = 0): Promise<boolean> {
        await this.waitForCanvasOnScreen();
        await this.reticle.animateHug();
        this.callbacks.clearLastActionResult();

        if (this.controlPanel) this.controlPanel.style.pointerEvents = 'none';
        const clickResult = this.callbacks.simulateClickAtPosition(x, y);
        if (this.controlPanel) this.controlPanel.style.pointerEvents = '';
        this.reticle.spawnKisses(x, y);

        if (clickResult.message === 'thought-bubble-dismissed' && retryCount < 3) {
            await this.delay(100);
            return this.clickAtPosition(x, y, context, expectAction, retryCount + 1);
        }

        return this.handleClickResult(clickResult, context ?? `at (${x.toFixed(0)}, ${y.toFixed(0)})`, expectAction);
    }

    private async clickOnCloud(cloudId: string, context?: string, expectAction: boolean = false): Promise<boolean> {
        await this.waitForCanvasOnScreen();
        await this.reticle.animateHug();
        this.callbacks.clearLastActionResult();

        const pos = this.callbacks.getCloudPosition(cloudId);
        const clickResult = this.callbacks.simulateClickOnCloud(cloudId);
        if (pos) this.reticle.spawnKisses(pos.x, pos.y);

        return this.handleClickResult(clickResult, context ?? cloudId, expectAction);
    }

    private async handleClickResult(clickResult: ActionResult, context: string, expectAction: boolean): Promise<boolean> {
        if (!clickResult.success) {
            this.handleError(clickResult.error ?? 'Click failed', context);
            return false;
        }

        if (expectAction) {
            await this.delay(100);
            const actionResult = this.callbacks.getLastActionResult();
            if (actionResult && !actionResult.success) {
                this.handleError(actionResult.error ?? 'Action failed', context);
                return false;
            }
        }

        return true;
    }

    private handleError(error: string, context: string): void {
        this.state = 'error';
        this.errorMessage = `${error} - ${context}`;
        this.callbacks.resumePlayback();

        console.error('[Playback Error]', this.errorMessage);
        console.error('[Playback] Current action:', this.actions[this.currentActionIndex]);
        console.error('[Playback] Action index:', this.currentActionIndex, 'of', this.actions.length);

        this.callbacks.onPlaybackError();
        this.updateControlPanel();
    }

    private async toggleToPanorama(): Promise<void> {
        if (this.callbacks.getMode() === 'panorama') return;
        await this.hoverAndClickCloud(MODE_TOGGLE_CLOUD_ID, 'mode toggle');
        await this.reticle.fadeOut();
        await this.delay(INTRA_ACTION_DELAY_MS);
    }

    private async executeModeChange(action: RecordedAction): Promise<void> {
        const targetMode = action.newMode;
        if (!targetMode || this.callbacks.getMode() === targetMode) return;
        await this.hoverAndClickCloud(MODE_TOGGLE_CLOUD_ID, `mode -> ${targetMode}`);
        await this.reticle.fadeOut();
    }

    private async showReticleAtCloud(cloudId: string): Promise<void> {
        const pos = this.callbacks.getCloudPosition(cloudId);
        if (!pos) return;
        await this.reticle.showAt(pos.x, pos.y, cloudId, (id) => this.callbacks.getCloudPosition(id));
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async waitForTransition(): Promise<void> {
        if (!this.callbacks.isTransitioning()) return;
        const maxWait = 5000;
        const start = performance.now();
        while (this.callbacks.isTransitioning()) {
            if (performance.now() - start > maxWait) {
                console.warn('[Playback] Timeout waiting for transition');
                break;
            }
            await this.delay(50);
        }
    }

    private async waitForPendingBlends(): Promise<void> {
        if (!this.callbacks.hasPendingBlends()) return;
        const maxWait = 5000;
        const start = performance.now();
        while (this.callbacks.hasPendingBlends()) {
            if (performance.now() - start > maxWait) {
                console.warn('[Playback] Timeout waiting for pending blends');
                break;
            }
            await this.delay(50);
        }
    }

    private async waitForSpiralExits(): Promise<void> {
        if (!this.callbacks.hasActiveSpiralExits()) return;
        const maxWait = 10000;
        const start = performance.now();
        while (this.callbacks.hasActiveSpiralExits()) {
            if (performance.now() - start > maxWait) {
                console.warn('[Playback] Timeout waiting for spiral exits');
                break;
            }
            await this.delay(50);
        }
    }

    private isCanvasOnScreen(): boolean {
        const rect = this.svgElement.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        // Measure sticky header height
        const header = document.getElementById('ifs-simulator-nav');
        const headerHeight = header?.getBoundingClientRect().height ?? 0;

        // Check bounds are within viewport (accounting for header)
        if (rect.top < headerHeight || rect.bottom > viewportHeight ||
            rect.left < 0 || rect.right > viewportWidth) {
            return false;
        }

        return true;
    }

    private async waitForCanvasOnScreen(): Promise<void> {
        if (this.callbacks.isMobile()) {
            if (this.callbacks.getIsFullscreen()) return;
            return new Promise<void>((resolve) => {
                const checkInterval = setInterval(() => {
                    if (this.callbacks.getIsFullscreen()) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
            });
        }

        if (this.isCanvasOnScreen()) return;

        return new Promise<void>((resolve) => {
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.7); display: flex;
                align-items: center; justify-content: center; z-index: 10000;
                pointer-events: none;
            `;
            const dialog = document.createElement('div');
            dialog.style.cssText = `
                background: #1a1a2e; color: #eee; padding: 2rem;
                border-radius: 12px; text-align: center; max-width: 400px;
                border: 2px solid #4a4a6a;
            `;
            dialog.innerHTML = `
                <h2 style="margin: 0 0 1rem; color: #88f;">⚠️ Canvas Off-Screen</h2>
                <p style="margin: 0;">Please scroll so the IFS simulator canvas is fully visible.</p>
            `;
            modal.appendChild(dialog);
            document.body.appendChild(modal);

            const checkInterval = setInterval(() => {
                if (this.isCanvasOnScreen()) {
                    clearInterval(checkInterval);
                    modal.remove();
                    resolve();
                }
            }, 100);
        });
    }

    private createControlPanel(): void {
        this.controlPanel = document.createElement('div');
        this.controlPanel.className = 'playback-control-panel';
        this.controlPanel.innerHTML = `
            <div class="playback-left-buttons">
                <button class="playback-btn dismiss" title="Stop playback">✕</button>
                <button class="playback-btn resume" title="Resume">▶</button>
                <button class="playback-btn final-dismiss" title="Stop playback">✕</button>
            </div>
            <div class="playback-frame">
                <span class="playback-display">
                    <span class="countdown"></span>
                    <span class="action"></span>
                </span>
                <button class="playback-btn advance" title="Skip wait">⏭</button>
            </div>
        `;

        this.dismissButton = this.controlPanel.querySelector('.dismiss');
        this.resumeButton = this.controlPanel.querySelector('.resume');
        this.finalDismissButton = this.controlPanel.querySelector('.final-dismiss');
        this.advanceButton = this.controlPanel.querySelector('.advance');
        this.countdownDisplay = this.controlPanel.querySelector('.countdown');
        this.actionDisplay = this.controlPanel.querySelector('.action');

        this.dismissButton?.addEventListener('click', () => {
            this.enterDismissConfirmMode();
        });

        this.resumeButton?.addEventListener('click', () => {
            this.exitDismissConfirmMode();
        });

        this.finalDismissButton?.addEventListener('click', () => {
            this.cancel();
        });

        this.advanceButton?.addEventListener('click', () => {
            this.advance();
        });

        this.dismissConfirmMode = false;
        this.container.appendChild(this.controlPanel);
    }

    private enterDismissConfirmMode(): void {
        this.dismissConfirmMode = true;
        this.pause();
        this.updateControlPanel();
    }

    private exitDismissConfirmMode(): void {
        this.dismissConfirmMode = false;
        this.resume();
        this.updateControlPanel();
    }

    private getNextDisplayableAction(): RecordedAction | null {
        for (let i = this.currentActionIndex; i < this.actions.length; i++) {
            if (this.actions[i].action !== 'process_intervals') {
                return this.actions[i];
            }
        }
        return null;
    }

    private updateControlPanel(): void {
        if (!this.controlPanel) return;

        this.controlPanel.classList.toggle('error', this.state === 'error');
        this.controlPanel.classList.toggle('confirm-mode', this.dismissConfirmMode);

        // Show/hide buttons based on confirm mode
        if (this.dismissButton) {
            this.dismissButton.style.display = this.dismissConfirmMode ? 'none' : 'flex';
        }
        if (this.resumeButton) {
            this.resumeButton.style.display = this.dismissConfirmMode ? 'flex' : 'none';
        }
        if (this.finalDismissButton) {
            this.finalDismissButton.style.display = this.dismissConfirmMode ? 'flex' : 'none';
        }

        // Show advance button only during long waits (not in confirm mode)
        const seconds = Math.ceil(this.waitCountdown);
        const isLongWait = this.state === 'waiting' && seconds >= PlaybackController.LONG_WAIT_THRESHOLD;
        if (this.advanceButton) {
            this.advanceButton.style.display = (isLongWait && !this.dismissConfirmMode) ? 'flex' : 'none';
        }

        if (this.countdownDisplay && this.actionDisplay) {
            if (this.state === 'error') {
                this.countdownDisplay.textContent = '❌ Error';
                this.actionDisplay.textContent = this.errorMessage;
            } else if (this.dismissConfirmMode) {
                this.countdownDisplay.textContent = '';
                this.actionDisplay.textContent = 'Stop playback?';
            } else if (this.state === 'waiting' || this.state === 'executing') {
                const action = this.getNextDisplayableAction();
                const actionLabel = action ? formatActionLabel(action, this.callbacks.getPartName) : '';

                if (seconds < PlaybackController.LONG_WAIT_THRESHOLD) {
                    this.countdownDisplay.textContent = '';
                    this.actionDisplay.textContent = actionLabel;
                    this.lastDisplayedCountdown = -1;
                } else {
                    const displaySeconds = Math.ceil(seconds / 5) * 5;
                    if (displaySeconds !== this.lastDisplayedCountdown) {
                        this.countdownDisplay.textContent = `0:${String(displaySeconds).padStart(2, '0')}`;
                        this.lastDisplayedCountdown = displaySeconds;
                    }
                    this.actionDisplay.textContent = actionLabel;
                }
            } else if (this.state === 'paused') {
                this.countdownDisplay.textContent = 'Paused';
                this.actionDisplay.textContent = '';
            }
        }
    }

    private completePlayback(): void {
        this.state = 'complete';
        if (this.actionDisplay) {
            this.actionDisplay.textContent = 'Playback complete';
        }
        if (this.countdownDisplay) {
            this.countdownDisplay.textContent = '';
        }
        setTimeout(() => {
            this.cleanup();
            this.callbacks.onPlaybackComplete();
        }, 2000);
    }

    private cleanup(): void {
        this.reticle.destroy();

        if (this.controlPanel) {
            this.controlPanel.remove();
            this.controlPanel = null;
        }

        this.callbacks.resumePlayback();
    }
}
