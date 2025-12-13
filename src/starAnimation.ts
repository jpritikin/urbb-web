import {
    STAR_OUTER_RADIUS,
    STAR_INNER_RADIUS,
    THREE_ARM_INNER_RADIUS_FACTOR,
    dist,
    computeTransitionPosition,
    computeAdjacentArmPosition,
    computeSourceArmPosition,
    computeFinalArmPosition,
    TransitionContext,
} from './starAnimationCore.js';

export { STAR_OUTER_RADIUS, STAR_INNER_RADIUS };

type RotationState = 'stationary' | 'rotating_cw' | 'rotating_ccw';
type PulseTarget = 'inner' | 'outer' | 'none';
type PulseDirection = 'expand' | 'contract';

const BASE_ROTATION_SPEED = 0.15;
const STATE_CHANGE_MIN = 2.0;
const STATE_CHANGE_MAX = 6.0;
const PULSE_MIN_INTERVAL = 3.0;
const PULSE_MAX_INTERVAL = 8.0;
const PULSE_MAGNITUDE = 0.35;
const PULSE_ATTACK_DURATION = 0.15;
const PULSE_DECAY_DURATION = 0.6;

const ARM_CHANGE_MIN_INTERVAL = 1.0;
const ARM_CHANGE_MAX_INTERVAL = 5.0;
const ARM_TRANSITION_DURATION = 8;
const ARM_EXPANSION_FACTOR = 0.15;

const VALID_ARM_COUNTS = [5, 6, 7];

interface DebugCheckpoint {
    label: string;
    progress: number;
    T: { x: number, y: number };
    b1: { x: number, y: number };
    b2: { x: number, y: number };
    St: { x: number, y: number };
    S1: { x: number, y: number };
    S2: { x: number, y: number };
    At: { x: number, y: number };
    A1: { x: number, y: number };
    A2: { x: number, y: number };
    fin?: { tipX: number, tipY: number, base1X: number, base1Y: number };
}

interface ArmTransition {
    type: 'adding' | 'removing';
    progress: number;
    sourceArmIndex: number;
    unfoldAngle: number;
    opNum: number;
    debugCheckpoints: DebugCheckpoint[];
    debugPhase1Start: boolean;
    debugPhase1Mid: boolean;
    debugPhase1End: boolean;
    debugPhase2Start: boolean;
    debugPhase2Mid: boolean;
    debugPhase2End: boolean;
}

export class AnimatedStar {
    private wrapperGroup: SVGGElement | null = null;
    private debugGroup: SVGGElement | null = null;
    private innerCircle: SVGCircleElement | null = null;
    private armElements: SVGPolygonElement[] = [];
    private transitionElement: SVGPolygonElement | null = null;
    private secondTransitionElement: SVGPolygonElement | null = null;
    private centerX: number;
    private centerY: number;

    private armCount: number = 5;
    private rotation: number = 0;
    private rotationState: RotationState = 'stationary';
    private stateTimer: number = 0;
    private nextStateChange: number;

    private pulseTarget: PulseTarget = 'none';
    private pulseDirection: PulseDirection = 'expand';
    private pulsePhase: 'attack' | 'decay' | 'idle' = 'idle';
    private pulseProgress: number = 0;
    private pulseTimer: number = 0;
    private nextPulse: number;

    private innerRadiusOffset: number = 0;
    private outerRadiusOffset: number = 0;

    private armChangeTimer: number = 0;
    private nextArmChange: number;
    private armTransition: ArmTransition | null = null;
    private secondArmTransition: ArmTransition | null = null;
    private expansionFactor: number = 0;
    private opCounter: number = 0;
    private nextArmToTest: number = 0;
    private nextTransitionType: 'adding' | 'removing' = 'removing';

    constructor(centerX: number, centerY: number) {
        this.centerX = centerX;
        this.centerY = centerY;
        this.nextStateChange = this.randomInterval(STATE_CHANGE_MIN, STATE_CHANGE_MAX);
        this.nextPulse = this.randomInterval(PULSE_MIN_INTERVAL, PULSE_MAX_INTERVAL);
        this.nextArmChange = this.randomInterval(ARM_CHANGE_MIN_INTERVAL, ARM_CHANGE_MAX_INTERVAL);
    }

    private randomInterval(min: number, max: number): number {
        return min + Math.random() * (max - min);
    }

