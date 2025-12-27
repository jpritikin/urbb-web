import { SimulatorModel, SelfRayState, PartMessage } from './ifsModel.js';
import { MessageRenderer } from './ifsView/MessageRenderer.js';
import { ThoughtBubbleRenderer } from './ifsView/ThoughtBubbleRenderer.js';
import { VictoryBanner } from './ifsView/VictoryBanner.js';
import { HelpPanel, HelpData } from './ifsView/HelpPanel.js';
import { SelfRay, BiographyField, PartContext } from './selfRay.js';
import { Cloud } from './cloudShape.js';
import { SeatInfo, CarpetState, CARPET_OFFSCREEN_DISTANCE } from './carpetRenderer.js';

function getOffscreenPosition(fromX: number, fromY: number, canvasWidth: number, canvasHeight: number): { x: number; y: number } {
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;
    const dx = fromX - centerX;
    const dy = fromY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) {
        return { x: centerX, y: centerY - CARPET_OFFSCREEN_DISTANCE };
    }
    const dirX = dx / dist;
    const dirY = dy / dist;
    return {
        x: centerX + dirX * CARPET_OFFSCREEN_DISTANCE,
        y: centerY + dirY * CARPET_OFFSCREEN_DISTANCE
    };
}
import { Vec3, CloudInstance } from './types.js';
import { STAR_OUTER_RADIUS } from './starAnimation.js';
import { ViewEventEmitter, ViewEventMap } from './ifsView/ViewEvents.js';
import { SeatManager } from './ifsView/SeatManager.js';
import { TransitionAnimator } from './ifsView/TransitionAnimator.js';
import {
    PositionTarget,
    SmoothingConfig,
    CloudAnimatedState,
    DEFAULT_SMOOTHING,
    LINEAR_INTERPOLATION_SPEED
} from './ifsView/types.js';

export { STAR_OUTER_RADIUS };
export type { PositionTarget, SmoothingConfig, CloudAnimatedState };
export { DEFAULT_SMOOTHING };

const BLENDED_OPACITY = 0.7;

export class SimulatorView {
    private events: ViewEventEmitter = new ViewEventEmitter();
    private seatManager: SeatManager;
    private transitionAnimator: TransitionAnimator;

    private cloudStates: Map<string, CloudAnimatedState> = new Map();
    private mode: 'panorama' | 'foreground' = 'panorama';
    private previousForegroundIds: Set<string> = new Set();
    private transitionProgress: number = 0;
    private transitionDuration: number = 1.0;
    private transitionDirection: 'forward' | 'reverse' | 'none' = 'none';
    private panoramaZoom: number = 0.5;
    private transitionStartZoom: number = 1.0;

    private canvasWidth: number;
    private canvasHeight: number;
    private perspectiveFactor: number = 600;
    private foregroundZoomFactor: number = 5.0;

    private starElement: SVGElement | null = null;
    private starCurrentX: number = 0;
    private starCurrentY: number = 0;
    private starTargetX: number = 0;
    private starTargetY: number = 0;

    private selfRay: SelfRay | null = null;
    private rayContainer: SVGGElement | null = null;
    private pieMenuOverlay: SVGGElement | null = null;
    private onSelfRayClick: ((cloudId: string, x: number, y: number, event: MouseEvent | TouchEvent) => void) | null = null;

    // Trace history for semantic events
    private traceHistory: string[] = [];
    private cloudNames: Map<string, string> = new Map();
    private pendingAction: string | null = null;

    // Part-to-part messages
    private messageRenderer: MessageRenderer | null = null;

    // Thought bubbles
    private thoughtBubbleRenderer: ThoughtBubbleRenderer | null = null;
    private onThoughtBubbleDismiss: (() => void) | null = null;

    // Victory banner
    private victoryBanner: VictoryBanner = new VictoryBanner();
    private htmlContainer: HTMLElement | null = null;

    // Help panel
    private helpPanel: HelpPanel = new HelpPanel();

    // Victory check throttle
    private lastVictoryCheck: number = 0;

    constructor(canvasWidth: number, canvasHeight: number) {
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.seatManager = new SeatManager(canvasWidth, canvasHeight);
        this.transitionAnimator = new TransitionAnimator({
            canvasWidth,
            canvasHeight,
            getCloudState: (cloudId) => this.cloudStates.get(cloudId),
            getOffscreenPosition: (fromX, fromY) => getOffscreenPosition(fromX, fromY, this.canvasWidth, this.canvasHeight),
            getConferenceTableRadius: () => this.getConferenceTableRadius(),
            getCloudPosition: (cloudId) => this.getCloudPosition(cloudId)
        });
    }

    on<K extends keyof ViewEventMap>(event: K, listener: (data: ViewEventMap[K]) => void): void {
        this.events.on(event, listener);
    }

    off<K extends keyof ViewEventMap>(event: K, listener: (data: ViewEventMap[K]) => void): void {
        this.events.off(event, listener);
    }

    setStarElement(element: SVGElement): void {
        this.starElement = element;
    }

    setHtmlContainer(container: HTMLElement): void {
        this.htmlContainer = container;
        container.style.position = 'relative';
        this.helpPanel.show(container);
    }

    updateHelpPanel(data: HelpData): void {
        this.helpPanel.update(data);
    }

    setRayContainer(container: SVGGElement): void {
        this.rayContainer = container;
    }

    setPieMenuOverlay(overlay: SVGGElement): void {
        this.pieMenuOverlay = overlay;
    }

    setMessageContainer(container: SVGGElement): void {
        this.messageRenderer = new MessageRenderer(
            container,
            (cloudId) => this.getCloudState(cloudId) ?? null,
            () => ({ width: this.canvasWidth, height: this.canvasHeight })
        );
    }

