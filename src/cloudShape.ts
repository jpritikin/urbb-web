import { Point, Knot, KnotType } from './geometry.js';
import { BezierSegment, computeSmoothBezierSegments, bezierTangent } from './bezier.js';
import { NormalizedHarmonics, generateHarmonics, getRandomInt } from './harmonics.js';
import { AnimatedKnot, AnimatedFluffiness } from './animation.js';
import { LatticeDeformation, AnchorSide } from './latticeDeformation.js';

export enum CloudType {
    STRATOCUMULUS = 'stratocumulus',
    CUMULUS = 'cumulus'
}

const FONT_SIZE = 14;
const MAX_TOP_GAP = 45;
const KNOT_MARGIN = 9;
const BOTTOM_INSET = 0;
const VERTICAL_PADDING = 6;
const FLUFFINESS_VARIATION = 2.7;
const MAX_ARC_LENGTH_FACTOR = 0.7;
const BOTTOM_LINE_HEIGHT_FACTOR = 0.85;
const TOP_KNOT_VARIATION_RANGE = 30;
const BOTTOM_KNOT_VARIATION_RANGE = 8;
const BASE_SEGMENT_LENGTH = 30;
const SEGMENT_LENGTH_EXPONENT = 0.7;
const ROTATION_SPEED_UPDATE_INTERVAL = 30;

class KnotLayout {
    constructor(
        public rightSideCount: number,
        public bottomMiddleCount: number,
        public leftSideCount: number,
        public topMiddleCount: number
    ) { }

    getRightTopIndex(): number {
        return 0;
    }

    getRightBottomIndex(): number {
        return this.rightSideCount - 1;
    }

    getBottomMiddleStart(): number {
        return this.rightSideCount;
    }

    getBottomMiddleEnd(): number {
        return this.rightSideCount + this.bottomMiddleCount;
    }

    getLeftBottomIndex(): number {
        return this.getBottomMiddleEnd();
    }

    getLeftTopIndex(): number {
        return this.getBottomMiddleEnd() + this.leftSideCount - 1;
    }

    getTopMiddleStart(): number {
        return this.getBottomMiddleEnd() + this.leftSideCount;
    }

    getTotalCount(): number {
        return this.rightSideCount + this.bottomMiddleCount + this.leftSideCount + this.topMiddleCount;
    }
}

function getTextMetrics(text: string, fontSize: number): { width: number; height: number; advances: number[]; ascent: number; descent: number } {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = `${fontSize}px sans-serif`;

    const metrics = ctx.measureText(text);
    const width = metrics.width;
    const ascent = metrics.actualBoundingBoxAscent;
    const descent = metrics.actualBoundingBoxDescent;
    const height = ascent + descent;

    const advances: number[] = [];
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const charMetrics = ctx.measureText(char);
        advances.push(charMetrics.width);
    }

    return { width, height, advances, ascent, descent };
}

function subdivideSegment(startKnot: Point, endKnot: Point, maxGap: number): Point[] {
    const initialWidth = endKnot.x - startKnot.x;
    if (initialWidth < 0) {
        throw new Error(`subdivideSegment: startKnot.x (${startKnot.x}) must be <= endKnot.x (${endKnot.x})`);
    }

    const knots = [startKnot, endKnot];
    const minGap = 3 * KNOT_MARGIN;
    if (maxGap < minGap) { maxGap = minGap; }

    let iterations = 0;
    while (true) {
        let largestGap = 0;
        let gapIndex = -1;

        for (let i = 0; i < knots.length - 1; i++) {
            const gap = knots[i + 1].x - knots[i].x;
            if (gap > largestGap) {
                largestGap = gap;
                gapIndex = i;
            }
        }

        if (largestGap <= minGap || (largestGap < maxGap && Math.random() < 0.5)) {
            break;
        }

        const leftKnot = knots[gapIndex];
        const rightKnot = knots[gapIndex + 1];

        const xMin = leftKnot.x + KNOT_MARGIN;
        const xMax = rightKnot.x - KNOT_MARGIN;
        const newX = xMin + Math.random() * (xMax - xMin);

        const avgSvgY = (leftKnot.y + rightKnot.y) / 2;
        knots.splice(gapIndex + 1, 0, new Point(newX, avgSvgY));
        iterations++;
    }

    return knots;
}


function transformCircleKnots(circleKnots: Point[], startX: number): Point[] {
    const positions: Point[] = [];

    for (const knot of circleKnots) {
        const x = startX + knot.x;
        positions.push(new Point(x, knot.y));
    }

    return positions;
}

import { PartState } from './partState.js';

export interface CloudOptions {
    id?: string;
}

export class Cloud {
    text: string;
    private _x: number = 0;
    private _y: number = 0;
    textHeight: number;
    textAscent: number;
    textDescent: number;
    minHeight: number;
    cloudType: CloudType;

    private _textLeft: number;
    private _textRight: number;

    // External coordinate system: (0,0) at center-top of text
    // Internal coordinate system: (0,0) at bottom-left of text, y increases upward (negative y is up)
    get x(): number { return this._x; }
    set x(val: number) { this._x = val; }
    get y(): number { return this._y; }
    set y(val: number) { this._y = val; }

    // Convert internal coordinates to external coordinates
    // Internal: (0,0) at bottom-left of text, y negative going up
    // External: (0,0) at center-top of text
    private toExternalCoords(internalX: number, internalY: number): Point {
        return new Point(
            internalX - this.textWidth / 2,
            internalY + this.minHeight
        );
    }

