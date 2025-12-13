const STAR_RADIUS_SCALE = 4;
export const STAR_OUTER_RADIUS = 20 * STAR_RADIUS_SCALE;
export const STAR_INNER_RADIUS = 8 * STAR_RADIUS_SCALE;

type RotationState = 'stationary' | 'rotating_cw' | 'rotating_ccw';
type PulseTarget = 'inner' | 'outer' | 'none';
type PulseDirection = 'expand' | 'contract';

const THREE_ARM_INNER_RADIUS_FACTOR = 0.5;

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

interface ArmTransition {
    type: 'adding' | 'removing';
    progress: number;
    sourceArmIndex: number;
    unfoldAngle: number;
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

        let adding: boolean;
        if (canAdd && canRemove) {
            adding = Math.random() < 0.5;
        } else if (canAdd) {
            adding = true;
        } else {
            adding = false;
        }

        const targetArmCount = adding
            ? VALID_ARM_COUNTS[currentIndex + 1]
            : VALID_ARM_COUNTS[currentIndex - 1];

        const armDiff = Math.abs(targetArmCount - this.armCount);
        const sourceArmIndex = Math.floor(Math.random() * this.armCount);

        this.armTransition = {
            type: adding ? 'adding' : 'removing',
            progress: 0,
            sourceArmIndex,
            unfoldAngle: 0
        };

        this.createTransitionElement();

