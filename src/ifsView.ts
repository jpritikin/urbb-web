import { SimulatorModel, SelfRayState } from './ifsModel.js';
import { SelfRay } from './selfRay.js';
import { Cloud } from './cloudShape.js';
import { SeatInfo, CarpetState, CARPET_OFFSCREEN_DISTANCE, CARPET_FLY_DURATION, CARPET_START_SCALE, CARPET_SCALE } from './carpetRenderer.js';

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
import { StretchAnimator } from './ifsView/StretchAnimator.js';
import {
    PositionTarget,
    SmoothingConfig,
    CloudAnimatedState,
    DEFAULT_SMOOTHING
} from './ifsView/types.js';

export { STAR_OUTER_RADIUS };
export type { PositionTarget, SmoothingConfig, CloudAnimatedState };
export { DEFAULT_SMOOTHING };

const BLENDED_OPACITY = 0.7;

export class SimulatorView {
    private events: ViewEventEmitter = new ViewEventEmitter();
    private seatManager: SeatManager;

    private cloudStates: Map<string, CloudAnimatedState> = new Map();
    private mode: 'panorama' | 'foreground' = 'panorama';
    private previousMode: 'panorama' | 'foreground' = 'panorama';
    private previousTargetIds: Set<string> = new Set();
    private previousForegroundIds: Set<string> = new Set();
    private transitionProgress: number = 0;
    private transitionDuration: number = 1.0;
    private transitionDirection: 'forward' | 'reverse' | 'none' = 'none';

    private canvasWidth: number;
    private canvasHeight: number;
    private perspectiveFactor: number = 600;
    private maxZoomFactor: number = 2.0;

    private starElement: SVGElement | null = null;
    private starCurrentX: number = 0;
    private starCurrentY: number = 0;
    private starTargetX: number = 0;
    private starTargetY: number = 0;
    private blendedOffsets: Map<string, { x: number; y: number }> = new Map();

    private selfRay: SelfRay | null = null;
    private rayContainer: SVGGElement | null = null;
    private pieMenuOverlay: SVGGElement | null = null;
    private onRayFieldSelect: ((field: 'age' | 'identity' | 'job' | 'gratitude', cloudId: string) => void) | null = null;

    // Spiral exit animation state for parts forced out by spontaneous blends
    private spiralExits: Map<string, {
        startX: number;
        startY: number;
        startTime: number;
        duration: number;
        spiralRadius: number;
        rotations: number;
        exitAngle: number;
    }> = new Map();

    // Fly-out exit animation (carpet-style) for stepping back
    private flyOutExits: Map<string, {
        startX: number;
        startY: number;
        exitX: number;
        exitY: number;
        startTime: number;
        duration: number;
        startScale: number;
    }> = new Map();

    // Delayed arrivals for parts that should appear after displaced parts exit
    private delayedArrivals: Map<string, { arrivalTime: number }> = new Map();

    // Stretch animators for blended clouds
    private stretchAnimators: Map<string, StretchAnimator> = new Map();