    knots: Knot[] = [];
    segments: BezierSegment[] = [];
    textWidth: number = 0;
    layout: KnotLayout = new KnotLayout(0, 0, 0, 0);

    leftRotation: number = 0;
    rightRotation: number = 0;
    leftRotationSpeed: number = 1;
    rightRotationSpeed: number = 1;
    rotationSpeedTimer: number = 1 + ROTATION_SPEED_UPDATE_INTERVAL;
    leftHarmonics: NormalizedHarmonics;
    rightHarmonics: NormalizedHarmonics;
    leftHeightRange: { min: number; max: number } = { min: 0, max: 0 };
    rightHeightRange: { min: number; max: number } = { min: 0, max: 0 };

    topMiddleKnots: AnimatedKnot[] = [];
    bottomMiddleKnots: AnimatedKnot[] = [];
    fluffinessAnimations: AnimatedFluffiness[] = [];
    private initialized: boolean = false;

    id: string;

    private groupElement: SVGGElement | null = null;
    private pathElement: SVGPathElement | null = null;
    private textElement: SVGTextElement | null = null;

    private latticeDeformation: LatticeDeformation | null = null;
    private isBlended: boolean = false;
    private isUnblending: boolean = false;
    private externalLattice: LatticeDeformation | null = null;
    private _animatedBlendingDegree: number = 1;

    private static nextId = 1;

    constructor(text: string, x: number = 0, y: number = 0, cloudType?: CloudType, options?: CloudOptions) {
        this.text = text;
        this._x = x;
        this._y = y;

        const metrics = getTextMetrics(text, FONT_SIZE);

        this.textWidth = metrics.width + BOTTOM_INSET;
        this.textHeight = metrics.height;
        this.textAscent = metrics.ascent;
        this.textDescent = metrics.descent;

        this._textLeft = 0;
        this._textRight = this.textWidth;

        this.minHeight = this.textHeight + VERTICAL_PADDING;

        this.cloudType = cloudType ?? (Math.random() > 0.5 ? CloudType.CUMULUS : CloudType.STRATOCUMULUS);
        if (this.textWidth < 20) {
            this.cloudType = CloudType.STRATOCUMULUS;
        }

        this.id = options?.id ?? `cloud_${Cloud.nextId++}`;

        const baseRadius = this.minHeight / 2;
        this.leftHarmonics = new NormalizedHarmonics([
            ...generateHarmonics(1, 0, Math.random() * 6),
            ...generateHarmonics(2, 2, Math.random() * 7),
        ], baseRadius);
        this.rightHarmonics = new NormalizedHarmonics([
            ...generateHarmonics(1, 0, Math.random() * 6),
            ...generateHarmonics(2, 2, Math.random() * 7),
        ], baseRadius);

        this.computeHeightRanges();
        this.generateKnots();
    }

    private getLeftTopKnotIndex(): number {
        return this.layout.getLeftTopIndex();
    }

    private updateAnimatedKnots(
        knots: AnimatedKnot[],
        deltaTime: number,
        getBaseY: (index: number) => number,
        variationRange: number,
        clampY?: (y: number) => number
    ): void {
        const halfRange = variationRange / 2;
        for (let i = 0; i < knots.length; i++) {
            const knot = knots[i];
            knot.targetTimer += deltaTime;
            if (knot.targetTimer >= knot.targetInterval) {
                const variation = Math.random() * variationRange - halfRange;
                knot.setNewVariationOffset(variation);
            }
            knot.update(deltaTime, getBaseY(i));
            if (clampY) {
                knot.y = clampY(knot.y);
            }
        }
    }

    animate(deltaTime: number): void {
        this.updateRotation(deltaTime);
        this.updateTopKnotPhysics(deltaTime);
        this.updateBottomKnotPhysics(deltaTime);
        this.updateFluffinessPhysics(deltaTime);
        this.updateRotationSpeeds(deltaTime);
        this.animateLattice(deltaTime);
    }

    private updateTopKnotPhysics(deltaTime: number): void {
        const leftTopSvgY = this.knots[this.layout.getLeftTopIndex()].point.y;
        const rightTopSvgY = this.knots[this.layout.getRightTopIndex()].point.y;
        const maxSvgY = -this.minHeight;

        this.updateAnimatedKnots(
            this.topMiddleKnots,
            deltaTime,
            (i) => {
                const t = (i + 1) / (this.topMiddleKnots.length + 1);
                return leftTopSvgY + t * (rightTopSvgY - leftTopSvgY);
            },
            TOP_KNOT_VARIATION_RANGE,
            (y) => Math.min(maxSvgY, y)
        );
    }

    private updateBottomKnotPhysics(deltaTime: number): void {
        if (this.cloudType !== CloudType.CUMULUS || this.bottomMiddleKnots.length === 0) {
            return;
        }

        this.updateAnimatedKnots(
            this.bottomMiddleKnots,
            deltaTime,
            () => 0,
            BOTTOM_KNOT_VARIATION_RANGE
        );
    }

