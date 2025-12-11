import { SimulatorModel } from './ifsModel.js';
import { Cloud } from './cloudShape.js';

export const STAR_OUTER_RADIUS = 20;
export const STAR_INNER_RADIUS = 8;
const BLENDED_OPACITY = 0.7;

const CARPET_VERTEX_COUNT = 8;
const CARPET_BASE_WIDTH = 40;
export const CARPET_SCALE = 3;
const CARPET_WIDTH = CARPET_BASE_WIDTH * CARPET_SCALE;

interface CarpetVertex {
    baseX: number;
    yOffset: number;
    velocity: number;
}

interface CarpetState {
    seatIndex: number;
    currentX: number;
    currentY: number;
    targetX: number;
    targetY: number;
    isOccupied: boolean;
    occupiedOffset: number;
    entering: boolean;
    exiting: boolean;
    exitProgress: number;
    entryProgress: number;
    entryStartX: number;
    entryStartY: number;
    vertices: CarpetVertex[];
}

interface WindWave {
    amplitude: number;
    spatialFrequency: number;
    speed: number;
    phase: number;
}

interface WindImpulse {
    startTime: number;
    duration: number;
    peakAmplitude: number;
    position: number;
    width: number;
}

class WindField {
    private waves: WindWave[] = [];
    private impulses: WindImpulse[] = [];
    private direction: number;
    private time: number = 0;
    private baseWindSpeed: number = 1;
    private targetWindSpeed: number = 1;
    private canvasWidth: number;

    constructor(canvasWidth: number) {
        this.canvasWidth = canvasWidth;
        this.direction = Math.random() < 0.5 ? 1 : -1;

        this.waves = [
            { amplitude: 1.2, spatialFrequency: 0.015, speed: 80, phase: Math.random() * Math.PI * 2 },
            { amplitude: 0.8, spatialFrequency: 0.035, speed: 120, phase: Math.random() * Math.PI * 2 },
            { amplitude: 0.5, spatialFrequency: 0.008, speed: 40, phase: Math.random() * Math.PI * 2 },
            { amplitude: 0.6, spatialFrequency: 0.055, speed: 180, phase: Math.random() * Math.PI * 2 },
        ];

        for (let i = 0; i < 3; i++) {
            this.impulses.push({
                startTime: -Math.random() * 2,
                duration: 0.4 + Math.random() * 0.4,
                peakAmplitude: 0.8 + Math.random() * 1.5,
                position: Math.random() * this.canvasWidth,
                width: 100 + Math.random() * 200
            });
        }
    }

    update(deltaTime: number): void {
        this.time += deltaTime;

        if (Math.random() < 0.02 * deltaTime) {
            this.targetWindSpeed = 0.3 + Math.random() * 1.4;
        }
        this.baseWindSpeed += (this.targetWindSpeed - this.baseWindSpeed) * deltaTime * 0.5;

        if (Math.random() < 0.3 * deltaTime) {
            this.impulses.push({
                startTime: this.time,
                duration: 0.3 + Math.random() * 0.5,
                peakAmplitude: 1.2 + Math.random() * 2.5,
                position: Math.random() * this.canvasWidth,
                width: 100 + Math.random() * 200
            });
        }

        this.impulses = this.impulses.filter(imp =>
            this.time < imp.startTime + imp.duration + 2
        );
    }

