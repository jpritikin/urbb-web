import {
    STAR_OUTER_RADIUS,
    getInnerRadiusForArmCount,
    getRenderSpec,
    type TransitionDirection,
    type PlannedTransitionBundle,
} from './starAnimationCore.js';
import { StarFillField } from './starFillField.js';

export { STAR_OUTER_RADIUS };

type RotationState = 'stationary' | 'rotating_cw' | 'rotating_ccw';
type PulseTarget = 'inner' | 'outer' | 'tipAngle' | 'none';
type PulseDirection = 'expand' | 'contract';

const BASE_ROTATION_SPEED = 0.15;
const STATE_CHANGE_MIN = 2.0;
const STATE_CHANGE_MAX = 6.0;
const PULSE_MIN_INTERVAL = 3.0;
const PULSE_MAX_INTERVAL = 8.0;
const PULSE_MAGNITUDE = 0.35;
const PULSE_TIP_ANGLE_MAGNITUDE = 0.9;
const PULSE_ATTACK_DURATION = 0.15;
const PULSE_DECAY_DURATION = 0.6;

const ARM_CHANGE_MIN_INTERVAL = 1.0;
const ARM_CHANGE_MAX_INTERVAL = 5.0;
const ARM_TRANSITION_DURATION = 8;

const VALID_ARM_COUNTS = new Set([3, 5, 6, 7]);

function hexToHSL(hex: string): { h: number; s: number; l: number } {
    hex = hex.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    if (max === min) return { h: 0, s: 0, l: l * 100 };

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    let h = 0;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;

    return { h: h * 360, s: s * 100, l: l * 100 };
}

function getFillColor(): { h: number; s: number; l: number } {
    const gold = getComputedStyle(document.documentElement).getPropertyValue('--daime-gold').trim();
    if (gold && gold.startsWith('#')) return hexToHSL(gold);
    return { h: 50, s: 100, l: 50 };
}

interface SingleTransition {
    type: 'adding' | 'removing';
    direction: TransitionDirection;
    progress: number;
    sourceArmIndex: number;
    startArmCount: number;
}

interface TransitionBundle {
    first: SingleTransition;
    second: SingleTransition | null;
    overlapStart: number | null;  // first.progress when second started
    queuedSecondStart: number | null;  // first.progress when second should start (0.25-0.75)
    pendingSecondSourceIndex: number | null;  // for test method: override second source
    firstCompleted: boolean;  // true once first's arm count change has been applied
}

function createBundle(first: SingleTransition, isDouble: boolean, armCount: number): TransitionBundle {
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
        firstCompleted: false,
    };
}


function isBundleComplete(bundle: TransitionBundle): 'none' | 'first' | 'both' {
    const firstDone = bundle.first.progress >= 1;
    const secondDone = !bundle.second || bundle.second.progress >= 1;

    if (firstDone && secondDone) {
        return 'both';
    }
    if (firstDone && !bundle.firstCompleted) {
        return 'first';
    }
    return 'none';
}

export class AnimatedStar {
    private wrapperGroup: SVGGElement | null = null;
    private innerCircle: SVGCircleElement | null = null;
    private armElements: SVGPathElement[] = [];
    private transitionElement: SVGPolygonElement | null = null;
    private secondTransitionElement: SVGPolygonElement | null = null;
    private outlinePath: SVGPathElement | null = null;
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
    private tipAngleOffset: number = 0;

    private radiusScale: number = 1.0;
    private targetRadiusScale: number = 1.0;

    private armChangeTimer: number = 0;
    private nextArmChange: number;
    private transitionBundle: TransitionBundle | null = null;

    private fillField: StarFillField | null = null;
    private fillHue: number;
    private fillSaturation: number;
    private fillLightness: number;
    private clipPathGroup: SVGClipPathElement | null = null;
    private foreignObject: SVGForeignObjectElement | null = null;