    setOnMessageReceived(callback: (message: PartMessage) => void): void {
        this.messageRenderer?.setOnMessageReceived(callback);
    }

    startMessage(message: PartMessage, senderCloudId: string, targetCloudId: string): void {
        this.messageRenderer?.startMessage(message, senderCloudId, targetCloudId);
    }

    animateMessages(deltaTime: number): void {
        this.messageRenderer?.animate(deltaTime);
    }

    clearMessages(): void {
        this.messageRenderer?.clear();
    }

    setThoughtBubbleContainer(container: SVGGElement): void {
        this.thoughtBubbleRenderer = new ThoughtBubbleRenderer(
            container,
            (cloudId) => this.getCloudState(cloudId) ?? null,
            () => ({ width: this.canvasWidth, height: this.canvasHeight })
        );
        this.thoughtBubbleRenderer.setOnDismiss(() => {
            this.onThoughtBubbleDismiss?.();
        });
    }

    setOnThoughtBubbleDismiss(callback: () => void): void {
        this.onThoughtBubbleDismiss = callback;
    }

    syncThoughtBubbles(model: SimulatorModel): void {
        if (!this.thoughtBubbleRenderer) return;
        if (this.mode !== 'foreground') {
            this.thoughtBubbleRenderer.hide();
            return;
        }
        const bubble = model.getCurrentThoughtBubble();
        this.thoughtBubbleRenderer.sync(bubble);
    }

    hideThoughtBubbles(): void {
        this.thoughtBubbleRenderer?.hide();
    }

    setOnSelfRayClick(callback: (cloudId: string, x: number, y: number, event: MouseEvent | TouchEvent) => void): void {
        this.onSelfRayClick = callback;
    }

    setOnModeChange(callback: (mode: 'panorama' | 'foreground') => void): void {
        this.events.on('mode-changed', (data) => callback(data.mode));
    }

    setDimensions(width: number, height: number): void {
        this.canvasWidth = width;
        this.canvasHeight = height;
        this.seatManager.setDimensions(width, height);
        this.transitionAnimator.setDimensions(width, height);
    }

    getMode(): 'panorama' | 'foreground' {
        return this.mode;
    }

    setMode(mode: 'panorama' | 'foreground'): void {
        if (mode !== this.mode) {
            const wasTransitioning = this.transitionDirection !== 'none' && this.transitionProgress < 1;
            const oldDirection = this.transitionDirection;

            // Capture current zoom BEFORE changing mode/direction (so getCurrentZoomFactor returns correct value)
            const currentZoom = this.getCurrentZoomFactor();

            this.mode = mode;

            if (mode === 'foreground') {
                this.transitionDirection = 'forward';
            } else {
                this.transitionDirection = 'reverse';
            }

            if (wasTransitioning && oldDirection !== this.transitionDirection) {
                // Switching direction mid-transition: continue from current position
                this.transitionProgress = 1 - this.transitionProgress;
            } else {
                this.transitionProgress = 0;
                this.transitionStartZoom = currentZoom;
            }

            // Reset opacity smoothing for all clouds to ensure consistent transition speed
            for (const state of this.cloudStates.values()) {
                state.smoothing.opacity = DEFAULT_SMOOTHING.opacity;
            }

            this.events.emit('mode-changed', { mode });
            this.events.emit('transition-started', { direction: this.transitionDirection });
        }
    }

    setPanoramaZoom(zoom: number): void {
        this.panoramaZoom = zoom;
    }

    getPanoramaZoom(): number {
        return this.panoramaZoom;
    }

    setTransitionDuration(seconds: number): void {
        this.transitionDuration = seconds;
    }

    getTransitionDuration(): number {
        return this.transitionDuration;
    }

    initializeViewStates(instances: CloudInstance[], panoramaPositions: Map<string, { x: number; y: number; scale: number }>): void {
        for (const instance of instances) {
            const pos = panoramaPositions.get(instance.cloud.id);
            if (pos) {
                this.initializeCloudState(instance.cloud.id, pos, { type: 'panorama' });
            }
        }
    }

    projectToScreen(instance: CloudInstance): { x: number; y: number; scale: number } {
        const scale = this.perspectiveFactor / (this.perspectiveFactor - instance.position.z);
        const projectedX = instance.position.x * scale;
        const projectedY = instance.position.y * scale;
        return {
            x: this.canvasWidth / 2 + projectedX,
            y: this.canvasHeight / 2 + projectedY,
            scale
        };
    }

