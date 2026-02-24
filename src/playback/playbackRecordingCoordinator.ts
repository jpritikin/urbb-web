import { ActionRecorder, sessionToJSON } from './testability/recorder.js';
import { RNG, createModelRNG, SeededRNG } from './testability/rng.js';
import { PlaybackController, PlaybackCallbacks, ActionResult, ModelState, MenuSliceInfo, PlaybackSpeed } from './playback.js';
import type { RecordedSession, RecordedAction, SerializedModel, ViewSnapshot, OrchestratorSnapshot } from './testability/types.js';
import type { ThoughtBubble } from '../simulator/ifsModel.js';
import { STAR_CLOUD_ID, RAY_CLOUD_ID, MODE_TOGGLE_CLOUD_ID } from '../simulator/view/SeatManager.js';

export interface PlaybackRecordingDependencies {
    getModel: () => {
        toJSON(): SerializedModel;
        clone(): unknown;
        getTargetCloudIds(): Set<string>;
        getBlendedParts(): string[];
        getSelfRay(): { targetCloudId: string } | null;
        getAllPartIds(): string[];
        getMode(): 'panorama' | 'foreground';
        setSelfRay(cloudId: string): void;
        getConversationPhases(): Map<string, string>;
        getConversationTherapistDeltas(): Map<string, number>;
        getTherapistStanceDelta(cloudId: string): number;
        getConversationSpeakerId(): string | null;
        getConversationParticipantIds(): [string, string] | null;
        getConversationEffectiveStance(cloudId: string): number;
        getConversationPhase(cloudId: string): string | undefined;
        getSimulationTime(): number;
        getPendingAction(): { actionId: string; sourceCloudId: string } | null;
        getPendingBlends(): { cloudId: string }[];
        getThoughtBubbles(): ThoughtBubble[];
        freeze(): void;
        unfreeze(): void;
        parts: {
            isAgeRevealed(cloudId: string): boolean;
            isIdentityRevealed(cloudId: string): boolean;
            isJobRevealed(cloudId: string): boolean;
            isJobAppraisalRevealed(cloudId: string): boolean;
            getNeedAttention(cloudId: string): number;
            getTrust(cloudId: string): number;
            getRelationSummaries(): { fromId: string; toId: string; stance: number; trust: number }[];
            getRelationStance(fromId: string, toId: string): number;
            getInterPartTrust(fromId: string, toId: string): number;
        };
    };
    getCloudById: (id: string) => { text: string } | null;
    getCloudVisualCenter: (cloudId: string) => { x: number; y: number } | null;
    getView: () => {
        getVisualMode(): 'panorama' | 'foreground';
        getStarScreenPosition(): { x: number; y: number };
        getCloudState(cloudId: string): { x: number; y: number; opacity: number; targetOpacity: number; positionTarget: unknown; blendingDegree: number; targetBlendingDegree: number } | undefined;
        isTransitioning(): boolean;
        forceCompleteTransition(): void;
        hasActiveSpiralExits(): boolean;
        hasActiveSupportingEntries(): boolean;
        hasEnteringCarpets(): boolean;
        getViewSnapshot(): ViewSnapshot;
    };
    hasResolvingClouds: () => boolean;
    getTimeAdvancer: () => { getAndResetIntervalCount(): number; advanceIntervals(count: number): void; getAndResetAttentionDemandLog(): import('../simulator/timeAdvancer.js').AttentionDemandEntry[] } | null;
    getMessageOrchestrator: () => { getDebugState(): OrchestratorSnapshot; restoreState(snapshot: OrchestratorSnapshot): void } | null;
    getPieMenuController: () => { isOpen(): boolean; getMenuCenter(): { x: number; y: number } | null; getCurrentMenuItems(): { id: string }[] } | null;
    getAnimatedStar: () => { simulateClick(): void; getElement(): SVGGElement | null; setPointerEventsEnabled(enabled: boolean): void } | null;
    getUIManager: () => { isMobile(): boolean; getIsFullscreen(): boolean; simulateModeToggleClick(): void } | null;
    getContainer: () => HTMLElement | null;
    getSvgElement: () => SVGSVGElement | null;
    getCanvasDimensions: () => { width: number; height: number };
    simulateRayClick: () => void;
    executeSpontaneousBlendForPlayback: (cloudId: string) => void;
    promotePendingBlendForPlayback: (cloudId: string) => void;
    getCarpetRenderer: () => { getCarpetCenter(id: string): { x: number; y: number } | null; getCarpetVisualCenter(id: string): { x: number; y: number } | null; getTiltSign(id: string): number; isCarpetSettled(id: string): boolean; getCurrentDragStanceDelta(): number | null; getLockedDragSign(): number | null; setCarpetsInteractive(enabled: boolean): void } | null;
    checkBlendedPartsAttention: () => void;
    onRngChanged: (rng: RNG) => void;
    pauseAnimation: () => void;
}