    createElement(): SVGGElement {
        this.wrapperGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.wrapperGroup.style.pointerEvents = 'none';

        // Create inner circle
        this.innerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        this.innerCircle.setAttribute('fill', '#FFD700');
        this.innerCircle.setAttribute('stroke', 'none');
        this.innerCircle.setAttribute('cx', String(this.centerX));
        this.innerCircle.setAttribute('cy', String(this.centerY));
        const innerRadiusFactor = this.armCount === 3 ? THREE_ARM_INNER_RADIUS_FACTOR : 1;
        this.innerCircle.setAttribute('r', String(STAR_INNER_RADIUS * innerRadiusFactor));
        this.innerCircle.setAttribute('opacity', '0.9');
        this.wrapperGroup.appendChild(this.innerCircle);

        // Create individual arm elements
        this.createArmElements();

        // Create debug group - will be re-appended to stay on top whenever transition elements are added
        this.debugGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.wrapperGroup.appendChild(this.debugGroup);

        this.updateArms();
        return this.wrapperGroup;
    }

    private createArmElements(): void {
        if (!this.wrapperGroup) return;

        // Remove old arm elements
        for (const arm of this.armElements) {
            arm.remove();
        }
        this.armElements = [];

        // Create arm elements for current arm count
        for (let i = 0; i < this.armCount; i++) {
            const arm = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            arm.setAttribute('fill', '#FFD700');
            arm.setAttribute('opacity', '0.9');
            this.wrapperGroup.appendChild(arm);
            this.armElements.push(arm);
        }
    }

    getElement(): SVGGElement | null {
        return this.wrapperGroup;
    }

    animate(deltaTime: number): void {
        // Disabled for debugging:
        // this.updateRotationState(deltaTime);
        // this.updateRotation(deltaTime);
        // this.updatePulse(deltaTime);
        this.updateArmTransition(deltaTime);
        this.updateArms();
        this.updateTransitionElements();
    }

    private updateRotationState(deltaTime: number): void {
        this.stateTimer += deltaTime;
        if (this.stateTimer >= this.nextStateChange) {
            this.stateTimer = 0;
            this.nextStateChange = this.randomInterval(STATE_CHANGE_MIN, STATE_CHANGE_MAX);
            this.chooseNewRotationState();
        }
    }

    private chooseNewRotationState(): void {
        const roll = Math.random();
        if (roll < 0.33) {
            this.rotationState = 'stationary';
        } else if (roll < 0.66) {
            this.rotationState = 'rotating_cw';
        } else {
            this.rotationState = 'rotating_ccw';
        }
    }

    private updateRotation(deltaTime: number): void {
        if (this.rotationState === 'rotating_cw') {
            this.rotation += BASE_ROTATION_SPEED * deltaTime;
        } else if (this.rotationState === 'rotating_ccw') {
            this.rotation -= BASE_ROTATION_SPEED * deltaTime;
        }
        this.rotation = this.rotation % (2 * Math.PI);
    }

    private updatePulse(deltaTime: number): void {
        if (this.armTransition) return;

        if (this.pulsePhase === 'idle') {
            this.pulseTimer += deltaTime;
            if (this.pulseTimer >= this.nextPulse) {
                this.pulseTimer = 0;
                this.nextPulse = this.randomInterval(PULSE_MIN_INTERVAL, PULSE_MAX_INTERVAL);
                this.startPulse();
            }
        } else if (this.pulsePhase === 'attack') {
            this.pulseProgress += deltaTime / PULSE_ATTACK_DURATION;
            if (this.pulseProgress >= 1) {
                this.pulseProgress = 1;
                this.pulsePhase = 'decay';
            }
            this.applyPulseOffset(this.easeOut(this.pulseProgress));
        } else if (this.pulsePhase === 'decay') {
            this.pulseProgress -= deltaTime / PULSE_DECAY_DURATION;
            if (this.pulseProgress <= 0) {
                this.pulseProgress = 0;
                this.pulsePhase = 'idle';
                this.pulseTarget = 'none';
                this.innerRadiusOffset = 0;
                this.outerRadiusOffset = 0;
            } else {
                this.applyPulseOffset(this.easeOut(this.pulseProgress));
            }
        }
    }