    private easeInOutCubic(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    private getConferenceTableRadius(seatCount?: number): number {
        return this.seatManager.getConferenceTableRadius(seatCount);
    }

    getCloudPosition(cloudId: string): { x: number; y: number } | undefined {
        return this.seatManager.getCloudPosition(cloudId);
    }

    getStarPosition(): { x: number; y: number } {
        return this.seatManager.getStarPosition();
    }

    getUnblendedSeatPosition(): { x: number; y: number } | undefined {
        return this.seatManager.getUnblendedSeatPosition();
    }

    isSeated(cloudId: string): boolean {
        return this.seatManager.isSeated(cloudId);
    }

    resolvePositionTarget(
        target: PositionTarget,
        cloudId: string,
        panoramaPositions: Map<string, { x: number; y: number; scale: number }>,
        model: SimulatorModel
    ): { x: number; y: number; scale: number } {
        const targetIds = Array.from(model.getTargetCloudIds());
        const totalSeats = targetIds.length + 1; // star + targets (blended parts sit on star)
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;

        switch (target.type) {
            case 'panorama': {
                const pos = panoramaPositions.get(cloudId);
                const x = pos?.x ?? centerX;
                const y = pos?.y ?? centerY;
                const scale = pos?.scale ?? 1;
                return { x, y, scale };
            }

            case 'panorama-ui': {
                // For FG clouds in uiGroup during reverse transition
                // Target is panorama position transformed to screen coords
                const pos = panoramaPositions.get(cloudId);
                const rawX = pos?.x ?? centerX;
                const rawY = pos?.y ?? centerY;
                const rawScale = pos?.scale ?? 1;
                const zoom = this.panoramaZoom;
                return {
                    x: centerX + (rawX - centerX) * zoom,
                    y: centerY + (rawY - centerY) * zoom,
                    scale: rawScale * zoom
                };
            }

            case 'seat': {
                const pos = this.getCloudPosition(target.cloudId) ?? { x: centerX, y: centerY };
                return { x: pos.x, y: pos.y, scale: 1 };
            }

            case 'star': {
                const starPos = this.getStarPosition();
                return {
                    x: starPos.x + (target.offsetX ?? 0),
                    y: starPos.y + (target.offsetY ?? 0),
                    scale: 1
                };
            }

            case 'supporting': {
                const targetPos = this.getCloudPosition(target.targetId) ?? { x: centerX, y: centerY };
                const angle = Math.atan2(targetPos.y - centerY, targetPos.x - centerX);
                const distance = 80 + target.index * 50;
                return {
                    x: targetPos.x + Math.cos(angle) * distance,
                    y: targetPos.y + Math.sin(angle) * distance,
                    scale: 1
                };
            }

            case 'blended': {
                // Position cloud so anchor edge stays at star's far side
                // The lattice stretch moves the far edge toward the seat
                const seatPos = this.getUnblendedSeatPosition() ?? { x: centerX, y: centerY };
                const starPos = this.getStarPosition();
                const starX = starPos.x + target.offsetX;
                const starY = starPos.y + target.offsetY;

                // Direction from star to seat
                const dx = seatPos.x - starX;
                const dy = seatPos.y - starY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 1) {
                    return { x: starX, y: starY, scale: 1 };
                }
                const dirX = dx / dist;
                const dirY = dy / dist;

                // Position cloud center so anchor edge is at star's far side
                // Anchor edge offset from cloud center is roughly half cloud width (~40px)
                // Star's far edge is STAR_OUTER_RADIUS (~20px) from star center
                // So cloud center is shifted toward seat by (half_cloud_width - STAR_OUTER_RADIUS)
                const ESTIMATED_HALF_CLOUD_WIDTH = 40;
                const anchorToCenter = ESTIMATED_HALF_CLOUD_WIDTH - STAR_OUTER_RADIUS;
                return {
                    x: starX + dirX * anchorToCenter,
                    y: starY + dirY * anchorToCenter,
                    scale: 1
                };
            }

            case 'absolute': {
                return { x: target.x, y: target.y, scale: 1 };
            }
        }
    }

    private updateSeatAssignments(oldModel: SimulatorModel | null, newModel: SimulatorModel): void {
        this.seatManager.updateSeatAssignments(oldModel, newModel);
    }

    getCarpetStates(): Map<string, CarpetState> {
        return this.seatManager.getCarpets();
    }

    getSeats(): SeatInfo[] {
        return this.seatManager.getSeats();
    }

    syncWithModel(
        oldModel: SimulatorModel | null,
        newModel: SimulatorModel,
        instances: CloudInstance[],
        panoramaPositions: Map<string, { x: number; y: number; scale: number }>,
        relationships: { getProtecting: (id: string) => Set<string> }
    ): void {
        if (newModel.hasPendingAttentionDemand()) {
            newModel.consumeAttentionDemand();
            this.setMode('foreground');
        }

        // Check for displaced parts and start spiral exits
        const displacedParts = newModel.getDisplacedParts();
        const hasDisplacements = displacedParts.size > 0;

        for (const cloudId of displacedParts) {
            this.transitionAnimator.startSpiralExit(cloudId);
            newModel.clearDisplacedPart(cloudId);
        }

        // If parts were displaced, delay the arrival of NEW parts (not parts that were already visible)
        if (hasDisplacements) {
            const arrivalDelay = 4.0;

            // Only delay parts that weren't already in foreground (i.e., truly new arrivals)
            // Parts that were displaced are spiraling away; parts NOT displaced were already visible
            for (const blendedId of newModel.getBlendedParts()) {
                if (!this.transitionAnimator.isAwaitingArrival(blendedId)) {
                    this.transitionAnimator.scheduleDelayedArrival(blendedId, arrivalDelay);
                }
            }

            // Delay targets only if they weren't already visible
            for (const targetId of newModel.getTargetCloudIds()) {
                if (!this.transitionAnimator.isAwaitingArrival(targetId)) {
                    this.transitionAnimator.scheduleDelayedArrival(targetId, arrivalDelay);
                }
            }
        }

        this.updateSeatAssignments(oldModel, newModel);
        this.updateStarPosition(newModel);
        this.updateCloudStateTargets(newModel, instances);
        this.syncSelfRay(newModel);
        this.syncThoughtBubbles(newModel);

        this.generateTraceEntries(oldModel, newModel);

        this.checkVictoryCondition(newModel, relationships);
    }

    checkVictoryCondition(model: SimulatorModel, relationships: { getProtecting: (id: string) => Set<string> }): void {
        if (this.victoryBanner.isShown() || !this.htmlContainer) return;

        const now = Date.now();
        if (now - this.lastVictoryCheck < 1000) return;
        this.lastVictoryCheck = now;

        if (model.checkAndSetVictory(relationships)) {
            this.victoryBanner.show(this.htmlContainer);
            this.events.emit('victory-achieved', {});
        }
    }