        if (armDiff === 2) {
            const secondSourceIndex = (sourceArmIndex + Math.floor(this.armCount / 2)) % this.armCount;

            setTimeout(() => {
                if (this.armTransition) {
                    this.secondArmTransition = {
                        type: adding ? 'adding' : 'removing',
                        progress: 0,
                        sourceArmIndex: secondSourceIndex,
                        unfoldAngle: 0
                    };
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

    private dist(x1: number, y1: number, x2: number, y2: number): number {
        return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
    }

    private angle(fromX: number, fromY: number, toX: number, toY: number): number {
        return Math.atan2(toY - fromY, toX - fromX);
    }

    private normalizeAngle(angle: number): number {
        while (angle > Math.PI) angle -= 2 * Math.PI;
        while (angle < -Math.PI) angle += 2 * Math.PI;
        return angle;
    }

    private lerp(start: number, end: number, t: number): number {
        return start + (end - start) * t;
    }

    private getArmGeometry(tipAngle: number, halfStep: number, innerR: number, outerR: number) {
        return {
            tipX: this.centerX + outerR * Math.cos(tipAngle),
            tipY: this.centerY + outerR * Math.sin(tipAngle),
            base1X: this.centerX + innerR * Math.cos(tipAngle - halfStep),
            base1Y: this.centerY + innerR * Math.sin(tipAngle - halfStep),
            base2X: this.centerX + innerR * Math.cos(tipAngle + halfStep),
            base2Y: this.centerY + innerR * Math.sin(tipAngle + halfStep),
        };
    }

    private updateSingleTransitionElement(
        element: SVGPolygonElement,
        transition: ArmTransition
    ): void {
        const innerRadiusFactor = this.armCount === 3 ? THREE_ARM_INNER_RADIUS_FACTOR : 1;
        const innerRadius = STAR_INNER_RADIUS * innerRadiusFactor * (1 + this.innerRadiusOffset + this.expansionFactor);
        const outerRadius = STAR_OUTER_RADIUS * (1 + this.outerRadiusOffset + this.expansionFactor);

        const baseAngleStep = (2 * Math.PI) / this.armCount;
        const baseHalfStep = baseAngleStep / 2;
        const phase1End = 0.5;

        let tipX: number, tipY: number;
        let base1X: number, base1Y: number;
        let base2X: number, base2Y: number;

        if (transition.type === 'removing') {
            // Removing: P1 pivot around S2 until T reaches At, P2 rotate around At to align
            const srcAngle = this.rotation - Math.PI / 2 + transition.sourceArmIndex * baseAngleStep;
            const src = this.getArmGeometry(srcAngle, baseHalfStep, innerRadius, outerRadius);
            const adjAngle = srcAngle + baseAngleStep;
            const adj = this.getArmGeometry(adjAngle, baseHalfStep, innerRadius, outerRadius);

            // Phase 1: rigid rotation around S2 (src.base2)
            const tipDistFromS2 = this.dist(src.tipX, src.tipY, src.base2X, src.base2Y);
            const base1DistFromS2 = this.dist(src.base1X, src.base1Y, src.base2X, src.base2Y);
            const tipAngleFromS2Start = this.angle(src.base2X, src.base2Y, src.tipX, src.tipY);
            const base1AngleFromS2Start = this.angle(src.base2X, src.base2Y, src.base1X, src.base1Y);
            const tipAngleFromS2End = this.angle(src.base2X, src.base2Y, adj.tipX, adj.tipY);
            const phase1Rotation = this.normalizeAngle(tipAngleFromS2End - tipAngleFromS2Start);

            if (transition.progress < phase1End) {
                const t = transition.progress / phase1End;
                const rot = phase1Rotation * t;
                base2X = src.base2X;
                base2Y = src.base2Y;
                tipX = src.base2X + tipDistFromS2 * Math.cos(tipAngleFromS2Start + rot);
                tipY = src.base2Y + tipDistFromS2 * Math.sin(tipAngleFromS2Start + rot);
                base1X = src.base2X + base1DistFromS2 * Math.cos(base1AngleFromS2Start + rot);
                base1Y = src.base2Y + base1DistFromS2 * Math.sin(base1AngleFromS2Start + rot);
            } else {
                // Phase 2: T stays at moving At, base points rotate around T
                const t = (transition.progress - phase1End) / (1 - phase1End);
                const adjIndex = (transition.sourceArmIndex + 1) % this.armCount;
                const targetAngleStep = (2 * Math.PI) / (this.armCount - 1);
                const targetHalfStep = targetAngleStep / 2;

                const adjStartAngle = this.rotation - Math.PI / 2 + adjIndex * baseAngleStep;
                const adjEndAngle = this.rotation - Math.PI / 2 + (adjIndex - 1) * targetAngleStep;
                const adjCurrentAngle = this.lerp(adjStartAngle, adjEndAngle, t);

                // T follows moving At
                tipX = this.centerX + outerRadius * Math.cos(adjCurrentAngle);
                tipY = this.centerY + outerRadius * Math.sin(adjCurrentAngle);

                // Phase 1 end positions
                const base1AtP1End = {
                    x: src.base2X + base1DistFromS2 * Math.cos(base1AngleFromS2Start + phase1Rotation),
                    y: src.base2Y + base1DistFromS2 * Math.sin(base1AngleFromS2Start + phase1Rotation)
                };

                // Start: distances/angles from original At
                const base1DistStart = this.dist(base1AtP1End.x, base1AtP1End.y, adj.tipX, adj.tipY);
                const base2DistStart = this.dist(src.base2X, src.base2Y, adj.tipX, adj.tipY);
                const base1AngleStart = this.angle(adj.tipX, adj.tipY, base1AtP1End.x, base1AtP1End.y);
                const base2AngleStart = this.angle(adj.tipX, adj.tipY, src.base2X, src.base2Y);

                // End: adjacent arm final geometry
                const adjEnd = this.getArmGeometry(adjEndAngle, targetHalfStep, innerRadius, outerRadius);
                const base1DistEnd = this.dist(adjEnd.base1X, adjEnd.base1Y, adjEnd.tipX, adjEnd.tipY);
                const base2DistEnd = this.dist(adjEnd.base2X, adjEnd.base2Y, adjEnd.tipX, adjEnd.tipY);
                const base1AngleEnd = this.angle(adjEnd.tipX, adjEnd.tipY, adjEnd.base1X, adjEnd.base1Y);
                const base2AngleEnd = this.angle(adjEnd.tipX, adjEnd.tipY, adjEnd.base2X, adjEnd.base2Y);

                // Force long way rotation (clockwise)
                let base1Rot = this.normalizeAngle(base1AngleEnd - base1AngleStart) + 2 * Math.PI;
                let base2Rot = this.normalizeAngle(base2AngleEnd - base2AngleStart) + 2 * Math.PI;

                base1X = tipX + this.lerp(base1DistStart, base1DistEnd, t) * Math.cos(base1AngleStart + base1Rot * t);
                base1Y = tipY + this.lerp(base1DistStart, base1DistEnd, t) * Math.sin(base1AngleStart + base1Rot * t);
                base2X = tipX + this.lerp(base2DistStart, base2DistEnd, t) * Math.cos(base2AngleStart + base2Rot * t);
                base2Y = tipY + this.lerp(base2DistStart, base2DistEnd, t) * Math.sin(base2AngleStart + base2Rot * t);
            }
        } else {
            // Adding: P1 rotate around T(=At) until 2 aligns with A1, P2 pivot around 2(=A1)
            const targetArmCount = this.armCount + 1;
            const targetAngleStep = (2 * Math.PI) / targetArmCount;
            const targetHalfStep = targetAngleStep / 2;

            const adjIndex = transition.sourceArmIndex;
            const adjStartAngle = this.rotation - Math.PI / 2 + adjIndex * baseAngleStep;
            const adj = this.getArmGeometry(adjStartAngle, baseHalfStep, innerRadius, outerRadius);

            const finalTipAngle = this.rotation - Math.PI / 2 + transition.sourceArmIndex * targetAngleStep;
            const final = this.getArmGeometry(finalTipAngle, targetHalfStep, innerRadius, outerRadius);

            if (transition.progress < phase1End) {
                // Phase 1: T at At, base points rotate around T until base2 reaches A1
                const t = transition.progress / phase1End;
                tipX = adj.tipX;
                tipY = adj.tipY;

                const base1AngleStart = this.angle(tipX, tipY, adj.base1X, adj.base1Y);
                const base2AngleStart = this.angle(tipX, tipY, adj.base2X, adj.base2Y);
                const base2AngleEnd = this.angle(tipX, tipY, adj.base1X, adj.base1Y); // base2 -> A1
                const baseDist = this.dist(adj.base1X, adj.base1Y, tipX, tipY);

                // Force long way counterclockwise
                let rotation = this.normalizeAngle(base2AngleEnd - base2AngleStart) - 2 * Math.PI;

                base1X = tipX + baseDist * Math.cos(base1AngleStart + rotation * t);
                base1Y = tipY + baseDist * Math.sin(base1AngleStart + rotation * t);
                base2X = tipX + baseDist * Math.cos(base2AngleStart + rotation * t);
                base2Y = tipY + baseDist * Math.sin(base2AngleStart + rotation * t);
            } else {
                // Phase 2: base2 stays at moving A1, T and base1 pivot around base2
                const t = (transition.progress - phase1End) / (1 - phase1End);

                // A1 moves as adjacent arm shifts
                const adjEndAngle = this.rotation - Math.PI / 2 + (adjIndex + 1) * targetAngleStep;
                const adjCurrentAngle = this.lerp(adjStartAngle, adjEndAngle, t);
                const adjCurrentHalfStep = this.lerp(baseHalfStep, targetHalfStep, t);
                const a1CurrentAngle = adjCurrentAngle - adjCurrentHalfStep;
                base2X = this.centerX + innerRadius * Math.cos(a1CurrentAngle);
                base2Y = this.centerY + innerRadius * Math.sin(a1CurrentAngle);

                // Phase 1 end state: base2 at A1 (adj.base1), base1 rotated same amount
                const baseDist = this.dist(adj.base1X, adj.base1Y, adj.tipX, adj.tipY);
                const base2AngleStart = this.angle(adj.tipX, adj.tipY, adj.base2X, adj.base2Y);
                const base2AngleEnd = this.angle(adj.tipX, adj.tipY, adj.base1X, adj.base1Y);
                const phase1Rot = this.normalizeAngle(base2AngleEnd - base2AngleStart) - 2 * Math.PI;

                const base1AngleStart = this.angle(adj.tipX, adj.tipY, adj.base1X, adj.base1Y);
                const base1AtP1EndAngle = base1AngleStart + phase1Rot;
                const base1AtP1EndX = adj.tipX + baseDist * Math.cos(base1AtP1EndAngle);
                const base1AtP1EndY = adj.tipY + baseDist * Math.sin(base1AtP1EndAngle);

                // Pivot around base2 (at adj.base1 at phase 1 end)
                const tipDistStart = this.dist(adj.tipX, adj.tipY, adj.base1X, adj.base1Y);
                const base1DistStart = this.dist(base1AtP1EndX, base1AtP1EndY, adj.base1X, adj.base1Y);
                const tipAngleStart = this.angle(adj.base1X, adj.base1Y, adj.tipX, adj.tipY);
                const base1AngleFromPivotStart = this.angle(adj.base1X, adj.base1Y, base1AtP1EndX, base1AtP1EndY);

                const tipDistEnd = this.dist(final.tipX, final.tipY, final.base2X, final.base2Y);
                const base1DistEnd = this.dist(final.base1X, final.base1Y, final.base2X, final.base2Y);
                const tipAngleEnd = this.angle(final.base2X, final.base2Y, final.tipX, final.tipY);
                const base1AngleFromPivotEnd = this.angle(final.base2X, final.base2Y, final.base1X, final.base1Y);

                const tipRot = this.normalizeAngle(tipAngleEnd - tipAngleStart);
                const base1Rot = this.normalizeAngle(base1AngleFromPivotEnd - base1AngleFromPivotStart);

                tipX = base2X + this.lerp(tipDistStart, tipDistEnd, t) * Math.cos(tipAngleStart + tipRot * t);
                tipY = base2Y + this.lerp(tipDistStart, tipDistEnd, t) * Math.sin(tipAngleStart + tipRot * t);
                base1X = base2X + this.lerp(base1DistStart, base1DistEnd, t) * Math.cos(base1AngleFromPivotStart + base1Rot * t);
                base1Y = base2Y + this.lerp(base1DistStart, base1DistEnd, t) * Math.sin(base1AngleFromPivotStart + base1Rot * t);
            }
        }

        // Set the triangle points directly in world coordinates
        element.setAttribute('points',
            `${tipX.toFixed(2)},${tipY.toFixed(2)} ${base1X.toFixed(2)},${base1Y.toFixed(2)} ${base2X.toFixed(2)},${base2Y.toFixed(2)}`
        );
        element.removeAttribute('transform');

        // Calculate actual arm positions using the same logic as updateArms()
        const debugBaseAngleStep = (2 * Math.PI) / this.armCount;
        const sourceIndex = transition.sourceArmIndex;
        // For removing: adjacent is the next arm (sourceIndex + 1)
        // For adding: adjacent is the arm at sourceIndex (we unfold from it)
        const adjIndex = transition.type === 'removing'
            ? (sourceIndex + 1) % this.armCount
            : sourceIndex;

        // Calculate source arm position (fixed at original position since it's hidden)
        const srcTipAngle = this.rotation - Math.PI / 2 + sourceIndex * debugBaseAngleStep;
        const srcHalfStep = debugBaseAngleStep / 2;
        const srcBase1Angle = srcTipAngle - srcHalfStep;
        const srcBase2Angle = srcTipAngle + srcHalfStep;
        const srcTipX = this.centerX + outerRadius * Math.cos(srcTipAngle);
        const srcTipY = this.centerY + outerRadius * Math.sin(srcTipAngle);
        const srcBase1X = this.centerX + innerRadius * Math.cos(srcBase1Angle);
        const srcBase1Y = this.centerY + innerRadius * Math.sin(srcBase1Angle);
        const srcBase2X = this.centerX + innerRadius * Math.cos(srcBase2Angle);
        const srcBase2Y = this.centerY + innerRadius * Math.sin(srcBase2Angle);

        // Calculate adjacent arm position (may shift during phase 2)
        let adjTipAngle = this.rotation - Math.PI / 2 + adjIndex * debugBaseAngleStep;
        let adjHalfStep = debugBaseAngleStep / 2;

        if (transition.type === 'removing' && transition.progress > 0.5) {
            const phase2Progress = (transition.progress - 0.5) / 0.5;
            const targetAngleStep = (2 * Math.PI) / (this.armCount - 1);
            // Adjacent arm shifts backward to close gap
            const currentAngle = this.rotation - Math.PI / 2 + adjIndex * debugBaseAngleStep;
            const targetAngle = this.rotation - Math.PI / 2 + (adjIndex - 1) * targetAngleStep;
            adjTipAngle = currentAngle + (targetAngle - currentAngle) * phase2Progress;
            adjHalfStep = debugBaseAngleStep / 2 + (targetAngleStep / 2 - debugBaseAngleStep / 2) * phase2Progress;
        }

        if (transition.type === 'adding' && transition.progress > 0.5) {
            const phase2Progress = (transition.progress - 0.5) / 0.5;
            const targetAngleStep = (2 * Math.PI) / (this.armCount + 1);
            // Adjacent arm shifts forward to make room
            const currentAngle = this.rotation - Math.PI / 2 + adjIndex * debugBaseAngleStep;
            const targetAngle = this.rotation - Math.PI / 2 + (adjIndex + 1) * targetAngleStep;
            adjTipAngle = currentAngle + (targetAngle - currentAngle) * phase2Progress;
            adjHalfStep = debugBaseAngleStep / 2 + (targetAngleStep / 2 - debugBaseAngleStep / 2) * phase2Progress;
        }

        const adjBase1Angle = adjTipAngle - adjHalfStep;
        const adjBase2Angle = adjTipAngle + adjHalfStep;
        const adjTipX = this.centerX + outerRadius * Math.cos(adjTipAngle);
        const adjTipY = this.centerY + outerRadius * Math.sin(adjTipAngle);
        const adjBase1X = this.centerX + innerRadius * Math.cos(adjBase1Angle);
        const adjBase1Y = this.centerY + innerRadius * Math.sin(adjBase1Angle);
        const adjBase2X = this.centerX + innerRadius * Math.cos(adjBase2Angle);
        const adjBase2Y = this.centerY + innerRadius * Math.sin(adjBase2Angle);

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

        // Debug logging at key frames only
        const isFirstFrame = transition.progress < 0.002;
        const isPhase1End = transition.progress >= 0.498 && transition.progress <= 0.502;
        const isPhase2Start = transition.progress >= 0.502 && transition.progress <= 0.506;
        const isLastFrame = transition.progress > 0.998;
        if (isFirstFrame || isPhase1End || isPhase2Start || isLastFrame) {
            const phase = transition.progress < phase1End ? 1 : 2;
            const label = isFirstFrame ? 'START' : isPhase1End ? 'P1-END' : isPhase2Start ? 'P2-START' : 'END';
            console.log(`[${label}] ${transition.type} arm${transition.sourceArmIndex} p${phase}: T(${tipX.toFixed(0)},${tipY.toFixed(0)}) 1(${base1X.toFixed(0)},${base1Y.toFixed(0)}) 2(${base2X.toFixed(0)},${base2Y.toFixed(0)}) At(${adjTipX.toFixed(0)},${adjTipY.toFixed(0)})`);
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
}
