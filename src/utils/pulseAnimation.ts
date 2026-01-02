type PulseTarget = 'inner' | 'outer' | 'tipAngle' | 'outerAlternating' | 'none';
type PulseDirection = 'expand' | 'contract';
type PulsePhase = 'attack' | 'decay' | 'idle';

const PULSE_MIN_INTERVAL = 3.0;
const PULSE_MAX_INTERVAL = 8.0;
const PULSE_MAGNITUDE = 0.35;
const PULSE_TIP_ANGLE_MAGNITUDE = 0.9;
const PULSE_ATTACK_DURATION = 0.15;
const PULSE_DECAY_DURATION = 0.6;

function randomInterval(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

function easeOut(t: number): number {
    return 1 - Math.pow(1 - t, 2);
}

export class PulseAnimation {
    private target: PulseTarget = 'none';
    private direction: PulseDirection = 'expand';
    private phase: PulsePhase = 'idle';
    private progress: number = 0;
    private timer: number = 0;
    private nextPulse: number;
    private armCount: number = 5;
    private parity: number = 1;

    innerRadiusOffset: number = 0;
    outerRadiusOffset: number = 0;
    outerAlternatingRadiusOffsets: number[] = [];
    tipAngleOffset: number = 0;

    constructor() {
        this.nextPulse = randomInterval(PULSE_MIN_INTERVAL, PULSE_MAX_INTERVAL);
    }

    setArmCount(count: number): void {
        this.armCount = count;
    }

    update(deltaTime: number, transitionActive: boolean): void {
        if (transitionActive) return;

        if (this.phase === 'idle') {
            this.timer += deltaTime;
            if (this.timer >= this.nextPulse) {
                this.timer = 0;
                this.nextPulse = randomInterval(PULSE_MIN_INTERVAL, PULSE_MAX_INTERVAL);
                this.startPulse();
            }
        } else if (this.phase === 'attack') {
            this.progress += deltaTime / PULSE_ATTACK_DURATION;
            if (this.progress >= 1) {
                this.progress = 1;
                this.phase = 'decay';
            }
            this.applyPulseOffset(easeOut(this.progress));
        } else if (this.phase === 'decay') {
            this.progress -= deltaTime / PULSE_DECAY_DURATION;
            if (this.progress <= 0) {
                this.progress = 0;
                this.phase = 'idle';
                this.target = 'none';
                this.innerRadiusOffset = 0;
                this.outerRadiusOffset = 0;
                this.outerAlternatingRadiusOffsets = [];
                this.tipAngleOffset = 0;
            } else {
                this.applyPulseOffset(easeOut(this.progress));
            }
        }
    }

    isIdle(): boolean {
        return this.phase === 'idle';
    }

    private startPulse(): void {
        this.phase = 'attack';
        this.progress = 0;
        if (this.armCount === 3 && Math.random() < 0.33) {
            this.target = 'tipAngle';
        } else if (this.armCount === 6 && Math.random() < 0.5) {
            this.target = 'outerAlternating';
            this.parity = Math.random() < 0.5 ? 1 : -1;
        } else {
            this.target = Math.random() < 0.5 ? 'inner' : 'outer';
        }
        this.direction = Math.random() < 0.5 ? 'expand' : 'contract';
    }

    private applyPulseOffset(t: number): void {
        const sign = this.direction === 'expand' ? 1 : -1;
        if (this.target === 'tipAngle') {
            this.tipAngleOffset = t * PULSE_TIP_ANGLE_MAGNITUDE * sign;
            this.innerRadiusOffset = 0;
            this.outerRadiusOffset = 0;
            this.outerAlternatingRadiusOffsets = [];
        } else if (this.target === 'outerAlternating') {
            const baseOffset = t * PULSE_MAGNITUDE * sign;
            this.outerAlternatingRadiusOffsets = [];
            for (let i = 0; i < this.armCount; i++) {
                const altSign = i % 2 === 0 ? 1 : -1;
                this.outerAlternatingRadiusOffsets[i] = this.parity * baseOffset * altSign;
            }
            this.tipAngleOffset = 0;
            this.innerRadiusOffset = 0;
            this.outerRadiusOffset = 0;
        } else {
            const offset = t * PULSE_MAGNITUDE * sign;
            this.tipAngleOffset = 0;
            this.outerAlternatingRadiusOffsets = [];
            if (this.target === 'inner') {
                this.innerRadiusOffset = offset;
                this.outerRadiusOffset = 0;
            } else if (this.target === 'outer') {
                this.outerRadiusOffset = offset;
                this.innerRadiusOffset = 0;
            }
        }
    }

    getTarget(): PulseTarget {
        return this.target;
    }

    triggerPulse(target?: PulseTarget, direction?: PulseDirection): void {
        this.phase = 'attack';
        this.progress = 0;

        if (target) {
            this.target = target;
        } else {
            if (this.armCount === 3 && Math.random() < 0.33) {
                this.target = 'tipAngle';
            } else if (this.armCount === 6 && Math.random() < 0.5) {
                this.target = 'outerAlternating';
            } else {
                this.target = Math.random() < 0.5 ? 'inner' : 'outer';
            }
        }

        if (this.target === 'outerAlternating') {
            this.parity = Math.random() < 0.5 ? 1 : -1;
        }

        this.direction = direction || (Math.random() < 0.5 ? 'expand' : 'contract');
    }
}