    private syncSelfRay(model: SimulatorModel): void {
        const modelRay = model.getSelfRay();

        if (!modelRay || this.mode !== 'foreground') {
            if (this.selfRay) {
                this.selfRay.remove();
                this.selfRay = null;
            }
            return;
        }

        if (this.selfRay && this.selfRay.getTargetCloudId() !== modelRay.targetCloudId) {
            this.selfRay.remove();
            this.selfRay = null;
        }

        if (!this.selfRay && this.rayContainer) {
            const cloudState = this.cloudStates.get(modelRay.targetCloudId);
            if (!cloudState) return;

            const starPos = this.getStarPosition();

            this.selfRay = new SelfRay(this.rayContainer, {
                startX: starPos.x,
                startY: starPos.y,
                endX: cloudState.x,
                endY: cloudState.y,
                targetCloudId: modelRay.targetCloudId
            });

            this.selfRay.setOnClick((cloudId, x, y, event) => {
                this.onSelfRayClick?.(cloudId, x, y, event);
            });

            const rayElement = this.selfRay.create();
            this.rayContainer.appendChild(rayElement);
        }

        if (this.selfRay) {
            const openness = model.parts.getOpenness(modelRay.targetCloudId);
            const targetCount = Math.max(1, model.getTargetCloudIds().size);
            const trustGain = openness / targetCount;
            this.selfRay.setTrustGainFeedback(trustGain);
        }
    }

    updateSelfRayPosition(): void {
        if (!this.selfRay) return;

        const cloudState = this.cloudStates.get(this.selfRay.getTargetCloudId());
        if (cloudState) {
            const starPos = this.getStarPosition();
            this.selfRay.updatePosition(starPos.x, starPos.y, cloudState.x, cloudState.y);
        }
    }

    animateSelfRay(deltaTime: number): void {
        this.selfRay?.animate(deltaTime);
    }

    private updateCloudStateTargets(model: SimulatorModel, instances: CloudInstance[]): void {
        const targetIds = model.getTargetCloudIds();
        const blendedParts = model.getBlendedParts();
        const pendingBlends = model.getPendingBlends();
        const blendedDegrees = model.getBlendedPartsWithDegrees();
        const allSupporting = model.getAllSupportingParts();

        // Build supporting index map (which target each supporting cloud backs, and at what index)
        const supportingInfo = new Map<string, { targetId: string; index: number }>();
        for (const targetId of targetIds) {
            const supportingIds = Array.from(model.getSupportingParts(targetId));
            supportingIds.forEach((supportingId, index) => {
                supportingInfo.set(supportingId, { targetId, index });
            });
        }

        // Build current foreground set
        const currentForegroundIds = new Set<string>();

        for (const instance of instances) {
            const cloudId = instance.cloud.id;
            const state = this.cloudStates.get(cloudId);
            if (!state) continue;

            const isTarget = targetIds.has(cloudId);
            const isBlended = blendedParts.includes(cloudId);
            const isPendingBlend = pendingBlends.some(p => p.cloudId === cloudId);
            const isSupporting = allSupporting.has(cloudId);
            const isInForeground = isTarget || isBlended || isPendingBlend || isSupporting;

            const inForegroundMode = this.mode === 'foreground' ||
                (this.transitionDirection === 'reverse' && this.transitionProgress < 1);
            if (inForegroundMode && isInForeground) {
                currentForegroundIds.add(cloudId);
            }

            // Skip clouds that are currently fly-out exiting
            if (this.transitionAnimator.isFlyOutExiting(cloudId)) {
                continue;
            }

            // Determine position target based on role
            let positionTarget: PositionTarget;
            let targetOpacity = 1;

            if (this.mode === 'foreground' && isInForeground) {
                if (isBlended) {
                    const blendReason = model.getBlendReason(cloudId);

                    if (blendReason === 'spontaneous') {
                        // Spontaneous blends stay at the star until they become targets
                        positionTarget = { type: 'star' };
                    } else {
                        // Therapist-initiated blends interpolate between star and seat
                        // Get or create blended offset
                        const offset = this.transitionAnimator.getOrCreateBlendedOffset(cloudId);
                        positionTarget = {
                            type: 'blended',
                            cloudId,
                            offsetX: offset.x,
                            offsetY: offset.y
                        };

                        // Set blending degree target
                        const degree = blendedDegrees.get(cloudId) ?? 1;
                        state.targetBlendingDegree = degree;
                    }
                    targetOpacity = BLENDED_OPACITY;
                } else if (isPendingBlend) {
                    positionTarget = { type: 'star' };
                    targetOpacity = BLENDED_OPACITY;
                } else if (isTarget) {
                    positionTarget = { type: 'seat', cloudId };
                } else if (isSupporting) {
                    const info = supportingInfo.get(cloudId)!;
                    positionTarget = {
                        type: 'supporting',
                        targetId: info.targetId,
                        index: info.index
                    };
                    // Start fly-in animation for newly appearing supporting parts
                    if (!this.previousForegroundIds.has(cloudId) && !this.transitionAnimator.isSupportingEntering(cloudId)) {
                        this.transitionAnimator.startSupportingEntry(cloudId, info.targetId, info.index);
                    }
                } else {
                    positionTarget = { type: 'panorama' };
                }
            } else if (this.mode === 'foreground') {
                // In foreground mode but not part of the conference
                // Check if this part just left foreground - trigger fly-out exit
                if (this.previousForegroundIds.has(cloudId) && !this.transitionAnimator.isSpiralExiting(cloudId)) {
                    this.transitionAnimator.startFlyOutExit(cloudId);
                    continue;
                }
                positionTarget = { type: 'panorama' };
                targetOpacity = 0;
            } else {
                // Panorama mode (or reverse transition)
                // FG clouds in uiGroup need zoom-adjusted target
                if (this.transitionDirection === 'reverse' && this.previousForegroundIds.has(cloudId)) {
                    positionTarget = { type: 'panorama-ui' };
                } else {
                    positionTarget = { type: 'panorama' };
                }
            }

            // Don't override state for parts in entry animation (supporting entries handle their own state)
            if (!this.transitionAnimator.isSupportingEntering(cloudId)) {
                state.positionTarget = positionTarget;
                // Don't override opacity for delayed arrivals - they should stay invisible until arrival time
                if (!this.transitionAnimator.isAwaitingArrival(cloudId)) {
                    state.targetOpacity = targetOpacity;
                }
            }
            state.targetScale = 1;
        }

        // Detect clouds that newly joined the foreground (while already in foreground mode)
        if (this.mode === 'foreground' && this.transitionDirection === 'none') {
            const newlyJoined: string[] = [];
            for (const cloudId of currentForegroundIds) {
                if (!this.previousForegroundIds.has(cloudId)) {
                    newlyJoined.push(cloudId);
                }
            }
            if (newlyJoined.length > 0) {
                this.events.emit('clouds-joined-foreground', { cloudIds: newlyJoined });
            }
        }

        // Update previous foreground set for next frame
        this.previousForegroundIds = currentForegroundIds;
    }