    sample(x: number): number {
        let windForce = 0;

        for (const wave of this.waves) {
            const phase = (x * wave.spatialFrequency) - (this.time * wave.speed * 0.01 * this.direction) + wave.phase;
            windForce += Math.sin(phase) * wave.amplitude;
        }

        for (const imp of this.impulses) {
            const elapsed = this.time - imp.startTime;
            if (elapsed < 0) continue;

            const travelDistance = elapsed * 150 * this.direction;
            const impulseCenter = imp.position + travelDistance;

            const dist = Math.abs(x - impulseCenter);
            if (dist < imp.width) {
                const spatialFalloff = 1 - (dist / imp.width);
                let temporalEnvelope: number;
                if (elapsed < imp.duration * 0.3) {
                    temporalEnvelope = elapsed / (imp.duration * 0.3);
                } else if (elapsed < imp.duration) {
                    temporalEnvelope = 1;
                } else {
                    const decay = (elapsed - imp.duration) / 2;
                    temporalEnvelope = Math.exp(-decay * 2);
                }
                windForce += imp.peakAmplitude * spatialFalloff * temporalEnvelope;
            }
        }

        return windForce * this.baseWindSpeed;
    }
}

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

interface SupportingPartAnimation {
    startX: number;
    startY: number;
    startScale: number;
    startOpacity: number;
    endX: number;
    endY: number;
    endScale: number;
    endOpacity: number;
    progress: number;
    duration: number;
}

interface CloudViewState {
    cloudId: string;
    currentX: number;
    currentY: number;
    currentScale: number;
    currentOpacity: number;
    inCounterZoomGroup: boolean;
    supportingAnimation?: SupportingPartAnimation;
}

export class SimulatorView {
    private viewStates: Map<string, CloudViewState> = new Map();
    private mode: 'panorama' | 'foreground' = 'panorama';
    private previousMode: 'panorama' | 'foreground' = 'panorama';
    private previousTargetIds: Set<string> = new Set();
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
    private stretchPositionState: Map<string, { targetX: number; targetY: number; currentX: number; currentY: number }> = new Map();

    private conferencePhaseShift: number = Math.random() * Math.PI * 2;
    private conferenceSeatAssignments: Map<string, number> = new Map(); // cloudId -> seat index (0 = star)
    private previousSeatCount: number = 0;

    private committedBlendingDegrees: Map<string, number> = new Map();
    private readonly DEGREE_STEP_THRESHOLD = 0.06; // trigger overshoot every ~6% unblending

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

    private carpetStates: Map<number, CarpetState> = new Map();
    private windField: WindField | null = null;
    private readonly CARPET_OCCUPIED_DROP = 35;
    private readonly CARPET_FLY_DURATION = 0.8;
    private readonly CARPET_DAMPING = 0.92;
    private readonly CARPET_SPRING_STRENGTH = 15;
    private readonly CARPET_MAX_DISPLACEMENT = 12;