    private updateFluffinessPhysics(deltaTime: number): void {
        for (let i = 0; i < this.fluffinessAnimations.length; i++) {
            const anim = this.fluffinessAnimations[i];
            const mode = this.getFluffinessMode(i);

            if (mode === 'none') {
                anim.update(deltaTime, 1);
                continue;
            }

            anim.targetTimer += deltaTime;
            if (anim.targetTimer >= anim.targetInterval) {
                const targets = this.generateFluffinessTargets(anim);
                const cp1Target = (mode === 'cp2-only') ? 0 : targets.cp1;
                const cp2Target = (mode === 'cp1-only') ? 0 : targets.cp2;
                anim.setNewTargets(cp1Target, cp2Target);
            }

            const segmentLength = this.knots[i].point.distanceTo(this.knots[(i + 1) % this.knots.length].point);
            const lengthScale = BASE_SEGMENT_LENGTH / Math.max(segmentLength, BASE_SEGMENT_LENGTH);
            anim.update(deltaTime, lengthScale);
        }
    }

    private updateRotationSpeeds(deltaTime: number): void {
        this.rotationSpeedTimer += deltaTime;
        if (this.rotationSpeedTimer >= ROTATION_SPEED_UPDATE_INTERVAL) {
            this.leftRotationSpeed = 0.8 + Math.random() * 0.3;
            this.rightRotationSpeed = 0.8 + Math.random() * 0.3;
            this.rotationSpeedTimer = 0;
        }
    }

    private generateFluffinessTargets(anim: AnimatedFluffiness): { cp1: number; cp2: number } {
        const rp = 0.85;
        const min = FLUFFINESS_VARIATION * (1 - rp);
        const halfRange = FLUFFINESS_VARIATION * rp / 2;
        const mid = min + halfRange;
        const base = anim.highHalf ? mid : min;
        anim.highHalf = !anim.highHalf;
        const cp1 = base + Math.random() * halfRange;
        const cp2 = base + Math.random() * halfRange;
        return { cp1, cp2 };
    }

    private initializeFluffinessAnimations(baseSegments: BezierSegment[]): void {
        for (let i = 0; i < baseSegments.length; i++) {
            const mode = this.getFluffinessMode(i);
            const anim = new AnimatedFluffiness(0, 0);
            if (mode !== 'none') {
                const targets = this.generateFluffinessTargets(anim);
                const cp1 = (mode === 'cp2-only') ? 0 : targets.cp1;
                const cp2 = (mode === 'cp1-only') ? 0 : targets.cp2;
                anim.cp1Factor = cp1;
                anim.cp2Factor = cp2;
                anim.cp1TargetFactor = cp1;
                anim.cp2TargetFactor = cp2;
            }
            this.fluffinessAnimations.push(anim);
        }
    }

    private getFluffinessMode(segmentIndex: number): 'none' | 'cp1-only' | 'cp2-only' | 'both' {
        if (this.cloudType === CloudType.CUMULUS) {
            return 'both';
        }
        const bottomRightIndex = this.layout.getRightBottomIndex();
        if (segmentIndex === bottomRightIndex) return 'none';
        if (segmentIndex === bottomRightIndex - 1) return 'cp1-only';
        if (segmentIndex === bottomRightIndex + 1) return 'cp2-only';
        return 'both';
    }

    private generateCircleKnots(
        height: number,
        startAngle: number,
        endAngle: number,
        harmonics: NormalizedHarmonics,
        rotation: number
    ): Point[] {
        const MAX_ARC_LENGTH = this.minHeight * MAX_ARC_LENGTH_FACTOR;

        const totalAngle = Math.abs(endAngle - startAngle);
        const estimatedArcLength = height * totalAngle / 2;
        const minKnots = 3;
        const knotCount = Math.max(minKnots, Math.ceil(estimatedArcLength / MAX_ARC_LENGTH));

        const knots: Point[] = [];
        const angleStep = (endAngle - startAngle) / (knotCount - 1);

        for (let i = 0; i < knotCount; i++) {
            const angle = startAngle + i * angleStep;
            const radius = harmonics.evaluate(angle, rotation);
            const x = radius * Math.cos(angle);
            const svgYCoord = -radius * Math.sin(angle);
            knots.push(new Point(x, svgYCoord));
        }

        const maxSvgY = Math.max(...knots.map(k => k.y));
        for (const knot of knots) {
            knot.y -= maxSvgY;
        }

        const actualHeight = -Math.min(...knots.map(k => k.y));
        if (actualHeight < this.minHeight) {
            const scale = this.minHeight / actualHeight;
            for (const knot of knots) {
                knot.y *= scale;
            }
        }

        return knots;
    }

    private applyAnimatedFluffiness(baseSegments: BezierSegment[]): BezierSegment[] {
        const fluffySegments: BezierSegment[] = [];
        const lineY = -(this.minHeight * BOTTOM_LINE_HEIGHT_FACTOR);

        const closestPointOnLine = (knot: Point): Point => {
            const clampedX = Math.max(0, Math.min(this.textWidth, knot.x));
            return new Point(clampedX, lineY);
        };

        for (let i = 0; i < baseSegments.length; i++) {
            const [start, cp1, cp2, end] = baseSegments[i];
            const mode = this.getFluffinessMode(i);

            if (mode === 'none') {
                fluffySegments.push([start, cp1, cp2, end]);
                continue;
            }

            const startKnot = this.knots[i].point;
            const endKnot = this.knots[(i + 1) % this.knots.length].point;

            const closest1 = closestPointOnLine(startKnot);
            const closest2 = closestPointOnLine(endKnot);
            const normal1 = new Point(startKnot.x - closest1.x, startKnot.y - closest1.y).normalize();
            const normal2 = new Point(endKnot.x - closest2.x, endKnot.y - closest2.y).normalize();

            const segmentLength = startKnot.distanceTo(endKnot);
            const scaledLength = Math.pow(segmentLength, SEGMENT_LENGTH_EXPONENT);
            const anim = this.fluffinessAnimations[i];
            const newCp1 = cp1.add(normal1.mul(anim.cp1Factor * scaledLength));
            const newCp2 = cp2.add(normal2.mul(anim.cp2Factor * scaledLength));

            fluffySegments.push([start, newCp1, newCp2, end]);
        }

        return fluffySegments;
    }

