import type { RecordedAction, RecordedSession, OrchestratorSnapshot } from './testability/types.js';
import { formatActionLabel } from '../simulator/actionFormatter.js';
import { STAR_CLOUD_ID, RAY_CLOUD_ID, MODE_TOGGLE_CLOUD_ID } from '../simulator/view/SeatManager.js';
import { isStarMenuAction, isCloudMenuAction } from '../simulator/therapistActions.js';
import { PlaybackReticle } from './playbackReticle.js';
import { SPEED_CONFIGS } from '../simulator/scenarioSelector.js';
import { MAX_TILT } from '../star/carpetRenderer.js';
import { REGULATION_STANCE_LIMIT } from '../simulator/messageOrchestrator.js';

export type PlaybackSpeed = 'realtime' | 'highlights' | 'speedrun';

const HOVER_PAUSE_MS = 0;
const BASE_SLICE_HOVER_PAUSE_MS = 1500;
const BASE_MOVE_DURATION_MS = 900;
const MOVE_BASE_DISTANCE = 300;
const BASE_INTER_ACTION_DELAY_MS = 1000;
const BASE_INTRA_ACTION_DELAY_MS = 800;

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
    forceCompleteTransition: () => void;
    hasResolvingClouds: () => boolean;
    hasActiveSpiralExits: () => boolean;
    hasActiveSupportingEntries: () => boolean;
    hasEnteringCarpets: () => boolean;
    findActionInOpenMenu: (actionId: string) => MenuSliceInfo | null;
    getCurrentMenuItems?: () => { id: string }[];
    isMobile: () => boolean;
    getIsFullscreen: () => boolean;
    getCarpetCenter: (cloudId: string) => { x: number; y: number } | null;
    getCarpetVisualCenter: (cloudId: string) => { x: number; y: number } | null;
    getCarpetTiltSign: (cloudId: string) => number;
    isCarpetSettled: (cloudId: string) => boolean;
    getCurrentDragStanceDelta: () => number | null;
    getLockedDragSign: () => number | null;
    setCarpetsInteractive: (enabled: boolean) => void;
    setStarInteractive: (enabled: boolean) => void;
    isStarInteractive: () => boolean;
    getDiagnostics: () => Record<string, unknown>;
}

export interface PlaybackInputSimulator {
    simulateHover: (x: number, y: number) => void;
    simulateClickAtPosition: (x: number, y: number) => ActionResult;
    simulateMouseDown: (x: number, y: number, carpetCloudId?: string) => void;
    simulateMouseMove: (x: number, y: number) => void;
    simulateMouseUp: () => void;
}

export interface PlaybackModelAccess {
    getMode: () => 'panorama' | 'foreground';
    getPartName: (cloudId: string) => string;
    getModelState: () => ModelState;
    getLastActionResult: () => ActionResult | null;
    clearLastActionResult: () => void;
    getSimulationTime: () => number;
}

export interface PlaybackTimeControl {
    pauseSimTime: () => void;
    resumeSimTime: () => void;
    advanceIntervals: (count: number, orchState?: OrchestratorSnapshot) => void;
    advanceOneInterval: () => void;
    executeSpontaneousBlend: (cloudId: string) => void;
    promotePendingBlend: (cloudId: string) => void;
    enterStressPause: () => void;
    exitStressPause: () => void;
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

type PlaybackState = 'idle' | 'ready' | 'waiting' | 'executing' | 'paused' | 'complete' | 'error';

export class PlaybackController {
    private state: PlaybackState = 'idle';
    private canResume: boolean = true;
    private currentActionIndex: number = 0;
    private waitCountdown: number = 0;
    private actions: RecordedAction[] = [];
    private callbacks: PlaybackCallbacks;
    private errorMessage: string = '';
    private reticle: PlaybackReticle;
    private speed: PlaybackSpeed;
    private sliceHoverMs: number;
    private interActionDelayMs: number;
    private intraActionDelayMs: number;

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
        callbacks: PlaybackCallbacks,
        speed: PlaybackSpeed = 'highlights'
    ) {
        this.callbacks = callbacks;
        this.speed = speed;
        const divisor = SPEED_CONFIGS.find(c => c.speed === speed)?.divisor ?? 1;
        this.sliceHoverMs = BASE_SLICE_HOVER_PAUSE_MS / divisor;
        this.interActionDelayMs = BASE_INTER_ACTION_DELAY_MS / divisor;
        this.intraActionDelayMs = BASE_INTRA_ACTION_DELAY_MS / divisor;
        this.reticle = new PlaybackReticle(svgElement, divisor);
    }

