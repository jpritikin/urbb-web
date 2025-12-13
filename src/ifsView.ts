import { SimulatorModel } from './ifsModel.js';
import { Cloud } from './cloudShape.js';
import {
    SeatInfo,
    CarpetState,
    createCarpetVertices,
    getOffscreenPosition,
    CARPET_START_SCALE,
    CARPET_SCALE,
    CARPET_FLY_DURATION,
    CARPET_ENTRY_STAGGER
} from './carpetRenderer.js';

export const STAR_OUTER_RADIUS = 20;
export const STAR_INNER_RADIUS = 8;
const BLENDED_OPACITY = 0.7;

interface Vec3 {
    x: number;
    y: number;
    z: number;
}

interface CloudInstance {
    cloud: Cloud;
    position: Vec3;
    velocity: Vec3;
}

// Semantic position targets - resolved to x/y each frame
export type PositionTarget =
    | { type: 'panorama' }
    | { type: 'seat'; seatIndex: number }
    | { type: 'star'; offsetX?: number; offsetY?: number }
    | { type: 'supporting'; targetId: string; index: number }
    | { type: 'blended'; seatIndex: number; offsetX: number; offsetY: number }
    | { type: 'absolute'; x: number; y: number };

// Smoothing configuration - higher = faster approach, 0 = instant
export interface SmoothingConfig {
    position: number;      // default 8
    scale: number;         // default 8
    opacity: number;       // default 8
    blendingDegree: number; // default 4 (slower for visual effect)
}

export const DEFAULT_SMOOTHING: SmoothingConfig = {
    position: 8,
    scale: 8,
    opacity: 8,
    blendingDegree: 4
};

// Unified animation state per cloud
export interface CloudAnimatedState {
    cloudId: string;

    // Current animated values
    x: number;
    y: number;
    scale: number;
    opacity: number;
    blendingDegree: number;

    // Semantic target (resolved to x/y each frame)
    positionTarget: PositionTarget;
    targetScale: number;
    targetOpacity: number;
    targetBlendingDegree: number;

    // Smoothing factors
    smoothing: SmoothingConfig;

    // Flags
    inCounterZoomGroup: boolean;
}

export class SimulatorView {
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
    private cachedStarPosition: { x: number; y: number } | null = null;

    private conferencePhaseShift: number = Math.random() * Math.PI * 2;
    private conferenceRotationSpeed: number = 0.05; // radians per second
    private conferenceSeatAssignments: Map<string, number> = new Map(); // cloudId -> seat index (0 = star)
    private carpetStates: Map<string, CarpetState> = new Map();
    private previousSeatCount: number = 0;
    private currentSeatCount: number = 0;
    private targetSeatCount: number = 0;

    private committedBlendingDegrees: Map<string, number> = new Map();
    private readonly DEGREE_STEP_THRESHOLD = 0.06; // trigger overshoot every ~6% unblending