    private generateKnots(): void {
        const margin = 2;
        const knots: Knot[] = [];

        const rightDiameter = (this.rightHeightRange.min + this.rightHeightRange.max) / 2;
        const rightCircle = this.generateCircleKnots(rightDiameter, Math.PI / 2, -Math.PI / 2, this.rightHarmonics, this.rightRotation);
        const rightSide = transformCircleKnots(rightCircle, this._textRight + margin);

        const leftDiameter = (this.leftHeightRange.min + this.leftHeightRange.max) / 2;
        const leftCircle = this.generateCircleKnots(leftDiameter, -Math.PI / 2, -3 * Math.PI / 2, this.leftHarmonics, this.leftRotation);
        const leftSide = transformCircleKnots(leftCircle, this._textLeft - margin);

        for (let i = 0; i < rightSide.length; i++) {
            const knotType = KnotType.SMOOTH;
            knots.push(new Knot(rightSide[i], knotType));
        }
        const rightSideCount = rightSide.length;

        for (let i = 0; i < leftSide.length; i++) {
            const knotType = (i === 0) ? KnotType.LINE : KnotType.SMOOTH;
            knots.push(new Knot(leftSide[i], knotType));
        }
        const leftSideCount = leftSide.length;

        if (!this.initialized) {
            const rightTopIndex = 0;
            const leftTopIndex = rightSideCount + leftSideCount - 1;
            const subdivided = subdivideSegment(
                knots[leftTopIndex].point,
                knots[rightTopIndex].point,
                MAX_TOP_GAP
            );
            this.topMiddleKnots = subdivided.slice(1, -1).map(p => new AnimatedKnot(p.x, p.y));

            if (this.cloudType === CloudType.CUMULUS) {
                const rightBottomIndex = rightSideCount - 1;
                const leftBottomIndex = rightSideCount;
                const bottomSubdivided = subdivideSegment(
                    knots[leftBottomIndex].point,
                    knots[rightBottomIndex].point,
                    0
                );
                this.bottomMiddleKnots = bottomSubdivided.slice(1, -1).reverse().map(p => new AnimatedKnot(p.x, p.y));
            }

            this.initialized = true;
        }

        if (this.cloudType === CloudType.CUMULUS && this.bottomMiddleKnots.length > 0) {
            const bottomSegmentKnots = this.bottomMiddleKnots.map(ak => new Knot(ak.toPoint(), KnotType.SMOOTH));
            const insertIndex = rightSideCount;
            knots.splice(insertIndex, 0, ...bottomSegmentKnots);
        }

        const topSegmentKnots = this.topMiddleKnots.map(ak => new Knot(ak.toPoint(), KnotType.SMOOTH));
        knots.splice(knots.length, 0, ...topSegmentKnots);

        this.layout = new KnotLayout(
            rightSideCount,
            this.bottomMiddleKnots.length,
            leftSideCount,
            this.topMiddleKnots.length
        );

        this.knots = knots;

        const baseSegments = computeSmoothBezierSegments(this.knots, true);

        if (this.fluffinessAnimations.length === 0) {
            this.initializeFluffinessAnimations(baseSegments);
        }

        this.segments = this.applyAnimatedFluffiness(baseSegments);
    }

    getKnotLabel(index: number): string {
        if (index < this.layout.rightSideCount) {
            if (index === this.layout.getRightTopIndex()) return 'T';
            if (index === this.layout.getRightBottomIndex()) return 'B';
            return 'R';
        }

        if (index >= this.layout.getBottomMiddleStart() && index < this.layout.getBottomMiddleEnd()) {
            return 'B';
        }

        if (index >= this.layout.getBottomMiddleEnd() && index < this.layout.getTopMiddleStart()) {
            const leftIndex = index - this.layout.getBottomMiddleEnd();
            if (leftIndex === 0) return 'B';
            if (leftIndex === this.layout.leftSideCount - 1) return 'T';
            return 'L';
        }

        return 'T';
    }

    logKnotPositions(): void {
        console.log(`\n=== Cloud: "${this.text}" ===`);
        this.knots.forEach((knot, i) => {
            const label = this.getKnotLabel(i);
            console.log(`Knot ${i} (${label}): x=${knot.point.x.toFixed(2)}, y=${knot.point.y.toFixed(2)}`);
        });
    }

    private getDebugPercentages(): {
        left: number;
        right: number;
        leftHeight: number;
        leftMin: number;
        leftMax: number;
        rightHeight: number;
        rightMin: number;
        rightMax: number;
    } {
        const leftHeightFromSvgY = -this.leftHeightInternal;
        const leftMinHeight = this.leftHeightRange.min;
        const leftMaxHeight = this.leftHeightRange.max;
        const leftRange = leftMaxHeight - leftMinHeight;
        const leftPercentage = leftRange > 0.01 ? ((leftHeightFromSvgY - leftMinHeight) / leftRange) * 100 : 50;

        const rightHeightFromSvgY = -this.rightHeightInternal;
        const rightMinHeight = this.rightHeightRange.min;
        const rightMaxHeight = this.rightHeightRange.max;
        const rightRange = rightMaxHeight - rightMinHeight;
        const rightPercentage = rightRange > 0.01 ? ((rightHeightFromSvgY - rightMinHeight) / rightRange) * 100 : 50;

        return {
            left: leftPercentage,
            right: rightPercentage,
            leftHeight: leftHeightFromSvgY,
            leftMin: leftMinHeight,
            leftMax: leftMaxHeight,
            rightHeight: rightHeightFromSvgY,
            rightMin: rightMinHeight,
            rightMax: rightMaxHeight
        };
    }