export class PlaybackRecordingCoordinator {
    private recorder: ActionRecorder = new ActionRecorder();
    private playbackController: PlaybackController | null = null;
    private rng: RNG = createModelRNG();
    private simTimePaused: boolean = false;
    private lastActionResult: ActionResult | null = null;
    private downloadSessionHandler: (() => void) | null = null;
    private lastOrchestratorSnapshot: OrchestratorSnapshot | undefined;
    private pendingOrchMismatch: string | undefined;
    private _inStressPause: boolean = false;

    constructor(private deps: PlaybackRecordingDependencies) { }

    isInStressPause(): boolean {
        return this._inStressPause;
    }

    enterStressPause(): void {
        this._inStressPause = true;
        this.deps.getModel().freeze();
    }

    exitStressPause(): void {
        this._inStressPause = false;
        this.deps.getModel().unfreeze();
    }

    getRNG(): RNG {
        return this.rng;
    }

    setRNG(rng: RNG): void {
        this.rng = rng;
        this.deps.onRngChanged(rng);
    }

    setSeed(seed: number): void {
        this.setRNG(createModelRNG(seed));
    }

    startRecording(codeVersion: string, isMobile: boolean, playbackOf?: string, playbackOfHash?: string): void {
        if (!(this.rng instanceof SeededRNG)) {
            const seed = Math.floor(Math.random() * 2147483647);
            this.setRNG(createModelRNG(seed));
        }
        const platform = isMobile ? 'mobile' : 'desktop';
        this.lastOrchestratorSnapshot = this.deps.getMessageOrchestrator()?.getDebugState();
        this.recorder.start(
            this.deps.getModel().toJSON(),
            codeVersion,
            platform,
            this.rng as SeededRNG,
            playbackOf,
            playbackOfHash
        );
    }

    getRecordingSession(): RecordedSession | null {
        return this.recorder.getSession(
            this.deps.getModel().toJSON()
        );
    }

    stopRecording(): RecordedSession | null {
        this.recordIntervals();
        const session = this.recorder.getSession(
            this.deps.getModel().toJSON()
        );
        this.recorder.clear();
        return session;
    }

    isRecording(): boolean {
        return this.recorder.isRecording();
    }

    getRecorder(): ActionRecorder {
        return this.recorder;
    }

    setDownloadSessionHandler(handler: () => void): void {
        this.downloadSessionHandler = handler;
    }

    triggerDownload(): void {
        this.downloadSessionHandler?.();
    }

    addEffectiveTime(deltaTime: number): void {
        if (this.recorder.isRecording()) {
            this.recorder.addEffectiveTime(deltaTime);
        }
    }

    recordIntervals(): void {
        if (this.recorder.isRecording()) {
            const timeAdvancer = this.deps.getTimeAdvancer();
            const intervalCount = timeAdvancer?.getAndResetIntervalCount() ?? 0;
            if (intervalCount > 0) {
                const attentionDemands = timeAdvancer?.getAndResetAttentionDemandLog();
                const model = this.deps.getModel();
                const needAttention: Record<string, number> = {};
                for (const id of model.getAllPartIds()) {
                    needAttention[id] = model.parts.getNeedAttention(id);
                }
                const isTransitioning = this.deps.getView().isTransitioning();
                this.recorder.recordIntervals(intervalCount, attentionDemands, needAttention, isTransitioning, this.lastOrchestratorSnapshot);
            }
        }
    }

    markSpontaneousBlendTriggered(accumulatedTime: number): void {
        this.recorder.markSpontaneousBlendTriggered(
            this.rng.getCallCount(),
            accumulatedTime
        );
    }