    updateBlendedLatticeDeformations(model: SimulatorModel, instances: CloudInstance[], resolvingClouds: Set<string> = new Set()): void {
        for (const instance of instances) {
            const cloud = instance.cloud;

            // Skip clouds that are in the resolution animation
            if (resolvingClouds.has(cloud.id)) continue;

            const stretchInfo = this.getBlendedLatticeStretch(cloud, model);

            if (stretchInfo) {
                cloud.setBlendedStretch(stretchInfo.stretchX, stretchInfo.stretchY, stretchInfo.anchorSide);
            } else {
                cloud.clearBlendedStretch();
                this.transitionAnimator.deleteStretchAnimator(cloud.id);
            }
        }
    }

    animateStretchEffects(deltaTime: number): void {
        this.transitionAnimator.animateStretchEffects(deltaTime);
    }

    triggerOvershoot(cloudId: string): void {
        this.transitionAnimator.triggerOvershoot(cloudId);
    }


    private findTargetForSupporting(model: SimulatorModel, supportingId: string): string | null {
        for (const targetId of model.getTargetCloudIds()) {
            const supportingIds = model.getSupportingParts(targetId);
            if (supportingIds.has(supportingId)) {
                return targetId;
            }
        }
        return null;
    }

    private setsEqual(a: Set<string>, b: Set<string>): boolean {
        if (a.size !== b.size) return false;
        for (const item of a) {
            if (!b.has(item)) return false;
        }
        return true;
    }

    animate(deltaTime: number): void {
        if (this.transitionDirection !== 'none' && this.transitionProgress < 1) {
            this.transitionProgress = Math.min(1, this.transitionProgress + deltaTime / this.transitionDuration);
            if (this.transitionProgress >= 1) {
                this.transitionDirection = 'none';
                this.events.emit('transition-completed', {});
            }
        }

        this.seatManager.animate(deltaTime, this.mode);
        this.animateStar(deltaTime);
    }

    animateCloudStates(
        deltaTime: number,
        panoramaPositions: Map<string, { x: number; y: number; scale: number }>,
        model: SimulatorModel
    ): { completedUnblendings: string[]; completedPendingBlends: string[] } {
        const completedUnblendings: string[] = [];
        const completedPendingBlends: string[] = [];
        const pendingBlendIds = new Set(model.getPendingBlends().map(p => p.cloudId));
        const starPos = this.getStarPosition();

        for (const [cloudId, state] of this.cloudStates) {
            // Resolve semantic position target to actual x/y
            const resolved = this.resolvePositionTarget(
                state.positionTarget,
                cloudId,
                panoramaPositions,
                model
            );


            // Apply linear interpolation to position and scale
            const posDiff = Math.sqrt((resolved.x - state.x) ** 2 + (resolved.y - state.y) ** 2);
            if (posDiff > 0.5) {
                state.x += (resolved.x - state.x) * deltaTime * LINEAR_INTERPOLATION_SPEED;
                state.y += (resolved.y - state.y) * deltaTime * LINEAR_INTERPOLATION_SPEED;
            } else {
                state.x = resolved.x;
                state.y = resolved.y;
            }

            const scaleDiff = resolved.scale - state.scale;
            if (Math.abs(scaleDiff) > 0.001) {
                state.scale += scaleDiff * deltaTime * LINEAR_INTERPOLATION_SPEED;
            } else {
                state.scale = resolved.scale;
            }

            // For non-fg clouds fading out during forward transition, use late fade
            const isFadingOut = state.targetOpacity === 0 && state.opacity > 0;
            const isForwardTransition = this.transitionDirection === 'forward' && this.transitionProgress < 1;
            if (isFadingOut && isForwardTransition) {
                // Stay opaque until late in transition, then fade quickly
                // progress 0→0.7: opacity stays at 1
                // progress 0.7→1: opacity fades 1→0
                const fadeStart = 0.7;
                if (this.transitionProgress < fadeStart) {
                    state.opacity = 1;
                } else {
                    const fadeProgress = (this.transitionProgress - fadeStart) / (1 - fadeStart);
                    state.opacity = 1 - fadeProgress;
                }
            } else if (state.smoothing.opacity > 0) {
                const factor = 1 - Math.exp(-state.smoothing.opacity * deltaTime);
                state.opacity += (state.targetOpacity - state.opacity) * factor;
                // Snap to target when very close to avoid lingering at near-zero opacity
                if (Math.abs(state.opacity - state.targetOpacity) < 0.05) {
                    state.opacity = state.targetOpacity;
                }
            } else {
                state.opacity = state.targetOpacity;
            }

            // Track previous degree for detecting completion
            const prevDegree = state.blendingDegree;

            if (state.smoothing.blendingDegree > 0) {
                const factor = 1 - Math.exp(-state.smoothing.blendingDegree * deltaTime);
                state.blendingDegree += (state.targetBlendingDegree - state.blendingDegree) * factor;
            } else {
                state.blendingDegree = state.targetBlendingDegree;
            }

            // Detect when blending completes (degree reaches ~0)
            if (prevDegree > 0.01 && state.blendingDegree <= 0.01 && state.targetBlendingDegree <= 0.01) {
                completedUnblendings.push(cloudId);
            }

            // Detect when pending blend reaches the star
            if (pendingBlendIds.has(cloudId)) {
                const dx = state.x - starPos.x;
                const dy = state.y - starPos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < 30) {
                    completedPendingBlends.push(cloudId);
                }
            }
        }