    constructor(canvasWidth: number, canvasHeight: number) {
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.seatManager = new SeatManager(canvasWidth, canvasHeight);
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

    setRayContainer(container: SVGGElement): void {
        this.rayContainer = container;
    }

    setPieMenuOverlay(overlay: SVGGElement): void {
        this.pieMenuOverlay = overlay;
    }

    setOnRayFieldSelect(callback: (field: 'age' | 'identity' | 'job' | 'gratitude', cloudId: string) => void): void {
        this.onRayFieldSelect = callback;
    }

    setOnModeChange(callback: (mode: 'panorama' | 'foreground') => void): void {
        this.events.on('mode-changed', (data) => callback(data.mode));
    }

    getMode(): 'panorama' | 'foreground' {
        return this.mode;
    }

    setMode(mode: 'panorama' | 'foreground'): void {
        if (mode !== this.mode) {
            this.previousMode = this.mode;
            this.mode = mode;

            const wasTransitioning = this.transitionDirection !== 'none' && this.transitionProgress < 1;
            const oldDirection = this.transitionDirection;

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
            }

            // Reset opacity smoothing for all clouds to ensure consistent transition speed
            for (const state of this.cloudStates.values()) {
                state.smoothing.opacity = DEFAULT_SMOOTHING.opacity;
            }

            this.events.emit('mode-changed', { mode });
            this.events.emit('transition-started', { direction: this.transitionDirection });
        }
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
                return { x, y, scale: pos?.scale ?? 1 };
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

    private calculateConferenceRoomPositions(model: SimulatorModel, targetInstances: CloudInstance[]): { clouds: Map<string, { x: number; y: number }>, starX: number, starY: number } {
        const clouds = new Map<string, { x: number; y: number }>();

        for (const instance of targetInstances) {
            const pos = this.getCloudPosition(instance.cloud.id);
            if (pos) {
                clouds.set(instance.cloud.id, pos);
            }
        }

        const starPos = this.getStarPosition();
        return { clouds, starX: starPos.x, starY: starPos.y };
    }

    syncWithModel(
        oldModel: SimulatorModel | null,
        newModel: SimulatorModel,
        instances: CloudInstance[],
        panoramaPositions: Map<string, { x: number; y: number; scale: number }>
    ): void {
        if (newModel.hasPendingAttentionDemand()) {
            newModel.consumeAttentionDemand();
            this.setMode('foreground');
        }

        // Check for displaced parts and start spiral exits
        const displacedParts = newModel.getDisplacedParts();
        const hasDisplacements = displacedParts.size > 0;

        for (const cloudId of displacedParts) {
            this.startSpiralExit(cloudId);
            newModel.clearDisplacedPart(cloudId);
        }

        // If parts were displaced, delay the arrival of NEW parts (not parts that were already visible)
        if (hasDisplacements) {
            const arrivalDelay = 4.0;
            const arrivalTime = performance.now() + arrivalDelay * 1000;

            // Only delay parts that weren't already in foreground (i.e., truly new arrivals)
            // Parts that were displaced are spiraling away; parts NOT displaced were already visible
            for (const blendedId of newModel.getBlendedParts()) {
                if (!this.delayedArrivals.has(blendedId)) {
                    const state = this.cloudStates.get(blendedId);
                    // Only delay if this part wasn't already visible (opacity near 0 or in panorama)
                    if (state && state.opacity < 0.1) {
                        this.delayedArrivals.set(blendedId, { arrivalTime });
                        state.targetOpacity = 0;
                    }
                }
            }

            // Delay targets only if they weren't already visible
            for (const targetId of newModel.getTargetCloudIds()) {
                if (!this.delayedArrivals.has(targetId)) {
                    const state = this.cloudStates.get(targetId);
                    if (state && state.opacity < 0.1) {
                        this.delayedArrivals.set(targetId, { arrivalTime });
                        state.targetOpacity = 0;
                    }
                }
            }
        }

        this.updateSeatAssignments(oldModel, newModel);
        this.updateStarPosition(newModel);
        this.updateCloudStateTargets(newModel, instances);
        this.syncSelfRay(newModel);

        const currentTargetIds = newModel.getTargetCloudIds();
        if (this.transitionDirection !== 'reverse' || this.transitionProgress >= 1) {
            this.previousTargetIds = new Set(currentTargetIds);
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

            if (this.pieMenuOverlay) {
                this.selfRay.setPieMenuOverlay(this.pieMenuOverlay);
            }

            this.selfRay.setOnSelect((field, targetCloudId) => {
                this.onRayFieldSelect?.(field, targetCloudId);
            });

            const rayElement = this.selfRay.create();
            this.rayContainer.appendChild(rayElement);
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

            if (this.mode === 'foreground' && isInForeground) {
                currentForegroundIds.add(cloudId);
            }

            // Skip clouds that are currently fly-out exiting
            if (this.flyOutExits.has(cloudId)) {
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
                        if (!this.blendedOffsets.has(cloudId)) {
                            const angle = Math.random() * 2 * Math.PI;
                            const radius = Math.random() * 15;
                            this.blendedOffsets.set(cloudId, {
                                x: radius * Math.cos(angle),
                                y: radius * Math.sin(angle)
                            });
                        }
                        const offset = this.blendedOffsets.get(cloudId)!;
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
                } else {
                    positionTarget = { type: 'panorama' };
                }
            } else if (this.mode === 'foreground') {
                // In foreground mode but not part of the conference
                // Check if this part just left foreground - trigger fly-out exit
                if (this.previousForegroundIds.has(cloudId) && !this.spiralExits.has(cloudId)) {
                    this.startFlyOutExit(cloudId);
                    continue;
                }
                positionTarget = { type: 'panorama' };
                targetOpacity = 0;
            } else {
                // Panorama mode
                positionTarget = { type: 'panorama' };
            }

            state.positionTarget = positionTarget;
            // Don't override opacity for delayed arrivals - they should stay invisible until arrival time
            if (!this.delayedArrivals.has(cloudId)) {
                state.targetOpacity = targetOpacity;
            }
            state.targetScale = 1;
        }

        // Update previous foreground set for next frame
        this.previousForegroundIds = currentForegroundIds;
    }