    recordAction(action: RecordedAction): void {
        if (!this.recorder.isRecording()) return;

        this.recordIntervals();

        const orchState = this.deps.getMessageOrchestrator()?.getDebugState();
        const model = this.deps.getModel();
        const selfRay = model.getSelfRay();
        const biography: Record<string, { ageRevealed: boolean; identityRevealed: boolean; jobRevealed: boolean; jobAppraisalRevealed: boolean }> = {};
        const needAttention: Record<string, number> = {};
        const trust: Record<string, number> = {};

        for (const cloudId of model.getAllPartIds()) {
            biography[cloudId] = {
                ageRevealed: model.parts.isAgeRevealed(cloudId),
                identityRevealed: model.parts.isIdentityRevealed(cloudId),
                jobRevealed: model.parts.isJobRevealed(cloudId),
                jobAppraisalRevealed: model.parts.isJobAppraisalRevealed(cloudId),
            };
            needAttention[cloudId] = model.parts.getNeedAttention(cloudId);
            trust[cloudId] = model.parts.getTrust(cloudId);
        }

        const modelState = {
            targets: [...model.getTargetCloudIds()],
            blended: model.getBlendedParts(),
            pendingBlends: model.getPendingBlends().map(p => p.cloudId),
            selfRay: selfRay ? { targetCloudId: selfRay.targetCloudId } : null,
            pendingAction: model.getPendingAction(),
            biography,
            needAttention,
            trust,
            conversationPhases: Object.fromEntries(model.getConversationPhases()),
            conversationTherapistDelta: Object.fromEntries(model.getConversationTherapistDeltas()),
            conversationSpeakerId: model.getConversationSpeakerId(),
            conversationParticipantIds: model.getConversationParticipantIds(),
            interPartRelations: model.parts.getRelationSummaries(),
            thoughtBubbles: model.getThoughtBubbles().map(b => ({ id: b.id, cloudId: b.cloudId, text: b.text, validated: b.validated, partInitiated: b.partInitiated })),
            viewState: this.deps.getView().getViewSnapshot(),
        };

        this.recorder.record(action, orchState, modelState);
        this.lastOrchestratorSnapshot = orchState;
    }

    // Playback

    startPlayback(session: RecordedSession, speed?: PlaybackSpeed): void {
        const container = this.deps.getContainer();
        const svgElement = this.deps.getSvgElement();
        if (!container || !svgElement) return;

        const callbacks = this.createPlaybackCallbacks();
        this.playbackController = new PlaybackController(container, svgElement, callbacks, speed);
        this.playbackController.start(session);
    }

    updatePlayback(deltaTime: number): void {
        this.playbackController?.update(deltaTime);
    }

    isInPlaybackMode(): boolean {
        return this.playbackController !== null && this.playbackController.isPlaying();
    }

    isSimTimeRunning(): boolean {
        return !this.simTimePaused;
    }

    pauseSimTime(): void {
        this.simTimePaused = true;
    }

    resumeSimTime(): void {
        this.simTimePaused = false;
    }

    cancelPlayback(): void {
        this.playbackController?.cancel();
    }

    cancelIfReady(): void {
        this.playbackController?.cancelIfReady();
    }

    onCanvasResized(): void {
        this.playbackController?.onCanvasResized();
    }

    setLastActionResult(result: ActionResult): void {
        this.lastActionResult = result;
    }

