import { CloudAnimatedState, DEFAULT_SMOOTHING, PositionTarget } from './types.js';
import { StretchAnimator, StretchConfig } from './StretchAnimator.js';
import { CARPET_FLY_DURATION, CARPET_START_SCALE, CARPET_SCALE } from '../carpetRenderer.js';

interface SpiralExitState {
    startX: number;
    startY: number;
    startTime: number;
    duration: number;
    spiralRadius: number;
    rotations: number;
    exitAngle: number;
}

interface FlyOutExitState {
    startX: number;
    startY: number;
    exitX: number;
    exitY: number;
    startTime: number;
    duration: number;
    startScale: number;
}

interface DelayedArrivalState {
    arrivalTime: number;
}

interface SupportingEntryState {
    startX: number;
    startY: number;
    startTime: number;
    duration: number;
}

export interface TransitionAnimatorConfig {
    canvasWidth: number;
    canvasHeight: number;
    getCloudState: (cloudId: string) => CloudAnimatedState | undefined;
    getOffscreenPosition: (fromX: number, fromY: number) => { x: number; y: number };
    getConferenceTableRadius: () => number;
    getCloudPosition: (cloudId: string) => { x: number; y: number } | undefined;
}

const BLENDED_OPACITY = 0.7;

export class TransitionAnimator {
    private config: TransitionAnimatorConfig;
    private spiralExits: Map<string, SpiralExitState> = new Map();
    private flyOutExits: Map<string, FlyOutExitState> = new Map();
    private delayedArrivals: Map<string, DelayedArrivalState> = new Map();
    private supportingEntries: Map<string, SupportingEntryState> = new Map();
    private stretchAnimators: Map<string, StretchAnimator> = new Map();
    private blendedOffsets: Map<string, { x: number; y: number }> = new Map();

    constructor(config: TransitionAnimatorConfig) {
        this.config = config;
    }

    setDimensions(width: number, height: number): void {
        this.config.canvasWidth = width;
        this.config.canvasHeight = height;
    }

    // --- Blended offsets ---

    getBlendedOffset(cloudId: string): { x: number; y: number } | undefined {
        return this.blendedOffsets.get(cloudId);
    }

    getOrCreateBlendedOffset(cloudId: string): { x: number; y: number } {
        let offset = this.blendedOffsets.get(cloudId);
        if (!offset) {
            const angle = Math.random() * 2 * Math.PI;
            const radius = Math.random() * 15;
            offset = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
            this.blendedOffsets.set(cloudId, offset);
        }
        return offset;
    }

    clearBlendedOffset(cloudId: string): void {
        this.blendedOffsets.delete(cloudId);
    }

    // --- Spiral exit animations ---

    startSpiralExit(cloudId: string): void {
        const state = this.config.getCloudState(cloudId);
        if (!state) return;

        const centerX = this.config.canvasWidth / 2;
        const centerY = this.config.canvasHeight / 2;
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
        state.smoothing.opacity = 0;
    }

    isSpiralExiting(cloudId: string): boolean {
        return this.spiralExits.has(cloudId);
    }

    hasActiveSpiralExits(): boolean {
        return this.spiralExits.size > 0;
    }

