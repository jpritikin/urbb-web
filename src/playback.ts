import type { RecordedAction, RecordedSession } from './testability/types.js';
import { formatActionLabel } from './actionFormatter.js';
import { STAR_CLOUD_ID, RAY_CLOUD_ID, MODE_TOGGLE_CLOUD_ID } from './ifsView/SeatManager.js';
import { isStarMenuAction } from './therapistActions.js';

const RETICLE_TOP_HAND_X_OFFSET = -10;
const RETICLE_BOTTOM_HAND_X_OFFSET = 10;

const RETICLE_FADE_MS = 600;
const HOVER_PAUSE_MS = 0;
const SLICE_HOVER_PAUSE_MS = 1500;
const MOVE_BASE_DURATION_MS = 900;
const MOVE_BASE_DISTANCE = 300; // pixels - distance that takes base duration
const HUG_DURATION_MS = 400;
const INTER_ACTION_DELAY_MS = 1000;
const INTRA_ACTION_DELAY_MS = 800;
const KISS_DURATION_MS = 1500;
const KISS_SPEED = 25; // pixels per second

interface DriftingKiss {
    element: SVGTextElement;
    x: number;
    y: number;
    vx: number;
    vy: number;
    rotation: number;
    angularVelocity: number;
    age: number;
}

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

export interface PlaybackCallbacks {
    getCloudPosition: (cloudId: string) => { x: number; y: number } | null;
    getMenuCenter: () => { x: number; y: number } | null;
    getSlicePosition: (sliceIndex: number, menuCenter: { x: number; y: number }, itemCount: number) => { x: number; y: number };
    getMode: () => 'panorama' | 'foreground';
    getPartName: (cloudId: string) => string;
    getLastActionResult: () => ActionResult | null;
    clearLastActionResult: () => void;
    getModelState: () => ModelState;
    isTransitioning: () => boolean;
    hasPendingBlends: () => boolean;
    findActionInOpenMenu: (actionId: string) => MenuSliceInfo | null;
    isMobile: () => boolean;
    getIsFullscreen: () => boolean;

    simulateHover: (x: number, y: number) => void;
    simulateClickAtPosition: (x: number, y: number) => ActionResult;
    simulateClickOnCloud: (cloudId: string) => ActionResult;

    setPauseTimeEffects: (paused: boolean) => void;
    advanceSimulationTime: (deltaTime: number) => void;
    advanceIntervals: (count: number) => void;
    executeSpontaneousBlend: (cloudId: string) => void;
    onActionCompleted: (action: RecordedAction) => ActionResult;
    onPlaybackComplete: () => void;
    onPlaybackCancelled: () => void;
    onPlaybackError: () => void;
}

type PlaybackState = 'idle' | 'waiting' | 'executing' | 'paused' | 'complete' | 'error';

export class PlaybackController {
    private state: PlaybackState = 'idle';
    private canResume: boolean = true;
    private currentActionIndex: number = 0;
    private waitCountdown: number = 0;
    private actions: RecordedAction[] = [];
    private callbacks: PlaybackCallbacks;
    private errorMessage: string = '';