    start(session: RecordedSession): void {
        this.actions = session.actions;
        this.currentActionIndex = 0;
        this.state = 'ready';
        this.canResume = true;
        this.createControlPanel();
        this.updateControlPanel();
    }

    private beginPlayback(): void {
        this.state = 'waiting';
        this.waitCountdown = this.getInterActionDelay();
        this.reticle.create();
        this.callbacks.pauseSimTime();
        this.updateControlPanel();
    }

    pause(): void {
        if (this.state !== 'waiting' && this.state !== 'executing') return;
        this.state = 'paused';
        this.updateControlPanel();
    }

    onCanvasResized(): void {
        if (!this.isActive() || this.state === 'ready') return;
        console.log('[Playback] Canvas resized, cancelling playback');
        this.cancel();
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

    cancelIfReady(): void {
        if (this.state !== 'ready') return;
        this.cancel();
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
        if (this.state === 'ready' || this.state === 'complete' || this.state === 'error') return;

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
            this.state = 'executing';
            const count = action.count ?? 0;
            if (count > 0) {
                this.callbacks.advanceIntervals(count, action.orchState);
            }
            if (this.state !== 'executing') return;
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
            this.state = 'waiting';
            return;
        }

        // For spontaneous_blend: execute and wait for animation
        if (action.action === 'spontaneous_blend') {
            this.state = 'executing';
            this.callbacks.executeSpontaneousBlend(action.cloudId);
            await this.waitForSpiralExits();
            if (this.state !== 'executing') return;
            const verifyResult = this.callbacks.onActionCompleted(action);
            if (!verifyResult.success) {
                this.handleError(verifyResult.error ?? 'Sync verification failed', `action ${this.currentActionIndex}`);
                return;
            }
            this.currentActionIndex++;
            this.advanceToNextAction();
            return;
        }

        // For promote_pending_blend: promote immediately (no animation wait needed)
        if (action.action === 'promote_pending_blend') {
            this.callbacks.promotePendingBlend(action.cloudId);
            this.currentActionIndex++;
            this.waitCountdown = 0;
            return;
        }

        this.state = 'executing';
        this.updateControlPanel();

        await this.executeAction(action);

        if (this.state !== 'executing') return;

        const verifyResult = this.callbacks.onActionCompleted(action);
        if (!verifyResult.success) {
            this.handleError(verifyResult.error ?? 'Sync verification failed', `action ${this.currentActionIndex}`);
            return;
        }

        this.currentActionIndex++;
        this.advanceToNextAction();
    }

    private getInterActionDelay(): number {
        if (this.speed !== 'realtime') return this.interActionDelayMs / 1000;
        const nextAction = this.actions[this.currentActionIndex];
        return nextAction?.elapsedTime ?? 1;
    }

    private advanceToNextAction(): void {
        if (this.currentActionIndex < this.actions.length) {
            this.waitCountdown = this.getInterActionDelay();
            this.lastDisplayedCountdown = -1;
            this.state = 'waiting';
        } else {
            this.completePlayback();
        }
    }