    private createPlaybackCallbacks(): PlaybackCallbacks {
        const { width, height } = this.deps.getCanvasDimensions();

        return {
            getCloudPosition: (cloudId) => {
                if (cloudId === STAR_CLOUD_ID) {
                    return this.deps.getView().getStarScreenPosition();
                }
                if (cloudId === RAY_CLOUD_ID) {
                    const model = this.deps.getModel();
                    const selfRay = model.getSelfRay();
                    if (!selfRay) return null;
                    const starPos = this.deps.getView().getStarScreenPosition();
                    const cloudState = this.deps.getView().getCloudState(selfRay.targetCloudId);
                    const cloudPos = cloudState ? { x: cloudState.x, y: cloudState.y } : starPos;
                    return {
                        x: (starPos.x + cloudPos.x) / 2,
                        y: (starPos.y + cloudPos.y) / 2
                    };
                }
                if (cloudId === MODE_TOGGLE_CLOUD_ID) {
                    return { x: width - 42 + 16, y: 10 + 16 };
                }
                return this.deps.getCloudVisualCenter(cloudId);
            },
            getMenuCenter: () => this.deps.getPieMenuController()?.getMenuCenter() ?? null,
            getSlicePosition: (sliceIndex, menuCenter, itemCount) => {
                const angleStep = (2 * Math.PI) / itemCount;
                const startAngle = -Math.PI / 2;
                const angle = startAngle + sliceIndex * angleStep;
                const radius = 60;
                return {
                    x: menuCenter.x + radius * Math.cos(angle),
                    y: menuCenter.y + radius * Math.sin(angle)
                };
            },
            getMode: () => this.deps.getModel().getMode(),
            getPartName: (cloudId) => this.deps.getCloudById(cloudId)?.text ?? cloudId,
            getSimulationTime: () => this.deps.getModel().getSimulationTime(),
            getLastActionResult: () => this.lastActionResult,
            clearLastActionResult: () => { this.lastActionResult = null; },
            getModelState: (): ModelState => {
                const model = this.deps.getModel();
                return {
                    targets: [...model.getTargetCloudIds()],
                    blended: model.getBlendedParts()
                };
            },
            isTransitioning: () => this.deps.getView().isTransitioning(),
            forceCompleteTransition: () => this.deps.getView().forceCompleteTransition(),
            hasResolvingClouds: () => this.deps.hasResolvingClouds(),
            hasActiveSpiralExits: () => this.deps.getView().hasActiveSpiralExits(),
            hasActiveSupportingEntries: () => this.deps.getView().hasActiveSupportingEntries(),
            hasEnteringCarpets: () => this.deps.getView().hasEnteringCarpets(),
            isMobile: () => this.deps.getUIManager()?.isMobile() ?? false,
            getIsFullscreen: () => this.deps.getUIManager()?.getIsFullscreen() ?? false,
            findActionInOpenMenu: (actionId: string): MenuSliceInfo | null => {
                const items = this.deps.getPieMenuController()?.getCurrentMenuItems() ?? [];
                const sliceIndex = items.findIndex(item => item.id === actionId);
                if (sliceIndex < 0) return null;
                return { sliceIndex, itemCount: items.length };
            },
            getCurrentMenuItems: (): { id: string }[] => {
                return this.deps.getPieMenuController()?.getCurrentMenuItems() ?? [];
            },
            simulateHover: (x, y) => {
                this.simulateHoverAtPosition(x, y);
            },
            simulateClickAtPosition: (x, y) => {
                return this.simulateClickAtPosition(x, y);
            },
            pauseSimTime: () => {
                this.simTimePaused = true;
            },
            resumeSimTime: () => {
                this.simTimePaused = false;
            },
            advanceOneInterval: () => {
                this.deps.getTimeAdvancer()?.advanceIntervals(1);
                this.deps.checkBlendedPartsAttention();
            },
            advanceIntervals: (count: number, orchState?: OrchestratorSnapshot) => {
                if (orchState) {
                    const actualOrch = this.deps.getMessageOrchestrator()?.getDebugState();
                    if (actualOrch) {
                        const mismatches: string[] = [];
                        for (const [cloudId, expectedTime] of Object.entries(orchState.blendTimers)) {
                            const actualTime = actualOrch.blendTimers[cloudId] ?? 0;
                            if (Math.abs(expectedTime - actualTime) > 0.01) {
                                const getName = (id: string) => this.deps.getCloudById(id)?.text ?? id;
                                mismatches.push(`blendTimer ${getName(cloudId)}: expected ${expectedTime.toFixed(2)}, got ${actualTime.toFixed(2)}`);
                            }
                        }
                        const orchFields: (keyof OrchestratorSnapshot)[] = [
                            'respondTimer', 'regulationScore', 'sustainedRegulationTimer',
                            'newCycleTimer', 'listenerViolationTimer',
                        ];
                        for (const field of orchFields) {
                            const expected = orchState[field];
                            const actual = actualOrch[field];
                            if (typeof expected === 'number' && typeof actual === 'number' && Math.abs(expected - actual) > 0.01) {
                                mismatches.push(`${field}: expected ${expected.toFixed(3)}, got ${actual.toFixed(3)}`);
                            }
                        }
                        if (mismatches.length > 0) {
                            this.pendingOrchMismatch = mismatches.join('; ');
                        }
                    }
                }
                const rngBefore = this.rng.getCallCount();
                const model = this.deps.getModel();
                const speakerBefore = model.getConversationSpeakerId();
                const participantsBefore = model.getConversationParticipantIds();
                const modeBefore = model.getMode();
                const orchBefore = this.deps.getMessageOrchestrator()?.getDebugState();
                const blendsBefore = Object.entries(orchBefore?.blendTimers ?? {}).map(([id, t]) => `${id}=${t.toFixed(2)}`).join(',') || 'none';
                const simTimeBefore = model.getSimulationTime().toFixed(2);
                this.deps.getTimeAdvancer()?.advanceIntervals(count);
                this.deps.checkBlendedPartsAttention();
                const orchAfter = this.deps.getMessageOrchestrator()?.getDebugState();
                const blendsAfter = Object.entries(orchAfter?.blendTimers ?? {}).map(([id, t]) => `${id}=${t.toFixed(2)}`).join(',') || 'none';
                const simTimeAfter = model.getSimulationTime().toFixed(2);
                console.log(`[AdvanceIntervals] count=${count} simTime=${simTimeBefore}->${simTimeAfter} blendTimers: ${blendsBefore} -> ${blendsAfter}`);
                const rngAfter = this.rng.getCallCount();
                if (rngAfter !== rngBefore) {
                    console.log(`[AdvanceIntervals] rngDelta=${rngAfter - rngBefore} mode=${modeBefore} speaker=${speakerBefore} participants=${JSON.stringify(participantsBefore)} orchReg=${orchState?.regulationScore?.toFixed(2)} orchResp=${orchState?.respondTimer?.toFixed(2)}`);
                }
            },
            executeSpontaneousBlend: (cloudId: string) => {
                this.deps.executeSpontaneousBlendForPlayback(cloudId);
            },
            promotePendingBlend: (cloudId: string) => {
                this.deps.promotePendingBlendForPlayback(cloudId);
            },
            enterStressPause: () => this.enterStressPause(),
            exitStressPause: () => this.exitStressPause(),
            getCarpetCenter: (cloudId: string) => {
                return this.deps.getCarpetRenderer()?.getCarpetCenter(cloudId) ?? null;
            },
            getCarpetVisualCenter: (cloudId: string) => {
                return this.deps.getCarpetRenderer()?.getCarpetVisualCenter(cloudId) ?? null;
            },
            getCarpetTiltSign: (cloudId: string) => {
                return this.deps.getCarpetRenderer()?.getTiltSign(cloudId) ?? 1;
            },
            isCarpetSettled: (cloudId: string) => {
                return this.deps.getCarpetRenderer()?.isCarpetSettled(cloudId) ?? false;
            },
            getCurrentDragStanceDelta: () => {
                return this.deps.getCarpetRenderer()?.getCurrentDragStanceDelta() ?? null;
            },
            getLockedDragSign: () => {
                return this.deps.getCarpetRenderer()?.getLockedDragSign() ?? null;
            },
            setCarpetsInteractive: (enabled: boolean) => {
                this.deps.getCarpetRenderer()?.setCarpetsInteractive(enabled);
            },
            setStarInteractive: (enabled: boolean) => {
                this.deps.getAnimatedStar()?.setPointerEventsEnabled(enabled);
            },
            getDiagnostics: () => {
                const model = this.deps.getModel();
                const orchState = this.deps.getMessageOrchestrator()?.getDebugState();
                const view = this.deps.getView();
                const cloudStates: Record<string, unknown> = {};
                for (const id of [...model.getTargetCloudIds(), ...model.getBlendedParts()]) {
                    const cs = view.getCloudState(id);
                    if (cs) {
                        cloudStates[id] = {
                            opacity: cs.opacity.toFixed(3),
                            targetOpacity: cs.targetOpacity,
                            pos: `(${cs.x.toFixed(0)},${cs.y.toFixed(0)})`,
                            posTarget: cs.positionTarget,
                            blendDeg: cs.blendingDegree.toFixed(3),
                            targetBlendDeg: cs.targetBlendingDegree.toFixed(3),
                        };
                    }
                }
                const participantIds = model.getConversationParticipantIds();
                const effectiveStances: Record<string, number> = {};
                const phases: Record<string, string> = {};
                if (participantIds) {
                    for (const id of participantIds) {
                        effectiveStances[id] = model.getConversationEffectiveStance(id);
                        phases[id] = model.getConversationPhase(id) ?? '';
                    }
                }
                return {
                    mode: model.getMode(),
                    pendingAction: model.getPendingAction(),
                    rngCallCount: this.rng.getCallCount(),
                    rngCallLog: this.rng.getCallLog(),
                    orchestratorTimers: orchState?.blendTimers ?? {},
                    orchestratorCooldowns: orchState?.cooldowns ?? {},
                    orchestratorConversation: {
                        respondTimer: orchState?.respondTimer ?? 0,
                        regulationScore: orchState?.regulationScore ?? 0,
                        sustainedRegulationTimer: orchState?.sustainedRegulationTimer ?? 0,
                        newCycleTimer: orchState?.newCycleTimer ?? 0,
                        listenerViolationTimer: orchState?.listenerViolationTimer ?? 0,
                    },
                    conversationState: {
                        speaker: model.getConversationSpeakerId(),
                        participants: participantIds,
                        effectiveStances,
                        phases,
                    },
                    targets: [...model.getTargetCloudIds()],
                    blended: model.getBlendedParts(),
                    cloudStates,
                };
            },
            simulateMouseDown: (x: number, y: number) => {
                const { clientX, clientY } = this.svgToScreenCoords(x, y);
                // Temporarily disable cloud pointer events so carpet elements are hit-testable
                const svgEl = this.deps.getSvgElement();
                const cloudPaths = svgEl ? [...svgEl.querySelectorAll<SVGElement>('.cloud-group path')] : [];
                for (const p of cloudPaths) p.setAttribute('pointer-events', 'none');
                const element = document.elementFromPoint(clientX, clientY);
                for (const p of cloudPaths) p.setAttribute('pointer-events', 'all');
                const parentChain: string[] = [];
                let el: Element | null = element;
                for (let i = 0; i < 5 && el; i++) { parentChain.push(`${el.tagName}${el.id ? '#'+el.id : ''}.${(el as SVGElement).dataset?.carpetId ?? ''}[${el.getAttribute('class')?.slice(0,30) ?? ''}]`); el = el.parentElement; }
                console.log(`[SimMouseDown] svg(${x.toFixed(0)},${y.toFixed(0)}) client(${clientX.toFixed(0)},${clientY.toFixed(0)}) chain=${parentChain.join(' > ')} pointerEvents=${element ? getComputedStyle(element).pointerEvents : '?'}`);
                if (!element) return;
                element.dispatchEvent(new MouseEvent('mousedown', {
                    clientX, clientY, bubbles: true, cancelable: true
                }));
            },
            simulateMouseMove: (x: number, y: number) => {
                const { clientX, clientY } = this.svgToScreenCoords(x, y);
                const element = document.elementFromPoint(clientX, clientY);
                if (!element) return;
                element.dispatchEvent(new MouseEvent('mousemove', {
                    clientX, clientY, bubbles: true, cancelable: true
                }));
            },
            simulateMouseUp: () => {
                const svgElement = this.deps.getSvgElement();
                if (!svgElement) return;
                svgElement.dispatchEvent(new MouseEvent('mouseup', {
                    bubbles: true, cancelable: true
                }));
            },
            onActionCompleted: (action: RecordedAction): ActionResult => {
                return this.verifyPlaybackSync(action);
            },
            onPlaybackComplete: () => {
                this.playbackController = null;
            },
            onPlaybackCancelled: () => {
                this.playbackController = null;
            },
            onPlaybackError: () => {
                this.deps.pauseAnimation();
                this.downloadSessionHandler?.();
            }
        };
    }