    constructor(canvasWidth: number, canvasHeight: number) {
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.windField = new WindField(canvasWidth);
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
        }
    }

    initializeViewStates(instances: CloudInstance[], panoramaPositions: Map<string, { x: number; y: number; scale: number }>): void {
        for (const instance of instances) {
            const pos = panoramaPositions.get(instance.cloud.id);
            if (pos) {
                this.viewStates.set(instance.cloud.id, {
                    cloudId: instance.cloud.id,
                    currentX: pos.x,
                    currentY: pos.y,
                    currentScale: pos.scale,
                    currentOpacity: 1,
                    inCounterZoomGroup: false
                });
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

    private getConferenceTableRadius(): number {
        return Math.min(this.canvasWidth, this.canvasHeight) * 0.3;
    }

    private getSeatPosition(seatIndex: number, totalSeats: number): { x: number; y: number } {
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;
        const radius = this.getConferenceTableRadius();
        const angleStep = (2 * Math.PI) / totalSeats;
        const angle = this.conferencePhaseShift + angleStep * seatIndex;
        return {
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle)
        };
    }

    getStarPosition(): { x: number; y: number } {
        return this.cachedStarPosition ?? { x: this.canvasWidth / 2, y: this.canvasHeight / 2 };
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
            }
        }

        // If seat count changed, we need to redistribute
        if (totalSeats !== this.previousSeatCount && this.previousSeatCount > 0) {
            // Keep existing relative positions by scaling seat indices
            const oldAssignments = new Map(this.conferenceSeatAssignments);
            this.conferenceSeatAssignments.clear();

            for (const [cloudId, oldSeat] of oldAssignments) {
                if (allSeatedIds.includes(cloudId)) {
                    // Scale the seat position proportionally
                    const newSeat = Math.round((oldSeat / this.previousSeatCount) * totalSeats);
                    this.conferenceSeatAssignments.set(cloudId, newSeat % totalSeats || 1);
                }
            }
        }

        // Assign seats to new parts at random available positions
        const usedSeats = new Set<number>([0]); // 0 is always the star
        for (const seat of this.conferenceSeatAssignments.values()) {
            usedSeats.add(seat);
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

                if (availableSeats.length > 0) {
                    const randomSeat = availableSeats[Math.floor(Math.random() * availableSeats.length)];
                    this.conferenceSeatAssignments.set(cloudId, randomSeat);
                    usedSeats.add(randomSeat);
                } else {
                    // Fallback: assign next seat
                    this.conferenceSeatAssignments.set(cloudId, usedSeats.size);
                    usedSeats.add(usedSeats.size);
                }
            }
        }

        this.previousSeatCount = totalSeats;

        // Update cached star position
        this.cachedStarPosition = this.getSeatPosition(0, totalSeats);
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
        const cloudsWithAnimations = new Set<string>();
        if (oldModel && this.mode === 'foreground') {
            this.detectAndAnimateSupportingParts(oldModel, newModel, instances);
            for (const [cloudId, viewState] of this.viewStates) {
                if (viewState.supportingAnimation) {
                    cloudsWithAnimations.add(cloudId);
                }
            }
        }

        this.updateViewStates(newModel, instances, panoramaPositions, cloudsWithAnimations);
        this.updateStarPosition(newModel);
        this.updateBlendedCloudStates(newModel, instances);

        const currentTargetIds = newModel.getTargetCloudIds();
        if (this.transitionDirection !== 'reverse' || this.transitionProgress >= 1) {
            this.previousTargetIds = new Set(currentTargetIds);
        }
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

            const stretchInfo = this.getBlendedLatticeStretch(cloud.id, model);

            if (stretchInfo) {
                cloud.setBlendedStretch(stretchInfo.stretchX, stretchInfo.stretchY, stretchInfo.anchorSide);

                const viewState = this.viewStates.get(cloud.id);
                if (viewState) {
                    const starPos = this.getStarPosition();
                    const cloudEdgeOffset = cloud.getAnchorEdgeOffset(stretchInfo.anchorSide);

                    // Target position: anchor edge at far side of star
                    const targetX = starPos.x + stretchInfo.anchorOffsetX + cloudEdgeOffset.x;
                    const targetY = starPos.y + stretchInfo.anchorOffsetY + cloudEdgeOffset.y;

                    // Get or create position state for smooth transition
                    let posState = this.stretchPositionState.get(cloud.id);
                    if (!posState) {
                        // First frame of stretch - start from current position
                        posState = {
                            targetX,
                            targetY,
                            currentX: viewState.currentX,
                            currentY: viewState.currentY
                        };
                        this.stretchPositionState.set(cloud.id, posState);
                    } else {
                        posState.targetX = targetX;
                        posState.targetY = targetY;
                    }

                    viewState.currentX = posState.currentX;
                    viewState.currentY = posState.currentY;
                }
            } else {
                cloud.clearBlendedStretch();
                this.stretchPositionState.delete(cloud.id);
                this.committedBlendingDegrees.delete(cloud.id);
                this.stretchAnim.delete(cloud.id);
            }
        }
    }

    animateStretchPositions(deltaTime: number): void {
        const smoothing = 8;
        const factor = 1 - Math.exp(-smoothing * deltaTime);

        for (const [cloudId, posState] of this.stretchPositionState) {
            posState.currentX += (posState.targetX - posState.currentX) * factor;
            posState.currentY += (posState.targetY - posState.currentY) * factor;
        }

        this.animateStretchEffects(deltaTime);
    }

    private animateStretchEffects(deltaTime: number): void {
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

    private detectAndAnimateSupportingParts(
        oldModel: SimulatorModel,
        newModel: SimulatorModel,
        instances: CloudInstance[]
    ): void {
        const oldTargets = oldModel.getTargetCloudIds();
        const newTargets = newModel.getTargetCloudIds();
        const oldSupporting = oldModel.getAllSupportingParts();
        const newSupporting = newModel.getAllSupportingParts();
        const oldBlended = oldModel.getBlendedParts();
        const newBlended = newModel.getBlendedParts();

        const targetInstances = Array.from(newTargets)
            .map(id => instances.find(inst => inst.cloud.id === id))
            .filter(inst => inst !== undefined) as CloudInstance[];

        if (targetInstances.length === 0) return;

        const conferencePositions = this.calculateConferenceRoomPositions(newModel, targetInstances);
        const centerX = this.canvasWidth / 2;
        const centerY = this.canvasHeight / 2;

        const cloudsToAnimate = new Set<string>();

        const targetsChanged = oldTargets.size !== newTargets.size;

        for (const id of newTargets) {
            if (!oldTargets.has(id)) {
                cloudsToAnimate.add(id);
            } else if (targetsChanged) {
                cloudsToAnimate.add(id);

                const oldSupportingIds = oldModel.getSupportingParts(id);
                for (const supportId of oldSupportingIds) {
                    cloudsToAnimate.add(supportId);
                }
            }
        }

        for (const id of newSupporting) {
            if (!oldSupporting.has(id)) {
                cloudsToAnimate.add(id);
            }
        }

        for (const id of newBlended) {
            if (!oldBlended.includes(id)) {
                cloudsToAnimate.add(id);
            }
        }

        for (const targetId of newTargets) {
            const targetPos = conferencePositions.clouds.get(targetId);
            if (!targetPos) continue;

            if (cloudsToAnimate.has(targetId)) {
                this.animateSupportingPart(targetId, targetPos.x, targetPos.y, 1, 1, 0.5);
            }

            const supportingIds = newModel.getSupportingParts(targetId);
            const supportingArray = Array.from(supportingIds);
            supportingArray.forEach((supportingId, index) => {
                if (!cloudsToAnimate.has(supportingId)) return;

                const angle = Math.atan2(targetPos.y - centerY, targetPos.x - centerX);
                const distance = 80 + index * 50;
                const supportX = targetPos.x + Math.cos(angle) * distance;
                const supportY = targetPos.y + Math.sin(angle) * distance;

                this.animateSupportingPart(supportingId, supportX, supportY, 1, 1, 0.5);
            });
        }

        newBlended.forEach((cloudId, index) => {
            if (!cloudsToAnimate.has(cloudId)) return;

            if (!this.blendedOffsets.has(cloudId)) {
                const angle = Math.random() * 2 * Math.PI;
                const radius = Math.random() * 15;
                this.blendedOffsets.set(cloudId, {
                    x: radius * Math.cos(angle),
                    y: radius * Math.sin(angle)
                });
            }
            const offset = this.blendedOffsets.get(cloudId)!;
            this.animateSupportingPart(
                cloudId,
                conferencePositions.starX + offset.x,
                conferencePositions.starY + offset.y,
                1,
                BLENDED_OPACITY,
                0.5
            );
        });
    }

    private setsEqual(a: Set<string>, b: Set<string>): boolean {
        if (a.size !== b.size) return false;
        for (const item of a) {
            if (!b.has(item)) return false;
        }
        return true;
    }

    private updateViewStates(
        model: SimulatorModel,
        instances: CloudInstance[],
        panoramaPositions: Map<string, { x: number; y: number; scale: number }>,
        cloudsWithFreshAnimations: Set<string> = new Set()
    ): void {
        const isTransitioning = this.transitionDirection !== 'none';

        const foregroundPositions = this.calculateForegroundPositions(model, instances);
        const eased = this.easeInOutCubic(this.transitionProgress);

        if (this.mode === 'panorama') {
            for (const instance of instances) {
                const viewState = this.viewStates.get(instance.cloud.id);
                const panoramaPos = panoramaPositions.get(instance.cloud.id);
                if (!viewState || !panoramaPos) continue;

                const fgPos = foregroundPositions.get(instance.cloud.id);
                if (fgPos && isTransitioning) {
                    viewState.currentX = fgPos.x + (panoramaPos.x - fgPos.x) * eased;
                    viewState.currentY = fgPos.y + (panoramaPos.y - fgPos.y) * eased;
                    viewState.currentScale = fgPos.scale + (panoramaPos.scale - fgPos.scale) * eased;
                    viewState.currentOpacity = 1;
                    viewState.inCounterZoomGroup = eased < 1;
                } else if (isTransitioning) {
                    viewState.currentX = panoramaPos.x;
                    viewState.currentY = panoramaPos.y;
                    viewState.currentScale = panoramaPos.scale;
                    viewState.currentOpacity = eased;
                    viewState.inCounterZoomGroup = false;
                } else {
                    viewState.currentX = panoramaPos.x;
                    viewState.currentY = panoramaPos.y;
                    viewState.currentScale = panoramaPos.scale;
                    viewState.currentOpacity = 1;
                    viewState.inCounterZoomGroup = false;
                }
            }
        } else if (this.mode === 'foreground') {
            const fadeProgress = isTransitioning ? eased : 1;

            for (const instance of instances) {
                const viewState = this.viewStates.get(instance.cloud.id);
                if (!viewState) continue;

                const fgPos = foregroundPositions.get(instance.cloud.id);
                const panoramaPos = panoramaPositions.get(instance.cloud.id);

                if (fgPos) {
                    const isTarget = model.isTarget(instance.cloud.id);
                    const isBlended = model.isBlended(instance.cloud.id);
                    const hasFreshAnimation = cloudsWithFreshAnimations.has(instance.cloud.id);
                    const targetOpacity = isBlended ? BLENDED_OPACITY : 1;

                    // Keep animation if it exists and is still running (progress < 1)
                    const hasRunningAnimation = viewState.supportingAnimation && viewState.supportingAnimation.progress < 1;

                    if (hasRunningAnimation || (viewState.supportingAnimation && hasFreshAnimation)) {
                        // Animation handles position - let it continue
                    } else {
                        viewState.supportingAnimation = undefined;
                        if (isTransitioning && panoramaPos) {
                            viewState.currentX = panoramaPos.x + (fgPos.x - panoramaPos.x) * fadeProgress;
                            viewState.currentY = panoramaPos.y + (fgPos.y - panoramaPos.y) * fadeProgress;
                            viewState.currentScale = panoramaPos.scale + (fgPos.scale - panoramaPos.scale) * fadeProgress;
                            viewState.currentOpacity = targetOpacity;
                        } else {
                            viewState.currentX = fgPos.x;
                            viewState.currentY = fgPos.y;
                            viewState.currentScale = fgPos.scale;
                            viewState.currentOpacity = targetOpacity;
                        }
                    }
                    viewState.inCounterZoomGroup = true;
                } else if (panoramaPos) {
                    viewState.currentX = panoramaPos.x;
                    viewState.currentY = panoramaPos.y;
                    viewState.currentScale = panoramaPos.scale;
                    viewState.currentOpacity = isTransitioning ? (1 - fadeProgress) : 0;
                    viewState.inCounterZoomGroup = false;
                }
            }
        }
    }

    animate(deltaTime: number): void {
        if (this.transitionDirection !== 'none' && this.transitionProgress < 1) {
            this.transitionProgress = Math.min(1, this.transitionProgress + deltaTime / this.transitionDuration);
            if (this.transitionProgress >= 1) {
                this.transitionDirection = 'none';
            }
        }

        for (const viewState of this.viewStates.values()) {
            if (viewState.supportingAnimation) {
                const anim = viewState.supportingAnimation;
                anim.progress = Math.min(1, anim.progress + deltaTime / anim.duration);

                const eased = this.easeInOutCubic(anim.progress);
                viewState.currentX = anim.startX + (anim.endX - anim.startX) * eased;
                viewState.currentY = anim.startY + (anim.endY - anim.startY) * eased;
                viewState.currentScale = anim.startScale + (anim.endScale - anim.startScale) * eased;
                viewState.currentOpacity = anim.startOpacity + (anim.endOpacity - anim.startOpacity) * eased;

                if (anim.progress >= 1) {
                    viewState.supportingAnimation = undefined;
                }
            }
        }

        this.animateStar(deltaTime);
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

    updatePanoramaPosition(cloudId: string, x: number, y: number, scale: number): void {
        const viewState = this.viewStates.get(cloudId);
        if (viewState) {
            viewState.currentX = x;
            viewState.currentY = y;
            viewState.currentScale = scale;
        }
    }

    getViewState(cloudId: string): CloudViewState | undefined {
        return this.viewStates.get(cloudId);
    }

    getStretchPositionState(cloudId: string): { currentX: number; currentY: number; targetX: number; targetY: number } | undefined {
        return this.stretchPositionState.get(cloudId);
    }

    getBlendedStretchTarget(cloudId: string, model: SimulatorModel): { x: number; y: number } | null {
        if (!model.isBlended(cloudId)) return null;
        const degree = model.getBlendingDegree(cloudId);
        if (degree >= 1) return null;

        const seatIndex = this.conferenceSeatAssignments.get(cloudId);
        if (seatIndex === undefined) return null;

        const targetIds = Array.from(model.getTargetCloudIds());
        const blendedParts = model.getBlendedParts();
        const totalSeats = targetIds.length + blendedParts.length + 1;
        return this.getSeatPosition(seatIndex, totalSeats);
    }

    getBlendedLatticeStretch(cloudId: string, model: SimulatorModel): { stretchX: number; stretchY: number; anchorSide: 'left' | 'right' | 'top' | 'bottom'; anchorOffsetX: number; anchorOffsetY: number } | null {
        if (!model.isBlended(cloudId)) return null;

        const degree = model.getBlendingDegree(cloudId);
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

        // Stretch: base amount (relative) * factor (for contraction) + offset (absolute overshoot)
        const baseStretchAmount = (1 - degree) * qLength;
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

    animateSupportingPart(cloudId: string, endX: number, endY: number, endScale: number, endOpacity: number, duration: number = 0.5): void {
        const viewState = this.viewStates.get(cloudId);
        if (!viewState) return;

        viewState.supportingAnimation = {
            startX: viewState.currentX,
            startY: viewState.currentY,
            startScale: viewState.currentScale,
            startOpacity: viewState.currentOpacity,
            endX,
            endY,
            endScale,
            endOpacity,
            progress: 0,
            duration
        };
        viewState.currentX = endX;
        viewState.currentY = endY;
        viewState.currentScale = endScale;
        viewState.currentOpacity = endOpacity;
        viewState.inCounterZoomGroup = true;
    }

    animateFromPosition(cloudId: string, startX: number, startY: number, startScale: number, startOpacity: number, endX: number, endY: number, endScale: number, endOpacity: number, duration: number = 0.5): void {
        const viewState = this.viewStates.get(cloudId);
        if (!viewState) return;
        viewState.supportingAnimation = {
            startX,
            startY,
            startScale,
            startOpacity,
            endX,
            endY,
            endScale,
            endOpacity,
            progress: 0,
            duration
        };
        viewState.currentX = startX;
        viewState.currentY = startY;
        viewState.currentScale = startScale;
        viewState.currentOpacity = startOpacity;
        viewState.inCounterZoomGroup = true;
    }

    animateStepBack(cloudId: string, panoramaX: number, panoramaY: number, panoramaScale: number, duration: number = 0.5): void {
        const viewState = this.viewStates.get(cloudId);
        if (!viewState) return;

        viewState.supportingAnimation = {
            startX: viewState.currentX,
            startY: viewState.currentY,
            startScale: viewState.currentScale,
            startOpacity: viewState.currentOpacity,
            endX: panoramaX,
            endY: panoramaY,
            endScale: panoramaScale,
            endOpacity: 0,
            progress: 0,
            duration
        };
        viewState.inCounterZoomGroup = true;
    }

    private createCarpetVertices(): CarpetVertex[] {
        const vertices: CarpetVertex[] = [];
        const segmentWidth = CARPET_WIDTH / (CARPET_VERTEX_COUNT - 1);
        for (let i = 0; i < CARPET_VERTEX_COUNT; i++) {
            vertices.push({
                baseX: -CARPET_WIDTH / 2 + i * segmentWidth,
                yOffset: 0,
                velocity: 0
            });
        }
        return vertices;
    }

    updateCarpets(model: SimulatorModel, deltaTime: number): void {
        if (!this.windField) return;

        this.windField.update(deltaTime);

        const targetIds = Array.from(model.getTargetCloudIds());
        const blendedIds = model.getBlendedParts();
        const totalSeats = targetIds.length + blendedIds.length + 1;

        const currentSeatIndices = new Set<number>();
        for (let i = 0; i < totalSeats; i++) {
            currentSeatIndices.add(i);
        }

        for (const [seatIndex, carpet] of this.carpetStates) {
            if (!currentSeatIndices.has(seatIndex) && !carpet.exiting) {
                carpet.exiting = true;
                carpet.exitProgress = 0;
            }
        }

        for (let seatIndex = 0; seatIndex < totalSeats; seatIndex++) {
            if (!this.carpetStates.has(seatIndex)) {
                const seatPos = this.getSeatPosition(seatIndex, totalSeats);
                const entryAngle = Math.random() * Math.PI * 2;
                const entryDistance = Math.max(this.canvasWidth, this.canvasHeight);
                this.carpetStates.set(seatIndex, {
                    seatIndex,
                    currentX: seatPos.x + Math.cos(entryAngle) * entryDistance,
                    currentY: seatPos.y + Math.sin(entryAngle) * entryDistance,
                    targetX: seatPos.x,
                    targetY: seatPos.y,
                    isOccupied: false,
                    occupiedOffset: 0,
                    entering: true,
                    exiting: false,
                    exitProgress: 0,
                    entryProgress: 0,
                    entryStartX: seatPos.x + Math.cos(entryAngle) * entryDistance,
                    entryStartY: seatPos.y + Math.sin(entryAngle) * entryDistance,
                    vertices: this.createCarpetVertices()
                });
            }
        }

        const occupiedSeats = new Set<number>([0]);
        for (const cloudId of targetIds) {
            const seat = this.conferenceSeatAssignments.get(cloudId);
            if (seat !== undefined) occupiedSeats.add(seat);
        }
        for (const cloudId of blendedIds) {
            const seat = this.conferenceSeatAssignments.get(cloudId);
            if (seat !== undefined) occupiedSeats.add(seat);
        }

        for (const [seatIndex, carpet] of this.carpetStates) {
            if (carpet.exiting) {
                carpet.exitProgress += deltaTime / this.CARPET_FLY_DURATION;
                if (carpet.exitProgress >= 1) {
                    this.carpetStates.delete(seatIndex);
                    continue;
                }
                const eased = this.easeInOutCubic(carpet.exitProgress);
                const exitAngle = Math.atan2(carpet.currentY - this.canvasHeight / 2, carpet.currentX - this.canvasWidth / 2);
                const exitDistance = Math.max(this.canvasWidth, this.canvasHeight);
                carpet.currentX = carpet.targetX + Math.cos(exitAngle) * exitDistance * eased;
                carpet.currentY = carpet.targetY + Math.sin(exitAngle) * exitDistance * eased;
                continue;
            }

            if (carpet.entering) {
                carpet.entryProgress += deltaTime / this.CARPET_FLY_DURATION;
                if (carpet.entryProgress >= 1) {
                    carpet.entering = false;
                    carpet.currentX = carpet.targetX;
                    carpet.currentY = carpet.targetY;
                } else {
                    const eased = this.easeInOutCubic(carpet.entryProgress);
                    carpet.currentX = carpet.entryStartX + (carpet.targetX - carpet.entryStartX) * eased;
                    carpet.currentY = carpet.entryStartY + (carpet.targetY - carpet.entryStartY) * eased;
                }
            } else {
                const seatPos = this.getSeatPosition(seatIndex, totalSeats);
                carpet.targetX = seatPos.x;
                carpet.targetY = seatPos.y;

                const smoothing = 5;
                const factor = 1 - Math.exp(-smoothing * deltaTime);
                carpet.currentX += (carpet.targetX - carpet.currentX) * factor;
                carpet.currentY += (carpet.targetY - carpet.currentY) * factor;
            }

            const isNowOccupied = occupiedSeats.has(seatIndex);
            carpet.isOccupied = isNowOccupied;

            const targetOffset = isNowOccupied ? this.CARPET_OCCUPIED_DROP : 0;
            const offsetSmoothing = 4;
            const offsetFactor = 1 - Math.exp(-offsetSmoothing * deltaTime);
            carpet.occupiedOffset += (targetOffset - carpet.occupiedOffset) * offsetFactor;

            for (let i = 0; i < carpet.vertices.length; i++) {
                const vertex = carpet.vertices[i];
                const worldX = carpet.currentX + vertex.baseX;

                const windForce = this.windField.sample(worldX);

                vertex.velocity += windForce * this.CARPET_SPRING_STRENGTH * deltaTime;

                vertex.velocity -= vertex.yOffset * this.CARPET_SPRING_STRENGTH * 0.5 * deltaTime;

                if (i > 0) {
                    const prev = carpet.vertices[i - 1];
                    const diff = prev.yOffset - vertex.yOffset;
                    vertex.velocity += diff * this.CARPET_SPRING_STRENGTH * 0.3 * deltaTime;
                }
                if (i < carpet.vertices.length - 1) {
                    const next = carpet.vertices[i + 1];
                    const diff = next.yOffset - vertex.yOffset;
                    vertex.velocity += diff * this.CARPET_SPRING_STRENGTH * 0.3 * deltaTime;
                }

                vertex.velocity *= this.CARPET_DAMPING;

                vertex.yOffset += vertex.velocity * deltaTime;

                vertex.yOffset = Math.max(-this.CARPET_MAX_DISPLACEMENT,
                    Math.min(this.CARPET_MAX_DISPLACEMENT, vertex.yOffset));
            }
        }
    }

    getCarpetRenderData(): Array<{
        x: number;
        y: number;
        opacity: number;
        vertices: Array<{ x: number; y: number }>;
    }> {
        const carpets: Array<{
            x: number;
            y: number;
            opacity: number;
            vertices: Array<{ x: number; y: number }>;
        }> = [];

        for (const carpet of this.carpetStates.values()) {
            let opacity = 1;
            if (carpet.entering) {
                opacity = this.easeInOutCubic(carpet.entryProgress);
            } else if (carpet.exiting) {
                opacity = 1 - this.easeInOutCubic(carpet.exitProgress);
            }

            const vertices = carpet.vertices.map(v => ({
                x: v.baseX,
                y: v.yOffset
            }));

            carpets.push({
                x: carpet.currentX,
                y: carpet.currentY + carpet.occupiedOffset,
                opacity,
                vertices
            });
        }

        return carpets;
    }
}