    private updateBlendedCloudStates(model: SimulatorModel, instances: CloudInstance[]): void {
        const blendedParts = new Set(model.getBlendedParts());

        for (const instance of instances) {
            const cloud = instance.cloud;
            const isBlended = blendedParts.has(cloud.id);
            cloud.setBlended(isBlended);
        }
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
                this.stretchAnimators.delete(cloud.id);
            }
        }
    }

    animateStretchEffects(deltaTime: number): void {
        for (const animator of this.stretchAnimators.values()) {
            animator.animate(deltaTime);
        }
    }

    triggerOvershoot(cloudId: string): void {
        const animator = this.stretchAnimators.get(cloudId);
        if (animator) {
            animator.triggerOvershoot();
        }
    }

    private getStretchFactor(cloudId: string): number {
        return this.stretchAnimators.get(cloudId)?.getStretchFactor() ?? 1;
    }

    private getStretchOffset(cloudId: string): number {
        return this.stretchAnimators.get(cloudId)?.getStretchOffset() ?? 0;
    }

    private getStretchAngle(cloudId: string): number {
        return this.stretchAnimators.get(cloudId)?.getStretchAngle() ?? 0;
    }

    private getOrCreateStretchAnimator(cloudId: string): StretchAnimator {
        let animator = this.stretchAnimators.get(cloudId);
        if (!animator) {
            animator = new StretchAnimator(cloudId, {
                getConferenceTableRadius: () => this.getConferenceTableRadius()
            });
            this.stretchAnimators.set(cloudId, animator);
        }
        return animator;
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

            // Apply exponential smoothing to each property
            if (state.smoothing.position > 0) {
                const factor = 1 - Math.exp(-state.smoothing.position * deltaTime);
                state.x += (resolved.x - state.x) * factor;
                state.y += (resolved.y - state.y) * factor;
            } else {
                state.x = resolved.x;
                state.y = resolved.y;
            }

            if (state.smoothing.scale > 0) {
                const factor = 1 - Math.exp(-state.smoothing.scale * deltaTime);
                state.scale += (state.targetScale - state.scale) * factor;
            } else {
                state.scale = state.targetScale;
            }

            if (state.smoothing.opacity > 0) {
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

        const speed = 3.0;
        const dx = this.starTargetX - this.starCurrentX;
        const dy = this.starTargetY - this.starCurrentY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > 0.5) {
            const step = Math.min(distance, speed * deltaTime * 100);
            this.starCurrentX += (dx / distance) * step;
            this.starCurrentY += (dy / distance) * step;
        } else {
            this.starCurrentX = this.starTargetX;
            this.starCurrentY = this.starTargetY;
        }

        this.starElement.setAttribute('transform', `translate(${this.starCurrentX}, ${this.starCurrentY})`);
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

        const offset = this.blendedOffsets.get(cloudId);
        const starPos = this.getStarPosition();
        const starX = starPos.x + (offset?.x ?? 0);
        const starY = starPos.y + (offset?.y ?? 0);

        const qDx = seatPos.x - starX;
        const qDy = seatPos.y - starY;
        const qLength = Math.sqrt(qDx * qDx + qDy * qDy);

        if (qLength < 1) return null;

        // Get or create stretch animator for this cloud
        const animator = this.getOrCreateStretchAnimator(cloudId);

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
        const state = this.cloudStates.get(cloudId);
        if (!state) return;

        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        const dx = state.x - centerX;
        const dy = state.y - centerY;
        const startRadius = Math.sqrt(dx * dx + dy * dy);
        const startAngle = Math.atan2(dy, dx);

        this.spiralExits.set(cloudId, {
            startX: state.x,
            startY: state.y,
            startTime: performance.now(),
            duration: 8,
            spiralRadius: startRadius,
            rotations: 2.5,
            exitAngle: startAngle
        });

        state.targetOpacity = 0;
        state.smoothing.opacity = 0; // Opacity handled manually in animateSpiralExits
    }

    isSpiralExiting(cloudId: string): boolean {
        return this.spiralExits.has(cloudId);
    }

    isAwaitingArrival(cloudId: string): boolean {
        return this.delayedArrivals.has(cloudId);
    }

    hasActiveSpiralExits(): boolean {
        return this.spiralExits.size > 0;
    }

    animateSpiralExits(): void {
        const now = performance.now();
        const toRemove: string[] = [];
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        const maxRadius = Math.max(this.canvasWidth, this.canvasHeight) * 1.1;

        for (const [cloudId, spiral] of this.spiralExits) {
            const state = this.cloudStates.get(cloudId);
            if (!state) {
                toRemove.push(cloudId);
                continue;
            }

            const elapsed = (now - spiral.startTime) / 1000;
            const progress = Math.min(1, elapsed / spiral.duration);

            if (progress >= 1) {
                toRemove.push(cloudId);
                state.smoothing.opacity = DEFAULT_SMOOTHING.opacity;
                continue;
            }

            // Ease out for smooth deceleration at the end
            const eased = 1 - Math.pow(1 - progress, 2);

            // Spiral around screen center:
            // - Start at initial angle and radius
            // - Rotate while expanding outward
            const currentAngle = spiral.exitAngle + eased * spiral.rotations * Math.PI * 2;
            const currentRadius = spiral.spiralRadius + eased * (maxRadius - spiral.spiralRadius);

            state.x = centerX + Math.cos(currentAngle) * currentRadius;
            state.y = centerY + Math.sin(currentAngle) * currentRadius;
            state.opacity = 1 - eased;

            state.positionTarget = { type: 'absolute', x: state.x, y: state.y };
        }

        for (const cloudId of toRemove) {
            this.spiralExits.delete(cloudId);
        }
    }

    startFlyOutExit(cloudId: string): void {
        const state = this.cloudStates.get(cloudId);
        if (!state) return;

        const exitPos = getOffscreenPosition(state.x, state.y, this.canvasWidth, this.canvasHeight);

        this.flyOutExits.set(cloudId, {
            startX: state.x,
            startY: state.y,
            exitX: exitPos.x,
            exitY: exitPos.y,
            startTime: performance.now(),
            duration: CARPET_FLY_DURATION,
            startScale: state.scale
        });

        state.targetOpacity = 0;
        state.smoothing.opacity = 0; // We'll handle opacity manually in animateFlyOutExits
    }

    isFlyOutExiting(cloudId: string): boolean {
        return this.flyOutExits.has(cloudId);
    }

    hasActiveFlyOutExits(): boolean {
        return this.flyOutExits.size > 0;
    }

    animateFlyOutExits(): void {
        const now = performance.now();
        const toRemove: string[] = [];

        for (const [cloudId, flyOut] of this.flyOutExits) {
            const state = this.cloudStates.get(cloudId);
            if (!state) {
                toRemove.push(cloudId);
                continue;
            }

            const elapsed = (now - flyOut.startTime) / 1000;
            const progress = Math.min(1, elapsed / flyOut.duration);

            if (progress >= 1) {
                toRemove.push(cloudId);
                state.smoothing.opacity = DEFAULT_SMOOTHING.opacity;
                state.opacity = 0;
                continue;
            }

            const eased = this.easeInOutCubic(progress);

            // Animate position from start to exit (like carpet)
            state.x = flyOut.startX + (flyOut.exitX - flyOut.startX) * eased;
            state.y = flyOut.startY + (flyOut.exitY - flyOut.startY) * eased;

            // Scale up as it exits (like carpet growing to CARPET_START_SCALE)
            state.scale = flyOut.startScale + (CARPET_START_SCALE / CARPET_SCALE - flyOut.startScale) * eased;

            // Fade out
            state.opacity = 1 - eased;

            // Override position target to prevent smoothing from interfering
            state.positionTarget = { type: 'absolute', x: state.x, y: state.y };
        }

        for (const cloudId of toRemove) {
            this.flyOutExits.delete(cloudId);
        }
    }

    animateDelayedArrivals(model: SimulatorModel): void {
        const now = performance.now();
        const toRemove: string[] = [];

        for (const [cloudId, arrival] of this.delayedArrivals) {
            if (now >= arrival.arrivalTime) {
                const state = this.cloudStates.get(cloudId);
                if (state) {
                    // Set appropriate opacity based on whether it's a blended part or target
                    const isBlended = model.isBlended(cloudId);
                    state.targetOpacity = isBlended ? BLENDED_OPACITY : 1;
                    state.smoothing.opacity = 2; // Gentle fade in
                }
                toRemove.push(cloudId);
            }
        }

        for (const cloudId of toRemove) {
            this.delayedArrivals.delete(cloudId);
        }
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
        const maxZoomFactor = this.maxZoomFactor;

        if (this.transitionDirection !== 'none' && this.transitionProgress < 1) {
            const eased = this.easeInOutCubic(this.transitionProgress);
            if (this.transitionDirection === 'forward') {
                return 1 + (maxZoomFactor - 1) * eased;
            } else {
                return maxZoomFactor - (maxZoomFactor - 1) * eased;
            }
        } else if (this.mode === 'foreground') {
            return maxZoomFactor;
        }
        return 1.0;
    }

    getForegroundCloudIds(): Set<string> {
        return this.previousForegroundIds;
    }
}