    private simulateHoverAtPosition(x: number, y: number): void {
        const { clientX, clientY } = this.svgToScreenCoords(x, y);
        const element = document.elementFromPoint(clientX, clientY);
        if (!element) return;

        const mouseEnterEvent = new MouseEvent('mouseenter', {
            clientX,
            clientY,
            bubbles: true,
            cancelable: true
        });

        const mouseMoveEvent = new MouseEvent('mousemove', {
            clientX,
            clientY,
            bubbles: true,
            cancelable: true
        });

        element.dispatchEvent(mouseEnterEvent);
        element.dispatchEvent(mouseMoveEvent);
    }

    private svgToScreenCoords(x: number, y: number): { clientX: number; clientY: number } {
        const svgElement = this.deps.getSvgElement();
        const { width, height } = this.deps.getCanvasDimensions();
        if (!svgElement) return { clientX: x, clientY: y };
        const rect = svgElement.getBoundingClientRect();
        const viewBox = svgElement.viewBox.baseVal;
        const scaleX = rect.width / (viewBox.width || width);
        const scaleY = rect.height / (viewBox.height || height);
        return {
            clientX: rect.left + x * scaleX,
            clientY: rect.top + y * scaleY
        };
    }

    private simulateClickAtPosition(x: number, y: number, retryCount: number = 0): ActionResult {
        const { clientX, clientY } = this.svgToScreenCoords(x, y);
        const element = document.elementFromPoint(clientX, clientY);
        if (!element) {
            const svgElement = this.deps.getSvgElement();
            const rect = svgElement?.getBoundingClientRect();
            const viewBox = svgElement?.viewBox.baseVal;
            console.warn('[Playback] elementFromPoint returned null', {
                svgCoords: { x: x.toFixed(1), y: y.toFixed(1) },
                screenCoords: { clientX: clientX.toFixed(1), clientY: clientY.toFixed(1) },
                canvasRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
                viewBox: viewBox ? { width: viewBox.width, height: viewBox.height } : null,
            });
            return { success: false, error: `No element at svg(${x.toFixed(0)}, ${y.toFixed(0)}) screen(${clientX.toFixed(0)}, ${clientY.toFixed(0)})` };
        }

        const eventOpts = { clientX, clientY, bubbles: true, cancelable: true };
        element.dispatchEvent(new MouseEvent('mousedown', eventOpts));
        element.dispatchEvent(new MouseEvent('mouseup', eventOpts));
        element.dispatchEvent(new MouseEvent('click', eventOpts));

        return { success: true };
    }

