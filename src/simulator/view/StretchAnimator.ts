export type StretchPhase = 'holding' | 'contracting' | 'contracted_hold' | 'ratcheting' | 'yanking' | 'settling';

export interface StretchConfig {
    getConferenceTableRadius: () => number;
}

export class StretchAnimator {
    private cloudId: string;
    private config: StretchConfig;

    private phase: StretchPhase = 'holding';
    private stretchFactor: number = 1;
    private targetFactor: number = 1;
    private stretchOffset: number = 0;
    private holdEndTime: number;
    private phaseDuration: number = 0;
    private angleOffset: number = 0;
    private currentAngle: number = 0;
    private yankCount: number = 0;
    private yankTarget: number = 0;
    private yankHolding: boolean = false;
    private yankHoldEnd: number = 0;
    private contractPaused: boolean = false;
    private contractPauseEnd: number = 0;
    private nextPauseTime: number;

    private committedBlendingDegree: number = 1;

    static readonly DEGREE_STEP_THRESHOLD = 0.06;
    static readonly OVERSHOOT_ANGLE_RANGE = Math.PI / 6;
    static readonly RATCHET_DURATION = 0.35;
    static readonly YANK_DURATION = 0.30;
    static readonly YANK_ANGLE_THRESHOLD = Math.PI / 12;
    static readonly SETTLE_DURATION = 0.25;

    static readonly GRIP_LOSS_MIN_DURATION = 1.5;
    static readonly GRIP_LOSS_MAX_DURATION = 4.0;
    static readonly GRIP_LOSS_HOLD_MIN = 0.3;
    static readonly GRIP_LOSS_HOLD_MAX = 1.2;
    static readonly GRIP_LOSS_MIN_CONTRACTION = 0.6;
    static readonly GRIP_LOSS_MAX_CONTRACTION = 0.6;
    static readonly GRIP_LOSS_POST_SETTLE_DELAY_MIN = 1.0;
    static readonly GRIP_LOSS_POST_SETTLE_DELAY_MAX = 3.0;

    constructor(cloudId: string, config: StretchConfig) {
        this.cloudId = cloudId;
        this.config = config;
        const now = performance.now();
        this.holdEndTime = now + (1 + Math.random() * 2) * 1000;
        this.nextPauseTime = now + (500 + Math.random() * 2000);
    }

    private getOvershootDistance(): number {
        return this.config.getConferenceTableRadius() * 0.75;
    }

    animate(deltaTime: number): void {
        const now = performance.now();

        switch (this.phase) {
            case 'holding':
                if (now >= this.holdEndTime) {
                    this.phase = 'contracting';
                    this.targetFactor = 1 - (StretchAnimator.GRIP_LOSS_MIN_CONTRACTION +
                        Math.random() * (StretchAnimator.GRIP_LOSS_MAX_CONTRACTION - StretchAnimator.GRIP_LOSS_MIN_CONTRACTION));
                    this.phaseDuration = StretchAnimator.GRIP_LOSS_MIN_DURATION +
                        Math.random() * (StretchAnimator.GRIP_LOSS_MAX_DURATION - StretchAnimator.GRIP_LOSS_MIN_DURATION);
                }
                break;

            case 'contracting':
                if (this.contractPaused) {
                    if (now >= this.contractPauseEnd) {
                        this.contractPaused = false;
                        this.nextPauseTime = now + (500 + Math.random() * 2000);
                    }
                    break;
                }

                const contractSpeed = (1 - this.targetFactor) / this.phaseDuration;
                this.stretchFactor -= contractSpeed * deltaTime;

                if (now >= this.nextPauseTime) {
                    this.contractPaused = true;
                    this.contractPauseEnd = now + (100 + Math.random() * 300);
                }

                if (this.stretchFactor <= this.targetFactor) {
                    this.stretchFactor = this.targetFactor;
                    this.phase = 'contracted_hold';
                    const holdDuration = StretchAnimator.GRIP_LOSS_HOLD_MIN +
                        Math.random() * (StretchAnimator.GRIP_LOSS_HOLD_MAX - StretchAnimator.GRIP_LOSS_HOLD_MIN);
                    this.holdEndTime = now + holdDuration * 1000;
                }
                break;

            case 'contracted_hold':
                if (now >= this.holdEndTime) {
                    this.startRatcheting();
                }
                break;

            case 'ratcheting':
                this.animateRatcheting(deltaTime);
                break;

            case 'yanking':
                this.animateYanking(deltaTime);
                break;

            case 'settling':
                this.animateSettling(deltaTime, now);
                break;
        }
    }

    private startRatcheting(): void {
        this.phase = 'ratcheting';
        this.angleOffset = (Math.random() * 2 - 1) * StretchAnimator.OVERSHOOT_ANGLE_RANGE;
    }