    private startPulse(): void {
        this.pulsePhase = 'attack';
        this.pulseProgress = 0;
        this.pulseTarget = Math.random() < 0.5 ? 'inner' : 'outer';
        this.pulseDirection = Math.random() < 0.5 ? 'expand' : 'contract';
    }

    private applyPulseOffset(t: number): void {
        const sign = this.pulseDirection === 'expand' ? 1 : -1;
        const offset = t * PULSE_MAGNITUDE * sign;
        if (this.pulseTarget === 'inner') {
            this.innerRadiusOffset = offset;
            this.outerRadiusOffset = 0;
        } else if (this.pulseTarget === 'outer') {
            this.outerRadiusOffset = offset;
            this.innerRadiusOffset = 0;
        }
    }

    private easeOut(t: number): number {
        return 1 - Math.pow(1 - t, 2);
    }

    private easeInOut(t: number): number {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    private updateArmTransition(deltaTime: number): void {
        if (this.armTransition) {
            this.armTransition.progress += deltaTime / ARM_TRANSITION_DURATION;
            this.armTransition.unfoldAngle = this.armTransition.progress * 2 * Math.PI;

            const expansionProgress = this.armTransition.progress < 0.5
                ? this.armTransition.progress * 2
                : 2 - this.armTransition.progress * 2;
            this.expansionFactor = ARM_EXPANSION_FACTOR * expansionProgress;

            if (this.armTransition.progress >= 1) {
                this.completeArmTransition();
            }
        }

        if (this.secondArmTransition) {
            this.secondArmTransition.progress += deltaTime / ARM_TRANSITION_DURATION;
            this.secondArmTransition.unfoldAngle = this.secondArmTransition.progress * 2 * Math.PI;

            if (this.secondArmTransition.progress >= 1) {
                this.completeSecondArmTransition();
            }
        }

        if (!this.armTransition && !this.secondArmTransition) {
            this.armChangeTimer += deltaTime;
            if (this.armChangeTimer >= this.nextArmChange) {
                this.armChangeTimer = 0;
                this.nextArmChange = this.randomInterval(ARM_CHANGE_MIN_INTERVAL, ARM_CHANGE_MAX_INTERVAL);
                this.startArmChange();
            }
        }
    }

    private startArmChange(): void {
        const currentIndex = VALID_ARM_COUNTS.indexOf(this.armCount);
        if (currentIndex === -1) return;

        const canAdd = currentIndex < VALID_ARM_COUNTS.length - 1;
        const canRemove = currentIndex > 0;

        // Systematic selection: alternate between removing and adding, cycle through arms
        let adding: boolean;
        if (this.nextTransitionType === 'removing' && canRemove) {
            adding = false;
        } else if (this.nextTransitionType === 'adding' && canAdd) {
            adding = true;
        } else if (canRemove) {
            adding = false;
        } else {
            adding = true;
        }

        const targetArmCount = adding
            ? VALID_ARM_COUNTS[currentIndex + 1]
            : VALID_ARM_COUNTS[currentIndex - 1];

        const armDiff = Math.abs(targetArmCount - this.armCount);

        // Systematic arm selection: cycle through all arms
        const sourceArmIndex = this.nextArmToTest % this.armCount;
        this.nextArmToTest = (this.nextArmToTest + 1) % 10; // cycle 0-9 to cover all arm counts

        // Toggle transition type for next time
        this.nextTransitionType = adding ? 'removing' : 'adding';

        this.opCounter++;
        this.armTransition = {
            type: adding ? 'adding' : 'removing',
            progress: 0,
            sourceArmIndex,
            unfoldAngle: 0,
            opNum: this.opCounter,
            debugCheckpoints: [],
            debugPhase1Start: false,
            debugPhase1Mid: false,
            debugPhase1End: false,
            debugPhase2Start: false,
            debugPhase2Mid: false,
            debugPhase2End: false
        };

        console.log(`[Op${this.opCounter}] Starting ${this.armTransition.type} on arm ${sourceArmIndex} (${this.armCount} -> ${targetArmCount} arms)`);

        this.createTransitionElement();

        if (armDiff === 2) {
            const secondSourceIndex = (sourceArmIndex + Math.floor(this.armCount / 2)) % this.armCount;
            const secondOpNum = this.opCounter + 1;
            this.opCounter++;

            setTimeout(() => {
                if (this.armTransition) {
                    this.secondArmTransition = {
                        type: adding ? 'adding' : 'removing',
                        progress: 0,
                        sourceArmIndex: secondSourceIndex,
                        unfoldAngle: 0,
                        opNum: secondOpNum,
                        debugCheckpoints: [],
                        debugPhase1Start: false,
                        debugPhase1Mid: false,
                        debugPhase1End: false,
                        debugPhase2Start: false,
                        debugPhase2Mid: false,
                        debugPhase2End: false
                    };
                    console.log(`[Op${secondOpNum}] Starting ${this.secondArmTransition.type} on arm ${secondSourceIndex} (second transition)`);
                    this.createSecondTransitionElement();
                }
            }, ARM_TRANSITION_DURATION * 0.3 * 1000);
        }
    }

    private createTransitionElement(): void {
        if (!this.wrapperGroup || !this.armTransition) return;

        this.transitionElement = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        // Red for removing, green for adding
        const color = this.armTransition.type === 'removing' ? '#FF6B6B' : '#6BCB77';
        this.transitionElement.setAttribute('fill', color);
        this.transitionElement.setAttribute('opacity', '0.9');
        this.wrapperGroup.appendChild(this.transitionElement);

        // Re-append debug group to keep it on top
        if (this.debugGroup) {
            this.wrapperGroup.appendChild(this.debugGroup);
        }
    }

    private createSecondTransitionElement(): void {
        if (!this.wrapperGroup || !this.secondArmTransition) return;

        this.secondTransitionElement = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        this.secondTransitionElement.setAttribute('fill', '#6BCB77');  // Green for debugging
        this.secondTransitionElement.setAttribute('opacity', '0.9');
        this.wrapperGroup.appendChild(this.secondTransitionElement);

        // Re-append debug group to keep it on top
        if (this.debugGroup) {
            this.wrapperGroup.appendChild(this.debugGroup);
        }
    }

    private completeArmTransition(): void {
        if (!this.armTransition) return;

        this.printDebugReport(this.armTransition);

        if (this.armTransition.type === 'adding') {
            this.armCount++;
        } else {
            this.armCount--;
        }

        if (this.transitionElement?.parentNode) {
            this.transitionElement.parentNode.removeChild(this.transitionElement);
        }
        this.transitionElement = null;
        this.armTransition = null;

        // Recreate arm elements for new arm count
        this.createArmElements();

        if (!this.secondArmTransition) {
            this.expansionFactor = 0;
        }
    }

    private completeSecondArmTransition(): void {
        if (!this.secondArmTransition) return;

        this.printDebugReport(this.secondArmTransition);

        if (this.secondArmTransition.type === 'adding') {
            this.armCount++;
        } else {
            this.armCount--;
        }

        if (this.secondTransitionElement?.parentNode) {
            this.secondTransitionElement.parentNode.removeChild(this.secondTransitionElement);
        }
        this.secondTransitionElement = null;
        this.secondArmTransition = null;
        this.expansionFactor = 0;

        // Recreate arm elements for new arm count
        this.createArmElements();
    }

    private printDebugReport(transition: ArmTransition): void {
        const op = `Op${transition.opNum}`;
        const tolerance = 2;
        console.log(`\n[${op}] === ${transition.type.toUpperCase()} arm ${transition.sourceArmIndex} REPORT ===`);

        for (const cp of transition.debugCheckpoints) {
            const close = (p1: {x: number, y: number}, p2: {x: number, y: number}) =>
                dist(p1.x, p1.y, p2.x, p2.y) < tolerance;

            const finT = cp.fin ? { x: cp.fin.tipX, y: cp.fin.tipY } : cp.T;
            const finB1 = cp.fin ? { x: cp.fin.base1X, y: cp.fin.base1Y } : cp.b1;
            const inPhase1 = cp.label.startsWith('P1');

            let checks: string;
            if (transition.type === 'removing') {
                if (inPhase1) {
                    // P1: pivot=S2, T moves St->At
                    // start: T@St, 1@S1, 2@S2 | mid: 2@S2 | end: T@At, 2@S2
                    checks = [
                        `T@St:${close(cp.T, cp.St) ? '✓' : '✗'}`,
                        `1@S1:${close(cp.b1, cp.S1) ? '✓' : '✗'}`,
                        `2@S2:${close(cp.b2, cp.S2) ? '✓' : '✗'}`,
                        `T@At:${close(cp.T, cp.At) ? '✓' : '✗'}`,
                    ].join(' ');
                } else {
                    // P2: pivot=At(moving), base points collapse onto A
                    // start: T@At | mid: T@At | end: T@At, 1@A1, 2@A2
                    checks = [
                        `T@At:${close(cp.T, cp.At) ? '✓' : '✗'}`,
                        `1@A1:${close(cp.b1, cp.A1) ? '✓' : '✗'}`,
                        `2@A2:${close(cp.b2, cp.A2) ? '✓' : '✗'}`,
                    ].join(' ');
                }
            } else {
                if (inPhase1) {
                    // P1: pivot=At(fixed), base2 moves A2->A1
                    // start: T@At, 1@A1, 2@A2 | mid: T@At | end: T@At, 2@A1
                    checks = [
                        `T@At:${close(cp.T, cp.At) ? '✓' : '✗'}`,
                        `1@A1:${close(cp.b1, cp.A1) ? '✓' : '✗'}`,
                        `2@A2:${close(cp.b2, cp.A2) ? '✓' : '✗'}`,
                        `2@A1:${close(cp.b2, cp.A1) ? '✓' : '✗'}`,
                    ].join(' ');
                } else {
                    // P2: pivot=2(at A1, moving), T and 1 move to final
                    // start: 2@A1, T@At | mid: 2@A1 | end: T@fin, 1@fin, 2@A1
                    checks = [
                        `T@At:${close(cp.T, cp.At) ? '✓' : '✗'}`,
                        `2@A1:${close(cp.b2, cp.A1) ? '✓' : '✗'}`,
                        `T@fin:${close(cp.T, finT) ? '✓' : '✗'}`,
                        `1@fin:${close(cp.b1, finB1) ? '✓' : '✗'}`,
                    ].join(' ');
                }
            }
            console.log(`[${op}] ${cp.label.padEnd(10)} p=${cp.progress.toFixed(3)} | ${checks}`);
        }
        console.log(`[${op}] === END REPORT ===\n`);
    }

    private updateArms(): void {
        // Clear debug group at start of frame
        if (this.debugGroup) {
            this.debugGroup.innerHTML = '';
        }

        const innerRadiusFactor = this.armCount === 3 ? THREE_ARM_INNER_RADIUS_FACTOR : 1;
        const baseInnerRadius = STAR_INNER_RADIUS * innerRadiusFactor;
        const innerRadius = baseInnerRadius * (1 + this.innerRadiusOffset + this.expansionFactor);

        // Update inner circle
        if (this.innerCircle) {
            this.innerCircle.setAttribute('cx', String(this.centerX));
            this.innerCircle.setAttribute('cy', String(this.centerY));
            this.innerCircle.setAttribute('r', String(innerRadius));
        }

        // Ensure we have the right number of arm elements
        if (this.armElements.length !== this.armCount) {
            this.createArmElements();
        }

        // Calculate arm positions - during phase 2 of removal, close the gap where arm was removed
        const baseAngleStep = (2 * Math.PI) / this.armCount;

        // Update each arm
        for (let i = 0; i < this.armCount; i++) {
            const arm = this.armElements[i];
            if (!arm) continue;

            // Hide source arm during removal (it's replaced by the transition element)
            if (this.armTransition?.type === 'removing' && i === this.armTransition.sourceArmIndex) {
                arm.setAttribute('opacity', '0');
                continue;
            } else {
                arm.setAttribute('opacity', '0.9');
            }

            let outerOffset = this.outerRadiusOffset;
            if (this.armCount === 6 && this.pulseTarget === 'outer') {
                const altSign = i % 2 === 0 ? 1 : -1;
                outerOffset = this.outerRadiusOffset * altSign;
            }

            const outerRadius = STAR_OUTER_RADIUS * (1 + outerOffset + this.expansionFactor);

            // Calculate tip angle with transition adjustment
            let tipAngle = this.rotation - Math.PI / 2 + i * baseAngleStep;
            let halfStep = baseAngleStep / 2;

            // During phase 2 of removal, arms need to shift to close the gap
            if (this.armTransition?.type === 'removing' && this.armTransition.progress > 0.5) {
                const phase2Progress = (this.armTransition.progress - 0.5) / 0.5;
                const sourceIndex = this.armTransition.sourceArmIndex;
                const targetAngleStep = (2 * Math.PI) / (this.armCount - 1);

                // Arms after the removed arm shift backward to close the gap
                // Arms before stay in place (or shift slightly to expand)
                if (i > sourceIndex) {
                    // This arm needs to shift backward (toward lower index) to close gap
                    const currentAngle = this.rotation - Math.PI / 2 + i * baseAngleStep;
                    const targetAngle = this.rotation - Math.PI / 2 + (i - 1) * targetAngleStep;
                    tipAngle = currentAngle + (targetAngle - currentAngle) * phase2Progress;
                } else if (i < sourceIndex) {
                    // Arms before the gap - expand to new angle step
                    const currentAngle = this.rotation - Math.PI / 2 + i * baseAngleStep;
                    const targetAngle = this.rotation - Math.PI / 2 + i * targetAngleStep;
                    tipAngle = currentAngle + (targetAngle - currentAngle) * phase2Progress;
                }
                // Interpolate half step for arm width
                halfStep = baseAngleStep / 2 + (targetAngleStep / 2 - baseAngleStep / 2) * phase2Progress;
            }

            // During phase 2 of adding, arms need to spread apart to make room
            if (this.armTransition?.type === 'adding' && this.armTransition.progress > 0.5) {
                const phase2Progress = (this.armTransition.progress - 0.5) / 0.5;
                const sourceIndex = this.armTransition.sourceArmIndex;
                const targetAngleStep = (2 * Math.PI) / (this.armCount + 1);

                // Arms at or after sourceIndex shift forward (toward higher index) to make room
                if (i >= sourceIndex) {
                    const currentAngle = this.rotation - Math.PI / 2 + i * baseAngleStep;
                    const targetAngle = this.rotation - Math.PI / 2 + (i + 1) * targetAngleStep;
                    tipAngle = currentAngle + (targetAngle - currentAngle) * phase2Progress;
                } else {
                    // Arms before the new arm - compress to new angle step
                    const currentAngle = this.rotation - Math.PI / 2 + i * baseAngleStep;
                    const targetAngle = this.rotation - Math.PI / 2 + i * targetAngleStep;
                    tipAngle = currentAngle + (targetAngle - currentAngle) * phase2Progress;
                }
                // Interpolate half step for arm width
                halfStep = baseAngleStep / 2 + (targetAngleStep / 2 - baseAngleStep / 2) * phase2Progress;
            }

            // Arm base points on the inner circle (half step before and after tip)
            const base1Angle = tipAngle - halfStep;
            const base2Angle = tipAngle + halfStep;

            // Calculate points
            const tipX = this.centerX + outerRadius * Math.cos(tipAngle);
            const tipY = this.centerY + outerRadius * Math.sin(tipAngle);
            const base1X = this.centerX + innerRadius * Math.cos(base1Angle);
            const base1Y = this.centerY + innerRadius * Math.sin(base1Angle);
            const base2X = this.centerX + innerRadius * Math.cos(base2Angle);
            const base2Y = this.centerY + innerRadius * Math.sin(base2Angle);

            arm.setAttribute('points',
                `${tipX.toFixed(2)},${tipY.toFixed(2)} ${base1X.toFixed(2)},${base1Y.toFixed(2)} ${base2X.toFixed(2)},${base2Y.toFixed(2)}`
            );

            // Add arm index label at the tip
            this.addArmLabel(i, tipX, tipY);
        }
    }

    private addArmLabel(index: number, x: number, y: number): void {
        if (!this.debugGroup) return;

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(x));
        text.setAttribute('y', String(y - 10));
        text.setAttribute('font-size', '14');
        text.setAttribute('fill', '#FFD700');
        text.setAttribute('stroke', '#000');
        text.setAttribute('stroke-width', '0.5');
        text.setAttribute('font-weight', 'bold');
        text.setAttribute('text-anchor', 'middle');
        text.textContent = `Y${index}`;
        this.debugGroup.appendChild(text);
    }