    private async advanceIntervalsWithStress(count: number, action: RecordedAction): Promise<void> {
        // Advance one interval at a time with random view-only pauses between them.
        // This stresses the playback code by letting the animation loop run between
        // intervals, exposing any view→model leakage or timing-dependent bugs.
        // Pauses are view-only: sim time is paused, so no model state changes during the delay.
        const expectedRngLog = action.rngLog ?? [];
        let rngOffset = 0;
        for (let i = 0; i < count; i++) {
            if (this.state !== 'waiting' && this.state !== 'executing') return;
            const diagBefore = this.callbacks.getDiagnostics();
            const rngBefore = diagBefore.rngCallCount as number;
            const rngLogBefore = (diagBefore.rngCallLog as { label: string }[])?.length ?? 0;
            this.callbacks.advanceOneInterval();
            const diagAfter = this.callbacks.getDiagnostics();
            const rngAfter = diagAfter.rngCallCount as number;
            const delta = rngAfter - rngBefore;
            if (delta !== 0) {
                const rngLog = diagAfter.rngCallLog as { label: string }[];
                const actualLabels = rngLog?.slice(rngLogBefore).map(e => e.label) ?? [];
                const expectedLabels = expectedRngLog.slice(rngOffset, rngOffset + delta).map(e => e.label);
                const match = actualLabels.length === expectedLabels.length &&
                    actualLabels.every((l, j) => l === expectedLabels[j]);
                if (!match) {
                    const conv = diagAfter.orchestratorConversation as Record<string, number>;
                    const convState = diagAfter.conversationState as Record<string, unknown>;
                    console.warn(`[StressIntervals] interval ${i + 1}/${count}: RNG label mismatch at offset ${rngOffset}`,
                        `\n  expected: [${expectedLabels.join(', ')}]`,
                        `\n  actual:   [${actualLabels.join(', ')}]`,
                        `\n  orch: resp=${conv?.respondTimer?.toFixed(3)} reg=${conv?.regulationScore?.toFixed(3)} sustained=${conv?.sustainedRegulationTimer?.toFixed(3)}`,
                        `\n  conv:`, convState);
                }
            }
            // Check for expected RNG calls that didn't happen
            if (i === count - 1 && rngOffset + delta < expectedRngLog.length) {
                const missing = expectedRngLog.slice(rngOffset + delta).map(e => e.label);
                const conv = diagAfter.orchestratorConversation as Record<string, number>;
                const convState = diagAfter.conversationState as Record<string, unknown>;
                console.warn(`[StressIntervals] after all ${count} intervals: ${missing.length} expected RNG calls missing`,
                    `\n  missing: [${missing.join(', ')}]`,
                    `\n  orch: resp=${conv?.respondTimer?.toFixed(3)} reg=${conv?.regulationScore?.toFixed(3)} sustained=${conv?.sustainedRegulationTimer?.toFixed(3)}`,
                    `\n  conv:`, convState);
            }
            rngOffset += delta;
            // Freeze model then pause to let the animation loop run.
            // Any mutation attempted during this window throws immediately.
            this.callbacks.enterStressPause();
            try {
                await this.delay(Math.floor(Math.random() * 80));
            } finally {
                this.callbacks.exitStressPause();
            }
            if (this.state !== 'waiting' && this.state !== 'executing') return;
        }
    }

    private async executeAction(action: RecordedAction): Promise<void> {
        await this.waitForCanvasOnScreen();
        await this.waitForTransition();
        await this.waitForResolvingClouds();
        await this.waitForSupportingEntries();
        await this.waitForEnteringCarpets();

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

            case 'nudge_stance':
                await this.executeNudgeStance(action);
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
        if (action.targetCloudId) {
            if (!this.callbacks.getCloudPosition(action.targetCloudId)) {
                await this.toggleToPanorama();
            }
            await this.hoverAndClickCloud(action.targetCloudId, `${action.action} target ${action.targetCloudId}`, true);
            await this.reticle.fadeOut();
            return;
        }

        if (!this.callbacks.getCloudPosition(action.cloudId)) {
            await this.toggleToPanorama();
        }

        const result = await this.openMenuWithRetry(action.cloudId, action.action);
        if (!result) return;

        await this.executeSliceSelection(action.cloudId, result.sliceIndex, result.itemCount);
    }

    private async executeStarMenuAction(action: RecordedAction): Promise<void> {
        if (action.targetCloudId) {
            await this.hoverAndClickCloud(action.targetCloudId, `${action.action} target ${action.targetCloudId}`, true);
            await this.reticle.fadeOut();
            return;
        }

        const result = await this.openMenuWithRetry(STAR_CLOUD_ID, action.action, 'star');
        if (!result) return;

        await this.executeSliceSelection(STAR_CLOUD_ID, result.sliceIndex, result.itemCount);
    }