    renderDebugInfo(groupElement: SVGGElement): void {
        const rightTopKnot = this.knots[this.layout.getRightTopIndex()];
        const leftTopKnot = this.knots[this.layout.getLeftTopIndex()];
        const leftTopExt = this.toExternalCoords(leftTopKnot.point.x, leftTopKnot.point.y);
        const rightTopExt = this.toExternalCoords(rightTopKnot.point.x, rightTopKnot.point.y);

        const percentages = this.getDebugPercentages();

        const leftLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        leftLabel.setAttribute('x', String(leftTopExt.x - 5));
        leftLabel.setAttribute('y', String(leftTopExt.y));
        leftLabel.setAttribute('font-size', '6');
        leftLabel.setAttribute('fill', '#0000ff');
        leftLabel.setAttribute('text-anchor', 'end');
        leftLabel.textContent = `L ${percentages.left.toFixed(1)}%`;
        groupElement.appendChild(leftLabel);

        const rightLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        rightLabel.setAttribute('x', String(rightTopExt.x + 5));
        rightLabel.setAttribute('y', String(rightTopExt.y));
        rightLabel.setAttribute('font-size', '6');
        rightLabel.setAttribute('fill', '#0000ff');
        rightLabel.setAttribute('text-anchor', 'start');
        rightLabel.textContent = `R ${percentages.right.toFixed(1)}%`;
        groupElement.appendChild(rightLabel);

        for (let j = 0; j < this.knots.length; j++) {
            const knot = this.knots[j];
            const knotExt = this.toExternalCoords(knot.point.x, knot.point.y);
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(knotExt.x));
            circle.setAttribute('cy', String(knotExt.y));
            circle.setAttribute('r', '1');
            circle.setAttribute('fill', 'red');
            circle.setAttribute('opacity', '0.5');
            groupElement.appendChild(circle);

            const posLabel = this.getKnotLabel(j);
            const knotLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            knotLabel.setAttribute('x', String(knotExt.x));
            knotLabel.setAttribute('y', String(knotExt.y + 7));
            knotLabel.setAttribute('font-size', '5');
            knotLabel.setAttribute('fill', 'purple');
            knotLabel.textContent = `${j}(${posLabel})`;
            groupElement.appendChild(knotLabel);
        }
    }

    logAnimationSnapshot(): void {
        console.log(`\n=== Animation Snapshot: "${this.text}" ===`);
        console.log(`Left Rotation: ${this.leftRotation.toFixed(3)} rad, Right Rotation: ${this.rightRotation.toFixed(3)} rad`);

        console.log(`\n--- Height Range Diagnostics ---`);
        console.log(`baseRadius: ${this.baseRadius.toFixed(2)}, minHeight: ${this.minHeight.toFixed(2)}`);
        console.log(`Left height range: [${this.leftHeightRange.min.toFixed(2)}, ${this.leftHeightRange.max.toFixed(2)}]`);
        console.log(`Right height range: [${this.rightHeightRange.min.toFixed(2)}, ${this.rightHeightRange.max.toFixed(2)}]`);

        const leftCircle = this.generateCircleKnots(this.baseRadius * 2, -Math.PI / 2, -3 * Math.PI / 2, this.leftHarmonics, this.leftRotation);
        const leftCircleHeights = leftCircle.map(k => -k.y);
        const leftActualMin = Math.min(...leftCircleHeights);
        const leftActualMax = Math.max(...leftCircleHeights);
        console.log(`Left circle knots: actual heights range [${leftActualMin.toFixed(2)}, ${leftActualMax.toFixed(2)}]`);

        const rightCircle = this.generateCircleKnots(this.baseRadius * 2, Math.PI / 2, -Math.PI / 2, this.rightHarmonics, this.rightRotation);
        const rightCircleHeights = rightCircle.map(k => -k.y);
        const rightActualMin = Math.min(...rightCircleHeights);
        const rightActualMax = Math.max(...rightCircleHeights);
        console.log(`Right circle knots: actual heights range [${rightActualMin.toFixed(2)}, ${rightActualMax.toFixed(2)}]`);

        const debug = this.getDebugPercentages();
        console.log(`\nLeft debug: height=${debug.leftHeight.toFixed(2)}, min=${debug.leftMin.toFixed(2)}, max=${debug.leftMax.toFixed(2)}, %=${debug.left.toFixed(1)}`);
        console.log(`Right debug: height=${debug.rightHeight.toFixed(2)}, min=${debug.rightMin.toFixed(2)}, max=${debug.rightMax.toFixed(2)}, %=${debug.right.toFixed(1)}`);

        console.log(`\nTop Middle Knots (${this.topMiddleKnots.length}):`);
        this.topMiddleKnots.forEach((knot, i) => {
            const nextChange = (knot.targetInterval - knot.targetTimer).toFixed(2);
            console.log(`  [${i}] svgY=${knot.y.toFixed(2)}, variation=${knot.variationOffset.toFixed(2)}, targetVar=${knot.targetVariationOffset.toFixed(2)}, velocity=${knot.velocity.toFixed(2)}, interval=${knot.targetInterval.toFixed(2)}s, next=${nextChange}s`);
        });

        console.log(`\nFluffiness Animations (${this.fluffinessAnimations.length} segments):`);
        this.fluffinessAnimations.forEach((anim, i) => {
            const mode = this.getFluffinessMode(i);
            const status = mode === 'both' ? '' : ` [${mode.toUpperCase()}]`;
            const nextChange = mode === 'none' ? 'N/A' : (anim.targetInterval - anim.targetTimer).toFixed(2) + 's';
            console.log(`  Segment ${i}${status}:`);
            if (mode !== 'none') {
                console.log(`    CP1: factor=${anim.cp1Factor.toFixed(3)}, target=${anim.cp1TargetFactor.toFixed(3)}, vel=${anim.cp1Velocity.toFixed(3)}`);
                console.log(`    CP2: factor=${anim.cp2Factor.toFixed(3)}, target=${anim.cp2TargetFactor.toFixed(3)}, vel=${anim.cp2Velocity.toFixed(3)}`);
                console.log(`    Interval: ${anim.targetInterval.toFixed(2)}s, next change: ${nextChange}`);
            }
        });

        console.log(`\nSegment Counts:`);
        console.log(`  Right side: ${this.layout.rightSideCount}, Left side: ${this.layout.leftSideCount}, Top: ${this.layout.topMiddleCount}, Bottom middle: ${this.layout.bottomMiddleCount}`);
        console.log(`  Total segments: ${this.segments.length}`);
    }

    // External coordinates: x=0 is center of text, y=0 is top of cloud
    get textLeft(): number { return -this.textWidth / 2; }
    get textRight(): number { return this.textWidth / 2; }
    get centerX(): number { return 0; }
    get centerY(): number { return this.minHeight / 2; }

    get baseRadius(): number {
        return this.minHeight / 2;
    }

    // These return internal values for animation purposes
    private get leftHeightInternal(): number {
        return this.knots[this.getLeftTopKnotIndex()].point.y;
    }

    private get rightHeightInternal(): number {
        return this.knots[this.layout.getRightTopIndex()].point.y;
    }

    getTopLeft(): Point {
        return this.toExternalCoords(this._textLeft, this.leftHeightInternal);
    }

    getTopRight(): Point {
        return this.toExternalCoords(this._textRight, this.rightHeightInternal);
    }

    private computeHeightRanges(): void {
        let leftMin = Infinity;
        let leftMax = -Infinity;
        let rightMin = Infinity;
        let rightMax = -Infinity;

        const samples = 100;
        const leftSamples: number[] = [];
        const rightSamples: number[] = [];

        for (let i = 0; i < samples; i++) {
            const testRotation = (i / samples) * Math.PI * 2;

            const leftKnots = this.generateCircleKnots(this.baseRadius * 2, -Math.PI / 2, -3 * Math.PI / 2, this.leftHarmonics, testRotation);
            const leftHeight = -Math.min(...leftKnots.map(k => k.y));
            leftSamples.push(leftHeight);
            leftMin = Math.min(leftMin, leftHeight);
            leftMax = Math.max(leftMax, leftHeight);

            const rightKnots = this.generateCircleKnots(this.baseRadius * 2, Math.PI / 2, -Math.PI / 2, this.rightHarmonics, testRotation);
            const rightHeight = -Math.min(...rightKnots.map(k => k.y));
            rightSamples.push(rightHeight);
            rightMin = Math.min(rightMin, rightHeight);
            rightMax = Math.max(rightMax, rightHeight);
        }

        this.leftHeightRange = { min: leftMin, max: leftMax };
        this.rightHeightRange = { min: rightMin, max: rightMax };
    }

    private updateRotation(deltaTime: number): void {
        const rotationSpeed = 0.1;
        const deltaRotation = rotationSpeed * deltaTime;

        this.leftRotation += deltaRotation * this.leftRotationSpeed;
        this.leftRotation = this.leftRotation % (2 * Math.PI);

        this.rightRotation += deltaRotation * this.rightRotationSpeed;
        this.rightRotation = this.rightRotation % (2 * Math.PI);

        this.generateKnots();
    }

    setBlended(blended: boolean): void {
        this.isBlended = blended;
        if (!blended) {
            this.isUnblending = false;
            if (this.latticeDeformation) {
                this.latticeDeformation.reset();
            }
        }
    }

    getIsBlended(): boolean {
        return this.isBlended;
    }

    get animatedBlendingDegree(): number {
        return this._animatedBlendingDegree;
    }

    set animatedBlendingDegree(value: number) {
        this._animatedBlendingDegree = Math.max(0, Math.min(1, value));
    }

    setBlendedStretch(stretchX: number, stretchY: number, anchorSide: AnchorSide): void {
        if (!this.latticeDeformation) {
            const latticeWidth = this.textWidth + this.minHeight + 10;
            this.latticeDeformation = new LatticeDeformation(latticeWidth, this.minHeight);
        }
        this.latticeDeformation.setTugOffset(stretchX, stretchY, anchorSide);
        this.currentStretch = { stretchX, stretchY, anchorSide };
    }

    setBlendedStretchImmediate(stretchX: number, stretchY: number, anchorSide: AnchorSide): void {
        if (!this.latticeDeformation) {
            const latticeWidth = this.textWidth + this.minHeight + 10;
            this.latticeDeformation = new LatticeDeformation(latticeWidth, this.minHeight);
        }
        this.latticeDeformation.setTugOffsetImmediate(stretchX, stretchY, anchorSide);
        this.currentStretch = { stretchX, stretchY, anchorSide };
    }

    getBlendedStretch(): { stretchX: number; stretchY: number; anchorSide: AnchorSide } | null {
        return this.currentStretch;
    }

    getActualLatticeOffset(): { x: number; y: number } | null {
        if (!this.latticeDeformation) return null;
        return this.latticeDeformation.getCurrentOffset();
    }

    private currentStretch: { stretchX: number; stretchY: number; anchorSide: AnchorSide } | null = null;

    private findAnchorPoint(side: AnchorSide): { x: number; y: number } {
        // Find the midpoint of the specified edge
        const samples = 20;
        const edgePoints: { x: number; y: number }[] = [];

        for (let i = 0; i < this.segments.length; i++) {
            const segment = this.segments[i];
            const [p0, p1, p2, p3] = segment;

            for (let j = 0; j <= samples; j++) {
                const t = j / samples;
                const mt = 1 - t;
                const x = mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x;
                const y = mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y;
                edgePoints.push({ x, y });
            }
        }

        // Find extreme value and filter points near that extreme
        let extremeVal: number;
        let isHorizontal = side === 'left' || side === 'right';

        if (side === 'left') {
            extremeVal = Math.min(...edgePoints.map(p => p.x));
        } else if (side === 'right') {
            extremeVal = Math.max(...edgePoints.map(p => p.x));
        } else if (side === 'top') {
            extremeVal = Math.min(...edgePoints.map(p => p.y));
        } else {
            extremeVal = Math.max(...edgePoints.map(p => p.y));
        }

        // Find points near the extreme (within 5% of cloud dimension)
        const tolerance = isHorizontal ? this.minHeight * 0.15 : this.textWidth * 0.15;
        const nearExtremePoints = edgePoints.filter(p => {
            const val = isHorizontal ? p.x : p.y;
            return Math.abs(val - extremeVal) < tolerance;
        });

        // Return the midpoint of the edge (average of near-extreme points)
        if (nearExtremePoints.length === 0) {
            const ext = this.toExternalCoords(extremeVal, extremeVal);
            return { x: ext.x, y: ext.y };
        }

        const avgX = nearExtremePoints.reduce((sum, p) => sum + p.x, 0) / nearExtremePoints.length;
        const avgY = nearExtremePoints.reduce((sum, p) => sum + p.y, 0) / nearExtremePoints.length;

        const ext = this.toExternalCoords(avgX, avgY);
        return { x: ext.x, y: ext.y };
    }

    getAnchorEdgeOffset(anchorSide: AnchorSide): { x: number; y: number } {
        const anchor = this.findAnchorPoint(anchorSide);
        return { x: -anchor.x, y: -anchor.y };
    }

    clearBlendedStretch(): void {
        if (this.latticeDeformation) {
            this.latticeDeformation.clearTugTarget();
        }
        this.currentStretch = null;
    }

    startUnblending(targetX: number, targetY: number): void {
        this.isUnblending = true;
        if (!this.latticeDeformation) {
            this.latticeDeformation = new LatticeDeformation(
                this.textRight - this.textLeft + 40,
                this.minHeight
            );
        }

        const cloudCenterX = (this.textLeft + this.textRight) / 2;
        const relativeX = targetX - this.x - cloudCenterX;
        const direction = relativeX > 0 ? 'right' : 'left';

        // Set a small initial offset to start the unblending animation
        const offsetX = direction === 'right' ? 20 : -20;
        const offsetY = 0;

        this.latticeDeformation.setTugOffset(offsetX, offsetY, direction);
    }

    stopUnblending(): void {
        this.isUnblending = false;
        if (this.latticeDeformation) {
            this.latticeDeformation.clearTugTarget();
        }
    }

    getIsUnblending(): boolean {
        return this.isUnblending;
    }

    animateLattice(deltaTime: number): void {
        if (this.latticeDeformation && (this.isUnblending || this.latticeDeformation.isTugging())) {
            this.latticeDeformation.animate(deltaTime);
        }
    }

    private transformPointWithLattice(point: Point): Point {
        const isTugging = this.latticeDeformation && this.latticeDeformation.isTugging();
        const shouldUseLattice = this.isUnblending || isTugging;
        const lattice = this.externalLattice || (shouldUseLattice ? this.latticeDeformation : null);
        if (!lattice) {
            return point;
        }

        const external = this.toExternalCoords(point.x, point.y);
        const cloudLeftExtent = -this.textWidth / 2 - this.minHeight / 2 - 5;
        const latticeX = external.x - cloudLeftExtent;
        const latticeY = external.y;
        const displacement = lattice.getDisplacement(latticeX, latticeY);

        return new Point(
            point.x + displacement.x,
            point.y + displacement.y
        );
    }

    setExternalLattice(lattice: LatticeDeformation | null): void {
        this.externalLattice = lattice;
    }

    getExternalLattice(): LatticeDeformation | null {
        return this.externalLattice;
    }

    generateOutlinePath(): string {
        const pathParts: string[] = [];
        const r = (n: number) => n.toFixed(2);

        const transformToExternal = (p: Point): Point => {
            const latticeTransformed = this.transformPointWithLattice(p);
            return this.toExternalCoords(latticeTransformed.x, latticeTransformed.y);
        };

        const firstKnot = transformToExternal(this.knots[0].point);
        pathParts.push(`M ${r(firstKnot.x)},${r(firstKnot.y)}`);

        for (const [start, cp1, cp2, end] of this.segments) {
            const tCp1 = transformToExternal(cp1);
            const tCp2 = transformToExternal(cp2);
            const tEnd = transformToExternal(end);
            pathParts.push(`C ${r(tCp1.x)},${r(tCp1.y)} ${r(tCp2.x)},${r(tCp2.y)} ${r(tEnd.x)},${r(tEnd.y)}`);
        }

        pathParts.push('Z');
        return pathParts.join(' ');
    }

    getBoundingBox(): { minX: number; maxX: number; minY: number; maxY: number } {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

        const transformToExternal = (p: Point): Point => {
            const latticeTransformed = this.transformPointWithLattice(p);
            return this.toExternalCoords(latticeTransformed.x, latticeTransformed.y);
        };

        for (const knot of this.knots) {
            const ext = transformToExternal(knot.point);
            minX = Math.min(minX, ext.x);
            maxX = Math.max(maxX, ext.x);
            minY = Math.min(minY, ext.y);
            maxY = Math.max(maxY, ext.y);
        }

        return { minX, maxX, minY, maxY };
    }

    getFillColor(hovered: boolean): string {
        return hovered ? '#e0e0e0' : '#ffffff';
    }

    renderText(textElement: SVGTextElement, identityRevealed: boolean): void {
        const textX = 0;
        const lines = this.text.split('\\n');
        const lineHeight = this.textAscent + this.textDescent;
        const totalTextHeight = lines.length * lineHeight;
        const centerY = this.minHeight / 2;
        const firstBaselineY = centerY - totalTextHeight / 2 + this.textAscent;

        textElement.setAttribute('x', String(textX));
        textElement.setAttribute('opacity', identityRevealed ? '1' : '0');
        textElement.innerHTML = '';
        for (let j = 0; j < lines.length; j++) {
            const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspan.setAttribute('x', String(textX));
            tspan.setAttribute('y', String(firstBaselineY + j * lineHeight));
            tspan.textContent = lines[j];
            textElement.appendChild(tspan);
        }
    }

    updateStyles(pathElement: SVGPathElement, textElement: SVGTextElement, debug: boolean, hovered: boolean): void {
        const isDark = document.documentElement.classList.contains('dark');
        const bgColor = isDark ? '#1a1a1a' : '#ffffff';
        const textColor = isDark ? '#f5f5f5' : '#1a1a1a';

        if (debug) {
            pathElement.style.fill = 'yellow';
            pathElement.style.stroke = 'red';
            textElement.style.fill = '#000000';
            textElement.style.fontWeight = 'normal';
            textElement.style.stroke = '';
            textElement.style.strokeWidth = '';
        } else {
            pathElement.style.fill = this.getFillColor(hovered);
            pathElement.style.stroke = '#000000';
            pathElement.style.strokeOpacity = '1';
            pathElement.style.strokeLinejoin = 'round';
            textElement.style.stroke = bgColor;
            textElement.style.strokeWidth = '3';
            textElement.style.strokeLinejoin = 'round';
            textElement.style.fill = textColor;
            textElement.style.fontWeight = 'normal';
            textElement.style.paintOrder = 'stroke fill';
        }
    }

    createSVGElements(callbacks: {
        onClick: () => void;
        onHover: (hovered: boolean) => void;
        onLongPressStart: () => void;
        onLongPressEnd: () => void;
        onTouchStart?: (e: TouchEvent) => void;
        onTouchEnd?: () => void;
    }): SVGGElement {
        this.groupElement = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.groupElement.setAttribute('transform', `translate(${this.x}, ${this.y})`);
        this.groupElement.style.cursor = 'pointer';

        this.pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.pathElement.style.strokeWidth = String(0.8);

        this.textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        this.textElement.style.fontFamily = 'sans-serif';
        this.textElement.style.fontSize = `${FONT_SIZE}px`;
        this.textElement.style.textAnchor = 'middle';
        this.textElement.style.pointerEvents = 'none';

        this.groupElement.appendChild(this.pathElement);
        this.groupElement.appendChild(this.textElement);

        this.groupElement.addEventListener('click', (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            callbacks.onClick();
        }, true);

        this.groupElement.addEventListener('mouseenter', () => callbacks.onHover(true));
        this.groupElement.addEventListener('mouseleave', () => callbacks.onHover(false));

        this.groupElement.addEventListener('touchstart', (e: TouchEvent) => {
            callbacks.onLongPressStart();
            callbacks.onTouchStart?.(e);
        }, { passive: true });

        this.groupElement.addEventListener('touchend', () => {
            callbacks.onLongPressEnd();
            callbacks.onTouchEnd?.();
        });
        this.groupElement.addEventListener('touchcancel', () => callbacks.onLongPressEnd());

        return this.groupElement;
    }

    getGroupElement(): SVGGElement | null {
        return this.groupElement;
    }

    updateSVGElements(debug: boolean, state?: PartState, hovered?: boolean): void {
        if (!this.groupElement || !this.pathElement || !this.textElement) return;

        const identityRevealed = state?.biography.identityRevealed ?? false;

        const outlinePath = this.generateOutlinePath();
        this.pathElement.setAttribute('d', outlinePath);
        this.updateStyles(this.pathElement, this.textElement, debug, hovered ?? false);
        this.renderText(this.textElement, identityRevealed);

        if (debug) {
            while (this.groupElement.childNodes.length > 2) {
                this.groupElement.removeChild(this.groupElement.lastChild!);
            }
            this.renderDebugInfo(this.groupElement);
        }
    }

}