    constructor(centerX: number, centerY: number) {
        const baseColor = getFillColor();
        this.fillHue = baseColor.h;
        this.fillSaturation = 92;
        this.fillLightness = 69;
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

        this.fillField = new StarFillField(this.fillHue, this.fillSaturation, this.fillLightness);
        const fieldSize = this.fillField.getSize();

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        clipPath.setAttribute('id', 'starClip');
        clipPath.setAttribute('clipPathUnits', 'objectBoundingBox');
        this.innerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        clipPath.appendChild(this.innerCircle);
        this.clipPathGroup = clipPath;
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
        this.foreignObject.appendChild(canvas);

        const clippedGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        clippedGroup.setAttribute('clip-path', 'url(#starClip)');
        clippedGroup.appendChild(this.foreignObject);
        this.wrapperGroup.appendChild(clippedGroup);

        this.outlinePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.outlinePath.setAttribute('fill', 'none');
        this.outlinePath.setAttribute('stroke', '#f400d7');
        this.outlinePath.setAttribute('stroke-width', '1');
        this.outlinePath.setAttribute('stroke-dasharray', '2,2');
        this.wrapperGroup.appendChild(this.outlinePath);

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

    getFillColor(): { h: number; s: number; l: number } {
        return { h: this.fillHue, s: this.fillSaturation, l: this.fillLightness };
    }

    setTargetRadiusScale(scale: number): void {
        this.targetRadiusScale = scale;
    }

    getRadiusScale(): number {
        return this.radiusScale;
    }

    animate(deltaTime: number): void {
        this.updateRotationState(deltaTime);
        this.updateRotation(deltaTime);
        this.updatePulse(deltaTime);
        this.updateArmTransition(deltaTime);
        this.updateRadiusScale(deltaTime);
        this.updateFillField(deltaTime);
        this.updateArms();
    }

    private updateRadiusScale(deltaTime: number): void {
        const diff = this.targetRadiusScale - this.radiusScale;
        if (Math.abs(diff) > 0.001) {
            this.radiusScale += diff * deltaTime * 3.0;
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

    private updatePulse(deltaTime: number): void {
        if (this.transitionBundle) return;

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
                this.tipAngleOffset = 0;
            } else {
                this.applyPulseOffset(this.easeOut(this.pulseProgress));
            }
        }
    }

    private startPulse(): void {
        this.pulsePhase = 'attack';
        this.pulseProgress = 0;
        if (this.armCount === 3 && Math.random() < 0.33) {
            this.pulseTarget = 'tipAngle';
        } else {
            this.pulseTarget = Math.random() < 0.5 ? 'inner' : 'outer';
        }
        this.pulseDirection = Math.random() < 0.5 ? 'expand' : 'contract';
    }

    private applyPulseOffset(t: number): void {
        const sign = this.pulseDirection === 'expand' ? 1 : -1;
        if (this.pulseTarget === 'tipAngle') {
            this.tipAngleOffset = t * PULSE_TIP_ANGLE_MAGNITUDE * sign;
            this.innerRadiusOffset = 0;
            this.outerRadiusOffset = 0;
        } else {
            const offset = t * PULSE_MAGNITUDE * sign;
            this.tipAngleOffset = 0;
            if (this.pulseTarget === 'inner') {
                this.innerRadiusOffset = offset;
                this.outerRadiusOffset = 0;
            } else if (this.pulseTarget === 'outer') {
                this.outerRadiusOffset = offset;
                this.innerRadiusOffset = 0;
            }
        }
    }

    private easeOut(t: number): number {
        return 1 - Math.pow(1 - t, 2);
    }

    private updateArmTransition(deltaTime: number): void {
        const bundle = this.transitionBundle;

        if (bundle) {
            bundle.first.progress += deltaTime / ARM_TRANSITION_DURATION;

            // Check if we should start second overlapping transition
            if (!bundle.second && bundle.queuedSecondStart !== null &&
                bundle.first.progress >= bundle.queuedSecondStart) {
                this.startSecondTransition();
            }

            // Advance second transition if active
            if (bundle.second) {
                bundle.second.progress += deltaTime / ARM_TRANSITION_DURATION;
            }

            // Handle completions
            const completion = isBundleComplete(bundle);
            if (completion === 'first' && bundle.second) {
                this.completeFirstTransition();
            } else if (completion === 'both' || (completion === 'first' && !bundle.second)) {
                this.completeBundleTransition();
            }
        }

        // Start new transition when none are active and pulse is idle
        if (!this.transitionBundle && this.pulsePhase === 'idle') {
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

        bundle.second = {
            type: first.type,
            direction: first.direction,
            progress: 0,
            sourceArmIndex: secondSourceIndex,
            startArmCount: intermediateArmCount,
        };
        bundle.overlapStart = first.progress;
        bundle.queuedSecondStart = null;
        bundle.pendingSecondSourceIndex = null;

        this.createSecondTransitionElement();
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

        this.createTransitionElement();
    }

    private createTransitionElement(): void {
        if (!this.clipPathGroup || !this.transitionBundle) return;

        this.transitionElement = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        this.clipPathGroup.appendChild(this.transitionElement);
    }

    private createSecondTransitionElement(): void {
        if (!this.clipPathGroup || !this.transitionBundle?.second) return;

        this.secondTransitionElement = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        this.clipPathGroup.appendChild(this.secondTransitionElement);
    }

    private completeFirstTransition(): void {
        const bundle = this.transitionBundle;
        if (!bundle || bundle.firstCompleted) return;

        if (bundle.first.type === 'adding') {
            this.armCount++;
        } else {
            this.armCount--;
        }

        this.transitionElement?.remove();
        this.transitionElement = null;
        bundle.firstCompleted = true;

        this.createArmElements();
    }

    private completeBundleTransition(): void {
        const bundle = this.transitionBundle;
        if (!bundle) return;

        // Complete first if not already done
        if (!bundle.firstCompleted) {
            if (bundle.first.type === 'adding') {
                this.armCount++;
            } else {
                this.armCount--;
            }
        }

        // Complete second if present
        if (bundle.second) {
            if (bundle.second.type === 'adding') {
                this.armCount++;
            } else {
                this.armCount--;
            }
            this.secondTransitionElement?.remove();
            this.secondTransitionElement = null;
        }

        this.transitionElement?.remove();
        this.transitionElement = null;
        this.transitionBundle = null;

        this.createArmElements();
    }

    private getFieldSize(): number {
        return this.fillField?.getSize() ?? 200;
    }

    private toNormalized(absX: number, absY: number): { x: number; y: number } {
        const fieldSize = this.getFieldSize();
        const originX = this.centerX - fieldSize / 2;
        const originY = this.centerY - fieldSize / 2;
        return {
            x: (absX - originX) / fieldSize,
            y: (absY - originY) / fieldSize,
        };
    }

    private toBundleState(): PlannedTransitionBundle | null {
        const bundle = this.transitionBundle;
        if (!bundle) return null;

        // Case 1: Second transition is already active
        if (bundle.second) {
            return {
                first: bundle.first,
                second: bundle.second,
                overlapStart: bundle.overlapStart,
                firstCompleted: bundle.firstCompleted,
            };
        }

        // Case 2: Second transition is planned but not yet started
        if (bundle.queuedSecondStart !== null && bundle.pendingSecondSourceIndex !== null) {
            const intermediateCount = bundle.first.type === 'adding'
                ? bundle.first.startArmCount + 1
                : bundle.first.startArmCount - 1;

            const second = {
                type: bundle.first.type,
                direction: bundle.first.direction,
                progress: 0,
                sourceArmIndex: bundle.pendingSecondSourceIndex,
                startArmCount: intermediateCount,
            };

            return {
                first: bundle.first,
                second,
                overlapStart: bundle.queuedSecondStart,
                firstCompleted: bundle.firstCompleted,
            };
        }

        // Case 3: Single transition only
        return {
            first: bundle.first,
            second: null,
            overlapStart: null,
            firstCompleted: bundle.firstCompleted,
        };
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

        const innerRadius = spec.innerRadius * (1 + this.innerRadiusOffset) * this.radiusScale;
        const baseOuterRadius = STAR_OUTER_RADIUS * (1 + this.outerRadiusOffset) * this.radiusScale;

        if (this.innerCircle && fieldSize > 0) {
            const c = this.toNormalized(this.centerX, this.centerY);
            const r = innerRadius / fieldSize;
            if (isFinite(c.x) && isFinite(c.y) && isFinite(r)) {
                this.innerCircle.setAttribute('cx', String(c.x));
                this.innerCircle.setAttribute('cy', String(c.y));
                this.innerCircle.setAttribute('r', String(r));
            }
        }

        for (let i = 0; i < this.armCount; i++) {
            const arm = this.armElements[i];
            if (!arm) continue;

            const armSpec = spec.staticArms.get(i);
            if (!armSpec) {
                arm.setAttribute('d', '');
                continue;
            }

            let outerRadius = baseOuterRadius;
            if (this.armCount === 6 && this.pulseTarget === 'outer') {
                const altSign = i % 2 === 0 ? 1 : -1;
                outerRadius = STAR_OUTER_RADIUS * (1 + this.outerRadiusOffset * altSign) * this.radiusScale;
            }

            const baseCenterAngle = armSpec.tipAngle;
            let tipAngle = baseCenterAngle;
            if (this.tipAngleOffset !== 0) {
                tipAngle += this.tipAngleOffset;
            }

            const base1Angle = baseCenterAngle - armSpec.halfStep;
            const base2Angle = baseCenterAngle + armSpec.halfStep;

            const tipAbs = { x: this.centerX + outerRadius * Math.cos(tipAngle), y: this.centerY + outerRadius * Math.sin(tipAngle) };
            const base1Abs = { x: this.centerX + innerRadius * Math.cos(base1Angle), y: this.centerY + innerRadius * Math.sin(base1Angle) };
            const base2Abs = { x: this.centerX + innerRadius * Math.cos(base2Angle), y: this.centerY + innerRadius * Math.sin(base2Angle) };

            const tip = this.toNormalized(tipAbs.x, tipAbs.y);
            const base1 = this.toNormalized(base1Abs.x, base1Abs.y);
            const base2 = this.toNormalized(base2Abs.x, base2Abs.y);

            if (this.tipAngleOffset !== 0) {
                const straightTipAbs = {
                    x: this.centerX + outerRadius * Math.cos(baseCenterAngle),
                    y: this.centerY + outerRadius * Math.sin(baseCenterAngle)
                };
                const straightTip = this.toNormalized(straightTipAbs.x, straightTipAbs.y);
                const ctrl1 = { x: (base1.x + straightTip.x) / 2, y: (base1.y + straightTip.y) / 2 };
                const ctrl2 = { x: (base2.x + straightTip.x) / 2, y: (base2.y + straightTip.y) / 2 };
                arm.setAttribute('d',
                    `M ${base1.x.toFixed(4)},${base1.y.toFixed(4)} ` +
                    `Q ${ctrl1.x.toFixed(4)},${ctrl1.y.toFixed(4)} ${tip.x.toFixed(4)},${tip.y.toFixed(4)} ` +
                    `Q ${ctrl2.x.toFixed(4)},${ctrl2.y.toFixed(4)} ${base2.x.toFixed(4)},${base2.y.toFixed(4)} Z`
                );
            } else {
                arm.setAttribute('d',
                    `M ${tip.x.toFixed(4)},${tip.y.toFixed(4)} ` +
                    `L ${base1.x.toFixed(4)},${base1.y.toFixed(4)} ` +
                    `L ${base2.x.toFixed(4)},${base2.y.toFixed(4)} Z`
                );
            }
        }

        this.updateTransitionElements(spec);
    }

    private updateTransitionElements(spec: ReturnType<typeof getRenderSpec>): void {
        if (!this.transitionBundle) return;

        const outerScale = (1 + this.outerRadiusOffset) * this.radiusScale;
        const innerScale = (1 + this.innerRadiusOffset) * this.radiusScale;

        const scaleTip = (p: { x: number; y: number }) => ({
            x: this.centerX + (p.x - this.centerX) * outerScale,
            y: this.centerY + (p.y - this.centerY) * outerScale,
        });
        const scaleBase = (p: { x: number; y: number }) => ({
            x: this.centerX + (p.x - this.centerX) * innerScale,
            y: this.centerY + (p.y - this.centerY) * innerScale,
        });

        if (this.transitionElement && spec.firstTransitionArm) {
            const { tip, b1, b2 } = spec.firstTransitionArm;
            const t = this.toNormalized(scaleTip(tip).x, scaleTip(tip).y);
            const b1n = this.toNormalized(scaleBase(b1).x, scaleBase(b1).y);
            const b2n = this.toNormalized(scaleBase(b2).x, scaleBase(b2).y);
            this.transitionElement.setAttribute('points',
                `${t.x.toFixed(4)},${t.y.toFixed(4)} ${b1n.x.toFixed(4)},${b1n.y.toFixed(4)} ${b2n.x.toFixed(4)},${b2n.y.toFixed(4)}`
            );
        }

        if (this.secondTransitionElement && spec.secondTransitionArm) {
            const { tip, b1, b2 } = spec.secondTransitionArm;
            const t = this.toNormalized(scaleTip(tip).x, scaleTip(tip).y);
            const b1n = this.toNormalized(scaleBase(b1).x, scaleBase(b1).y);
            const b2n = this.toNormalized(scaleBase(b2).x, scaleBase(b2).y);
            this.secondTransitionElement.setAttribute('points',
                `${t.x.toFixed(4)},${t.y.toFixed(4)} ${b1n.x.toFixed(4)},${b1n.y.toFixed(4)} ${b2n.x.toFixed(4)},${b2n.y.toFixed(4)}`
            );
        }
    }

    setPosition(centerX: number, centerY: number): void {
        this.centerX = centerX;
        this.centerY = centerY;
        if (this.foreignObject && this.fillField) {
            const fieldSize = this.fillField.getSize();
            this.foreignObject.setAttribute('x', String(centerX - fieldSize / 2));
            this.foreignObject.setAttribute('y', String(centerY - fieldSize / 2));
        }
    }

    private clearTransitionBundle(): void {
        this.transitionElement?.remove();
        this.transitionElement = null;
        this.secondTransitionElement?.remove();
        this.secondTransitionElement = null;
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

        this.createTransitionElement();
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
            firstCompleted: false,
        };
        this.createTransitionElement();

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

        this.createTransitionElement();

        console.log(`Star testSingleTransition: ${type}ing arm, ${startArmCount}→${targetCount} arms, sourceIdx=${sourceIndex}, dir=${direction > 0 ? 'CW' : 'CCW'}`);
    }

    getArmCount(): number {
        return this.armCount;
    }
}

export function createFillColorDebugPanel(star: AnimatedStar): HTMLElement {
    const panel = document.createElement('div');
    panel.style.cssText = `
        position: fixed; bottom: 10px; right: 10px; width: 150px; height: 150px;
        background: #222; border: 2px solid #666; border-radius: 4px;
        cursor: crosshair; z-index: 9999;
    `;

    const canvas = document.createElement('canvas');
    canvas.width = 150;
    canvas.height = 150;
    panel.appendChild(canvas);

    const ctx = canvas.getContext('2d')!;
    const color = star.getFillColor();

    for (let y = 0; y < 150; y++) {
        for (let x = 0; x < 150; x++) {
            const s = (x / 149) * 100;
            const l = 100 - (y / 149) * 100;
            ctx.fillStyle = `hsl(${color.h}, ${s}%, ${l}%)`;
            ctx.fillRect(x, y, 1, 1);
        }
    }

    const marker = document.createElement('div');
    marker.style.cssText = `
        position: absolute; width: 10px; height: 10px; border: 2px solid white;
        border-radius: 50%; pointer-events: none; transform: translate(-50%, -50%);
        box-shadow: 0 0 2px black;
    `;
    panel.appendChild(marker);

    const updateMarker = () => {
        const c = star.getFillColor();
        marker.style.left = `${(c.s / 100) * 150}px`;
        marker.style.top = `${(1 - c.l / 100) * 150}px`;
    };
    updateMarker();

    const logColor = () => {
        const c = star.getFillColor();
        console.log(`Fill color: S:${c.s.toFixed(0)} L:${c.l.toFixed(0)}`);
    };

    const handleInput = (e: MouseEvent | TouchEvent) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        const x = Math.max(0, Math.min(149, clientX - rect.left));
        const y = Math.max(0, Math.min(149, clientY - rect.top));
        const s = (x / 149) * 100;
        const l = 100 - (y / 149) * 100;
        star.setFillColor(s, l);
        updateMarker();
    };

    let dragging = false;
    panel.addEventListener('mousedown', (e) => { dragging = true; handleInput(e); });
    panel.addEventListener('mousemove', (e) => { if (dragging) handleInput(e); });
    panel.addEventListener('mouseup', () => { if (dragging) logColor(); dragging = false; });
    panel.addEventListener('mouseleave', () => { dragging = false; });
    panel.addEventListener('touchstart', (e) => { e.preventDefault(); handleInput(e); });
    panel.addEventListener('touchmove', (e) => { e.preventDefault(); handleInput(e); });
    panel.addEventListener('touchend', () => { logColor(); });

    return panel;
}