    private async waitForStarInteractive(): Promise<void> {
        if (this.callbacks.isStarInteractive()) return;
        const maxWait = 5000;
        const start = performance.now();
        while (!this.callbacks.isStarInteractive()) {
            if (performance.now() - start > maxWait) {
                console.warn('[Playback] Timeout waiting for star to become interactive');
                break;
            }
            await this.delay(50);
        }
    }

    private async openMenuWithRetry(cloudId: string, actionId: string, errorContext?: string): Promise<MenuSliceInfo | null> {
        const maxRetries = 5;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            if (cloudId === STAR_CLOUD_ID) {
                await this.waitForStarInteractive();
                this.callbacks.setStarInteractive(true);
            }
            const openSuccess = await this.hoverAndClickCloud(cloudId, `opening menu for ${cloudId}`);
            if (!openSuccess) return null;

            if (this.callbacks.getMenuCenter()) {
                const sliceInfo = this.callbacks.findActionInOpenMenu(actionId);
                if (sliceInfo) return sliceInfo;
                const menuItems = this.callbacks.getCurrentMenuItems?.() ?? [];
                console.error(`[Playback] Menu open for ${cloudId} but action '${actionId}' missing. Items: [${menuItems.map(i => i.id).join(', ')}]`, {
                    model: this.callbacks.getModelState(),
                    ...this.callbacks.getDiagnostics(),
                });
                this.handleError(`Action '${actionId}' not found in open menu`, errorContext ?? cloudId);
                return null;
            }

            if (attempt < maxRetries - 1) {
                console.warn(`[Playback] Menu didn't open for ${cloudId}, retry ${attempt + 1}/${maxRetries}`);
                await this.delay(200);
            }
        }
        this.handleError('Menu failed to open after retries', errorContext ?? cloudId);
        return null;
    }

    private async executeSliceSelection(menuCloudId: string, sliceIndex: number, itemCount: number, fadeOut: boolean = true): Promise<void> {
        const menuCenter = this.callbacks.getMenuCenter();
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
        this.callbacks.setCarpetsInteractive(false);
        this.callbacks.setStarInteractive(false);
        const openSuccess = await this.hoverAndClickCloud(RAY_CLOUD_ID, 'opening ray menu');
        this.callbacks.setStarInteractive(true);
        this.callbacks.setCarpetsInteractive(true);
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
        if (!pos) {
            this.handleError(`Cloud position not found: ${cloudId}`, context ?? cloudId);
            return false;
        }
        this.callbacks.simulateHover(pos.x, pos.y);
        await this.trackCloudDelay(HOVER_PAUSE_MS, cloudId);
        return this.clickAtPosition(pos.x, pos.y, context ?? `click cloud ${cloudId}`, expectAction);
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
        await this.delay(this.sliceHoverMs);
    }

    private async clickAtPosition(x: number, y: number, context?: string, expectAction: boolean = false, retryCount: number = 0): Promise<boolean> {
        await this.waitForCanvasOnScreen();
        await this.reticle.animateHug();
        this.callbacks.clearLastActionResult();

        if (this.controlPanel) this.controlPanel.style.pointerEvents = 'none';
        const clickResult = this.callbacks.simulateClickAtPosition(x, y);
        if (this.controlPanel) this.controlPanel.style.pointerEvents = '';
        this.reticle.spawnKisses(x, y);

        if (!clickResult.success && clickResult.error?.startsWith('No element') && retryCount < 5) {
            const rect = this.svgElement.getBoundingClientRect();
            const viewBox = this.svgElement.viewBox.baseVal;
            console.warn(`[Playback] elementFromPoint miss at svg(${x.toFixed(0)}, ${y.toFixed(0)}), retry ${retryCount + 1}/5`, {
                canvasRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                viewBox: { width: viewBox.width, height: viewBox.height },
            });
            await this.delay(100);
            return this.clickAtPosition(x, y, context, expectAction, retryCount + 1);
        }

        return this.handleClickResult(clickResult, context ?? `at (${x.toFixed(0)}, ${y.toFixed(0)})`, expectAction);
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
        const actionIndex = this.currentActionIndex;
        const totalActions = this.actions.length;
        const simTime = this.callbacks.getSimulationTime().toFixed(2);
        const diag = this.callbacks.getDiagnostics();
        const orchTimers = diag.orchestratorTimers as Record<string, number> | undefined;
        const blendTimerStr = orchTimers && Object.keys(orchTimers).length
            ? Object.entries(orchTimers).map(([id, t]) => `${this.callbacks.getPartName(id)}=${t.toFixed(2)}`).join(', ')
            : 'none';
        this.errorMessage = [
            `❌ ${error}`,
            `action ${actionIndex} of ${totalActions} | simTime ${simTime}s`,
            `blendTimers: ${blendTimerStr}`,
            `context: ${context}`,
        ].join('\n');

        console.error('[Playback Error]', error, '-', context);
        console.error('[Playback] Action index:', actionIndex, 'of', totalActions);
        console.error('[Playback] Sim time:', simTime);
        console.error('[Playback] Current action:', this.actions[actionIndex]);

        const rect = this.svgElement.getBoundingClientRect();
        const viewBox = this.svgElement.viewBox.baseVal;
        console.error('[Playback] Diagnostics:', {
            canvas: {
                boundingRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                viewBox: { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height },
            },
            fullscreen: this.callbacks.getIsFullscreen(),
            mobile: this.callbacks.isMobile(),
            view: {
                transitioning: this.callbacks.isTransitioning(),
                activeSpiralExits: this.callbacks.hasActiveSpiralExits(),
            },
            model: this.callbacks.getModelState(),
            ...diag,
        });

        this.callbacks.onPlaybackError();
        this.updateControlPanel();
    }

    private async toggleToPanorama(): Promise<void> {
        if (this.callbacks.getMode() === 'panorama') return;
        await this.hoverAndClickCloud(MODE_TOGGLE_CLOUD_ID, 'mode toggle');
        await this.reticle.fadeOut();
        await this.delay(this.intraActionDelayMs);
    }

    private async executeModeChange(action: RecordedAction): Promise<void> {
        const targetMode = action.newMode;
        const currentMode = this.callbacks.getMode();
        if (!targetMode || currentMode === targetMode) {
            return;
        }
        await this.waitForSpiralExits();
        await this.hoverAndClickCloud(MODE_TOGGLE_CLOUD_ID, `mode -> ${targetMode}`);
        await this.waitForTransition();
        await this.reticle.fadeOut();
    }

    private async executeNudgeStance(action: RecordedAction): Promise<void> {
        const stanceDelta = action.stanceDelta ?? 0;
        // Wait for carpet to finish entering/landing animation
        const maxWait = 5000;
        const start = performance.now();
        while (!this.callbacks.isCarpetSettled(action.cloudId)) {
            if (performance.now() - start > maxWait) {
                console.warn('[NudgeDrag] Timeout waiting for carpet to settle');
                break;
            }
            await this.delay(50);
        }

        const canvasWidth = this.svgElement.viewBox.baseVal.width || 800;
        const dragRadius = 200;
        const targetAngleDeg = (stanceDelta / REGULATION_STANCE_LIMIT) * MAX_TILT;

        // Mousedown somewhere on the carpet to start the drag. The carpet center
        // may be occluded by the cloud sitting on it, so scan outward along the
        // carpet until the mousedown registers (getLockedDragSign becomes non-null).
        // tiltSign is intentionally NOT fetched yet — it may change during reticle animation.
        const preCenter = this.callbacks.getCarpetCenter(action.cloudId);
        if (!preCenter) return;
        const horizontalDir = preCenter.x < canvasWidth / 2 ? 1 : -1;

        const startX = preCenter.x;
        const startY = preCenter.y;
        await this.reticle.showAt(startX, startY);
        this.callbacks.simulateMouseDown(startX, startY);
        const lockedSign = this.callbacks.getLockedDragSign();

        // After mousedown the carpet is frozen and lockDirectionSign has run.
        // Read the actual locked direction sign so our endpoint matches.
        if (lockedSign === null) {
            console.error(`[NudgeDrag] ${action.cloudId} drag failed - mousedown missed carpet at svg(${startX.toFixed(0)},${startY.toFixed(0)})`);
            this.handleError(`nudge_stance drag missed carpet ${action.cloudId}`, `action ${this.currentActionIndex}`);
            return;
        }

        const center = this.callbacks.getCarpetCenter(action.cloudId) ?? preCenter;

        // stanceDelta = (clamp(angleDeg, ±MAX_ROTATION_ANGLE) / MAX_TILT) * REGULATION_STANCE_LIMIT
        // angleDeg = atan2(dy, |dx|) * lockedSign; no startAngle offset.
        // So we want atan2(dy, |dx|) = targetAngleDeg / lockedSign.
        const rawAngleRad = (targetAngleDeg / lockedSign) * Math.PI / 180;
        const endX = center.x + Math.abs(Math.cos(rawAngleRad)) * dragRadius * horizontalDir;
        const endY = center.y + Math.sin(rawAngleRad) * dragRadius;

        // Animate drag outward to end position (carpet is frozen so no drift)
        const steps = 8;
        const stepDelay = 30;
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const x = center.x + (endX - center.x) * t;
            const y = center.y + (endY - center.y) * t;
            this.reticle.setTarget(x, y);
            this.callbacks.simulateMouseMove(x, y);
            await this.delay(stepDelay);
        }


        // Mouse up triggers commitRotation → onRotationEnd
        this.callbacks.simulateMouseUp();
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
                console.warn(`[Playback] Timeout waiting for transition after ${maxWait}ms, forcing completion`);
                this.callbacks.forceCompleteTransition();
                break;
            }
            await this.delay(50);
        }
    }

    private async waitForResolvingClouds(): Promise<void> {
        if (!this.callbacks.hasResolvingClouds()) return;
        const maxWait = 5000;
        const start = performance.now();
        while (this.callbacks.hasResolvingClouds()) {
            if (performance.now() - start > maxWait) {
                console.warn(`[Playback] Timeout waiting for resolving clouds after ${maxWait}ms`);
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
                console.warn(`[Playback] Timeout waiting for spiral exits after ${maxWait}ms`);
                break;
            }
            await this.delay(50);
        }
    }

    private async waitForSupportingEntries(): Promise<void> {
        if (!this.callbacks.hasActiveSupportingEntries()) return;
        const maxWait = 5000;
        const start = performance.now();
        while (this.callbacks.hasActiveSupportingEntries()) {
            if (performance.now() - start > maxWait) {
                console.warn(`[Playback] Timeout waiting for supporting entries after ${maxWait}ms`);
                break;
            }
            await this.delay(50);
        }
    }

    private async waitForEnteringCarpets(): Promise<void> {
        if (!this.callbacks.hasEnteringCarpets()) return;
        const maxWait = 5000;
        const start = performance.now();
        while (this.callbacks.hasEnteringCarpets()) {
            if (performance.now() - start > maxWait) {
                console.warn(`[Playback] Timeout waiting for entering carpets after ${maxWait}ms`);
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
            if (this.state === 'ready') {
                this.beginPlayback();
            } else {
                this.exitDismissConfirmMode();
            }
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

        const isReady = this.state === 'ready';

        if (this.dismissButton) {
            this.dismissButton.style.display = (this.dismissConfirmMode || isReady) ? 'none' : 'flex';
        }
        if (this.resumeButton) {
            this.resumeButton.style.display = (this.dismissConfirmMode || isReady) ? 'flex' : 'none';
        }
        if (this.finalDismissButton) {
            this.finalDismissButton.style.display = (this.dismissConfirmMode && !isReady) ? 'flex' : 'none';
        }

        const seconds = Math.ceil(this.waitCountdown);
        const isLongWait = this.state === 'waiting' && seconds >= PlaybackController.LONG_WAIT_THRESHOLD;
        if (this.advanceButton) {
            this.advanceButton.style.display = (isLongWait && !this.dismissConfirmMode) ? 'flex' : 'none';
        }

        if (this.countdownDisplay && this.actionDisplay) {
            if (isReady) {
                this.countdownDisplay.textContent = '';
                this.actionDisplay.textContent = 'Start playback';
            } else if (this.state === 'error') {
                this.countdownDisplay.textContent = '';
                this.actionDisplay.innerHTML = this.errorMessage
                    .split('\n')
                    .map(line => `<div>${line}</div>`)
                    .join('') +
                    `<button onclick="window.location.reload()" style="margin-top:8px;padding:4px 12px;cursor:pointer">Restart app</button>`;
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

        this.callbacks.resumeSimTime();
    }
}