    private verifyPlaybackSync(action: RecordedAction): ActionResult {
        const parts: string[] = [];

        if (this.pendingOrchMismatch) {
            parts.push(this.pendingOrchMismatch);
            this.pendingOrchMismatch = undefined;
        }

        if (action.rngCounts) {
            const actualModelCount = this.rng.getCallCount();
            if (action.rngCounts.model !== actualModelCount) {
                const actualLog = this.rng.getCallLog();
                const expectedDelta = action.rngLog ?? [];
                const prevExpectedCount = action.rngCounts.model - expectedDelta.length;
                const actualDelta = actualLog.slice(prevExpectedCount);
                console.log(`[Sync] RNG mismatch - expected: ${action.rngCounts.model}, actual: ${actualModelCount} (delta from ${prevExpectedCount})`,
                    `\n  expected (${expectedDelta.length}):`, expectedDelta.map(e => e.label).join(', '),
                    `\n  actual   (${actualDelta.length}):`, actualDelta.map(e => e.label).join(', '));
                parts.push(`model RNG count: expected ${action.rngCounts.model}, got ${actualModelCount}`);
            }
        }

        const expected = action.modelState;
        if (!expected) {
            if (parts.length > 0) {
                return { success: false, error: `Sync mismatch: ${parts.join('; ')}` };
            }
            return { success: true };
        }

        const model = this.deps.getModel();
        const actual = {
            targets: [...model.getTargetCloudIds()],
            blended: model.getBlendedParts()
        };

        const expectedTargets = new Set(expected.targets);
        const actualTargets = new Set(actual.targets);
        const expectedBlended = new Set(expected.blended);
        const actualBlended = new Set(actual.blended);

        const missingTargets = [...expectedTargets].filter(t => !actualTargets.has(t));
        const extraTargets = [...actualTargets].filter(t => !expectedTargets.has(t));
        const missingBlended = [...expectedBlended].filter(b => !actualBlended.has(b));
        const extraBlended = [...actualBlended].filter(b => !expectedBlended.has(b));

        if (expected.pendingBlends !== undefined) {
            const expectedPending = new Set(expected.pendingBlends);
            const actualPending = new Set(model.getPendingBlends().map(p => p.cloudId));
            const missingPending = [...expectedPending].filter(p => !actualPending.has(p));
            const extraPending = [...actualPending].filter(p => !expectedPending.has(p));
            const getName = (id: string) => this.deps.getCloudById(id)?.text ?? id;
            if (missingPending.length) parts.push(`missing pending: ${missingPending.map(getName).join(', ')}`);
            if (extraPending.length) parts.push(`extra pending: ${extraPending.map(getName).join(', ')}`);
        }

        if (missingTargets.length || extraTargets.length || missingBlended.length || extraBlended.length) {
            const getName = (id: string) => this.deps.getCloudById(id)?.text ?? id;
            if (missingTargets.length) parts.push(`missing targets: ${missingTargets.map(getName).join(', ')}`);
            if (extraTargets.length) parts.push(`extra targets: ${extraTargets.map(getName).join(', ')}`);
            if (missingBlended.length) parts.push(`missing blended: ${missingBlended.map(getName).join(', ')}`);
            if (extraBlended.length) parts.push(`extra blended: ${extraBlended.map(getName).join(', ')}`);
        }

        if ('pendingAction' in expected) {
            const actualPending = model.getPendingAction();
            const expId = expected.pendingAction?.actionId ?? null;
            const actId = actualPending?.actionId ?? null;
            if (expId !== actId) {
                parts.push(`pendingAction: expected ${expId ?? 'none'}, got ${actId ?? 'none'}`);
            }
        }

        if (expected.biography) {
            for (const [cloudId, expectedBio] of Object.entries(expected.biography)) {
                const actualBio = {
                    ageRevealed: model.parts.isAgeRevealed(cloudId),
                    identityRevealed: model.parts.isIdentityRevealed(cloudId),
                    jobRevealed: model.parts.isJobRevealed(cloudId),
                    jobAppraisalRevealed: model.parts.isJobAppraisalRevealed(cloudId),
                };
                const getName = (id: string) => this.deps.getCloudById(id)?.text ?? id;
                for (const [field, expectedVal] of Object.entries(expectedBio)) {
                    const actualVal = actualBio[field as keyof typeof actualBio];
                    if (expectedVal !== actualVal) {
                        parts.push(`${getName(cloudId)} ${field}: expected ${expectedVal}, got ${actualVal}`);
                    }
                }
            }
        }

        if (expected.trust) {
            const getName = (id: string) => this.deps.getCloudById(id)?.text ?? id;
            for (const [cloudId, expectedTrust] of Object.entries(expected.trust)) {
                const actualTrust = model.parts.getTrust(cloudId);
                if (Math.abs(expectedTrust - actualTrust) > 0.001) {
                    parts.push(`${getName(cloudId)} trust: expected ${expectedTrust.toFixed(3)}, got ${actualTrust.toFixed(3)}`);
                }
            }
        }

        const expectedSelfRay = expected.selfRay;
        const actualSelfRay = model.getSelfRay();
        if (expectedSelfRay?.targetCloudId !== actualSelfRay?.targetCloudId) {
            const getName = (id: string) => this.deps.getCloudById(id)?.text ?? id;
            const expectedName = expectedSelfRay?.targetCloudId ? getName(expectedSelfRay.targetCloudId) : 'null';
            const actualName = actualSelfRay?.targetCloudId ? getName(actualSelfRay.targetCloudId) : 'null';
            parts.push(`selfRay: expected ${expectedName}, got ${actualName}`);
        }

        if (expected.conversationTherapistDelta) {
            const getName = (id: string) => this.deps.getCloudById(id)?.text ?? id;
            for (const [cloudId, expectedDelta] of Object.entries(expected.conversationTherapistDelta)) {
                const actualDelta = model.getTherapistStanceDelta(cloudId);
                if (Math.abs(expectedDelta - actualDelta) > 0.001) {
                    parts.push(`${getName(cloudId)} therapistDelta: expected ${expectedDelta.toFixed(3)}, got ${actualDelta.toFixed(3)}`);
                }
            }
        }

        if (expected.interPartRelations) {
            const getName = (id: string) => this.deps.getCloudById(id)?.text ?? id;
            for (const exp of expected.interPartRelations) {
                if (exp.fromId === exp.toId) continue;
                const actualStance = model.parts.getRelationStance(exp.fromId, exp.toId);
                if (Math.abs(exp.stance - actualStance) > 0.001) {
                    parts.push(`${getName(exp.fromId)}→${getName(exp.toId)} stance: expected ${exp.stance.toFixed(3)}, got ${actualStance.toFixed(3)}`);
                }
                const actualTrust = model.parts.getInterPartTrust(exp.fromId, exp.toId);
                if (Math.abs(exp.trust - actualTrust) > 0.001) {
                    parts.push(`${getName(exp.fromId)}→${getName(exp.toId)} interTrust: expected ${exp.trust.toFixed(3)}, got ${actualTrust.toFixed(3)}`);
                }
            }
        }

        if (expected.conversationPhases) {
            const getName = (id: string) => this.deps.getCloudById(id)?.text ?? id;
            for (const [cloudId, expectedPhase] of Object.entries(expected.conversationPhases)) {
                const actualPhase = model.getConversationPhase(cloudId);
                if (expectedPhase !== actualPhase) {
                    parts.push(`${getName(cloudId)} phase: expected ${expectedPhase}, got ${actualPhase ?? 'none'}`);
                }
            }
        }

        if (expected.conversationSpeakerId !== undefined) {
            const actualSpeaker = model.getConversationSpeakerId();
            if (expected.conversationSpeakerId !== actualSpeaker) {
                const getName = (id: string) => this.deps.getCloudById(id)?.text ?? id;
                const exp = expected.conversationSpeakerId ? getName(expected.conversationSpeakerId) : 'none';
                const act = actualSpeaker ? getName(actualSpeaker) : 'none';
                parts.push(`speaker: expected ${exp}, got ${act}`);
            }
        }

        const expectedOrch = action.orchState;
        const actualOrch = this.deps.getMessageOrchestrator()?.getDebugState();
        if (expectedOrch && actualOrch) {
            for (const [cloudId, expectedTime] of Object.entries(expectedOrch.blendTimers)) {
                const actualTime = actualOrch.blendTimers[cloudId] ?? 0;
                if (Math.abs(expectedTime - actualTime) > 0.01) {
                    const getName = (id: string) => this.deps.getCloudById(id)?.text ?? id;
                    parts.push(`blendTimer ${getName(cloudId)}: expected ${expectedTime.toFixed(2)}, got ${actualTime.toFixed(2)}`);
                }
            }
        }

        if (parts.length > 0) {
            const actualBubbles = model.getThoughtBubbles();
            if (actualBubbles.length > 0) {
                const getName = (id: string) => this.deps.getCloudById(id)?.text ?? id;
                const desc = actualBubbles.map(b =>
                    `#${b.id} ${getName(b.cloudId)}:"${b.text.slice(0, 30)}"${b.validated ? '[V]' : ''}${b.partInitiated ? '[P]' : ''}`
                ).join(', ');
                parts.push(`bubbles: ${desc}`);
            }
            return { success: false, error: `Sync mismatch: ${parts.join('; ')}` };
        }

        return { success: true };
    }
}