        return { completedUnblendings, completedPendingBlends };
    }

    getCloudState(cloudId: string): CloudAnimatedState | undefined {
        return this.cloudStates.get(cloudId);
    }

    setCloudTarget(
        cloudId: string,
        target: Partial<{
            positionTarget: PositionTarget;
            targetScale: number;
            targetOpacity: number;
            targetBlendingDegree: number;
            smoothing: Partial<SmoothingConfig>;
        }>
    ): void {
        const state = this.cloudStates.get(cloudId);
        if (!state) return;

        if (target.positionTarget !== undefined) {
            state.positionTarget = target.positionTarget;
        }
        if (target.targetScale !== undefined) {
            state.targetScale = target.targetScale;
        }
        if (target.targetOpacity !== undefined) {
            state.targetOpacity = target.targetOpacity;
        }
        if (target.targetBlendingDegree !== undefined) {
            state.targetBlendingDegree = target.targetBlendingDegree;
        }
        if (target.smoothing) {
            Object.assign(state.smoothing, target.smoothing);
        }
    }

    initializeCloudState(
        cloudId: string,
        initialPosition: { x: number; y: number; scale: number },
        positionTarget: PositionTarget
    ): void {
        this.cloudStates.set(cloudId, {
            cloudId,
            x: initialPosition.x,
            y: initialPosition.y,
            scale: initialPosition.scale,
            opacity: 1,
            blendingDegree: 1,
            positionTarget,
            targetScale: initialPosition.scale,
            targetOpacity: 1,
            targetBlendingDegree: 1,
            smoothing: { ...DEFAULT_SMOOTHING }
        });
    }

    isSeatCountAnimating(): boolean {
        return this.seatManager.isSeatCountAnimating();
    }

    isConferenceRotating(): boolean {
        return this.mode === 'foreground' && this.seatManager.isConferenceRotating();
    }

    setConferenceRotationPaused(paused: boolean): void {
        this.seatManager.setConferenceRotationPaused(paused);
    }

    updateForegroundPositions(model: SimulatorModel, instances: CloudInstance[]): void {
        if (this.mode !== 'foreground') return;

        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        const starPos = this.getStarPosition();
        this.starTargetX = starPos.x - centerX;
        this.starTargetY = starPos.y - centerY;
    }

    private animateStar(deltaTime: number): void {
        if (!this.starElement) return;

        const dx = this.starTargetX - this.starCurrentX;
        const dy = this.starTargetY - this.starCurrentY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 0.5) {
            this.starCurrentX += dx * deltaTime * LINEAR_INTERPOLATION_SPEED;
            this.starCurrentY += dy * deltaTime * LINEAR_INTERPOLATION_SPEED;
        } else {
            this.starCurrentX = this.starTargetX;
            this.starCurrentY = this.starTargetY;
        }

        this.starElement.setAttribute('transform', `translate(${this.starCurrentX}, ${this.starCurrentY})`);
    }

    transformStarPosition(factor: number): void {
        this.starCurrentX *= factor;
        this.starCurrentY *= factor;
        this.starTargetX *= factor;
        this.starTargetY *= factor;
    }

    getStarScreenPosition(): { x: number; y: number } {
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        return {
            x: centerX + this.starCurrentX,
            y: centerY + this.starCurrentY
        };
    }

    getStarTargetPosition(): { x: number; y: number } {
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        return {
            x: centerX + this.starTargetX,
            y: centerY + this.starTargetY
        };
    }

    private updateStarPosition(model: SimulatorModel): void {
        const targetIds = model.getTargetCloudIds();
        const blendedParts = model.getBlendedParts();
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;

        if (this.mode === 'foreground' && (targetIds.size > 0 || blendedParts.length > 0)) {
            const starPos = this.getStarPosition();
            this.starTargetX = starPos.x - centerX;
            this.starTargetY = starPos.y - centerY;
        } else {
            this.starTargetX = 0;
            this.starTargetY = 0;
        }
    }

    clearAllCloudStates(): void {
        this.cloudStates.clear();
    }

    getBlendedStretchTarget(cloud: Cloud, model: SimulatorModel): { x: number; y: number } | null {
        const cloudId = cloud.id;
        if (!model.isBlended(cloudId)) return null;
        if (cloud.animatedBlendingDegree >= 1) return null;

        return this.getCloudPosition(cloudId) ?? null;
    }

    getBlendedLatticeStretch(cloud: Cloud, model: SimulatorModel): { stretchX: number; stretchY: number; anchorSide: 'left' | 'right' | 'top' | 'bottom'; anchorOffsetX: number; anchorOffsetY: number } | null {
        const cloudId = cloud.id;
        if (!model.isBlended(cloudId)) return null;

        // No stretch animation for spontaneous blends
        if (model.getBlendReason(cloudId) !== 'therapist') return null;

        const degree = cloud.animatedBlendingDegree;
        if (degree >= 1) return null;

        const seatPos = this.getUnblendedSeatPosition();
        if (!seatPos) return null;

        const offset = this.transitionAnimator.getBlendedOffset(cloudId);
        const starPos = this.getStarPosition();
        const starX = starPos.x + (offset?.x ?? 0);
        const starY = starPos.y + (offset?.y ?? 0);

        const qDx = seatPos.x - starX;
        const qDy = seatPos.y - starY;
        const qLength = Math.sqrt(qDx * qDx + qDy * qDy);

        if (qLength < 1) return null;

        // Get or create stretch animator for this cloud
        const animator = this.transitionAnimator.getOrCreateStretchAnimator(cloudId);

        // Check if user has actively unblended (degree decreased significantly)
        animator.checkDegreeChange(degree);

        // Get stretch factor, offset, and angle from animator
        const stretchFactor = animator.getStretchFactor();
        const stretchOffset = animator.getStretchOffset();
        const stretchAngle = animator.getStretchAngle();

        // Cloud center is offset from star (anchor edge at star's far side)
        // Stretch only needs to move far edge from its current position to seat
        // effectiveDistance = qLength - anchorToCenter - halfWidth
        //                   = qLength - (halfWidth - STAR_OUTER_RADIUS) - halfWidth
        //                   = qLength - 2*halfWidth + STAR_OUTER_RADIUS
        const ESTIMATED_HALF_CLOUD_WIDTH = 40;
        const effectiveDistance = Math.max(0, qLength - 2 * ESTIMATED_HALF_CLOUD_WIDTH + STAR_OUTER_RADIUS);
        const baseStretchAmount = (1 - degree) * effectiveDistance;
        const stretchAmount = baseStretchAmount * stretchFactor + stretchOffset;

        // Apply angle offset to stretch direction
        const baseAngle = Math.atan2(qDy, qDx);
        const adjustedAngle = baseAngle + stretchAngle;
        const stretchX = Math.cos(adjustedAngle) * stretchAmount;
        const stretchY = Math.sin(adjustedAngle) * stretchAmount;

        // Determine anchor side based on dominant direction
        // The anchor is on the side OPPOSITE to the stretch direction (far side of star from seat)
        let anchorSide: 'left' | 'right' | 'top' | 'bottom';
        if (Math.abs(qDx) > Math.abs(qDy)) {
            anchorSide = qDx > 0 ? 'left' : 'right';
        } else {
            anchorSide = qDy > 0 ? 'top' : 'bottom';
        }

        // Position anchor at far side of star (opposite from seat direction)
        const anchorOffsetX = -(qDx / qLength) * STAR_OUTER_RADIUS;
        const anchorOffsetY = -(qDy / qLength) * STAR_OUTER_RADIUS;

        return { stretchX, stretchY, anchorSide, anchorOffsetX, anchorOffsetY };
    }

    startSpiralExit(cloudId: string): void {
        this.transitionAnimator.startSpiralExit(cloudId);
    }

    isSpiralExiting(cloudId: string): boolean {
        return this.transitionAnimator.isSpiralExiting(cloudId);
    }

    isAwaitingArrival(cloudId: string): boolean {
        return this.transitionAnimator.isAwaitingArrival(cloudId);
    }

    hasActiveSpiralExits(): boolean {
        return this.transitionAnimator.hasActiveSpiralExits();
    }

    animateSpiralExits(): void {
        this.transitionAnimator.animateSpiralExits();
    }

    startFlyOutExit(cloudId: string): void {
        this.transitionAnimator.startFlyOutExit(cloudId);
    }

    isFlyOutExiting(cloudId: string): boolean {
        return this.transitionAnimator.isFlyOutExiting(cloudId);
    }

    hasActiveFlyOutExits(): boolean {
        return this.transitionAnimator.hasActiveFlyOutExits();
    }

    animateFlyOutExits(): void {
        this.transitionAnimator.animateFlyOutExits();
    }

    animateDelayedArrivals(model: SimulatorModel): void {
        this.transitionAnimator.animateDelayedArrivals((cloudId) => model.isBlended(cloudId));
    }

    isSupportingEntering(cloudId: string): boolean {
        return this.transitionAnimator.isSupportingEntering(cloudId);
    }

    animateSupportingEntries(model: SimulatorModel): void {
        this.transitionAnimator.animateSupportingEntries(
            (cloudId) => this.cloudStates.get(cloudId)?.positionTarget,
            (cloudId) => {
                this.previousForegroundIds.add(cloudId);
                const state = this.cloudStates.get(cloudId);
                if (state) {
                    const allParts = model.getAllSupportingParts();
                    if (allParts.has(cloudId)) {
                        for (const targetId of model.getTargetCloudIds()) {
                            const supportingIds = model.getSupportingParts(targetId);
                            const supportArray = Array.from(supportingIds);
                            const index = supportArray.indexOf(cloudId);
                            if (index !== -1) {
                                state.positionTarget = {
                                    type: 'supporting',
                                    targetId,
                                    index
                                };
                                break;
                            }
                        }
                    }
                }
            }
        );
    }

    isTransitioning(): boolean {
        return this.transitionDirection !== 'none' && this.transitionProgress < 1;
    }

    getTransitionProgress(): number {
        return this.transitionProgress;
    }

    getTransitionDirection(): 'forward' | 'reverse' | 'none' {
        return this.transitionDirection;
    }

    getCurrentZoomFactor(): number {
        // Panorama mode uses panoramaZoom (adjustable via pinch)
        // Foreground mode zooms into foregroundZoomFactor for non-participating clouds
        // Transitions interpolate smoothly between these
        if (this.transitionDirection !== 'none' && this.transitionProgress < 1) {
            const eased = this.easeInOutCubic(this.transitionProgress);
            const startZoom = this.transitionStartZoom;
            const endZoom = this.transitionDirection === 'forward' ? this.foregroundZoomFactor : this.panoramaZoom;
            return startZoom + (endZoom - startZoom) * eased;
        } else if (this.mode === 'foreground') {
            return this.foregroundZoomFactor;
        }
        return this.panoramaZoom;
    }

    getForegroundCloudIds(): Set<string> {
        return this.previousForegroundIds;
    }

    setCloudNames(names: Map<string, string>): void {
        this.cloudNames = names;
    }

    getTrace(): string {
        return this.traceHistory.map((entry, i) => `[${i}] ${entry}`).join('\n');
    }

    setAction(action: string): void {
        this.pendingAction = action;
    }

    private addTraceEntry(action: string, effects: string[]): void {
        if (effects.length === 0) return;
        this.traceHistory.push(`${action} → ${effects.join(', ')}`);
    }

    private getName(cloudId: string): string {
        return this.cloudNames.get(cloudId) ?? cloudId;
    }

    private generateTraceEntries(oldModel: SimulatorModel | null, newModel: SimulatorModel): void {
        if (!oldModel) return;

        const effects: string[] = [];
        const oldTargets = oldModel.getTargetCloudIds();
        const newTargets = newModel.getTargetCloudIds();
        const oldBlended = new Set(oldModel.getBlendedParts());
        const newBlended = new Set(newModel.getBlendedParts());

        // Detect "demands attention" pattern: conference cleared + new spontaneous blend
        const wasOccupied = oldTargets.size > 0 || oldBlended.size > 0;
        const conferenceCleared = wasOccupied && newTargets.size === 0 && newBlended.size === 1;
        if (conferenceCleared) {
            const newBlendedId = Array.from(newBlended)[0];
            const isNewBlend = !oldBlended.has(newBlendedId);
            const reason = newModel.getBlendReason(newBlendedId);
            if (isNewBlend && reason === 'spontaneous') {
                const displaced = oldTargets.size + oldBlended.size;
                const action = `${this.getName(newBlendedId)} demands attention`;
                this.addTraceEntry(action, [`${displaced} displaced`]);
                this.pendingAction = null;
                return;
            }
        }

        // Detect conference table clear (all empty now, wasn't before)
        const nowEmpty = newTargets.size === 0 && newBlended.size === 0;
        if (wasOccupied && nowEmpty) {
            const action = this.pendingAction ?? 'Clear';
            this.addTraceEntry(action, ['conference cleared']);
            this.pendingAction = null;
            return;
        }

        // Track conference membership changes
        for (const id of newTargets) {
            if (!oldTargets.has(id) && !oldBlended.has(id)) {
                effects.push(`${this.getName(id)} joins`);
            }
        }

        for (const id of oldTargets) {
            if (!newTargets.has(id) && !newBlended.has(id)) {
                effects.push(`${this.getName(id)} leaves`);
            }
        }

        // Track blending changes
        for (const id of newBlended) {
            if (!oldBlended.has(id)) {
                effects.push(`${this.getName(id)} blends`);
            }
        }

        let actionDescribesEffect = false;
        for (const id of oldBlended) {
            if (!newBlended.has(id)) {
                const effect = newTargets.has(id) ? `${this.getName(id)} separates` : `${this.getName(id)} unblends`;
                if (this.pendingAction === effect) {
                    actionDescribesEffect = true;
                } else {
                    effects.push(effect);
                }
            }
        }

        // Track biography reveals
        this.collectBiographyEffects(oldModel, newModel, effects);

        // Track trust changes
        this.collectTrustEffects(oldModel, newModel, effects);

        // Check for new messages (action label already describes the message)
        const hasMessages = this.hasNewMessages(oldModel, newModel);

        if (effects.length > 0) {
            const action = this.pendingAction ?? 'Update';
            this.addTraceEntry(action, effects);
        } else if (this.pendingAction && (hasMessages || actionDescribesEffect)) {
            this.traceHistory.push(this.pendingAction);
        }
        this.pendingAction = null;
    }

    private collectBiographyEffects(oldModel: SimulatorModel, newModel: SimulatorModel, effects: string[]): void {
        for (const [cloudId] of this.cloudNames) {
            const oldBio = oldModel.parts.getBiography(cloudId);
            const newBio = newModel.parts.getBiography(cloudId);
            if (!oldBio || !newBio) continue;

            if (!oldBio.identityRevealed && newBio.identityRevealed) {
                effects.push(`${this.getName(cloudId)} revealed`);
            }
            if (!oldBio.ageRevealed && newBio.ageRevealed) {
                effects.push(`${this.getName(cloudId)} age revealed`);
            }
        }
    }

    private collectTrustEffects(oldModel: SimulatorModel, newModel: SimulatorModel, effects: string[]): void {
        for (const [cloudId] of this.cloudNames) {
            const oldTrust = oldModel.parts.getTrust(cloudId);
            const newTrust = newModel.parts.getTrust(cloudId);
            const diff = newTrust - oldTrust;
            if (Math.abs(diff) > 0.01) {
                const oldPct = Math.round(oldTrust * 100);
                const newPct = Math.round(newTrust * 100);
                const direction = diff > 0 ? '↑' : '↓';
                effects.push(`${this.getName(cloudId)} trust ${oldPct}%${direction}${newPct}%`);
            }
        }
    }

    private hasNewMessages(oldModel: SimulatorModel, newModel: SimulatorModel): boolean {
        const oldMessages = new Set(oldModel.getMessages().map(m => m.id));
        return newModel.getMessages().some(m => !oldMessages.has(m.id));
    }

}