    animateSpiralExits(): void {
        const now = performance.now();
        const toRemove: string[] = [];
        const centerX = this.config.canvasWidth / 2;
        const centerY = this.config.canvasHeight / 2;
        const maxRadius = Math.max(this.config.canvasWidth, this.config.canvasHeight) * 1.1;

        for (const [cloudId, spiral] of this.spiralExits) {
            const state = this.config.getCloudState(cloudId);
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

            const eased = 1 - Math.pow(1 - progress, 2);
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

    // --- Fly-out exit animations ---

    startFlyOutExit(cloudId: string): void {
        const state = this.config.getCloudState(cloudId);
        if (!state) return;

        const exitPos = this.config.getOffscreenPosition(state.x, state.y);

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
        state.smoothing.opacity = 0;
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
            const state = this.config.getCloudState(cloudId);
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
            state.x = flyOut.startX + (flyOut.exitX - flyOut.startX) * eased;
            state.y = flyOut.startY + (flyOut.exitY - flyOut.startY) * eased;
            state.scale = flyOut.startScale + (CARPET_START_SCALE / CARPET_SCALE - flyOut.startScale) * eased;
            state.opacity = 1 - eased;
            state.positionTarget = { type: 'absolute', x: state.x, y: state.y };
        }

        for (const cloudId of toRemove) {
            this.flyOutExits.delete(cloudId);
        }
    }

    // --- Delayed arrivals ---

    scheduleDelayedArrival(cloudId: string, delaySeconds: number): void {
        const state = this.config.getCloudState(cloudId);
        if (state && state.opacity < 0.1) {
            this.delayedArrivals.set(cloudId, {
                arrivalTime: performance.now() + delaySeconds * 1000
            });
            state.targetOpacity = 0;
        }
    }

    isAwaitingArrival(cloudId: string): boolean {
        return this.delayedArrivals.has(cloudId);
    }

    animateDelayedArrivals(isBlended: (cloudId: string) => boolean): void {
        const now = performance.now();
        const toRemove: string[] = [];

        for (const [cloudId, arrival] of this.delayedArrivals) {
            if (now >= arrival.arrivalTime) {
                const state = this.config.getCloudState(cloudId);
                if (state) {
                    state.targetOpacity = isBlended(cloudId) ? BLENDED_OPACITY : 1;
                    state.smoothing.opacity = 2;
                }
                toRemove.push(cloudId);
            }
        }

        for (const cloudId of toRemove) {
            this.delayedArrivals.delete(cloudId);
        }
    }

    // --- Supporting entry animations ---

    startSupportingEntry(cloudId: string, targetId: string, index: number): void {
        const state = this.config.getCloudState(cloudId);
        if (!state) return;

        const targetPos = this.config.getCloudPosition(targetId);
        if (!targetPos) return;

        const centerX = this.config.canvasWidth / 2;
        const centerY = this.config.canvasHeight / 2;

        const angle = Math.atan2(targetPos.y - centerY, targetPos.x - centerX);
        const distance = 80 + index * 50;
        const finalX = targetPos.x + Math.cos(angle) * distance;
        const finalY = targetPos.y + Math.sin(angle) * distance;

        const startPos = this.config.getOffscreenPosition(finalX, finalY);

        state.x = startPos.x;
        state.y = startPos.y;
        state.opacity = 0;
        state.targetOpacity = 1;
        state.smoothing.opacity = 0;
        state.smoothing.position = 0;
        state.positionTarget = { type: 'supporting', targetId, index };

        this.supportingEntries.set(cloudId, {
            startX: startPos.x,
            startY: startPos.y,
            startTime: performance.now(),
            duration: CARPET_FLY_DURATION
        });
    }

    isSupportingEntering(cloudId: string): boolean {
        return this.supportingEntries.has(cloudId);
    }

    animateSupportingEntries(
        getPositionTarget: (cloudId: string) => PositionTarget | undefined,
        onComplete: (cloudId: string) => void
    ): void {
        const now = performance.now();
        const toRemove: string[] = [];
        const centerX = this.config.canvasWidth / 2;
        const centerY = this.config.canvasHeight / 2;

        for (const [cloudId, entry] of this.supportingEntries) {
            const state = this.config.getCloudState(cloudId);
            if (!state) {
                toRemove.push(cloudId);
                continue;
            }

            const elapsed = (now - entry.startTime) / 1000;
            const progress = Math.min(1, elapsed / entry.duration);

            if (progress >= 1) {
                toRemove.push(cloudId);
                state.smoothing.opacity = DEFAULT_SMOOTHING.opacity;
                state.smoothing.position = DEFAULT_SMOOTHING.position;
                state.opacity = 1;
                onComplete(cloudId);
                continue;
            }

            const eased = this.easeInOutCubic(progress);
            const posTarget = getPositionTarget(cloudId);
            let targetX = entry.startX;
            let targetY = entry.startY;

            if (posTarget?.type === 'supporting') {
                const seatPos = this.config.getCloudPosition(posTarget.targetId);
                if (seatPos) {
                    const angle = Math.atan2(seatPos.y - centerY, seatPos.x - centerX);
                    const distance = 80 + posTarget.index * 50;
                    targetX = seatPos.x + Math.cos(angle) * distance;
                    targetY = seatPos.y + Math.sin(angle) * distance;
                }
            }

            state.x = entry.startX + (targetX - entry.startX) * eased;
            state.y = entry.startY + (targetY - entry.startY) * eased;
            state.opacity = eased;
        }

        for (const cloudId of toRemove) {
            this.supportingEntries.delete(cloudId);
        }
    }

    // --- Stretch animators ---

    getOrCreateStretchAnimator(cloudId: string): StretchAnimator {
        let animator = this.stretchAnimators.get(cloudId);
        if (!animator) {
            animator = new StretchAnimator(cloudId, {
                getConferenceTableRadius: this.config.getConferenceTableRadius
            });
            this.stretchAnimators.set(cloudId, animator);
        }
        return animator;
    }

    getStretchAnimator(cloudId: string): StretchAnimator | undefined {
        return this.stretchAnimators.get(cloudId);
    }

    deleteStretchAnimator(cloudId: string): void {
        this.stretchAnimators.delete(cloudId);
    }

    animateStretchEffects(deltaTime: number): void {
        for (const animator of this.stretchAnimators.values()) {
            animator.animate(deltaTime);
        }
    }

    triggerOvershoot(cloudId: string): void {
        this.stretchAnimators.get(cloudId)?.triggerOvershoot();
    }

    // --- Utility ---

    private easeInOutCubic(t: number): number {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }
}
