import {
    STAR_OUTER_RADIUS,
    getRenderSpec,
    computeTransitionProgress,
    type TransitionDirection,
    type PlannedTransitionBundle,
} from './starAnimationCore.js';
import { StarFillField } from './starFillField.js';
import { getCSSColor, type HSLColor } from './colorUtils.js';
import { PulseAnimation } from './pulseAnimation.js';
import { TransitionElements } from './transitionElements.js';
import { CoordinateConverter } from './coordinateConverter.js';
import { LINEAR_INTERPOLATION_SPEED } from './ifsView/types.js';

export { STAR_OUTER_RADIUS };

function scaleFromCenter(p: { x: number; y: number }, centerX: number, centerY: number, scale: number): { x: number; y: number } {
    return {
        x: centerX + (p.x - centerX) * scale,
        y: centerY + (p.y - centerY) * scale,
    };
}

function trianglePath(tip: { x: number; y: number }, b1: { x: number; y: number }, b2: { x: number; y: number }): string {
    return `M ${tip.x.toFixed(2)},${tip.y.toFixed(2)} L ${b1.x.toFixed(2)},${b1.y.toFixed(2)} L ${b2.x.toFixed(2)},${b2.y.toFixed(2)} Z`;
}

type RotationState = 'stationary' | 'rotating_cw' | 'rotating_ccw';

const BASE_ROTATION_SPEED = 0.15;
const STATE_CHANGE_MIN = 2.0;
const STATE_CHANGE_MAX = 6.0;

const ARM_CHANGE_MIN_INTERVAL = 10.0;
const ARM_CHANGE_MAX_INTERVAL = 25.0;
const ARM_TRANSITION_DURATION = 8;

const VALID_ARM_COUNTS = new Set([3, 5, 6, 7]);

interface TransitionScheduling {
    queuedSecondStart: number | null;
    pendingSecondSourceIndex: number | null;
    bundleProgress: number;
}

function createBundle(first: PlannedTransitionBundle['first'], isDouble: boolean, armCount: number): PlannedTransitionBundle & TransitionScheduling {
    let pendingSecondSourceIndex: number | null = null;
    if (isDouble) {
        const intermediateCount = first.type === 'adding' ? armCount + 1 : armCount - 1;
        const offset = Math.floor(intermediateCount / 2);
        pendingSecondSourceIndex = (first.sourceArmIndex + offset) % intermediateCount;
    }
    return {
        first,
        second: null,
        overlapStart: null,
        queuedSecondStart: isDouble ? 0.25 + Math.random() * 0.5 : null,
        pendingSecondSourceIndex,
        bundleProgress: 0,
    };
}

function isBundleComplete(bundle: PlannedTransitionBundle & TransitionScheduling): boolean {
    const isDouble = bundle.queuedSecondStart !== null || bundle.second !== null;
    if (!isDouble) {
        return bundle.bundleProgress >= 1;
    }
    // For double transitions, complete when second transition finishes (p2 = 1)
    const overlapStart = bundle.overlapStart ?? bundle.queuedSecondStart ?? 0;
    const { p2 } = computeTransitionProgress(bundle.bundleProgress, overlapStart);
    return p2 >= 1;
}

export class AnimatedStar {
    private wrapperGroup: SVGGElement | null = null;
    private innerCircle: SVGCircleElement | null = null;
    private armElements: SVGPathElement[] = [];
    private staticStarOutline: SVGPathElement | null = null;
    private transitionOutlines: SVGPathElement[] = [];
    private centerX: number;
    private centerY: number;

    private armCount: number = 5;
    private rotation: number = 0;
    private rotationState: RotationState = 'stationary';
    private stateTimer: number = 0;
    private nextStateChange: number;

    private pulse: PulseAnimation;

    private radiusScale: number = 1.0;
    private targetRadiusScale: number = 1.0;

    private armChangeTimer: number = 0;
    private nextArmChange: number;
    private transitionBundle: (PlannedTransitionBundle & TransitionScheduling) | null = null;

    private fillField: StarFillField | null = null;
    private fillHue: number;
    private fillSaturation: number;
    private fillLightness: number;
    private clipPathGroup: SVGClipPathElement | null = null;
    private foreignObject: SVGForeignObjectElement | null = null;
    private clippedGroup: SVGGElement | null = null;
    private transitionElements: TransitionElements | null = null;
    private coordinateConverter: CoordinateConverter | null = null;
    private onClick: ((x: number, y: number, event: MouseEvent | TouchEvent) => void) | null = null;