    private updateTransitionElements(): void {
        if (this.transitionElement && this.armTransition) {
            this.updateSingleTransitionElement(
                this.transitionElement,
                this.armTransition
            );
        }

        if (this.secondTransitionElement && this.secondArmTransition) {
            this.updateSingleTransitionElement(
                this.secondTransitionElement,
                this.secondArmTransition
            );
        }
    }

    private updateSingleTransitionElement(
        element: SVGPolygonElement,
        transition: ArmTransition
    ): void {
        const innerRadiusFactor = this.armCount === 3 ? THREE_ARM_INNER_RADIUS_FACTOR : 1;
        const innerRadius = STAR_INNER_RADIUS * innerRadiusFactor * (1 + this.innerRadiusOffset + this.expansionFactor);
        const outerRadius = STAR_OUTER_RADIUS * (1 + this.outerRadiusOffset + this.expansionFactor);
        const phase1End = 0.5;

        const ctx: TransitionContext = {
            type: transition.type,
            progress: transition.progress,
            sourceArmIndex: transition.sourceArmIndex,
            armCount: this.armCount,
            rotation: this.rotation,
            centerX: this.centerX,
            centerY: this.centerY,
            innerRadius,
            outerRadius,
        };

        const pos = computeTransitionPosition(ctx);
        const { tipX, tipY, base1X, base1Y, base2X, base2Y } = pos;

        element.setAttribute('points',
            `${tipX.toFixed(2)},${tipY.toFixed(2)} ${base1X.toFixed(2)},${base1Y.toFixed(2)} ${base2X.toFixed(2)},${base2Y.toFixed(2)}`
        );
        element.removeAttribute('transform');

        const src = computeSourceArmPosition(ctx);
        const adj = computeAdjacentArmPosition(ctx);
        const srcTipX = src.tipX, srcTipY = src.tipY;
        const srcBase1X = src.base1X, srcBase1Y = src.base1Y;
        const srcBase2X = src.base2X, srcBase2Y = src.base2Y;
        const adjTipX = adj.tipX, adjTipY = adj.tipY;
        const adjBase1X = adj.base1X, adjBase1Y = adj.base1Y;
        const adjBase2X = adj.base2X, adjBase2Y = adj.base2Y;

        // Update debug labels
        // For removing: show source arm (S) being removed and adjacent arm (A) it folds onto
        // For adding: source labels show final position, adjacent shows arm we unfold from
        const debugLabels = [
            // Red/Green: Current animated transition element position
            { label: 'T', x: tipX, y: tipY },
            { label: '1', x: base1X, y: base1Y },
            { label: '2', x: base2X, y: base2Y },
            // Green: Adjacent arm (the yellow arm we fold onto / unfold from)
            { label: 'At', x: adjTipX, y: adjTipY },
            { label: 'A1', x: adjBase1X, y: adjBase1Y },
            { label: 'A2', x: adjBase2X, y: adjBase2Y },
        ];
        // Only show source arm labels for removing (source arm is hidden and replaced by transition)
        if (transition.type === 'removing') {
            debugLabels.push(
                { label: 'St', x: srcTipX, y: srcTipY },
                { label: 'S1', x: srcBase1X, y: srcBase1Y },
                { label: 'S2', x: srcBase2X, y: srcBase2Y },
            );
        }
        this.updateDebugLabels(debugLabels);

        // Collect debug checkpoints at phase boundaries
        const p = transition.progress;
        const inPhase1 = p < phase1End;

        let label: string | null = null;
        if (inPhase1) {
            if (!transition.debugPhase1Start) {
                label = 'P1-start';
                transition.debugPhase1Start = true;
            } else if (!transition.debugPhase1Mid && p >= 0.25) {
                label = 'P1-mid';
                transition.debugPhase1Mid = true;
            } else if (!transition.debugPhase1End && p >= 0.49) {
                label = 'P1-end';
                transition.debugPhase1End = true;
            }
        } else {
            if (!transition.debugPhase2Start) {
                label = 'P2-start';
                transition.debugPhase2Start = true;
            } else if (!transition.debugPhase2Mid && p >= 0.75) {
                label = 'P2-mid';
                transition.debugPhase2Mid = true;
            } else if (!transition.debugPhase2End && p >= 0.99) {
                label = 'P2-end';
                transition.debugPhase2End = true;
            }
        }

        if (label) {
            const checkpoint: DebugCheckpoint = {
                label,
                progress: p,
                T: { x: tipX, y: tipY },
                b1: { x: base1X, y: base1Y },
                b2: { x: base2X, y: base2Y },
                St: { x: srcTipX, y: srcTipY },
                S1: { x: srcBase1X, y: srcBase1Y },
                S2: { x: srcBase2X, y: srcBase2Y },
                At: { x: adjTipX, y: adjTipY },
                A1: { x: adjBase1X, y: adjBase1Y },
                A2: { x: adjBase2X, y: adjBase2Y },
            };

            const fin = computeFinalArmPosition(ctx);
            if (fin) {
                checkpoint.fin = {
                    tipX: fin.tipX,
                    tipY: fin.tipY,
                    base1X: fin.base1X,
                    base1Y: fin.base1Y,
                };
            }

            transition.debugCheckpoints.push(checkpoint);
        }
    }

