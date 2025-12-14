import {
    STAR_OUTER_RADIUS,
    STAR_INNER_RADIUS,
    getInnerRadiusForArmCount,
    getTransitionInnerRadius,
    computeTransitionPosition,
    type TransitionContext,
    type TransitionDirection,
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

const VALID_ARM_COUNTS = [3, 4, 5, 6, 7];

const DOT_COUNT = 15;
const DOT_GROUPS = 3;
const DOT_FIELD_SIZE = 200;
const CURL_NOISE_SCALE = 0.02;
const CURL_TIME_SCALE = 1.0;  // how fast forces evolve
const SPEED_NOISE_RATE = 0.25;  // how fast per-dot speed evolves
const DOT_TRAIL_LENGTH = 8;
const TRAIL_UPDATE_PERIOD = 1;
const TRAIL_POINTS_PER_SEGMENT = 4;

interface Dot {
    x: number;
    y: number;
    trail: { x: number; y: number }[];
    updateCount: number;
    noiseOffset: number;
}

interface ArmTransition {
    type: 'adding' | 'removing';
    direction: TransitionDirection;  // +1 for CW, -1 for CCW
    progress: number;
    sourceArmIndex: number;
}

export class AnimatedStar {
    private wrapperGroup: SVGGElement | null = null;
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

    private dotCanvas: HTMLCanvasElement | null = null;
    private dotCtx: CanvasRenderingContext2D | null = null;
    private dotPatternImage: SVGImageElement | null = null;
    private dots: Dot[] = [];
    private noiseTime: number = 0;
    private currentDotGroup: number = 0;

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

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
        filter.setAttribute('id', 'starGlow');
        filter.setAttribute('x', '-50%');
        filter.setAttribute('y', '-50%');
        filter.setAttribute('width', '200%');
        filter.setAttribute('height', '200%');
        const blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
        blur.setAttribute('stdDeviation', '3');
        blur.setAttribute('result', 'blur');
        const merge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
        const mergeBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
        mergeBlur.setAttribute('in', 'blur');
        const mergeOriginal = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
        mergeOriginal.setAttribute('in', 'SourceGraphic');
        merge.appendChild(mergeBlur);
        merge.appendChild(mergeOriginal);
        filter.appendChild(blur);
        filter.appendChild(merge);
        defs.appendChild(filter);

        this.dotCanvas = document.createElement('canvas');
        this.dotCanvas.width = DOT_FIELD_SIZE;
        this.dotCanvas.height = DOT_FIELD_SIZE;
        this.dotCtx = this.dotCanvas.getContext('2d');

        for (let i = 0; i < DOT_COUNT; i++) {
            const x = Math.random() * DOT_FIELD_SIZE;
            const y = Math.random() * DOT_FIELD_SIZE;
            const trail: { x: number; y: number }[] = [];
            for (let t = 0; t < DOT_TRAIL_LENGTH; t++) {
                trail.push({ x, y });
            }
            this.dots.push({ x, y, trail, updateCount: 0, noiseOffset: Math.random() * 1000 });
        }

        const dotPattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
        dotPattern.setAttribute('id', 'starDots');
        dotPattern.setAttribute('patternUnits', 'userSpaceOnUse');
        dotPattern.setAttribute('width', String(DOT_FIELD_SIZE));
        dotPattern.setAttribute('height', String(DOT_FIELD_SIZE));
        const patternImage = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        patternImage.setAttribute('width', String(DOT_FIELD_SIZE));
        patternImage.setAttribute('height', String(DOT_FIELD_SIZE));
        patternImage.setAttribute('href', this.dotCanvas.toDataURL());
        dotPattern.appendChild(patternImage);
        defs.appendChild(dotPattern);
        this.dotPatternImage = patternImage;

        this.wrapperGroup.appendChild(defs);

        this.innerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        this.innerCircle.setAttribute('fill', 'url(#starDots)');
        this.innerCircle.setAttribute('stroke', 'none');
        this.innerCircle.setAttribute('cx', String(this.centerX));
        this.innerCircle.setAttribute('cy', String(this.centerY));
        this.innerCircle.setAttribute('r', String(getInnerRadiusForArmCount(this.armCount)));
        this.innerCircle.setAttribute('opacity', '0.9');
        this.innerCircle.setAttribute('filter', 'url(#starGlow)');
        this.wrapperGroup.appendChild(this.innerCircle);

        this.createArmElements();
        this.updateArms();
        return this.wrapperGroup;
    }

    private createArmElements(): void {
        if (!this.wrapperGroup) return;

        for (const arm of this.armElements) {
            arm.remove();
        }
        this.armElements = [];

        for (let i = 0; i < this.armCount; i++) {
            const arm = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            arm.setAttribute('fill', 'url(#starDots)');
            arm.setAttribute('opacity', '0.9');
            arm.setAttribute('filter', 'url(#starGlow)');
            this.wrapperGroup.appendChild(arm);
            this.armElements.push(arm);
        }
    }

    getElement(): SVGGElement | null {
        return this.wrapperGroup;
    }

    animate(deltaTime: number): void {
        this.updateRotationState(deltaTime);
        this.updateRotation(deltaTime);
        this.updatePulse(deltaTime);
        this.updateArmTransition(deltaTime);
        this.updateDotCurlNoise(deltaTime);
        this.updateArms();
        this.updateTransitionElements();
    }

    private permutation: number[] = [];

    private initPerlin(): void {
        const p = [];
        for (let i = 0; i < 256; i++) p[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [p[i], p[j]] = [p[j], p[i]];
        }
        this.permutation = [...p, ...p];
    }

    private fade(t: number): number {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    private lerp(a: number, b: number, t: number): number {
        return a + t * (b - a);
    }

    private grad(hash: number, x: number, y: number): number {
        const h = hash & 3;
        const u = h < 2 ? x : y;
        const v = h < 2 ? y : x;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    private perlin(x: number, y: number): number {
        if (this.permutation.length === 0) this.initPerlin();
        const p = this.permutation;

        const xi = Math.floor(x) & 255;
        const yi = Math.floor(y) & 255;
        const xf = x - Math.floor(x);
        const yf = y - Math.floor(y);

        const u = this.fade(xf);
        const v = this.fade(yf);

        const aa = p[p[xi] + yi];
        const ab = p[p[xi] + yi + 1];
        const ba = p[p[xi + 1] + yi];
        const bb = p[p[xi + 1] + yi + 1];

        return this.lerp(
            this.lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u),
            this.lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u),
            v
        );
    }

    private noise(x: number, y: number, t: number): number {
        return Math.sin(x * 1.0 + t) * Math.cos(y * 1.3) +
            Math.sin(x * 2.1 - t * 0.7) * Math.cos(y * 1.9 + t * 0.3) * 0.5 +
            Math.sin(x * 4.3 + t * 0.4) * Math.cos(y * 3.7 - t * 0.2) * 0.25;
    }

    private curlNoise(x: number, y: number, t: number): { vx: number; vy: number } {
        const eps = 0.01;
        const dPdy = (this.noise(x, y + eps, t) - this.noise(x, y - eps, t)) / (2 * eps);
        const dPdx = (this.noise(x + eps, y, t) - this.noise(x - eps, y, t)) / (2 * eps);
        return { vx: dPdy, vy: -dPdx };
    }

    private updateDotCurlNoise(deltaTime: number): void {
        if (!this.dotCtx || !this.dotCanvas || !this.dotPatternImage) return;

        this.noiseTime += deltaTime * CURL_TIME_SCALE;

        const dotsPerGroup = Math.ceil(DOT_COUNT / DOT_GROUPS);
        const startIdx = this.currentDotGroup * dotsPerGroup;
        const endIdx = Math.min(startIdx + dotsPerGroup, this.dots.length);
        this.currentDotGroup = (this.currentDotGroup + 1) % DOT_GROUPS;

        for (let i = startIdx; i < endIdx; i++) {
            const dot = this.dots[i];

            dot.updateCount++;
            if (dot.updateCount >= TRAIL_UPDATE_PERIOD) {
                dot.updateCount = 0;
                for (let t = DOT_TRAIL_LENGTH - 1; t > 0; t--) {
                    dot.trail[t].x = dot.trail[t - 1].x;
                    dot.trail[t].y = dot.trail[t - 1].y;
                }
                dot.trail[0].x = dot.x;
                dot.trail[0].y = dot.y;
            }

            const { vx, vy } = this.curlNoise(
                dot.x * CURL_NOISE_SCALE,
                dot.y * CURL_NOISE_SCALE,
                this.noiseTime
            );

            const speedNoise = this.perlin(dot.noiseOffset, this.noiseTime * SPEED_NOISE_RATE);
            const speed = 1 + speedNoise * 5

            dot.x += vx * speed;
            dot.y += vy * speed;

            if (dot.x < 0) dot.x = -dot.x;
            else if (dot.x > DOT_FIELD_SIZE) dot.x = 2 * DOT_FIELD_SIZE - dot.x;
            if (dot.y < 0) dot.y = -dot.y;
            else if (dot.y > DOT_FIELD_SIZE) dot.y = 2 * DOT_FIELD_SIZE - dot.y;
        }

        const ctx = this.dotCtx;
        ctx.fillStyle = '#FFD700';
        ctx.fillRect(0, 0, DOT_FIELD_SIZE, DOT_FIELD_SIZE);

        const maxDistSq = (DOT_FIELD_SIZE / 4) ** 2;

        for (const dot of this.dots) {
            const colorNoise = this.noise(
                dot.x * CURL_NOISE_SCALE * 0.5,
                dot.y * CURL_NOISE_SCALE * 0.5,
                this.noiseTime * 0.5
            );
            const hueNoise = this.noise(
                dot.x * CURL_NOISE_SCALE * 0.3 + 100,
                dot.y * CURL_NOISE_SCALE * 0.3 + 100,
                this.noiseTime * 0.3
            );
            const ct = (colorNoise + 1.75) / 3.5;
            const hueShift = hueNoise * 25;
            const r = Math.round(Math.min(255, Math.max(0, 180 + ct * 75 + hueShift)));
            const g = Math.round(Math.min(255, Math.max(0, 100 + ct * 140 - Math.abs(hueShift) * 0.8)));
            const b = Math.round(Math.min(255, Math.max(0, 20 + ct * 220)));
            const color = `rgb(${r},${g},${b})`;

            const segments = Math.ceil(DOT_TRAIL_LENGTH / TRAIL_POINTS_PER_SEGMENT);

            ctx.lineCap = 'round';
            ctx.lineWidth = 1.5;

            let prevX = dot.x;
            let prevY = dot.y;
            for (let seg = 0; seg < segments; seg++) {
                const endIdx = Math.min((seg + 1) * TRAIL_POINTS_PER_SEGMENT, DOT_TRAIL_LENGTH - 1);
                const endPoint = dot.trail[endIdx];

                const dx = prevX - endPoint.x;
                const dy = prevY - endPoint.y;
                const distSq = dx * dx + dy * dy;

                if (distSq < maxDistSq) {
                    const opacity = 1 - (seg / segments) * 0.75;
                    ctx.globalAlpha = opacity;
                    ctx.strokeStyle = color;
                    ctx.beginPath();
                    ctx.moveTo(prevX, prevY);
                    ctx.lineTo(endPoint.x, endPoint.y);
                    ctx.stroke();
                }

                prevX = endPoint.x;
                prevY = endPoint.y;
            }
            ctx.globalAlpha = 1;

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }

        this.dotPatternImage.setAttribute('href', this.dotCanvas.toDataURL());
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

    private updateArmTransition(deltaTime: number): void {
        if (this.armTransition) {
            this.armTransition.progress += deltaTime / ARM_TRANSITION_DURATION;

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
        } else {
            adding = canAdd;
        }

        const targetArmCount = adding
            ? VALID_ARM_COUNTS[currentIndex + 1]
            : VALID_ARM_COUNTS[currentIndex - 1];

        const armDiff = Math.abs(targetArmCount - this.armCount);
        const sourceArmIndex = Math.floor(Math.random() * this.armCount);
        const direction: TransitionDirection = Math.random() < 0.5 ? 1 : -1;

        this.armTransition = {
            type: adding ? 'adding' : 'removing',
            direction,
            progress: 0,
            sourceArmIndex,
        };

        console.log(`Star transition: ${this.armTransition.type} arm, ${this.armCount}→${adding ? this.armCount + 1 : this.armCount - 1} arms, sourceIdx=${sourceArmIndex}, dir=${direction > 0 ? 'CW' : 'CCW'}; replay: star.testTransition('${this.armTransition.type}', ${this.armCount}, ${sourceArmIndex}, ${direction})`);

        this.createTransitionElement();

        if (armDiff === 2) {
            const secondSourceIndex = (sourceArmIndex + Math.floor(this.armCount / 2)) % this.armCount;

            setTimeout(() => {
                if (this.armTransition) {
                    this.secondArmTransition = {
                        type: adding ? 'adding' : 'removing',
                        direction,
                        progress: 0,
                        sourceArmIndex: secondSourceIndex,
                    };
                    console.log(`Star transition (2nd): ${this.secondArmTransition.type} arm, sourceIdx=${secondSourceIndex}, dir=${direction > 0 ? 'CW' : 'CCW'}`);
                    this.createSecondTransitionElement();
                }
            }, ARM_TRANSITION_DURATION * 0.3 * 1000);
        }
    }

    private createTransitionElement(): void {
        if (!this.wrapperGroup || !this.armTransition) return;

        this.transitionElement = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        this.transitionElement.setAttribute('fill', 'url(#starDots)');
        this.transitionElement.setAttribute('opacity', '0.9');
        this.transitionElement.setAttribute('filter', 'url(#starGlow)');
        this.wrapperGroup.appendChild(this.transitionElement);
    }

    private createSecondTransitionElement(): void {
        if (!this.wrapperGroup || !this.secondArmTransition) return;

        this.secondTransitionElement = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        this.secondTransitionElement.setAttribute('fill', 'url(#starDots)');
        this.secondTransitionElement.setAttribute('opacity', '0.9');
        this.secondTransitionElement.setAttribute('filter', 'url(#starGlow)');
        this.wrapperGroup.appendChild(this.secondTransitionElement);
    }

    private completeArmTransition(): void {
        if (!this.armTransition) return;

        if (this.armTransition.type === 'adding') {
            this.armCount++;
        } else {
            this.armCount--;
        }

        this.transitionElement?.remove();
        this.transitionElement = null;
        this.armTransition = null;

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

        this.secondTransitionElement?.remove();
        this.secondTransitionElement = null;
        this.secondArmTransition = null;
        this.expansionFactor = 0;

        this.createArmElements();
    }

    private updateArms(): void {
        const transition = this.armTransition ?? this.secondArmTransition;
        const baseInnerRadius = getTransitionInnerRadius(
            this.armCount,
            transition?.type ?? null,
            transition?.progress ?? 0
        );
        const innerRadius = baseInnerRadius * (1 + this.innerRadiusOffset + this.expansionFactor);

        if (this.innerCircle) {
            this.innerCircle.setAttribute('cx', String(this.centerX));
            this.innerCircle.setAttribute('cy', String(this.centerY));
            this.innerCircle.setAttribute('r', String(innerRadius));
        }

        if (this.armElements.length !== this.armCount) {
            this.createArmElements();
        }

        const baseAngleStep = (2 * Math.PI) / this.armCount;

        for (let i = 0; i < this.armCount; i++) {
            const arm = this.armElements[i];
            if (!arm) continue;

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

            let tipAngle = this.rotation - Math.PI / 2 + i * baseAngleStep;
            let halfStep = baseAngleStep / 2;

            // Phase 2 of removal: arms shift to close the gap
            if (this.armTransition?.type === 'removing' && this.armTransition.progress > 0.5) {
                const t = (this.armTransition.progress - 0.5) / 0.5;
                const sourceIndex = this.armTransition.sourceArmIndex;
                const targetAngleStep = (2 * Math.PI) / (this.armCount - 1);

                if (i > sourceIndex) {
                    const currentAngle = this.rotation - Math.PI / 2 + i * baseAngleStep;
                    const targetAngle = this.rotation - Math.PI / 2 + (i - 1) * targetAngleStep;
                    tipAngle = currentAngle + (targetAngle - currentAngle) * t;
                } else if (i < sourceIndex) {
                    const currentAngle = this.rotation - Math.PI / 2 + i * baseAngleStep;
                    const targetAngle = this.rotation - Math.PI / 2 + i * targetAngleStep;
                    tipAngle = currentAngle + (targetAngle - currentAngle) * t;
                }
                halfStep = baseAngleStep / 2 + (targetAngleStep / 2 - baseAngleStep / 2) * t;
            }

            // Phase 2 of adding: arms spread to make room
            if (this.armTransition?.type === 'adding' && this.armTransition.progress > 0.5) {
                const t = (this.armTransition.progress - 0.5) / 0.5;
                const sourceIndex = this.armTransition.sourceArmIndex;
                const dir = this.armTransition.direction;
                const targetAngleStep = (2 * Math.PI) / (this.armCount + 1);

                // CW: new arm at sourceIndex+1, so arms > sourceIndex shift by +1
                // CCW: new arm at sourceIndex, so arms >= sourceIndex shift by +1
                const shouldShift = dir === 1 ? (i > sourceIndex) : (i >= sourceIndex);
                if (shouldShift) {
                    const currentAngle = this.rotation - Math.PI / 2 + i * baseAngleStep;
                    const targetAngle = this.rotation - Math.PI / 2 + (i + 1) * targetAngleStep;
                    tipAngle = currentAngle + (targetAngle - currentAngle) * t;
                } else {
                    const currentAngle = this.rotation - Math.PI / 2 + i * baseAngleStep;
                    const targetAngle = this.rotation - Math.PI / 2 + i * targetAngleStep;
                    tipAngle = currentAngle + (targetAngle - currentAngle) * t;
                }
                halfStep = baseAngleStep / 2 + (targetAngleStep / 2 - baseAngleStep / 2) * t;
            }

            const base1Angle = tipAngle - halfStep;
            const base2Angle = tipAngle + halfStep;

            const tipX = this.centerX + outerRadius * Math.cos(tipAngle);
            const tipY = this.centerY + outerRadius * Math.sin(tipAngle);
            const base1X = this.centerX + innerRadius * Math.cos(base1Angle);
            const base1Y = this.centerY + innerRadius * Math.sin(base1Angle);
            const base2X = this.centerX + innerRadius * Math.cos(base2Angle);
            const base2Y = this.centerY + innerRadius * Math.sin(base2Angle);

            arm.setAttribute('points',
                `${tipX.toFixed(2)},${tipY.toFixed(2)} ${base1X.toFixed(2)},${base1Y.toFixed(2)} ${base2X.toFixed(2)},${base2Y.toFixed(2)}`
            );
        }
    }

    private updateTransitionElements(): void {
        if (this.transitionElement && this.armTransition) {
            this.updateSingleTransitionElement(this.transitionElement, this.armTransition);
        }

        if (this.secondTransitionElement && this.secondArmTransition) {
            this.updateSingleTransitionElement(this.secondTransitionElement, this.secondArmTransition);
        }
    }

    private updateSingleTransitionElement(element: SVGPolygonElement, transition: ArmTransition): void {
        const innerRadius = getInnerRadiusForArmCount(this.armCount) * (1 + this.innerRadiusOffset + this.expansionFactor);
        const outerRadius = STAR_OUTER_RADIUS * (1 + this.outerRadiusOffset + this.expansionFactor);

        const ctx: TransitionContext = {
            type: transition.type,
            direction: transition.direction,
            progress: transition.progress,
            sourceArmIndex: transition.sourceArmIndex,
            armCount: this.armCount,
            rotation: this.rotation,
            centerX: this.centerX,
            centerY: this.centerY,
            innerRadius,
            outerRadius,
        };

        const { tipX, tipY, base1X, base1Y, base2X, base2Y } = computeTransitionPosition(ctx);

        element.setAttribute('points',
            `${tipX.toFixed(2)},${tipY.toFixed(2)} ${base1X.toFixed(2)},${base1Y.toFixed(2)} ${base2X.toFixed(2)},${base2Y.toFixed(2)}`
        );
    }

    setPosition(centerX: number, centerY: number): void {
        this.centerX = centerX;
        this.centerY = centerY;
    }

    testTransition(type: 'adding' | 'removing', armCount: number, sourceArmIndex: number, direction: TransitionDirection = 1): void {
        if (this.armTransition) {
            this.transitionElement?.remove();
            this.transitionElement = null;
            this.armTransition = null;
        }
        if (this.secondArmTransition) {
            this.secondTransitionElement?.remove();
            this.secondTransitionElement = null;
            this.secondArmTransition = null;
        }
        this.expansionFactor = 0;

        this.armCount = armCount;
        this.createArmElements();
        this.updateArms();

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

        this.armTransition = {
            type,
            direction,
            progress: 0,
            sourceArmIndex,
        };

        console.log(`Star testTransition: ${type} arm, ${armCount}→${type === 'adding' ? armCount + 1 : armCount - 1} arms, sourceIdx=${sourceArmIndex}, dir=${direction > 0 ? 'CW' : 'CCW'}`);

        this.createTransitionElement();
    }

    getArmCount(): number {
        return this.armCount;
    }
}
