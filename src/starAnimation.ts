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

    private updateSingleTransitionElement(
        element: SVGPolygonElement,
        transition: ArmTransition
    ): void {
        // Use the same radius calculations as updateArms() for accurate tracking
        const innerRadiusFactor = this.armCount === 3 ? THREE_ARM_INNER_RADIUS_FACTOR : 1;
        const baseInnerRadius = STAR_INNER_RADIUS * innerRadiusFactor;
        const innerRadius = baseInnerRadius * (1 + this.innerRadiusOffset + this.expansionFactor);
        const outerRadius = STAR_OUTER_RADIUS * (1 + this.outerRadiusOffset + this.expansionFactor);

        // Use base angle step (no spacing adjustment) for fixed reference positions
        const baseAngleStep = (2 * Math.PI) / this.armCount;
        const baseHalfStep = baseAngleStep / 2;

        // The arm being animated - fixed starting position (no spacing adjustment)
        const armAngle = this.rotation - Math.PI / 2 + transition.sourceArmIndex * baseAngleStep;

        // Adjacent arm (the one we're folding onto for removing, or unfolding from for adding)
        const adjacentArmAngle = armAngle + baseAngleStep; // next arm

        // The arm's starting geometry (fixed, no spacing adjustment)
        const tipStartX = this.centerX + outerRadius * Math.cos(armAngle);
        const tipStartY = this.centerY + outerRadius * Math.sin(armAngle);
        const base1StartX = this.centerX + innerRadius * Math.cos(armAngle - baseHalfStep);
        const base1StartY = this.centerY + innerRadius * Math.sin(armAngle - baseHalfStep);
        const base2StartX = this.centerX + innerRadius * Math.cos(armAngle + baseHalfStep);
        const base2StartY = this.centerY + innerRadius * Math.sin(armAngle + baseHalfStep);

        // Adjacent arm's tip (fixed position - where our tip will end up after phase 1)
        const adjacentTipX = this.centerX + outerRadius * Math.cos(adjacentArmAngle);
        const adjacentTipY = this.centerY + outerRadius * Math.sin(adjacentArmAngle);

        // Phase 1 ends when tips touch (about halfway through)
        const phase1End = 0.5;

        let tipX: number, tipY: number;
        let base1X: number, base1Y: number;
        let base2X: number, base2Y: number;

        if (transition.type === 'removing') {
            if (transition.progress < 0.002) {
                console.log(`=== REMOVING arm Y${transition.sourceArmIndex} (${this.armCount}->${this.armCount - 1}) ===`);
                console.log(`P1: pivot around S2 until T reaches At(Y${(transition.sourceArmIndex + 1) % this.armCount}) | P2: rotate around At to align`);
            }

            // Phase 1: Pivot around S2 (base2Start) until tip reaches At (adjacentTip)
            // Distances from S2 (pivot point) - stay constant during rotation
            const tipDistFromS2 = Math.sqrt((tipStartX - base2StartX) ** 2 + (tipStartY - base2StartY) ** 2);
            const base1DistFromS2 = Math.sqrt((base1StartX - base2StartX) ** 2 + (base1StartY - base2StartY) ** 2);

            // Angles from S2 to each point
            const tipAngleFromS2Start = Math.atan2(tipStartY - base2StartY, tipStartX - base2StartX);
            const base1AngleFromS2Start = Math.atan2(base1StartY - base2StartY, base1StartX - base2StartX);
            const tipAngleFromS2End = Math.atan2(adjacentTipY - base2StartY, adjacentTipX - base2StartX);

            // Total rotation needed in phase 1: from St to At
            // Ensure we rotate the SHORT way (clockwise direction toward adjacent arm)
            let phase1TotalRotation = tipAngleFromS2End - tipAngleFromS2Start;
            // Normalize to take the shorter path (should be negative for clockwise)
            if (phase1TotalRotation > Math.PI) phase1TotalRotation -= 2 * Math.PI;
            if (phase1TotalRotation < -Math.PI) phase1TotalRotation += 2 * Math.PI;

            if (transition.progress < phase1End) {
                // Phase 1: Pivot around S2
                const phase1Progress = transition.progress / phase1End;
                const currentRotation = phase1TotalRotation * phase1Progress;

                // S2 is the pivot - stays fixed
                base2X = base2StartX;
                base2Y = base2StartY;

                // Rotate tip around S2
                const tipAngle = tipAngleFromS2Start + currentRotation;
                tipX = base2StartX + tipDistFromS2 * Math.cos(tipAngle);
                tipY = base2StartY + tipDistFromS2 * Math.sin(tipAngle);

                // Rotate base1 around S2 by the same amount
                const base1Angle = base1AngleFromS2Start + currentRotation;
                base1X = base2StartX + base1DistFromS2 * Math.cos(base1Angle);
                base1Y = base2StartY + base1DistFromS2 * Math.sin(base1Angle);
            } else {
                // Phase 2: Red arm rotates clockwise around T (which stays at At)
                // At moves as arms redistribute, and red arm rotates around it
                const phase2Progress = (transition.progress - phase1End) / (1 - phase1End);

                // Calculate where adjacent arm tip (At) is NOW as it shifts during phase 2
                const adjIndex = (transition.sourceArmIndex + 1) % this.armCount;
                const targetAngleStep = (2 * Math.PI) / (this.armCount - 1);

                // Adjacent arm tip angle shifts from current to target
                const adjStartAngle = this.rotation - Math.PI / 2 + adjIndex * baseAngleStep;
                const adjEndAngle = this.rotation - Math.PI / 2 + (adjIndex - 1) * targetAngleStep;
                const adjCurrentAngle = adjStartAngle + (adjEndAngle - adjStartAngle) * phase2Progress;

                // Current position of At - this is where T stays
                const atX = this.centerX + outerRadius * Math.cos(adjCurrentAngle);
                const atY = this.centerY + outerRadius * Math.sin(adjCurrentAngle);

                // T stays at At
                tipX = atX;
                tipY = atY;

                // Calculate where red arm's base1 and base2 were at end of phase 1
                const base1AngleAtPhase1End = base1AngleFromS2Start + phase1TotalRotation;
                const base1AtPhase1EndX = base2StartX + base1DistFromS2 * Math.cos(base1AngleAtPhase1End);
                const base1AtPhase1EndY = base2StartY + base1DistFromS2 * Math.sin(base1AngleAtPhase1End);
                const base2AtPhase1EndX = base2StartX; // S2 was the pivot in phase 1
                const base2AtPhase1EndY = base2StartY;

                // At end of phase 1, T was at adjacentTipX/Y (original At position)
                // Distances from T at phase 1 end
                const base1DistFromTStart = Math.sqrt((base1AtPhase1EndX - adjacentTipX) ** 2 + (base1AtPhase1EndY - adjacentTipY) ** 2);
                const base2DistFromTStart = Math.sqrt((base2AtPhase1EndX - adjacentTipX) ** 2 + (base2AtPhase1EndY - adjacentTipY) ** 2);

                // Angles from T (at phase 1 end position) to base points at START of phase 2
                const base1AngleStart = Math.atan2(base1AtPhase1EndY - adjacentTipY, base1AtPhase1EndX - adjacentTipX);
                const base2AngleStart = Math.atan2(base2AtPhase1EndY - adjacentTipY, base2AtPhase1EndX - adjacentTipX);

                // Target: at END of phase 2, red arm should overlap with adjacent arm
                const adjEndHalfStep = targetAngleStep / 2;

                // At end position (where At will be)
                const atEndX = this.centerX + outerRadius * Math.cos(adjEndAngle);
                const atEndY = this.centerY + outerRadius * Math.sin(adjEndAngle);

                // A1 position (Red-2 should end here)
                const adjEndBase1Angle = adjEndAngle - adjEndHalfStep;
                const adjEndBase1X = this.centerX + innerRadius * Math.cos(adjEndBase1Angle);
                const adjEndBase1Y = this.centerY + innerRadius * Math.sin(adjEndBase1Angle);

                // A2 position (Red-1 should end here)
                const adjEndBase2Angle = adjEndAngle + adjEndHalfStep;
                const adjEndBase2X = this.centerX + innerRadius * Math.cos(adjEndBase2Angle);
                const adjEndBase2Y = this.centerY + innerRadius * Math.sin(adjEndBase2Angle);

                // Target distances from tip to base points
                const base1DistFromTEnd = Math.sqrt((adjEndBase1X - atEndX) ** 2 + (adjEndBase1Y - atEndY) ** 2); // Red-1 -> A1
                const base2DistFromTEnd = Math.sqrt((adjEndBase2X - atEndX) ** 2 + (adjEndBase2Y - atEndY) ** 2); // Red-2 -> A2

                // Interpolate distances during phase 2
                const base1DistFromT = base1DistFromTStart + (base1DistFromTEnd - base1DistFromTStart) * phase2Progress;
                const base2DistFromT = base2DistFromTStart + (base2DistFromTEnd - base2DistFromTStart) * phase2Progress;

                // Target angles: Red-1 -> A1, Red-2 -> A2 (consistent with distances)
                const base1AngleEnd = Math.atan2(adjEndBase1Y - atEndY, adjEndBase1X - atEndX);
                const base2AngleEnd = Math.atan2(adjEndBase2Y - atEndY, adjEndBase2X - atEndX);

                // Calculate rotation for base2
                let base2Rotation = base2AngleEnd - base2AngleStart;
                while (base2Rotation > Math.PI) base2Rotation -= 2 * Math.PI;
                while (base2Rotation < -Math.PI) base2Rotation += 2 * Math.PI;
                // Force the LONG way (positive = clockwise on screen)
                base2Rotation = base2Rotation + 2 * Math.PI;

                // Calculate rotation for base1
                let base1Rotation = base1AngleEnd - base1AngleStart;
                while (base1Rotation > Math.PI) base1Rotation -= 2 * Math.PI;
                while (base1Rotation < -Math.PI) base1Rotation += 2 * Math.PI;
                // Force the LONG way
                base1Rotation = base1Rotation + 2 * Math.PI;

                // Apply rotations
                const base1Angle = base1AngleStart + base1Rotation * phase2Progress;
                const base2Angle = base2AngleStart + base2Rotation * phase2Progress;

                // Position base points relative to current T position (which is at moving At)
                base1X = tipX + base1DistFromT * Math.cos(base1Angle);
                base1Y = tipY + base1DistFromT * Math.sin(base1Angle);
                base2X = tipX + base2DistFromT * Math.cos(base2Angle);
                base2Y = tipY + base2DistFromT * Math.sin(base2Angle);

                if (phase2Progress > 0.99) {
                    console.log(`Phase2 end: Red arm: T(${tipX.toFixed(1)},${tipY.toFixed(1)}) 1(${base1X.toFixed(1)},${base1Y.toFixed(1)}) 2(${base2X.toFixed(1)},${base2Y.toFixed(1)})`);
                    console.log(`Phase2 end: Adj arm: At(${atEndX.toFixed(1)},${atEndY.toFixed(1)}) A1(${adjEndBase1X.toFixed(1)},${adjEndBase1Y.toFixed(1)}) A2(${adjEndBase2X.toFixed(1)},${adjEndBase2Y.toFixed(1)})`);
                }
            }
        } else {
            // Adding: reverse of removing
            // Phase 1: T stays at At, Green-2 rotates around T to align with A1
            // Phase 2: Green-2 stays at A1 (moving), T and Green-1 pivot around Green-2 to final positions

            if (transition.progress < 0.002) {
                console.log(`=== ADDING arm at pos ${transition.sourceArmIndex} (${this.armCount}->${this.armCount + 1}) ===`);
                console.log(`P1: rotate around T(=At) until 2 aligns with A1 | P2: pivot around 2(=A1) to final pos`);
            }

            const targetArmCount = this.armCount + 1;
            const targetAngleStep = (2 * Math.PI) / targetArmCount;
            const targetHalfStep = targetAngleStep / 2;

            // Adjacent arm (Y at sourceArmIndex) - this is where green arm starts aligned
            const adjIndex = transition.sourceArmIndex;
            const adjStartAngle = this.rotation - Math.PI / 2 + adjIndex * baseAngleStep;
            const adjStartTipX = this.centerX + outerRadius * Math.cos(adjStartAngle);
            const adjStartTipY = this.centerY + outerRadius * Math.sin(adjStartAngle);
            const adjStartBase1X = this.centerX + innerRadius * Math.cos(adjStartAngle - baseHalfStep);
            const adjStartBase1Y = this.centerY + innerRadius * Math.sin(adjStartAngle - baseHalfStep);
            const adjStartBase2X = this.centerX + innerRadius * Math.cos(adjStartAngle + baseHalfStep);
            const adjStartBase2Y = this.centerY + innerRadius * Math.sin(adjStartAngle + baseHalfStep);

            // Final position of the new arm
            const finalTipAngle = this.rotation - Math.PI / 2 + transition.sourceArmIndex * targetAngleStep;
            const finalTipX = this.centerX + outerRadius * Math.cos(finalTipAngle);
            const finalTipY = this.centerY + outerRadius * Math.sin(finalTipAngle);
            const finalBase1X = this.centerX + innerRadius * Math.cos(finalTipAngle - targetHalfStep);
            const finalBase1Y = this.centerY + innerRadius * Math.sin(finalTipAngle - targetHalfStep);
            const finalBase2X = this.centerX + innerRadius * Math.cos(finalTipAngle + targetHalfStep);
            const finalBase2Y = this.centerY + innerRadius * Math.sin(finalTipAngle + targetHalfStep);

            if (transition.progress < phase1End) {
                // Phase 1: T stays at At (fixed), base points rotate around T
                // Goal: Green-2 ends at A1 position
                const phase1Progress = transition.progress / phase1End;

                // T stays at original adjacent tip throughout phase 1
                tipX = adjStartTipX;
                tipY = adjStartTipY;

                // Start: Green-1 at A1, Green-2 at A2
                const base1AngleStart = Math.atan2(adjStartBase1Y - tipY, adjStartBase1X - tipX);
                const base2AngleStart = Math.atan2(adjStartBase2Y - tipY, adjStartBase2X - tipX);
                const base1DistFromT = Math.sqrt((adjStartBase1X - tipX) ** 2 + (adjStartBase1Y - tipY) ** 2);
                const base2DistFromT = Math.sqrt((adjStartBase2X - tipX) ** 2 + (adjStartBase2Y - tipY) ** 2);

                // End: Green-2 at A1 position (Green-1 position doesn't matter yet)
                const base2AngleEnd = Math.atan2(adjStartBase1Y - tipY, adjStartBase1X - tipX); // Green-2 -> A1

                // Green-2 rotation: from A2 angle to A1 angle (counterclockwise, the long way)
                let base2Rotation = base2AngleEnd - base2AngleStart;
                while (base2Rotation > Math.PI) base2Rotation -= 2 * Math.PI;
                while (base2Rotation < -Math.PI) base2Rotation += 2 * Math.PI;
                base2Rotation = base2Rotation - 2 * Math.PI; // Force long way counterclockwise

                // Green-1 rotates the same amount (rigid body rotation around T)
                const base1Rotation = base2Rotation;

                const base1Angle = base1AngleStart + base1Rotation * phase1Progress;
                const base2Angle = base2AngleStart + base2Rotation * phase1Progress;

                base1X = tipX + base1DistFromT * Math.cos(base1Angle);
                base1Y = tipY + base1DistFromT * Math.sin(base1Angle);
                base2X = tipX + base2DistFromT * Math.cos(base2Angle);
                base2Y = tipY + base2DistFromT * Math.sin(base2Angle);

            } else {
                // Phase 2: Green-2 stays at A1 (which moves as arms spread), T and Green-1 pivot around Green-2
                const phase2Progress = (transition.progress - phase1End) / (1 - phase1End);

                // A1 position moves during phase 2 as adjacent arm shifts
                // Adjacent arm shifts from adjIndex to adjIndex+1 in target spacing
                const adjEndAngle = this.rotation - Math.PI / 2 + (adjIndex + 1) * targetAngleStep;
                const adjCurrentAngle = adjStartAngle + (adjEndAngle - adjStartAngle) * phase2Progress;
                const adjCurrentHalfStep = baseHalfStep + (targetHalfStep - baseHalfStep) * phase2Progress;

                // Current A1 position (Green-2 stays here)
                const a1CurrentAngle = adjCurrentAngle - adjCurrentHalfStep;
                base2X = this.centerX + innerRadius * Math.cos(a1CurrentAngle);
                base2Y = this.centerY + innerRadius * Math.sin(a1CurrentAngle);

                // At end of phase 1, T was at adjStartTip, base points had rotated
                // Distances from Green-2 (pivot point)
                const tipDistFromBase2 = Math.sqrt((adjStartTipX - adjStartBase1X) ** 2 + (adjStartTipY - adjStartBase1Y) ** 2);
                const base1DistFromBase2 = Math.sqrt((adjStartBase1X - adjStartBase1X) ** 2 + (adjStartBase1Y - adjStartBase1Y) ** 2); // 0 at start

                // Actually need to recalculate based on phase 1 end state
                // At phase 1 end: T at adjStartTip, Green-2 at adjStartBase1 (A1)
                const tipDistFromPivot = Math.sqrt((adjStartTipX - adjStartBase1X) ** 2 + (adjStartTipY - adjStartBase1Y) ** 2);

                // At phase 1 end, Green-1 had rotated the same as Green-2
                // Green-2 went from A2 to A1, so Green-1 rotated the same amount
                const base2StartAngle = Math.atan2(adjStartBase2Y - adjStartTipY, adjStartBase2X - adjStartTipX);
                const base2EndAngle = Math.atan2(adjStartBase1Y - adjStartTipY, adjStartBase1X - adjStartTipX);
                let phase1Rotation = base2EndAngle - base2StartAngle;
                while (phase1Rotation > Math.PI) phase1Rotation -= 2 * Math.PI;
                while (phase1Rotation < -Math.PI) phase1Rotation += 2 * Math.PI;
                phase1Rotation = phase1Rotation - 2 * Math.PI;

                const base1StartAngle = Math.atan2(adjStartBase1Y - adjStartTipY, adjStartBase1X - adjStartTipX);
                const base1AtPhase1EndAngle = base1StartAngle + phase1Rotation;
                const base1AtPhase1EndX = adjStartTipX + Math.sqrt((adjStartBase1X - adjStartTipX) ** 2 + (adjStartBase1Y - adjStartTipY) ** 2) * Math.cos(base1AtPhase1EndAngle);
                const base1AtPhase1EndY = adjStartTipY + Math.sqrt((adjStartBase1X - adjStartTipX) ** 2 + (adjStartBase1Y - adjStartTipY) ** 2) * Math.sin(base1AtPhase1EndAngle);

                // Distances from pivot (Green-2 at A1 position at phase 1 end)
                const base1DistFromPivot = Math.sqrt((base1AtPhase1EndX - adjStartBase1X) ** 2 + (base1AtPhase1EndY - adjStartBase1Y) ** 2);

                // Angles from pivot at phase 1 end
                const tipAngleFromPivotStart = Math.atan2(adjStartTipY - adjStartBase1Y, adjStartTipX - adjStartBase1X);
                const base1AngleFromPivotStart = Math.atan2(base1AtPhase1EndY - adjStartBase1Y, base1AtPhase1EndX - adjStartBase1X);

                // Final angles from pivot (Green-2 at finalBase2)
                const tipAngleFromPivotEnd = Math.atan2(finalTipY - finalBase2Y, finalTipX - finalBase2X);
                const base1AngleFromPivotEnd = Math.atan2(finalBase1Y - finalBase2Y, finalBase1X - finalBase2X);

                // Distances at end
                const tipDistFromPivotEnd = Math.sqrt((finalTipX - finalBase2X) ** 2 + (finalTipY - finalBase2Y) ** 2);
                const base1DistFromPivotEnd = Math.sqrt((finalBase1X - finalBase2X) ** 2 + (finalBase1Y - finalBase2Y) ** 2);

                // Interpolate distances
                const tipDist = tipDistFromPivot + (tipDistFromPivotEnd - tipDistFromPivot) * phase2Progress;
                const base1Dist = base1DistFromPivot + (base1DistFromPivotEnd - base1DistFromPivot) * phase2Progress;

                // Calculate rotations
                let tipRotation = tipAngleFromPivotEnd - tipAngleFromPivotStart;
                while (tipRotation > Math.PI) tipRotation -= 2 * Math.PI;
                while (tipRotation < -Math.PI) tipRotation += 2 * Math.PI;

                let base1Rotation2 = base1AngleFromPivotEnd - base1AngleFromPivotStart;
                while (base1Rotation2 > Math.PI) base1Rotation2 -= 2 * Math.PI;
                while (base1Rotation2 < -Math.PI) base1Rotation2 += 2 * Math.PI;

                const tipAngle = tipAngleFromPivotStart + tipRotation * phase2Progress;
                const base1Angle = base1AngleFromPivotStart + base1Rotation2 * phase2Progress;

                tipX = base2X + tipDist * Math.cos(tipAngle);
                tipY = base2Y + tipDist * Math.sin(tipAngle);
                base1X = base2X + base1Dist * Math.cos(base1Angle);
                base1Y = base2Y + base1Dist * Math.sin(base1Angle);
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
