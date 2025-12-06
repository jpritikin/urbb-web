import { Point } from './geometry.js';

export class AnimatedKnot {
    x: number;
    y: number;
    velocity: number = 0;
    variationOffset: number = 0;
    targetVariationOffset: number = 0;
    targetTimer: number;
    targetInterval: number;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
        this.targetInterval = 0;
        this.targetTimer = 0;
    }

    setNewVariationOffset(offset: number, minInterval: number = 2.5, maxInterval: number = 3.5): void {
        this.targetVariationOffset = offset;
        this.targetInterval = minInterval + Math.random() * (maxInterval - minInterval);
        this.targetTimer = 0;
    }

    update(deltaTime: number, baseSvgY: number): void {
        const ACCELERATION = 0.25;
        const DAMPING = 0.25;

        const diff = this.targetVariationOffset - this.variationOffset;
        this.velocity += diff * ACCELERATION * deltaTime;
        this.velocity *= Math.pow(DAMPING, deltaTime);
        this.variationOffset += this.velocity * deltaTime;

        this.y = baseSvgY + this.variationOffset;
    }

    toPoint(): Point {
        return new Point(this.x, this.y);
    }
}

export class AnimatedFluffiness {
    cp1Factor: number;
    cp2Factor: number;
    cp1Velocity: number = 0;
    cp2Velocity: number = 0;
    cp1TargetFactor: number;
    cp2TargetFactor: number;
    targetTimer: number;
    targetInterval: number;

    constructor(cp1Factor: number, cp2Factor: number) {
        this.cp1Factor = cp1Factor;
        this.cp2Factor = cp2Factor;
        this.cp1TargetFactor = cp1Factor;
        this.cp2TargetFactor = cp2Factor;
        this.targetInterval = 0;
        this.targetTimer = 0;
    }

    setNewTargets(cp1Factor: number, cp2Factor: number, minInterval: number = 2.5, maxInterval: number = 3.5): void {
        this.cp1TargetFactor = cp1Factor;
        this.cp2TargetFactor = cp2Factor;
        this.targetInterval = minInterval + Math.random() * (maxInterval - minInterval);
        this.targetTimer = 0;
    }

    update(deltaTime: number, accelerationScale: number = 1): void {
        const ACCELERATION = 1;
        const DAMPING = 0.2;

        const diff1 = this.cp1TargetFactor - this.cp1Factor;
        this.cp1Velocity += diff1 * ACCELERATION * accelerationScale * deltaTime;
        this.cp1Velocity *= Math.pow(DAMPING, deltaTime);
        this.cp1Factor += this.cp1Velocity * deltaTime;

        const diff2 = this.cp2TargetFactor - this.cp2Factor;
        this.cp2Velocity += diff2 * ACCELERATION * accelerationScale * deltaTime;
        this.cp2Velocity *= Math.pow(DAMPING, deltaTime);
        this.cp2Factor += this.cp2Velocity * deltaTime;
    }
}