    private animateRatcheting(deltaTime: number): void {
        const overshootDistance = this.getOvershootDistance();

        if (this.stretchFactor < 1) {
            const factorSpeed = (1 - this.targetFactor) / StretchAnimator.RATCHET_DURATION;
            this.stretchFactor = Math.min(1, this.stretchFactor + factorSpeed * deltaTime);
        }

        const offsetSpeed = overshootDistance / StretchAnimator.RATCHET_DURATION;
        this.stretchOffset += offsetSpeed * deltaTime;

        const angleSpeed = Math.abs(this.angleOffset) / StretchAnimator.RATCHET_DURATION;
        if (this.currentAngle < this.angleOffset) {
            this.currentAngle = Math.min(this.angleOffset, this.currentAngle + angleSpeed * deltaTime);
        } else {
            this.currentAngle = Math.max(this.angleOffset, this.currentAngle - angleSpeed * deltaTime);
        }

        if (this.stretchOffset >= overshootDistance) {
            this.stretchFactor = 1;
            this.stretchOffset = overshootDistance;
            this.currentAngle = this.angleOffset;

            if (Math.abs(this.angleOffset) >= StretchAnimator.YANK_ANGLE_THRESHOLD) {
                const yankCount = Math.abs(this.angleOffset) >= StretchAnimator.OVERSHOOT_ANGLE_RANGE * 0.8 ? 3 : 2;
                this.phase = 'yanking';
                this.yankCount = yankCount;
                this.yankTarget = -this.angleOffset;
            } else {
                this.phase = 'settling';
            }
        }
    }

    private animateYanking(deltaTime: number): void {
        const now = performance.now();

        if (this.yankHolding) {
            if (now >= this.yankHoldEnd) {
                this.yankHolding = false;
                this.yankCount--;

                if (this.yankCount <= 0) {
                    this.phase = 'settling';
                } else {
                    this.yankTarget = -this.yankTarget;
                }
            }
            return;
        }

        const angleSpeed = Math.abs(this.angleOffset) * 2 / (StretchAnimator.YANK_DURATION / 2);

        if (this.currentAngle < this.yankTarget) {
            this.currentAngle = Math.min(this.yankTarget, this.currentAngle + angleSpeed * deltaTime);
        } else {
            this.currentAngle = Math.max(this.yankTarget, this.currentAngle - angleSpeed * deltaTime);
        }

        if (Math.abs(this.currentAngle - this.yankTarget) < 0.01) {
            this.currentAngle = this.yankTarget;
            this.yankHolding = true;
            const holdDuration = (StretchAnimator.YANK_DURATION / 2) * (5 * Math.random());
            this.yankHoldEnd = now + holdDuration * 1000;
        }
    }

    private animateSettling(deltaTime: number, now: number): void {
        const overshootDistance = this.getOvershootDistance();

        const settleSpeed = overshootDistance / StretchAnimator.SETTLE_DURATION;
        this.stretchOffset -= settleSpeed * deltaTime;

        const angleSettleSpeed = Math.abs(this.angleOffset) / StretchAnimator.SETTLE_DURATION;
        if (this.currentAngle > 0) {
            this.currentAngle = Math.max(0, this.currentAngle - angleSettleSpeed * deltaTime);
        } else {
            this.currentAngle = Math.min(0, this.currentAngle + angleSettleSpeed * deltaTime);
        }

        if (this.stretchOffset <= 0) {
            this.stretchOffset = 0;
            this.currentAngle = 0;
            this.phase = 'holding';
            const nextDelay = StretchAnimator.GRIP_LOSS_POST_SETTLE_DELAY_MIN +
                Math.random() * (StretchAnimator.GRIP_LOSS_POST_SETTLE_DELAY_MAX - StretchAnimator.GRIP_LOSS_POST_SETTLE_DELAY_MIN);
            this.holdEndTime = now + nextDelay * 1000;
        }
    }

    triggerOvershoot(): void {
        this.phase = 'holding';
        this.stretchFactor = 1;
        this.stretchOffset = 0;
        this.currentAngle = 0;
        this.yankCount = 0;
        this.yankTarget = 0;
        this.yankHolding = false;
        this.yankHoldEnd = 0;
        this.contractPaused = false;
        this.contractPauseEnd = 0;
        this.nextPauseTime = performance.now() + (500 + Math.random() * 2000);
        const nextDelay = StretchAnimator.GRIP_LOSS_POST_SETTLE_DELAY_MIN +
            Math.random() * (StretchAnimator.GRIP_LOSS_POST_SETTLE_DELAY_MAX - StretchAnimator.GRIP_LOSS_POST_SETTLE_DELAY_MIN);
        this.holdEndTime = performance.now() + nextDelay * 1000;
    }

    checkDegreeChange(newDegree: number): boolean {
        const isAboutToFullyUnblend = newDegree < 0.15;
        const isCurrentlyOvershooting = this.phase === 'ratcheting' || this.phase === 'settling';

        if (!isCurrentlyOvershooting && !isAboutToFullyUnblend &&
            newDegree < this.committedBlendingDegree - StretchAnimator.DEGREE_STEP_THRESHOLD) {
            this.committedBlendingDegree = newDegree;
            this.triggerOvershoot();
            return true;
        }
        return false;
    }

    setCommittedDegree(degree: number): void {
        this.committedBlendingDegree = degree;
    }

    getStretchFactor(): number {
        return this.stretchFactor;
    }

    getStretchOffset(): number {
        return this.stretchOffset;
    }

    getStretchAngle(): number {
        return this.currentAngle;
    }

    getPhase(): StretchPhase {
        return this.phase;
    }
}