    private updateDebugLabels(points: { label: string, x: number, y: number }[]): void {
        if (!this.debugGroup) return;

        // Create new labels and markers (debug group is cleared at start of updateArms)
        for (const point of points) {
            // Determine color based on label
            let fillColor: string;
            if (point.label.startsWith('A')) {
                fillColor = '#00AA00'; // Green for adjacent arm
            } else if (point.label.includes('S')) {
                fillColor = '#0000FF'; // Blue for source arm start
            } else {
                fillColor = '#FF0000'; // Red for current animated position
            }

            // Add a small circle at each point
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(point.x));
            circle.setAttribute('cy', String(point.y));
            circle.setAttribute('r', '4');
            circle.setAttribute('fill', fillColor);
            circle.setAttribute('stroke', '#000');
            circle.setAttribute('stroke-width', '1');
            this.debugGroup.appendChild(circle);

            // Add text label
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', String(point.x + 6));
            text.setAttribute('y', String(point.y + 4));
            text.setAttribute('font-size', '12');
            text.setAttribute('fill', fillColor);
            text.setAttribute('font-weight', 'bold');
            text.textContent = point.label;
            this.debugGroup.appendChild(text);
        }
    }

    setPosition(centerX: number, centerY: number): void {
        this.centerX = centerX;
        this.centerY = centerY;
    }

    // Console API for testing specific transitions
    testTransition(type: 'adding' | 'removing', armCount: number, sourceArmIndex: number): void {
        // Cancel any existing transition
        if (this.armTransition) {
            if (this.transitionElement?.parentNode) {
                this.transitionElement.parentNode.removeChild(this.transitionElement);
            }
            this.transitionElement = null;
            this.armTransition = null;
        }
        if (this.secondArmTransition) {
            if (this.secondTransitionElement?.parentNode) {
                this.secondTransitionElement.parentNode.removeChild(this.secondTransitionElement);
            }
            this.secondTransitionElement = null;
            this.secondArmTransition = null;
        }
        this.expansionFactor = 0;

        // Set arm count
        this.armCount = armCount;
        this.createArmElements();
        this.updateArms();

        // Validate
        if (type === 'removing' && armCount <= VALID_ARM_COUNTS[0]) {
            console.error(`Cannot remove: already at minimum ${VALID_ARM_COUNTS[0]} arms`);
            return;
        }
        if (type === 'adding' && armCount >= VALID_ARM_COUNTS[VALID_ARM_COUNTS.length - 1]) {
            console.error(`Cannot add: already at maximum ${VALID_ARM_COUNTS[VALID_ARM_COUNTS.length - 1]} arms`);
            return;
        }
        if (sourceArmIndex < 0 || sourceArmIndex >= armCount) {
            console.error(`Invalid sourceArmIndex ${sourceArmIndex} for ${armCount} arms`);
            return;
        }

        // Start transition
        this.opCounter++;
        this.armTransition = {
            type,
            progress: 0,
            sourceArmIndex,
            unfoldAngle: 0,
            opNum: this.opCounter,
            debugCheckpoints: [],
            debugPhase1Start: false,
            debugPhase1Mid: false,
            debugPhase1End: false,
            debugPhase2Start: false,
            debugPhase2Mid: false,
            debugPhase2End: false
        };

        const targetArmCount = type === 'adding' ? armCount + 1 : armCount - 1;
        console.log(`[Op${this.opCounter}] TEST: ${type} arm ${sourceArmIndex} (${armCount} -> ${targetArmCount} arms)`);

        this.createTransitionElement();
    }

    getArmCount(): number {
        return this.armCount;
    }
}