    private reticleGroup: SVGGElement | null = null;
    private reticleOpacity: number = 0;
    private reticleX: number = 0;
    private reticleY: number = 0;
    private reticleTargetX: number = 0;
    private reticleTargetY: number = 0;
    private reticleVisible: boolean = false;
    private reticleTilt: number = 0; // stochastic +/- 20 degree tilt
    private reticleFadeDirection: 'in' | 'out' | 'none' = 'none';
    private hugAnimating: boolean = false;
    private hugProgress: number = 0; // 0→1 over HUG_DURATION_MS
    private hugRelaxFactor: number = 1; // random 0.5-1, determines post-click hand distance
    private fadeProgress: number = 0; // 0 = folded/far, 1 = open/close
    private fadeOutArcAngle: number = 0; // random 10-20 degrees, set when fade out starts
    private kisses: DriftingKiss[] = [];

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
    }

    start(session: RecordedSession): void {
        console.log(`[Playback] Starting playback with ${session.actions.length} actions`);
        this.actions = session.actions;
        this.currentActionIndex = 0;
        this.state = 'waiting';
        this.canResume = true;
        this.waitCountdown = INTER_ACTION_DELAY_MS / 1000;

        this.createReticle();
        this.createControlPanel();
        this.updateControlPanel();
        this.callbacks.setPauseTimeEffects(true);
    }

    pause(): void {
        if (this.state !== 'waiting' && this.state !== 'executing') return;
        this.state = 'paused';
        this.callbacks.setPauseTimeEffects(false);
        this.updateControlPanel();
    }

    resume(): void {
        if (this.state !== 'paused' || !this.canResume) return;
        this.state = 'waiting';
        this.callbacks.setPauseTimeEffects(true);
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

        this.animateReticle(deltaTime);

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

        // For spontaneous_blend: just execute (intervals already processed)
        if (action.action === 'spontaneous_blend') {
            this.callbacks.executeSpontaneousBlend(action.cloudId);
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

        if (this.state as PlaybackState === 'error') return;

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
        await this.waitForCanvasOnScreen();
        await this.waitForTransition();
        await this.waitForPendingBlends();

        switch (action.action) {
            case 'select_a_target':
                await this.executeSelectTarget(action);
                break;

            case 'feel_toward':
            case 'notice_part':
            case 'who_do_you_see':
            case 'job':
            case 'separate':
            case 'blend':
            case 'help_protected':
            case 'step_back':
            case 'expand_deepen':
            case 'join_conference':
                await this.executeCloudAction(action);
                break;

            case 'ray_field_select':
                await this.executeRayFieldAction(action);
                break;

            case 'mode_change':
                await this.executeModeChange(action);
                break;

            default:
                console.warn(`[Playback] Unknown action: ${action.action}`);
        }
    }

    private async executeSelectTarget(action: RecordedAction): Promise<void> {
        await this.toggleToPanorama();
        await this.hoverAndClickCloud(action.cloudId);
        await this.fadeOutReticle();
    }

    private async executeCloudAction(action: RecordedAction): Promise<void> {
        if (isStarMenuAction(action.action)) {
            await this.executeStarMenuAction(action);
        } else {
            await this.executeCloudMenuAction(action);
        }
    }

    private async executeCloudMenuAction(action: RecordedAction): Promise<void> {
        const openSuccess = await this.hoverAndClickCloud(action.cloudId, `opening cloud menu for ${action.cloudId}`);
        if (!openSuccess) return;

        const sliceInfo = this.callbacks.findActionInOpenMenu(action.action);
        if (!sliceInfo) {
            this.handleError(`Action '${action.action}' not found in open menu`, action.cloudId);
            return;
        }

        const needsTargetClick = action.targetCloudId && action.targetCloudId !== action.cloudId;
        await this.executeSliceSelection(action.cloudId, sliceInfo.sliceIndex, sliceInfo.itemCount, !needsTargetClick);

        if (needsTargetClick) {
            await this.hoverAndClickCloud(action.targetCloudId!, `${action.action} target ${action.targetCloudId}`, true);
            await this.fadeOutReticle();
        }
    }

    private async executeStarMenuAction(action: RecordedAction): Promise<void> {
        const openSuccess = await this.hoverAndClickCloud(STAR_CLOUD_ID, 'opening star menu');
        if (!openSuccess) return;

        const sliceInfo = this.callbacks.findActionInOpenMenu(action.action);
        if (!sliceInfo) {
            this.handleError(`Action '${action.action}' not found in star menu`, 'star');
            return;
        }

        // Don't fade out - we need to continue to target cloud click
        await this.executeSliceSelection(STAR_CLOUD_ID, sliceInfo.sliceIndex, sliceInfo.itemCount, false);

        // Star menu actions require clicking target cloud
        const targetCloudId = action.targetCloudId ?? action.cloudId;
        await this.hoverAndClickCloud(targetCloudId, `${action.action} target ${targetCloudId}`, true);
        await this.fadeOutReticle();
    }

    private async executeSliceSelection(menuCloudId: string, sliceIndex: number, itemCount: number, fadeOut: boolean = true): Promise<void> {
        const menuCenter = this.callbacks.getMenuCenter();
        if (!menuCenter) {
            this.handleError('Menu center not found', menuCloudId);
            return;
        }
        const slicePos = this.callbacks.getSlicePosition(sliceIndex, menuCenter, itemCount);
        await this.hoverOnSlice(slicePos.x, slicePos.y);

        const selectSuccess = await this.clickAtPosition(slicePos.x, slicePos.y, `selecting slice ${sliceIndex}`);
        if (!selectSuccess) return;

        if (fadeOut) {
            await this.fadeOutReticle();
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
        await this.trackingDelay(HOVER_PAUSE_MS, cloudId);
        return this.clickOnCloud(cloudId, context, expectAction);
    }

    private async trackingDelay(ms: number, cloudId?: string): Promise<void> {
        if (!cloudId) {
            await this.delay(ms);
            return;
        }
        const interval = 50;
        let remaining = ms;
        while (remaining > 0) {
            await this.delay(Math.min(interval, remaining));
            remaining -= interval;
            const pos = this.callbacks.getCloudPosition(cloudId);
            if (pos) {
                this.reticleTargetX = pos.x;
                this.reticleTargetY = pos.y;
            }
        }
    }

    private async hoverOnSlice(x: number, y: number): Promise<void> {
        await this.moveReticleTo(x, y);
        this.callbacks.simulateHover(x, y);
        await this.delay(SLICE_HOVER_PAUSE_MS);
    }

    private async clickAtPosition(x: number, y: number, context?: string, expectAction: boolean = false, retryCount: number = 0): Promise<boolean> {
        await this.waitForCanvasOnScreen();
        await this.animateHug();
        this.callbacks.clearLastActionResult();

        if (this.controlPanel) this.controlPanel.style.pointerEvents = 'none';
        const clickResult = this.callbacks.simulateClickAtPosition(x, y);
        if (this.controlPanel) this.controlPanel.style.pointerEvents = '';
        this.spawnKisses(x, y);

        if (clickResult.message === 'thought-bubble-dismissed' && retryCount < 3) {
            await this.delay(100);
            return this.clickAtPosition(x, y, context, expectAction, retryCount + 1);
        }

        return this.handleClickResult(clickResult, context ?? `at (${x.toFixed(0)}, ${y.toFixed(0)})`, expectAction);
    }

    private async clickOnCloud(cloudId: string, context?: string, expectAction: boolean = false): Promise<boolean> {
        await this.waitForCanvasOnScreen();
        await this.animateHug();
        this.callbacks.clearLastActionResult();

        const pos = this.callbacks.getCloudPosition(cloudId);
        const clickResult = this.callbacks.simulateClickOnCloud(cloudId);
        if (pos) this.spawnKisses(pos.x, pos.y);

        return this.handleClickResult(clickResult, context ?? cloudId, expectAction);
    }

    private async animateHug(): Promise<void> {
        this.hugAnimating = true;
        this.hugProgress = 0;
        this.hugRelaxFactor = 0.5 + Math.random() * 0.5;
        await this.delay(HUG_DURATION_MS);
        this.hugAnimating = false;
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
        this.callbacks.setPauseTimeEffects(false);

        console.error('[Playback Error]', this.errorMessage);
        console.error('[Playback] Current action:', this.actions[this.currentActionIndex]);
        console.error('[Playback] Action index:', this.currentActionIndex, 'of', this.actions.length);

        this.callbacks.onPlaybackError();
        this.updateControlPanel();
    }

    private async toggleToPanorama(): Promise<void> {
        if (this.callbacks.getMode() === 'panorama') return;
        await this.hoverAndClickCloud(MODE_TOGGLE_CLOUD_ID, 'mode toggle');
        await this.fadeOutReticle();
        await this.delay(INTRA_ACTION_DELAY_MS);
    }

    private async executeModeChange(action: RecordedAction): Promise<void> {
        const targetMode = action.newMode;
        if (!targetMode || this.callbacks.getMode() === targetMode) return;
        await this.hoverAndClickCloud(MODE_TOGGLE_CLOUD_ID, `mode -> ${targetMode}`);
        await this.fadeOutReticle();
    }

    private async showReticleAtCloud(cloudId: string): Promise<void> {
        const pos = this.callbacks.getCloudPosition(cloudId);
        if (!pos) return;

        if (this.reticleVisible) {
            // Animate to new position if already visible
            await this.moveReticleTo(pos.x, pos.y);
        } else {
            // Fade in at position
            this.reticleX = pos.x;
            this.reticleY = pos.y;
            this.reticleTargetX = pos.x;
            this.reticleTargetY = pos.y;
            this.reticleVisible = true;
            this.reticleTilt = 40 + (Math.random() - 0.5) * 60;
            this.reticleFadeDirection = 'in';
            this.fadeProgress = 0;
            await this.trackingDelay(RETICLE_FADE_MS, cloudId);
        }
    }

    private reticleMoveProgress: number = 1;
    private reticleMoveDuration: number = 0;
    private reticleMoveStartX: number = 0;
    private reticleMoveStartY: number = 0;
    private reticleMoveEndX: number = 0;
    private reticleMoveEndY: number = 0;

    private async moveReticleTo(x: number, y: number): Promise<void> {
        const dx = x - this.reticleX;
        const dy = y - this.reticleY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const duration = MOVE_BASE_DURATION_MS * (distance / MOVE_BASE_DISTANCE);

        this.reticleMoveStartX = this.reticleX;
        this.reticleMoveStartY = this.reticleY;
        this.reticleMoveEndX = x;
        this.reticleMoveEndY = y;
        this.reticleMoveProgress = 0;
        this.reticleMoveDuration = duration;
        this.reticleTargetX = x;
        this.reticleTargetY = y;

        await this.delay(duration);
    }

    private async fadeOutReticle(): Promise<void> {
        this.reticleFadeDirection = 'out';
        this.fadeOutArcAngle = -(10 + Math.random() * 10) * Math.PI / 180;
        await this.delay(RETICLE_FADE_MS);
        this.reticleVisible = false;
        this.reticleOpacity = 0;
        this.fadeProgress = 0;
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

    private animateReticle(deltaTime: number): void {
        if (!this.reticleGroup) return;

        // Fade and rotation/position animation
        const fadeRate = deltaTime / (RETICLE_FADE_MS / 1000);
        if (this.reticleFadeDirection === 'in') {
            this.fadeProgress = Math.min(1, this.fadeProgress + fadeRate);
            this.reticleOpacity = Math.min(1, this.reticleOpacity + fadeRate);
            if (this.fadeProgress >= 1) {
                this.reticleFadeDirection = 'none';
            }
        } else if (this.reticleFadeDirection === 'out') {
            this.fadeProgress = Math.max(0, this.fadeProgress - fadeRate);
            this.reticleOpacity = Math.max(0, this.reticleOpacity - fadeRate);
        }

        // Position animation with quadratic ease-in-out
        if (this.reticleMoveProgress < 1 && this.reticleMoveDuration > 0) {
            this.reticleMoveProgress = Math.min(1, this.reticleMoveProgress + deltaTime / (this.reticleMoveDuration / 1000));
            const t = this.reticleMoveProgress;
            const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            this.reticleX = this.reticleMoveStartX + (this.reticleMoveEndX - this.reticleMoveStartX) * eased;
            this.reticleY = this.reticleMoveStartY + (this.reticleMoveEndY - this.reticleMoveStartY) * eased;
        } else {
            // Fallback smoothing for tracking moving clouds
            const positionSmoothing = 10;
            this.reticleX += (this.reticleTargetX - this.reticleX) * Math.min(1, deltaTime * positionSmoothing);
            this.reticleY += (this.reticleTargetY - this.reticleY) * Math.min(1, deltaTime * positionSmoothing);
        }

        // Hug animation - single 0→1 cycle, easing creates 0→1→0 squeeze
        if (this.hugAnimating) {
            this.hugProgress = Math.min(1, this.hugProgress + deltaTime / (HUG_DURATION_MS / 1000));
        }
        this.updateHugHands(this.hugProgress);

        this.reticleGroup.setAttribute('transform', `translate(${this.reticleX}, ${this.reticleY}) rotate(${this.reticleTilt})`);
        this.reticleGroup.setAttribute('opacity', String(this.reticleOpacity));
        this.reticleGroup.style.display = this.reticleVisible ? '' : 'none';

        // Update drifting kisses
        this.updateKisses(deltaTime);
    }

    private topHand: SVGTextElement | null = null;
    private bottomHand: SVGTextElement | null = null;
    private haloCircle: SVGCircleElement | null = null;

    private static readonly HALO_RADIUS_OPEN = 45;
    private static readonly HALO_RADIUS_CLICK = 4;
    private static readonly HALO_OPACITY_OPEN = 0.2;
    private static readonly HALO_OPACITY_CLICK = 1;
    private static readonly HALO_COLOR = '#E6B3CC'; // pastel pink

    private createReticle(): void {
        this.reticleGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.reticleGroup.setAttribute('class', 'playback-reticle');
        this.reticleGroup.style.display = 'none';
        this.reticleGroup.style.pointerEvents = 'none';

        // Halo circle (behind hands)
        this.haloCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        this.haloCircle.setAttribute('cx', '0');
        this.haloCircle.setAttribute('cy', '0');
        this.haloCircle.setAttribute('r', String(PlaybackController.HALO_RADIUS_OPEN));
        this.haloCircle.setAttribute('fill', PlaybackController.HALO_COLOR);
        this.haloCircle.setAttribute('opacity', String(PlaybackController.HALO_OPACITY_OPEN));
        this.reticleGroup.appendChild(this.haloCircle);

        // Top hand emoji 🫳
        this.topHand = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        this.topHand.setAttribute('font-size', '28');
        this.topHand.setAttribute('text-anchor', 'middle');
        this.topHand.setAttribute('dominant-baseline', 'middle');
        this.topHand.textContent = '🫳';
        this.reticleGroup.appendChild(this.topHand);

        // Bottom hand emoji 🫴
        this.bottomHand = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        this.bottomHand.setAttribute('font-size', '28');
        this.bottomHand.setAttribute('text-anchor', 'middle');
        this.bottomHand.setAttribute('dominant-baseline', 'middle');
        this.bottomHand.textContent = '🫴';
        this.reticleGroup.appendChild(this.bottomHand);

        this.updateHugHands(0);

        this.svgElement.appendChild(this.reticleGroup);
    }

    private updateHugHands(progress: number): void {
        // progress: 0→1 over full animation
        // Convert to squeeze: 0→1→0 (peak at progress=0.5)
        const triangle = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
        // Apply quartic ease-in-out for smooth acceleration/deceleration
        const easedSqueeze = triangle < 0.5
            ? 8 * triangle * triangle * triangle * triangle
            : 1 - Math.pow(-2 * triangle + 2, 4) / 2;
        const baseSpread = 35;
        const hugSpread = 12;
        // After click, hands relax to a random position between hugSpread and baseSpread
        const relaxTarget = hugSpread + (baseSpread - hugSpread) * this.hugRelaxFactor;
        const targetSpread = progress < 0.5 ? baseSpread : relaxTarget;
        const spread = targetSpread - (targetSpread - hugSpread) * easedSqueeze;

        // During fade in/out: hands rotate and move from farther position
        // fadeProgress: 0 = folded (180°) and far, 1 = open (0°) and at target
        // Ease-out: starts fast, slows down as it approaches target
        const easeOut = 1 - Math.pow(1 - this.fadeProgress, 2);
        const rotation = 90 * (1 - this.fadeProgress);
        const extraDistance = 100 * (1 - easeOut);

        // Parabolic path during fade out: hands curve outward, starting curved then straightening
        // fadeOutT goes 0→1 as hands move away (fadeProgress 1→0)
        const fadeOutT = 1 - this.fadeProgress;
        // At click point (fadeOutT=0): angle=0, hands centered. As they move away: curve out then straighten
        const pathAngle = this.fadeOutArcAngle * fadeOutT * (1 - fadeOutT) * 4;
        const distance = spread + extraDistance;
        const pathX = Math.sin(pathAngle) * distance;

        const topY = -Math.cos(pathAngle) * distance;
        const bottomY = Math.cos(pathAngle) * distance;

        // Top hand rotates CW (positive), bottom hand rotates CCW (negative)
        // Use translate in transform instead of x/y attributes for consistent positioning
        // Apply lateral offset to each hand, reducing to half during squeeze
        const offsetScale = this.fadeProgress * (1 - 0.5 * easedSqueeze);
        const topOffset = RETICLE_TOP_HAND_X_OFFSET * offsetScale;
        const bottomOffset = RETICLE_BOTTOM_HAND_X_OFFSET * offsetScale;
        this.topHand?.setAttribute('transform', `translate(${-pathX + topOffset}, ${topY}) rotate(${rotation})`);

        this.bottomHand?.setAttribute('transform', `translate(${pathX + bottomOffset}, ${bottomY}) scale(-1, 1) rotate(${-rotation})`);

        // Animate halo: shrinks and becomes more opaque on click
        if (this.haloCircle) {
            const { HALO_RADIUS_OPEN, HALO_RADIUS_CLICK, HALO_OPACITY_OPEN, HALO_OPACITY_CLICK } = PlaybackController;
            const radius = HALO_RADIUS_OPEN - (HALO_RADIUS_OPEN - HALO_RADIUS_CLICK) * easedSqueeze;
            const opacity = HALO_OPACITY_OPEN + (HALO_OPACITY_CLICK - HALO_OPACITY_OPEN) * easedSqueeze;
            this.haloCircle.setAttribute('r', String(radius));
            this.haloCircle.setAttribute('opacity', String(opacity));
        }
    }

    private spawnKisses(x: number, y: number): void {
        const r = Math.random();
        const count = r < 0.6 ? 1 : r < 0.9 ? 2 : 3;
        const emojis = ['💋', '🎉', '🎊', '🪄', '💎', '🔑', '❤️', '💥', '💦'];
        const rotatedEmojis = new Set(['💋', '🔑']);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = KISS_SPEED * (0.5 + Math.random() * 0.5);
            const emoji = emojis[Math.floor(Math.random() * emojis.length)];
            const shouldRotate = rotatedEmojis.has(emoji);

            const kiss = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            kiss.setAttribute('font-size', '16');
            kiss.setAttribute('text-anchor', 'middle');
            kiss.setAttribute('dominant-baseline', 'middle');
            kiss.textContent = emoji;
            kiss.style.pointerEvents = 'none';
            this.svgElement.appendChild(kiss);

            this.kisses.push({
                element: kiss,
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                rotation: shouldRotate ? 45 : 0,
                angularVelocity: shouldRotate ? (Math.random() - 0.5) * 400 : 0,
                age: 0
            });
        }
    }

    private updateKisses(deltaTime: number): void {
        for (let i = this.kisses.length - 1; i >= 0; i--) {
            const kiss = this.kisses[i];
            kiss.age += deltaTime * 1000;
            kiss.x += kiss.vx * deltaTime;
            kiss.y += kiss.vy * deltaTime;
            kiss.rotation += kiss.angularVelocity * deltaTime;

            const progress = kiss.age / KISS_DURATION_MS;
            const opacity = 1 - progress;
            const scale = 1 + progress;

            kiss.element.setAttribute('transform', `translate(${kiss.x}, ${kiss.y}) rotate(${kiss.rotation}) scale(${scale})`);
            kiss.element.setAttribute('opacity', String(Math.max(0, opacity)));

            if (kiss.age >= KISS_DURATION_MS) {
                kiss.element.remove();
                this.kisses.splice(i, 1);
            }
        }
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
        if (this.reticleGroup) {
            this.reticleGroup.remove();
            this.reticleGroup = null;
        }

        if (this.controlPanel) {
            this.controlPanel.remove();
            this.controlPanel = null;
        }

        for (const kiss of this.kisses) {
            kiss.element.remove();
        }
        this.kisses = [];

        this.callbacks.setPauseTimeEffects(false);
    }
}