    // Spiral exit animation state for parts forced out by spontaneous blends
    private spiralExits: Map<string, {
        startX: number;
        startY: number;
        startTime: number;
        duration: number;
        spiralRadius: number;
        rotations: number;
        exitAngle: number; // angle toward edge of screen
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

    // Unified stretch animation state (handles both user-triggered overshoot and idle grip loss)
    private stretchAnim: Map<string, {
        phase: 'holding' | 'contracting' | 'contracted_hold' | 'ratcheting' | 'yanking' | 'settling';
        stretchFactor: number;    // multiplier for grip loss contraction (1 = normal, <1 = contracted)
        targetFactor: number;     // target factor to animate toward during contraction
        stretchOffset: number;    // absolute overshoot distance (0 = normal, >0 = overshooting)
        holdEndTime: number;      // when to start next phase
        phaseDuration: number;    // duration for current animation phase
        angleOffset: number;      // target angle offset in radians
        currentAngle: number;     // current angle offset (animates toward angleOffset then back to 0)
        yankCount: number;        // number of yanks remaining
        yankTarget: number;       // current yank target angle
        yankHolding: boolean;     // true if in hold portion of yank
        yankHoldEnd: number;      // timestamp when yank hold ends
        contractPaused: boolean;  // true if in a micro-pause during contraction
        contractPauseEnd: number; // timestamp when micro-pause ends
        nextPauseTime: number;    // timestamp for next potential micro-pause
    }> = new Map();

    // Overshoot distance: approx 75% of conference table radius (what a 75% unblended part would travel)
    private getOvershootDistance(): number {
        return this.getConferenceTableRadius() * 0.75;
    }
    private readonly OVERSHOOT_ANGLE_RANGE = Math.PI / 6; // +/- 30 degrees
    private readonly RATCHET_DURATION = 0.35;       // snap to overshoot speed
    private readonly YANK_DURATION = 0.30;          // total time per yank (half snap, half hold)
    private readonly YANK_ANGLE_THRESHOLD = Math.PI / 12; // trigger yanks if angleOffset > 15 degrees
    private readonly SETTLE_DURATION = 0.25;        // ease from overshoot to normal

    // Grip loss (idle contraction) constants
    private readonly GRIP_LOSS_MIN_DURATION = 1.5;
    private readonly GRIP_LOSS_MAX_DURATION = 4.0;
    private readonly GRIP_LOSS_HOLD_MIN = 0.3;
    private readonly GRIP_LOSS_HOLD_MAX = 1.2;
    private readonly GRIP_LOSS_MIN_CONTRACTION = 0.6;
    private readonly GRIP_LOSS_MAX_CONTRACTION = 0.6;
    private readonly GRIP_LOSS_POST_SETTLE_DELAY_MIN = 1.0;
    private readonly GRIP_LOSS_POST_SETTLE_DELAY_MAX = 3.0;

    constructor(canvasWidth: number, canvasHeight: number) {
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
    }

    setStarElement(element: SVGElement): void {
        this.starElement = element;
    }

    getMode(): 'panorama' | 'foreground' {
        return this.mode;
    }

    setMode(mode: 'panorama' | 'foreground'): void {
        if (mode !== this.mode) {
            this.previousMode = this.mode;
            this.mode = mode;
            if (mode === 'foreground') {
                this.transitionDirection = 'forward';
            } else {
                this.transitionDirection = 'reverse';
            }
            this.transitionProgress = 0;

            // Reset opacity smoothing for all clouds to ensure consistent transition speed
            for (const state of this.cloudStates.values()) {
                state.smoothing.opacity = DEFAULT_SMOOTHING.opacity;
            }
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
        const baseRadius = Math.min(this.canvasWidth, this.canvasHeight) * 0.3;
        const seats = seatCount ?? this.currentSeatCount;
        if (seats <= 2) return baseRadius * 0.5;
        if (seats >= 7) return baseRadius;
        return baseRadius * (0.5 + 0.5 * (seats - 2) / 5);
    }

    private getSeatPosition(seatIndex: number, totalSeats: number): { x: number; y: number } {
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        const animatedSeats = this.currentSeatCount > 0 ? this.currentSeatCount : totalSeats;
        const radius = this.getConferenceTableRadius(animatedSeats);
        const angleStep = (2 * Math.PI) / animatedSeats;
        const angle = this.conferencePhaseShift + angleStep * seatIndex;
        return {
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle)
        };
    }

    getStarPosition(): { x: number; y: number } {
        return this.cachedStarPosition ?? { x: this.canvasWidth / 2, y: this.canvasHeight / 2 };
    }

    resolvePositionTarget(
        target: PositionTarget,
        cloudId: string,
        panoramaPositions: Map<string, { x: number; y: number; scale: number }>,
        model: SimulatorModel
    ): { x: number; y: number; scale: number } {
        const targetIds = Array.from(model.getTargetCloudIds());
        const blendedParts = model.getBlendedParts();
        const totalSeats = targetIds.length + blendedParts.length + 1;
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;

        switch (target.type) {
            case 'panorama': {
                const pos = panoramaPositions.get(cloudId);
                let x = pos?.x ?? centerX;
                let y = pos?.y ?? centerY;

                // If cloud is in counter-zoom group, convert world position to counter-zoom coords
                // Exception: during reverse transition, use unscaled position so clouds animate
                // directly to their final panorama positions
                const state = this.cloudStates.get(cloudId);
                if (state?.inCounterZoomGroup && this.transitionDirection !== 'reverse') {
                    const zoomFactor = this.getCurrentZoomFactor();
                    x = centerX + (x - centerX) * zoomFactor;
                    y = centerY + (y - centerY) * zoomFactor;
                }

                return { x, y, scale: pos?.scale ?? 1 };
            }

            case 'seat': {
                const pos = this.getSeatPosition(target.seatIndex, totalSeats);
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
                const targetPos = this.conferenceSeatAssignments.has(target.targetId)
                    ? this.getSeatPosition(this.conferenceSeatAssignments.get(target.targetId)!, totalSeats)
                    : { x: centerX, y: centerY };
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
                const seatPos = this.getSeatPosition(target.seatIndex, totalSeats);
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

    private updateSeatAssignments(model: SimulatorModel): void {
        const targetIds = Array.from(model.getTargetCloudIds());
        const blendedIds = model.getBlendedParts();
        const allSeatedIds = [...targetIds, ...blendedIds];
        const totalSeats = allSeatedIds.length + 1; // +1 for star

        // Remove assignments for parts no longer at the table
        for (const cloudId of this.conferenceSeatAssignments.keys()) {
            if (!allSeatedIds.includes(cloudId)) {
                this.conferenceSeatAssignments.delete(cloudId);
                this.markCarpetForExit(cloudId);
            }
        }

        // If seat count changed, we need to redistribute
        if (totalSeats !== this.previousSeatCount && this.previousSeatCount > 0) {
            // Keep existing relative positions by scaling seat indices
            const oldAssignments = new Map(this.conferenceSeatAssignments);
            this.conferenceSeatAssignments.clear();

            const usedInRedistribution = new Set<number>([0]); // 0 is star
            for (const [cloudId, oldSeat] of oldAssignments) {
                if (allSeatedIds.includes(cloudId)) {
                    // Scale the seat position proportionally
                    let newSeat = Math.round((oldSeat / this.previousSeatCount) * totalSeats);
                    newSeat = newSeat % totalSeats || 1;
                    // Resolve collisions by finding next available seat
                    while (usedInRedistribution.has(newSeat)) {
                        newSeat = (newSeat % (totalSeats - 1)) + 1;
                    }
                    this.conferenceSeatAssignments.set(cloudId, newSeat);
                    usedInRedistribution.add(newSeat);
                }
            }
        }

        // Assign seats to new parts at random available positions
        const usedSeats = new Set<number>([0]); // 0 is always the star
        for (const seat of this.conferenceSeatAssignments.values()) {
            usedSeats.add(seat);
        }

        let enteringCount = 0;
        for (const carpet of this.carpetStates.values()) {
            if (carpet.entering) enteringCount++;
        }

        for (const cloudId of allSeatedIds) {
            if (!this.conferenceSeatAssignments.has(cloudId)) {
                // Find available seats
                const availableSeats: number[] = [];
                for (let i = 1; i < totalSeats; i++) {
                    if (!usedSeats.has(i)) {
                        availableSeats.push(i);
                    }
                }

                let seatIndex: number;
                if (availableSeats.length > 0) {
                    seatIndex = availableSeats[Math.floor(Math.random() * availableSeats.length)];
                } else {
                    seatIndex = usedSeats.size;
                }
                this.conferenceSeatAssignments.set(cloudId, seatIndex);
                usedSeats.add(seatIndex);

                // Create carpet for new seat
                if (!this.carpetStates.has(cloudId)) {
                    this.createCarpet(cloudId, seatIndex, totalSeats, enteringCount);
                    enteringCount++;
                }
            }
        }

        this.previousSeatCount = totalSeats;
        this.targetSeatCount = totalSeats;
        if (this.currentSeatCount === 0) {
            this.currentSeatCount = totalSeats;
        }

        // Update cached star position using current animated seat count
        this.cachedStarPosition = this.getSeatPosition(0, totalSeats);
    }

    private createCarpet(cloudId: string, seatIndex: number, totalSeats: number, enteringCount: number): void {
        const targetPos = this.getSeatPosition(seatIndex, totalSeats);
        const startPos = getOffscreenPosition(targetPos.x, targetPos.y, this.canvasWidth, this.canvasHeight);

        this.carpetStates.set(cloudId, {
            cloudId,
            currentX: startPos.x,
            currentY: startPos.y,
            targetX: targetPos.x,
            targetY: targetPos.y,
            startX: startPos.x,
            startY: startPos.y,
            currentScale: CARPET_START_SCALE,
            isOccupied: false,
            occupiedOffset: 0,
            entering: true,
            exiting: false,
            progress: -enteringCount * CARPET_ENTRY_STAGGER,
            vertices: createCarpetVertices()
        });
    }

    private markCarpetForExit(cloudId: string): void {
        const carpet = this.carpetStates.get(cloudId);
        if (carpet && !carpet.exiting) {
            // Use current visual position, not target, so carpet leaves immediately
            const exitPos = getOffscreenPosition(carpet.currentX, carpet.currentY, this.canvasWidth, this.canvasHeight);
            carpet.exiting = true;
            carpet.entering = false;
            carpet.progress = 0;
            carpet.targetX = carpet.currentX;
            carpet.targetY = carpet.currentY;
            carpet.startX = exitPos.x;
            carpet.startY = exitPos.y;
        }
    }

    getCarpetStates(): Map<string, CarpetState> {
        return this.carpetStates;
    }

    clearCarpetStates(): void {
        this.carpetStates.clear();
    }

    private calculateConferenceRoomPositions(model: SimulatorModel, targetInstances: CloudInstance[]): { clouds: Map<string, { x: number; y: number }>, starX: number, starY: number } {
        this.updateSeatAssignments(model);

        const targetIds = Array.from(model.getTargetCloudIds());
        const blendedIds = model.getBlendedParts();
        const totalSeats = targetIds.length + blendedIds.length + 1;

        const clouds = new Map<string, { x: number; y: number }>();

        for (const instance of targetInstances) {
            const seatIndex = this.conferenceSeatAssignments.get(instance.cloud.id);
            if (seatIndex !== undefined) {
                const pos = this.getSeatPosition(seatIndex, totalSeats);
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

        this.updateSeatAssignments(newModel);
        this.updateStarPosition(newModel);
        this.updateCloudStateTargets(newModel, instances);

        const currentTargetIds = newModel.getTargetCloudIds();
        if (this.transitionDirection !== 'reverse' || this.transitionProgress >= 1) {
            this.previousTargetIds = new Set(currentTargetIds);
        }
    }

    private updateCloudStateTargets(model: SimulatorModel, instances: CloudInstance[]): void {
        const targetIds = model.getTargetCloudIds();
        const blendedParts = model.getBlendedParts();
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
            const isSupporting = allSupporting.has(cloudId);
            const isInForeground = isTarget || isBlended || isSupporting;

            if (this.mode === 'foreground' && isInForeground) {
                currentForegroundIds.add(cloudId);
            }

            // Skip clouds that are currently fly-out exiting
            if (this.flyOutExits.has(cloudId)) {
                state.inCounterZoomGroup = true;
                continue;
            }

            // Determine position target based on role
            let positionTarget: PositionTarget;
            let targetOpacity = 1;
            let inCounterZoomGroup = false;

            if (this.mode === 'foreground' && isInForeground) {
                inCounterZoomGroup = true;

                if (isBlended) {
                    const blendReason = model.getBlendReason(cloudId);

                    if (blendReason === 'spontaneous') {
                        // Spontaneous blends stay at the star until they become targets
                        positionTarget = { type: 'star' };
                    } else {
                        // Therapist-initiated blends interpolate between star and seat
                        const seatIndex = this.conferenceSeatAssignments.get(cloudId);
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
                            seatIndex: seatIndex ?? 1,
                            offsetX: offset.x,
                            offsetY: offset.y
                        };

                        // Set blending degree target
                        const degree = blendedDegrees.get(cloudId) ?? 1;
                        state.targetBlendingDegree = degree;
                    }
                    targetOpacity = BLENDED_OPACITY;
                } else if (isTarget) {
                    const seatIndex = this.conferenceSeatAssignments.get(cloudId);
                    positionTarget = { type: 'seat', seatIndex: seatIndex ?? 1 };
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
                    state.inCounterZoomGroup = true;
                    continue;
                }
                positionTarget = { type: 'panorama' };
                targetOpacity = 0;
            } else {
                // Panorama mode
                positionTarget = { type: 'panorama' };

                // During reverse transition, keep former fg clouds in counter-zoom group
                if (this.transitionDirection === 'reverse' && this.transitionProgress < 1) {
                    if (state.inCounterZoomGroup) {
                        inCounterZoomGroup = true;
                    }
                }
            }

            state.positionTarget = positionTarget;
            // Don't override opacity for delayed arrivals - they should stay invisible until arrival time
            if (!this.delayedArrivals.has(cloudId)) {
                state.targetOpacity = targetOpacity;
            }
            state.targetScale = 1;
            // Keep spiral-exiting or fly-out-exiting clouds in counter-zoom group
            state.inCounterZoomGroup = inCounterZoomGroup || this.spiralExits.has(cloudId) || this.flyOutExits.has(cloudId);
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
                this.committedBlendingDegrees.delete(cloud.id);
                this.stretchAnim.delete(cloud.id);
            }
        }
    }

    animateStretchEffects(deltaTime: number): void {
        const now = performance.now();

        for (const [cloudId, state] of this.stretchAnim) {
            switch (state.phase) {
                case 'holding':
                    if (now >= state.holdEndTime) {
                        // Transition to contracting (idle grip loss)
                        state.phase = 'contracting';
                        state.targetFactor = 1 - (this.GRIP_LOSS_MIN_CONTRACTION + Math.random() * (this.GRIP_LOSS_MAX_CONTRACTION - this.GRIP_LOSS_MIN_CONTRACTION));
                        state.phaseDuration = this.GRIP_LOSS_MIN_DURATION +
                            Math.random() * (this.GRIP_LOSS_MAX_DURATION - this.GRIP_LOSS_MIN_DURATION);
                    }
                    break;

                case 'contracting':
                    // Check if in a micro-pause
                    if (state.contractPaused) {
                        if (now >= state.contractPauseEnd) {
                            state.contractPaused = false;
                            // Schedule next possible pause
                            state.nextPauseTime = now + (500 + Math.random() * 2000);
                        }
                        break;
                    }

                    // Gradually lose grip
                    const contractSpeed = (1 - state.targetFactor) / state.phaseDuration;
                    state.stretchFactor -= contractSpeed * deltaTime;

                    // Time-based micro-pause: ~1 pause every 1-3 seconds
                    if (now >= state.nextPauseTime) {
                        state.contractPaused = true;
                        state.contractPauseEnd = now + (100 + Math.random() * 300);
                    }

                    if (state.stretchFactor <= state.targetFactor) {
                        state.stretchFactor = state.targetFactor;
                        state.phase = 'contracted_hold';
                        const holdDuration = this.GRIP_LOSS_HOLD_MIN +
                            Math.random() * (this.GRIP_LOSS_HOLD_MAX - this.GRIP_LOSS_HOLD_MIN);
                        state.holdEndTime = now + holdDuration * 1000;
                    }
                    break;

                case 'contracted_hold':
                    if (now >= state.holdEndTime) {
                        this.startRatcheting(state);
                    }
                    break;

                case 'ratcheting':
                    this.animateRatcheting(state, deltaTime);
                    break;

                case 'yanking':
                    this.animateYanking(state, deltaTime);
                    break;

                case 'settling':
                    this.animateSettling(state, deltaTime, now);
                    break;
            }
        }
    }

    private startRatcheting(state: { phase: string; angleOffset: number; targetFactor: number }): void {
        state.phase = 'ratcheting';
        state.angleOffset = (Math.random() * 2 - 1) * this.OVERSHOOT_ANGLE_RANGE;
    }

    private animateRatcheting(state: {
        phase: string;
        stretchFactor: number;
        targetFactor: number;
        stretchOffset: number;
        angleOffset: number;
        currentAngle: number;
        yankCount: number;
        yankTarget: number;
    }, deltaTime: number): void {
        const overshootDistance = this.getOvershootDistance();

        // Animate stretchFactor back to 1 (if contracted)
        if (state.stretchFactor < 1) {
            const factorSpeed = (1 - state.targetFactor) / this.RATCHET_DURATION;
            state.stretchFactor = Math.min(1, state.stretchFactor + factorSpeed * deltaTime);
        }

        // Animate stretchOffset toward overshoot distance
        const offsetSpeed = overshootDistance / this.RATCHET_DURATION;
        state.stretchOffset += offsetSpeed * deltaTime;

        // Animate angle toward target
        const angleSpeed = Math.abs(state.angleOffset) / this.RATCHET_DURATION;
        if (state.currentAngle < state.angleOffset) {
            state.currentAngle = Math.min(state.angleOffset, state.currentAngle + angleSpeed * deltaTime);
        } else {
            state.currentAngle = Math.max(state.angleOffset, state.currentAngle - angleSpeed * deltaTime);
        }

        if (state.stretchOffset >= overshootDistance) {
            state.stretchFactor = 1;
            state.stretchOffset = overshootDistance;
            state.currentAngle = state.angleOffset;

            // If large angle offset, do alternating yanks before settling
            if (Math.abs(state.angleOffset) >= this.YANK_ANGLE_THRESHOLD) {
                const yankCount = Math.abs(state.angleOffset) >= this.OVERSHOOT_ANGLE_RANGE * 0.8 ? 3 : 2;
                state.phase = 'yanking';
                state.yankCount = yankCount;
                state.yankTarget = -state.angleOffset; // first yank goes to opposite side
            } else {
                state.phase = 'settling';
            }
        }
    }

    private animateYanking(state: {
        phase: string;
        currentAngle: number;
        angleOffset: number;
        yankCount: number;
        yankTarget: number;
        yankHolding: boolean;
        yankHoldEnd: number;
    }, deltaTime: number): void {
        const now = performance.now();

        if (state.yankHolding) {
            if (now >= state.yankHoldEnd) {
                state.yankHolding = false;
                state.yankCount--;

                if (state.yankCount <= 0) {
                    state.phase = 'settling';
                } else {
                    state.yankTarget = -state.yankTarget;
                }
            }
            return;
        }

        // Snap portion: move in half the yank duration
        const angleSpeed = Math.abs(state.angleOffset) * 2 / (this.YANK_DURATION / 2);

        if (state.currentAngle < state.yankTarget) {
            state.currentAngle = Math.min(state.yankTarget, state.currentAngle + angleSpeed * deltaTime);
        } else {
            state.currentAngle = Math.max(state.yankTarget, state.currentAngle - angleSpeed * deltaTime);
        }

        // Reached target - start hold
        if (Math.abs(state.currentAngle - state.yankTarget) < 0.01) {
            state.currentAngle = state.yankTarget;
            state.yankHolding = true;
            const holdDuration = (this.YANK_DURATION / 2) * (5 * Math.random());
            state.yankHoldEnd = now + holdDuration * 1000;
        }
    }

    private animateSettling(state: {
        phase: string;
        stretchOffset: number;
        angleOffset: number;
        currentAngle: number;
        holdEndTime: number;
    }, deltaTime: number, now: number): void {
        const overshootDistance = this.getOvershootDistance();

        // Ease stretchOffset back to 0
        const settleSpeed = overshootDistance / this.SETTLE_DURATION;
        state.stretchOffset -= settleSpeed * deltaTime;

        // Ease angle back to 0
        const angleSettleSpeed = Math.abs(state.angleOffset) / this.SETTLE_DURATION;
        if (state.currentAngle > 0) {
            state.currentAngle = Math.max(0, state.currentAngle - angleSettleSpeed * deltaTime);
        } else {
            state.currentAngle = Math.min(0, state.currentAngle + angleSettleSpeed * deltaTime);
        }

        if (state.stretchOffset <= 0) {
            state.stretchOffset = 0;
            state.currentAngle = 0;
            state.phase = 'holding';
            const nextDelay = this.GRIP_LOSS_POST_SETTLE_DELAY_MIN +
                Math.random() * (this.GRIP_LOSS_POST_SETTLE_DELAY_MAX - this.GRIP_LOSS_POST_SETTLE_DELAY_MIN);
            state.holdEndTime = now + nextDelay * 1000;
        }
    }

    triggerOvershoot(cloudId: string): void {
        const state = this.stretchAnim.get(cloudId);
        if (!state) return;

        // User-triggered unblend: just reset to holding without overshoot animation
        state.phase = 'holding';
        state.stretchFactor = 1;
        state.stretchOffset = 0;
        state.currentAngle = 0;
        state.yankCount = 0;
        state.yankTarget = 0;
        state.yankHolding = false;
        state.yankHoldEnd = 0;
        state.contractPaused = false;
        state.contractPauseEnd = 0;
        state.nextPauseTime = performance.now() + (500 + Math.random() * 2000);
        const nextDelay = this.GRIP_LOSS_POST_SETTLE_DELAY_MIN +
            Math.random() * (this.GRIP_LOSS_POST_SETTLE_DELAY_MAX - this.GRIP_LOSS_POST_SETTLE_DELAY_MIN);
        state.holdEndTime = performance.now() + nextDelay * 1000;
    }

    private getStretchFactor(cloudId: string): number {
        const state = this.stretchAnim.get(cloudId);
        return state?.stretchFactor ?? 1;
    }

    private getStretchOffset(cloudId: string): number {
        const state = this.stretchAnim.get(cloudId);
        return state?.stretchOffset ?? 0;
    }

    private getStretchAngle(cloudId: string): number {
        const state = this.stretchAnim.get(cloudId);
        return state?.currentAngle ?? 0;
    }

    private initializeStretchAnim(cloudId: string): void {
        if (this.stretchAnim.has(cloudId)) return;

        this.stretchAnim.set(cloudId, {
            phase: 'holding',
            stretchFactor: 1,
            targetFactor: 1,
            stretchOffset: 0,
            holdEndTime: performance.now() + (1 + Math.random() * 2) * 1000,
            phaseDuration: 0,
            angleOffset: 0,
            currentAngle: 0,
            yankCount: 0,
            yankTarget: 0,
            yankHolding: false,
            yankHoldEnd: 0,
            contractPaused: false,
            contractPauseEnd: 0,
            nextPauseTime: performance.now() + (500 + Math.random() * 2000)
        });
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

    private calculateForegroundPositions(
        model: SimulatorModel,
        instances: CloudInstance[]
    ): Map<string, { x: number; y: number; scale: number }> {
        const positions = new Map<string, { x: number; y: number; scale: number }>();

        const targetInstances = Array.from(model.getTargetCloudIds())
            .map(id => instances.find(inst => inst.cloud.id === id))
            .filter(inst => inst !== undefined) as CloudInstance[];

        if (targetInstances.length === 0) return positions;

        const conferencePositions = this.calculateConferenceRoomPositions(model, targetInstances);
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;

        // Position target parts at their conference seats
        for (const [cloudId, pos] of conferencePositions.clouds) {
            positions.set(cloudId, { x: pos.x, y: pos.y, scale: 1 });
        }

        // Position supporting parts behind their targets
        for (const targetId of model.getTargetCloudIds()) {
            const supportingIds = model.getSupportingParts(targetId);
            const targetPos = conferencePositions.clouds.get(targetId);
            if (!targetPos) continue;

            const supportingArray = Array.from(supportingIds);
            supportingArray.forEach((supportingId, index) => {
                const angle = Math.atan2(targetPos.y - centerY, targetPos.x - centerX);
                const distance = 80 + index * 50;
                positions.set(supportingId, {
                    x: targetPos.x + Math.cos(angle) * distance,
                    y: targetPos.y + Math.sin(angle) * distance,
                    scale: 1
                });
            });
        }

        // Position blended parts: interpolate between star and their assigned seat based on degree
        const blendedParts = model.getBlendedParts();
        const blendedDegrees = model.getBlendedPartsWithDegrees();
        const targetIds = Array.from(model.getTargetCloudIds());
        const totalSeats = targetIds.length + blendedParts.length + 1;

        blendedParts.forEach((cloudId) => {
            if (!this.blendedOffsets.has(cloudId)) {
                const angle = Math.random() * 2 * Math.PI;
                const radius = Math.random() * 15;
                this.blendedOffsets.set(cloudId, {
                    x: radius * Math.cos(angle),
                    y: radius * Math.sin(angle)
                });
            }

            const seatIndex = this.conferenceSeatAssignments.get(cloudId);
            const seatPos = seatIndex !== undefined
                ? this.getSeatPosition(seatIndex, totalSeats)
                : this.getStarPosition();

            const offset = this.blendedOffsets.get(cloudId)!;
            const degree = blendedDegrees.get(cloudId) ?? 1;
            const starPos = this.getStarPosition();

            // degree=1 means fully blended (at star), degree->0 means separating (moving to seat)
            const starX = starPos.x + offset.x;
            const starY = starPos.y + offset.y;
            const interpolatedX = seatPos.x + degree * (starX - seatPos.x);
            const interpolatedY = seatPos.y + degree * (starY - seatPos.y);

            positions.set(cloudId, {
                x: interpolatedX,
                y: interpolatedY,
                scale: 1
            });
        });

        // Clean up offsets for parts no longer blended
        for (const cloudId of this.blendedOffsets.keys()) {
            if (!blendedParts.includes(cloudId)) {
                this.blendedOffsets.delete(cloudId);
            }
        }

        return positions;
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
            }
        }

        if (this.mode === 'foreground') {
            this.conferencePhaseShift += this.conferenceRotationSpeed * deltaTime;
        }

        this.animateSeatCount(deltaTime);
        this.animateStar(deltaTime);
    }

    animateCloudStates(
        deltaTime: number,
        panoramaPositions: Map<string, { x: number; y: number; scale: number }>,
        model: SimulatorModel
    ): { completedUnblendings: string[] } {
        const completedUnblendings: string[] = [];

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
            if (prevDegree > 0.01 && state.blendingDegree <= 0.01 && state.targetBlendingDegree <= 0) {
                completedUnblendings.push(cloudId);
            }
        }

        return { completedUnblendings };
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
            smoothing: { ...DEFAULT_SMOOTHING },
            inCounterZoomGroup: false
        });
    }

    private animateSeatCount(deltaTime: number): void {
        if (this.targetSeatCount === 0 || this.currentSeatCount === this.targetSeatCount) return;

        const speed = 0.2; // seats per second (linear)
        const diff = this.targetSeatCount - this.currentSeatCount;
        const step = Math.sign(diff) * Math.min(Math.abs(diff), speed * deltaTime);
        this.currentSeatCount += step;

        if (Math.abs(this.currentSeatCount - this.targetSeatCount) < 0.01) {
            this.currentSeatCount = this.targetSeatCount;
        }
    }

    isSeatCountAnimating(): boolean {
        return this.targetSeatCount > 0 && Math.abs(this.currentSeatCount - this.targetSeatCount) > 0.01;
    }

    isConferenceRotating(): boolean {
        return this.mode === 'foreground' && this.conferenceRotationSpeed !== 0;
    }

    setConferenceRotationPaused(paused: boolean): void {
        this.conferenceRotationSpeed = paused ? 0 : 0.05;
    }

    updateForegroundPositions(model: SimulatorModel, instances: CloudInstance[]): void {
        if (this.mode !== 'foreground') return;

        // Update cached star position for conference rotation
        this.cachedStarPosition = this.getSeatPosition(0, this.targetSeatCount);

        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        this.starTargetX = this.cachedStarPosition.x - centerX;
        this.starTargetY = this.cachedStarPosition.y - centerY;
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
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;

        if (this.mode === 'foreground' && targetIds.size > 0) {
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

        const seatIndex = this.conferenceSeatAssignments.get(cloudId);
        if (seatIndex === undefined) return null;

        const targetIds = Array.from(model.getTargetCloudIds());
        const blendedParts = model.getBlendedParts();
        const totalSeats = targetIds.length + blendedParts.length + 1;
        return this.getSeatPosition(seatIndex, totalSeats);
    }

    getBlendedLatticeStretch(cloud: Cloud, model: SimulatorModel): { stretchX: number; stretchY: number; anchorSide: 'left' | 'right' | 'top' | 'bottom'; anchorOffsetX: number; anchorOffsetY: number } | null {
        const cloudId = cloud.id;
        if (!model.isBlended(cloudId)) return null;

        // No stretch animation for spontaneous blends
        if (model.getBlendReason(cloudId) !== 'therapist') return null;

        const degree = cloud.animatedBlendingDegree;
        if (degree >= 1) return null;

        const seatIndex = this.conferenceSeatAssignments.get(cloudId);
        if (seatIndex === undefined) return null;

        const targetIds = Array.from(model.getTargetCloudIds());
        const blendedParts = model.getBlendedParts();
        const totalSeats = targetIds.length + blendedParts.length + 1;
        const seatPos = this.getSeatPosition(seatIndex, totalSeats);

        const offset = this.blendedOffsets.get(cloudId);
        const starPos = this.getStarPosition();
        const starX = starPos.x + (offset?.x ?? 0);
        const starY = starPos.y + (offset?.y ?? 0);

        const qDx = seatPos.x - starX;
        const qDy = seatPos.y - starY;
        const qLength = Math.sqrt(qDx * qDx + qDy * qDy);

        if (qLength < 1) return null;

        // Track committed degree - the level we've "settled" to after overshoots
        let committedDegree = this.committedBlendingDegrees.get(cloudId);
        if (committedDegree === undefined) {
            committedDegree = degree;
            this.committedBlendingDegrees.set(cloudId, degree);
        }

        // Initialize stretch animation state
        this.initializeStretchAnim(cloudId);

        // Check if user has actively unblended (degree decreased significantly)
        const isAboutToFullyUnblend = degree < 0.15;
        const state = this.stretchAnim.get(cloudId)!;
        const isCurrentlyOvershooting = state.phase === 'ratcheting' || state.phase === 'settling';

        if (!isCurrentlyOvershooting && !isAboutToFullyUnblend && degree < committedDegree - this.DEGREE_STEP_THRESHOLD) {
            // Degree has decreased by a step - trigger overshoot
            this.committedBlendingDegrees.set(cloudId, degree);
            committedDegree = degree;
            this.triggerOvershoot(cloudId);
        }

        // Get stretch factor, offset, and angle from unified animation state
        const stretchFactor = this.getStretchFactor(cloudId);
        const stretchOffset = this.getStretchOffset(cloudId);
        const stretchAngle = this.getStretchAngle(cloudId);

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
            duration: 10.0,
            spiralRadius: startRadius,
            rotations: 1.5,
            exitAngle: startAngle
        });

        // Set target opacity to fade out during spiral
        state.targetOpacity = 0;
        state.smoothing.opacity = 0.25; // Very slow fade to match spiral duration
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
        const maxRadius = Math.max(this.canvasWidth, this.canvasHeight) * 1.05;

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

            // Override position target to prevent smoothing from interfering
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

    getSeatInfo(model: SimulatorModel): SeatInfo[] {
        const targetIds = Array.from(model.getTargetCloudIds());
        const blendedIds = model.getBlendedParts();
        const totalSeats = targetIds.length + blendedIds.length + 1;

        const seatToCloudId = new Map<number, string>();
        for (const cloudId of targetIds) {
            const seat = this.conferenceSeatAssignments.get(cloudId);
            if (seat !== undefined) seatToCloudId.set(seat, cloudId);
        }
        for (const cloudId of blendedIds) {
            const seat = this.conferenceSeatAssignments.get(cloudId);
            if (seat !== undefined) seatToCloudId.set(seat, cloudId);
        }

        const seats: SeatInfo[] = [];
        for (let i = 0; i < totalSeats; i++) {
            const pos = this.getSeatPosition(i, totalSeats);
            const cloudId = seatToCloudId.get(i);
            seats.push({
                index: i,
                x: pos.x,
                y: pos.y,
                occupied: cloudId !== undefined,
                cloudId
            });
        }
        return seats;
    }
}