    constructor(centerX: number, centerY: number) {
        const baseColor = getCSSColor('--daime-gold', { h: 50, s: 100, l: 50 });
        this.fillHue = baseColor.h;
        this.fillSaturation = 92;
        this.fillLightness = 69;
        this.centerX = centerX;
        this.centerY = centerY;
        this.nextStateChange = this.randomInterval(STATE_CHANGE_MIN, STATE_CHANGE_MAX);
        this.nextArmChange = this.randomInterval(ARM_CHANGE_MIN_INTERVAL, ARM_CHANGE_MAX_INTERVAL);
        this.pulse = new PulseAnimation();
    }

    private randomInterval(min: number, max: number): number {
        return min + Math.random() * (max - min);
    }

    setOnClick(callback: (x: number, y: number, event: MouseEvent | TouchEvent) => void): void {
        this.onClick = callback;
    }

    createElement(): SVGGElement {
        this.wrapperGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.wrapperGroup.style.pointerEvents = 'none';

        this.fillField = new StarFillField(this.fillHue, this.fillSaturation, this.fillLightness);
        const fieldSize = this.fillField.getSize();
        this.coordinateConverter = new CoordinateConverter(fieldSize, this.centerX, this.centerY);

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        clipPath.setAttribute('id', 'starClip');
        clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
        this.innerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        clipPath.appendChild(this.innerCircle);
        this.clipPathGroup = clipPath;
        this.transitionElements = new TransitionElements(clipPath);
        defs.appendChild(clipPath);
        this.wrapperGroup.appendChild(defs);

        this.foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
        this.foreignObject.setAttribute('x', String(this.centerX - fieldSize / 2));
        this.foreignObject.setAttribute('y', String(this.centerY - fieldSize / 2));
        this.foreignObject.setAttribute('width', String(fieldSize));
        this.foreignObject.setAttribute('height', String(fieldSize));
        const canvas = this.fillField.getCanvas();
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        canvas.style.cursor = 'pointer';
        canvas.style.pointerEvents = 'auto';
        canvas.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onClick?.(this.centerX, this.centerY, e);
        });
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.onClick?.(this.centerX, this.centerY, e);
        }, { passive: false });
        this.foreignObject.appendChild(canvas);

        // Layer order from bottom to top:
        // 1. Dynamic arm fills (created by transitionElements, inside clip path - rendered via foreignObject below)
        // 2. Dynamic arm borders (will be inserted here dynamically)
        // 3. Static star fill (clipped group with foreignObject)
        // 4. Static star outline

        this.clippedGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.clippedGroup.setAttribute('clip-path', 'url(#starClip)');
        this.clippedGroup.appendChild(this.foreignObject);
        this.wrapperGroup.appendChild(this.clippedGroup);

        this.staticStarOutline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.staticStarOutline.setAttribute('fill', 'none');
        this.staticStarOutline.setAttribute('stroke', '#f400d7');
        this.staticStarOutline.setAttribute('stroke-width', '1');
        this.staticStarOutline.setAttribute('stroke-dasharray', '2,2');
        this.wrapperGroup.appendChild(this.staticStarOutline);

        this.createArmElements();
        this.updateArms();
        return this.wrapperGroup;
    }

    private createArmElements(): void {
        if (!this.clipPathGroup) return;

        for (const arm of this.armElements) {
            arm.remove();
        }
        this.armElements = [];

        for (let i = 0; i < this.armCount; i++) {
            const arm = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            this.clipPathGroup.appendChild(arm);
            this.armElements.push(arm);
        }
    }

    getElement(): SVGGElement | null {
        return this.wrapperGroup;
    }

    setFillColor(saturation: number, lightness: number): void {
        this.fillSaturation = saturation;
        this.fillLightness = lightness;
        this.fillField = new StarFillField(this.fillHue, this.fillSaturation, this.fillLightness);
        if (this.foreignObject) {
            const canvas = this.fillField.getCanvas();
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.display = 'block';
            this.foreignObject.replaceChildren(canvas);
        }
    }

    getFillColor(): HSLColor {
        return { h: this.fillHue, s: this.fillSaturation, l: this.fillLightness };
    }

    setTargetRadiusScale(scale: number): void {
        this.targetRadiusScale = scale;
    }

    setRadiusScale(scale: number): void {
        this.radiusScale = scale;
        this.targetRadiusScale = scale;
    }

    getRadiusScale(): number {
        return this.radiusScale;
    }

    animate(deltaTime: number): void {
        this.updateRotationState(deltaTime);
        this.updateRotation(deltaTime);
        this.pulse.setArmCount(this.armCount);
        this.pulse.update(deltaTime, this.transitionBundle !== null);
        this.updateArmTransition(deltaTime);
        this.updateRadiusScale(deltaTime);
        this.updateFillField(deltaTime);
        this.updateArms();
    }

    private updateRadiusScale(deltaTime: number): void {
        const diff = this.targetRadiusScale - this.radiusScale;
        if (Math.abs(diff) > 0.001) {
            this.radiusScale += diff * deltaTime * LINEAR_INTERPOLATION_SPEED;
        } else {
            this.radiusScale = this.targetRadiusScale;
        }
    }

    private updateFillField(deltaTime: number): void {
        if (!this.fillField) return;
        this.fillField.update(deltaTime);
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


    private updateArmTransition(deltaTime: number): void {
        const bundle = this.transitionBundle;

        if (bundle) {
            const isDouble = bundle.queuedSecondStart !== null || bundle.second !== null;
            const overlapStart = bundle.overlapStart ?? bundle.queuedSecondStart ?? 0;
            const totalWork = isDouble ? 2 - overlapStart : 1;
            bundle.bundleProgress += deltaTime / (ARM_TRANSITION_DURATION * totalWork);

            // Check if we should start second overlapping transition
            const { p1 } = computeTransitionProgress(bundle.bundleProgress, overlapStart);
            if (!bundle.second && bundle.queuedSecondStart !== null &&
                p1 >= bundle.queuedSecondStart) {
                this.startSecondTransition();
            }

            // Handle completion - only when entire bundle is done
            if (isBundleComplete(bundle)) {
                this.completeBundleTransition();
            }
        }

        // Start new transition when none are active and pulse is idle
        if (!this.transitionBundle && this.pulse.isIdle()) {
            this.armChangeTimer += deltaTime;
            if (this.armChangeTimer >= this.nextArmChange) {
                this.armChangeTimer = 0;
                this.nextArmChange = this.randomInterval(ARM_CHANGE_MIN_INTERVAL, ARM_CHANGE_MAX_INTERVAL);
                this.startArmChange();
            }
        }
    }


    private startSecondTransition(): void {
        const bundle = this.transitionBundle;
        if (!bundle) return;

        const { first } = bundle;
        const intermediateArmCount = first.type === 'adding'
            ? first.startArmCount + 1
            : first.startArmCount - 1;

        const secondSourceIndex = bundle.pendingSecondSourceIndex !== null
            ? bundle.pendingSecondSourceIndex
            : this.selectDisjointSourceArm(first.sourceArmIndex, intermediateArmCount);

        // Compute p1 at this moment to record as overlapStart
        const overlapStart = bundle.queuedSecondStart ?? 0;
        const { p1 } = computeTransitionProgress(bundle.bundleProgress, overlapStart);

        bundle.second = {
            type: first.type,
            direction: first.direction,
            progress: 0,
            sourceArmIndex: secondSourceIndex,
            startArmCount: intermediateArmCount,
        };
        bundle.overlapStart = p1;
        bundle.queuedSecondStart = null;
        bundle.pendingSecondSourceIndex = null;

        this.transitionElements?.createSecond();
    }

    private selectDisjointSourceArm(firstSourceIndex: number, armCount: number): number {
        // Pick arm roughly opposite to first source to avoid visual conflict
        const offset = Math.floor(armCount / 2);
        return (firstSourceIndex + offset) % armCount;
    }

    private startArmChange(): void {
        const x = this.armCount;

        type TransitionOption = { type: 'adding' | 'removing'; double: boolean };
        const options: TransitionOption[] = [];

        if (VALID_ARM_COUNTS.has(x + 1)) {
            options.push({ type: 'adding', double: false });
        }
        if (VALID_ARM_COUNTS.has(x - 1)) {
            options.push({ type: 'removing', double: false });
        }
        if (VALID_ARM_COUNTS.has(x + 2)) {
            options.push({ type: 'adding', double: true });
        }
        if (VALID_ARM_COUNTS.has(x - 2)) {
            options.push({ type: 'removing', double: true });
        }

        if (options.length === 0) return;

        const chosen = options[Math.floor(Math.random() * options.length)];
        const sourceArmIndex = Math.floor(Math.random() * this.armCount);
        const direction: TransitionDirection = Math.random() < 0.5 ? 1 : -1;

        this.transitionBundle = createBundle({
            type: chosen.type,
            direction,
            progress: 0,
            sourceArmIndex,
            startArmCount: this.armCount,
        }, chosen.double, this.armCount);

        const { first } = this.transitionBundle;
        const adding = first.type === 'adding';
        const targetCount = adding ? this.armCount + 1 : this.armCount - 1;

        if (chosen.double) {
            const finalCount = adding ? this.armCount + 2 : this.armCount - 2;
            const secondSrc = this.transitionBundle.pendingSecondSourceIndex!;
            console.log(`Star transition: ${adding ? 'adding' : 'removing'} arm, ${this.armCount}→${finalCount} arms (double), sourceIdx=${sourceArmIndex}, dir=${direction > 0 ? 'CW' : 'CCW'}; replay: star.testOverlappingTransition('${first.type}', ${this.armCount}, ${sourceArmIndex}, ${secondSrc}, ${this.transitionBundle.queuedSecondStart!.toFixed(2)}, ${direction})`);
        } else {
            const replayCmd = `star.testSingleTransition('${first.type}', ${this.armCount}, ${sourceArmIndex}, ${direction})`;
            console.log(`Star transition: ${adding ? 'adding' : 'removing'} arm, ${this.armCount}→${targetCount} arms, sourceIdx=${sourceArmIndex}, dir=${direction > 0 ? 'CW' : 'CCW'}; replay: ${replayCmd}`);
        }

        this.transitionElements?.createFirst();
    }


    private completeBundleTransition(): void {
        const bundle = this.transitionBundle;
        if (!bundle) return;

        // Compute final arm count based on transitions
        let delta = bundle.first.type === 'adding' ? 1 : -1;
        if (bundle.second) {
            delta += bundle.second.type === 'adding' ? 1 : -1;
        }
        this.armCount += delta;

        this.transitionElements?.removeAll();
        this.transitionBundle = null;

        this.createArmElements();
    }

    private toBundleState(): PlannedTransitionBundle | null {
        const bundle = this.transitionBundle;
        if (!bundle) return null;

        const isDouble = bundle.queuedSecondStart !== null || bundle.second !== null;
        const overlapStart = bundle.overlapStart ?? bundle.queuedSecondStart ?? 0;

        // Compute p1/p2 from bundleProgress
        const { p1, p2 } = isDouble
            ? computeTransitionProgress(bundle.bundleProgress, overlapStart)
            : { p1: bundle.bundleProgress, p2: 0 };

        // Update first.progress
        bundle.first.progress = p1;

        // Case 1: Second transition is already active
        if (bundle.second) {
            bundle.second.progress = p2;
            return bundle;
        }

        // Case 2: Second transition is planned but not yet started
        if (bundle.queuedSecondStart !== null && bundle.pendingSecondSourceIndex !== null) {
            const intermediateCount = bundle.first.type === 'adding'
                ? bundle.first.startArmCount + 1
                : bundle.first.startArmCount - 1;

            return {
                first: bundle.first,
                second: {
                    type: bundle.first.type,
                    direction: bundle.first.direction,
                    progress: p2,
                    sourceArmIndex: bundle.pendingSecondSourceIndex,
                    startArmCount: intermediateCount,
                },
                overlapStart: bundle.queuedSecondStart,
            };
        }

        // Case 3: Single transition only
        return bundle;
    }

    private renderPulseArm(
        arm: SVGPathElement,
        armSpec: { tipAngle: number; halfStep: number },
        armIndex: number,
        innerRadius: number,
        baseOuterRadius: number,
        tipAngleOffset: number
    ): void {
        const alternatingOffset = this.pulse.outerAlternatingRadiusOffsets[armIndex] || 0;
        const outerRadius = alternatingOffset !== 0
            ? STAR_OUTER_RADIUS * (1 + alternatingOffset) * this.radiusScale
            : baseOuterRadius;

        const baseCenterAngle = armSpec.tipAngle;
        const tipAngle = baseCenterAngle + tipAngleOffset;
        const base1Angle = baseCenterAngle - armSpec.halfStep;
        const base2Angle = baseCenterAngle + armSpec.halfStep;

        const tip = { x: this.centerX + outerRadius * Math.cos(tipAngle), y: this.centerY + outerRadius * Math.sin(tipAngle) };
        const base1 = { x: this.centerX + innerRadius * Math.cos(base1Angle), y: this.centerY + innerRadius * Math.sin(base1Angle) };
        const base2 = { x: this.centerX + innerRadius * Math.cos(base2Angle), y: this.centerY + innerRadius * Math.sin(base2Angle) };

        if (tipAngleOffset !== 0) {
            const straightTip = {
                x: this.centerX + outerRadius * Math.cos(baseCenterAngle),
                y: this.centerY + outerRadius * Math.sin(baseCenterAngle)
            };
            const ctrl1 = { x: (base1.x + straightTip.x) / 2, y: (base1.y + straightTip.y) / 2 };
            const ctrl2 = { x: (base2.x + straightTip.x) / 2, y: (base2.y + straightTip.y) / 2 };
            arm.setAttribute('d',
                `M ${base1.x.toFixed(2)},${base1.y.toFixed(2)} ` +
                `Q ${ctrl1.x.toFixed(2)},${ctrl1.y.toFixed(2)} ${tip.x.toFixed(2)},${tip.y.toFixed(2)} ` +
                `Q ${ctrl2.x.toFixed(2)},${ctrl2.y.toFixed(2)} ${base2.x.toFixed(2)},${base2.y.toFixed(2)} Z`
            );
        } else {
            arm.setAttribute('d', trianglePath(tip, base1, base2));
        }
    }

    private updateArms(): void {
        const fieldSize = this.fillField?.getSize() ?? 200;

        if (this.armElements.length !== this.armCount) {
            this.createArmElements();
        }

        const spec = getRenderSpec({
            bundle: this.toBundleState(),
            armCount: this.armCount,
            rotation: this.rotation,
            centerX: this.centerX,
            centerY: this.centerY,
            outerRadius: STAR_OUTER_RADIUS,
        });

        const innerRadiusOffset = this.transitionBundle ? 0 : this.pulse.innerRadiusOffset;
        const outerRadiusOffset = this.transitionBundle ? 0 : this.pulse.outerRadiusOffset;
        const tipAngleOffset = this.transitionBundle ? 0 : this.pulse.tipAngleOffset;

        const innerRadius = spec.innerRadius * (1 + innerRadiusOffset) * this.radiusScale;
        const baseOuterRadius = STAR_OUTER_RADIUS * (1 + outerRadiusOffset) * this.radiusScale;

        if (this.innerCircle) {
            this.innerCircle.setAttribute('cx', String(this.centerX));
            this.innerCircle.setAttribute('cy', String(this.centerY));
            this.innerCircle.setAttribute('r', String(innerRadius));
        }

        for (let i = 0; i < this.armCount; i++) {
            const arm = this.armElements[i];
            if (!arm) continue;

            const armSpec = spec.staticArms.get(i);
            if (!armSpec) {
                arm.setAttribute('d', '');
                continue;
            }

            if (this.transitionBundle) {
                const tip = scaleFromCenter(armSpec.tip, this.centerX, this.centerY, this.radiusScale);
                const base1 = scaleFromCenter(armSpec.b1, this.centerX, this.centerY, this.radiusScale);
                const base2 = scaleFromCenter(armSpec.b2, this.centerX, this.centerY, this.radiusScale);
                arm.setAttribute('d', trianglePath(tip, base1, base2));
            } else {
                this.renderPulseArm(arm, armSpec, i, innerRadius, baseOuterRadius, tipAngleOffset);
            }
        }

        this.updateTransitionElements(spec);
        this.updateOutlines(spec, innerRadius, baseOuterRadius, tipAngleOffset);
    }

    private computeOutlineArmPoints(
        armSpec: { tipAngle: number; halfStep: number; tip: { x: number; y: number }; b1: { x: number; y: number }; b2: { x: number; y: number } },
        armIndex: number,
        innerRadius: number,
        baseOuterRadius: number,
        tipAngleOffset: number
    ): { tip: { x: number; y: number }; base1: { x: number; y: number }; base2: { x: number; y: number } } {
        if (this.transitionBundle) {
            return {
                tip: scaleFromCenter(armSpec.tip, this.centerX, this.centerY, this.radiusScale),
                base1: scaleFromCenter(armSpec.b1, this.centerX, this.centerY, this.radiusScale),
                base2: scaleFromCenter(armSpec.b2, this.centerX, this.centerY, this.radiusScale),
            };
        }

        const base1Angle = armSpec.tipAngle - armSpec.halfStep;
        const base2Angle = armSpec.tipAngle + armSpec.halfStep;
        const alternatingOffset = this.pulse.outerAlternatingRadiusOffsets[armIndex] || 0;
        const outerRadius = alternatingOffset !== 0
            ? STAR_OUTER_RADIUS * (1 + alternatingOffset) * this.radiusScale
            : baseOuterRadius;
        const tipAngle = armSpec.tipAngle + tipAngleOffset;

        return {
            tip: { x: this.centerX + outerRadius * Math.cos(tipAngle), y: this.centerY + outerRadius * Math.sin(tipAngle) },
            base1: { x: this.centerX + innerRadius * Math.cos(base1Angle), y: this.centerY + innerRadius * Math.sin(base1Angle) },
            base2: { x: this.centerX + innerRadius * Math.cos(base2Angle), y: this.centerY + innerRadius * Math.sin(base2Angle) },
        };
    }

    private updateOutlines(
        spec: ReturnType<typeof getRenderSpec>,
        innerRadius: number,
        baseOuterRadius: number,
        tipAngleOffset: number
    ): void {
        if (this.staticStarOutline && this.coordinateConverter) {
            const visibleIndices: number[] = [];
            for (let i = 0; i < this.armCount; i++) {
                if (spec.staticArms.has(i)) visibleIndices.push(i);
            }

            if (visibleIndices.length === 0) {
                this.staticStarOutline.setAttribute('d', '');
            } else {
                const pathParts: string[] = [];

                for (let vi = 0; vi < visibleIndices.length; vi++) {
                    const i = visibleIndices[vi];
                    const armSpec = spec.staticArms.get(i)!;
                    const { tip, base1, base2 } = this.computeOutlineArmPoints(armSpec, i, innerRadius, baseOuterRadius, tipAngleOffset);

                    if (vi === 0) {
                        pathParts.push(`M ${base1.x.toFixed(2)},${base1.y.toFixed(2)}`);
                    }

                    if (!this.transitionBundle && tipAngleOffset !== 0) {
                        const alternatingOffset = this.pulse.outerAlternatingRadiusOffsets[i] || 0;
                        const outerRadius = alternatingOffset !== 0
                            ? STAR_OUTER_RADIUS * (1 + alternatingOffset) * this.radiusScale
                            : baseOuterRadius;
                        const straightTip = {
                            x: this.centerX + outerRadius * Math.cos(armSpec.tipAngle),
                            y: this.centerY + outerRadius * Math.sin(armSpec.tipAngle)
                        };
                        const ctrl1 = { x: (base1.x + straightTip.x) / 2, y: (base1.y + straightTip.y) / 2 };
                        const ctrl2 = { x: (base2.x + straightTip.x) / 2, y: (base2.y + straightTip.y) / 2 };
                        pathParts.push(`Q ${ctrl1.x.toFixed(2)},${ctrl1.y.toFixed(2)} ${tip.x.toFixed(2)},${tip.y.toFixed(2)}`);
                        pathParts.push(`Q ${ctrl2.x.toFixed(2)},${ctrl2.y.toFixed(2)} ${base2.x.toFixed(2)},${base2.y.toFixed(2)}`);
                    } else {
                        pathParts.push(`L ${tip.x.toFixed(2)},${tip.y.toFixed(2)}`);
                        pathParts.push(`L ${base2.x.toFixed(2)},${base2.y.toFixed(2)}`);
                    }

                    const nextVi = (vi + 1) % visibleIndices.length;
                    const nextArmSpec = spec.staticArms.get(visibleIndices[nextVi])!;
                    const nextPoints = this.computeOutlineArmPoints(nextArmSpec, visibleIndices[nextVi], innerRadius, baseOuterRadius, tipAngleOffset);
                    pathParts.push(`A ${innerRadius.toFixed(2)},${innerRadius.toFixed(2)} 0 0 1 ${nextPoints.base1.x.toFixed(2)},${nextPoints.base1.y.toFixed(2)}`);
                }
                pathParts.push('Z');

                this.staticStarOutline.setAttribute('d', pathParts.join(' '));
            }
        }

        // Collect which transition arms need outlines
        const armsToRender: Array<{ tip: { x: number; y: number }; b1: { x: number; y: number }; b2: { x: number; y: number } }> = [];
        if (spec.firstTransitionArm) armsToRender.push(spec.firstTransitionArm);
        if (spec.secondTransitionArm) armsToRender.push(spec.secondTransitionArm);

        // Remove excess outlines
        while (this.transitionOutlines.length > armsToRender.length) {
            const outline = this.transitionOutlines.pop();
            outline?.remove();
        }

        // Create missing outlines
        while (this.transitionOutlines.length < armsToRender.length) {
            const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            outline.setAttribute('fill', 'none');
            outline.setAttribute('stroke', '#f400d7');
            outline.setAttribute('stroke-width', '1');
            outline.setAttribute('stroke-dasharray', '2,2');

            if (this.wrapperGroup) {
                const clippedGroup = this.wrapperGroup.children[1];
                this.wrapperGroup.insertBefore(outline, clippedGroup);
            }
            this.transitionOutlines.push(outline);
        }

        for (let i = 0; i < armsToRender.length; i++) {
            const arm = armsToRender[i];
            const outline = this.transitionOutlines[i];
            if (!outline) continue;

            const tip = scaleFromCenter(arm.tip, this.centerX, this.centerY, this.radiusScale);
            const b1 = scaleFromCenter(arm.b1, this.centerX, this.centerY, this.radiusScale);
            const b2 = scaleFromCenter(arm.b2, this.centerX, this.centerY, this.radiusScale);

            outline.setAttribute('d',
                `M ${tip.x.toFixed(2)},${tip.y.toFixed(2)} L ${b1.x.toFixed(2)},${b1.y.toFixed(2)} ` +
                `M ${tip.x.toFixed(2)},${tip.y.toFixed(2)} L ${b2.x.toFixed(2)},${b2.y.toFixed(2)}`
            );
        }
    }

    private updateTransitionElements(spec: ReturnType<typeof getRenderSpec>): void {
        if (!this.transitionBundle) return;

        const scale = (p: { x: number; y: number }) => scaleFromCenter(p, this.centerX, this.centerY, this.radiusScale);

        const updateElement = (element: SVGPolygonElement | null, arm: typeof spec.firstTransitionArm) => {
            if (!element || !arm) return;
            const t = scale(arm.tip);
            const b1 = scale(arm.b1);
            const b2 = scale(arm.b2);
            element.setAttribute('points',
                `${t.x.toFixed(2)},${t.y.toFixed(2)} ${b1.x.toFixed(2)},${b1.y.toFixed(2)} ${b2.x.toFixed(2)},${b2.y.toFixed(2)}`
            );
        };

        updateElement(this.transitionElements?.getFirst() ?? null, spec.firstTransitionArm);
        updateElement(this.transitionElements?.getSecond() ?? null, spec.secondTransitionArm);
    }

    setPosition(centerX: number, centerY: number): void {
        this.centerX = centerX;
        this.centerY = centerY;
        this.coordinateConverter?.updateCenter(centerX, centerY);
        if (this.foreignObject && this.fillField) {
            const fieldSize = this.fillField.getSize();
            this.foreignObject.setAttribute('x', String(centerX - fieldSize / 2));
            this.foreignObject.setAttribute('y', String(centerY - fieldSize / 2));
        }
        this.updateArms();
        this.refreshClipPath();
    }

    private refreshClipPath(): void {
        if (!this.clippedGroup) return;
        // Force browser to re-evaluate clip path by toggling it
        this.clippedGroup.removeAttribute('clip-path');
        // Use requestAnimationFrame to ensure the removal is processed
        requestAnimationFrame(() => {
            this.clippedGroup?.setAttribute('clip-path', 'url(#starClip)');
        });
    }

    private clearTransitionBundle(): void {
        this.transitionElements?.removeAll();
        this.transitionBundle = null;
    }

    testTransition(type: 'adding' | 'removing', armCount: number, sourceArmIndex: number, direction: TransitionDirection = 1): void {
        this.clearTransitionBundle();

        this.armCount = armCount;
        this.createArmElements();
        this.updateArms();

        const targetCount = type === 'adding' ? armCount + 1 : armCount - 1;
        if (!VALID_ARM_COUNTS.has(targetCount)) {
            console.error(`Invalid transition: ${armCount}→${targetCount} arms`);
            return;
        }

        this.transitionBundle = createBundle({
            type,
            direction,
            progress: 0,
            sourceArmIndex,
            startArmCount: armCount,
        }, false, armCount);

        console.log(`Star testTransition: ${type}ing arm, ${armCount}→${type === 'adding' ? armCount + 1 : armCount - 1} arms, sourceIdx=${sourceArmIndex}, dir=${direction > 0 ? 'CW' : 'CCW'}`);

        this.transitionElements?.createFirst();
    }

    testOverlappingTransition(
        type: 'adding' | 'removing',
        startArmCount: number,
        firstSourceIndex: number,
        secondSourceIndex: number,
        overlapProgress: number = 0.5,
        direction: TransitionDirection = 1
    ): void {
        this.clearTransitionBundle();

        this.armCount = startArmCount;
        this.createArmElements();
        this.updateArms();

        const intermediateCount = type === 'adding' ? startArmCount + 1 : startArmCount - 1;
        const finalCount = type === 'adding' ? startArmCount + 2 : startArmCount - 2;

        if (!VALID_ARM_COUNTS.has(finalCount)) {
            console.error(`Invalid transition: ${startArmCount}→${finalCount} arms`);
            return;
        }
        if (firstSourceIndex < 0 || firstSourceIndex >= startArmCount) {
            console.error(`Invalid firstSourceIndex ${firstSourceIndex} for ${startArmCount} arms`);
            return;
        }
        if (secondSourceIndex < 0 || secondSourceIndex >= intermediateCount) {
            console.error(`Invalid secondSourceIndex ${secondSourceIndex} for ${intermediateCount} arms`);
            return;
        }

        this.transitionBundle = {
            first: {
                type,
                direction,
                progress: 0,
                sourceArmIndex: firstSourceIndex,
                startArmCount,
            },
            second: null,
            overlapStart: null,
            queuedSecondStart: overlapProgress,
            pendingSecondSourceIndex: secondSourceIndex,
            bundleProgress: 0,
        };
        this.transitionElements?.createFirst();

        console.log(`Star testOverlappingTransition: ${type}ing arm, ${startArmCount}→${intermediateCount}→${finalCount} arms`);
        console.log(`  First: sourceIdx=${firstSourceIndex}, Second: sourceIdx=${secondSourceIndex} (at ${(overlapProgress * 100).toFixed(0)}% overlap)`);
    }

    testSingleTransition(
        type: 'adding' | 'removing',
        startArmCount: number,
        sourceIndex: number,
        direction: TransitionDirection = 1
    ): void {
        this.clearTransitionBundle();

        const targetCount = type === 'adding' ? startArmCount + 1 : startArmCount - 1;
        if (!VALID_ARM_COUNTS.has(targetCount)) {
            console.error(`Invalid transition: ${startArmCount}→${targetCount} arms`);
            return;
        }

        this.armCount = startArmCount;
        this.createArmElements();

        this.transitionBundle = createBundle({
            type,
            direction,
            progress: 0,
            sourceArmIndex: sourceIndex,
            startArmCount,
        }, false, startArmCount);

        this.transitionElements?.createFirst();

        console.log(`Star testSingleTransition: ${type}ing arm, ${startArmCount}→${targetCount} arms, sourceIdx=${sourceIndex}, dir=${direction > 0 ? 'CW' : 'CCW'}`);
    }

    getArmCount(): number {
        return this.armCount;
    }

    setPointerEventsEnabled(enabled: boolean): void {
        const canvas = this.fillField?.getCanvas();
        if (canvas) {
            canvas.style.pointerEvents = enabled ? 'auto' : 'none';
        }
    }

    testPulse(target?: 'inner' | 'outer' | 'tipAngle' | 'outerAlternating', direction?: 'expand' | 'contract', armCount?: number): void {
        if (armCount !== undefined && VALID_ARM_COUNTS.has(armCount)) {
            this.armCount = armCount;
            this.pulse.setArmCount(armCount);
            this.createArmElements();
        }
        this.pulse.triggerPulse(target, direction);
        const targetStr = target || 'random';
        const dirStr = direction || 'random';
        console.log(`Star testPulse: target=${targetStr}, direction=${dirStr}, armCount=${this.armCount}`);
    }
}
