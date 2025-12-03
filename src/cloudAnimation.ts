class Point {
    constructor(public x: number, public y: number) { }

    add(other: Point): Point {
        return new Point(this.x + other.x, this.y + other.y);
    }

    sub(other: Point): Point {
        return new Point(this.x - other.x, this.y - other.y);
    }

    mul(scalar: number): Point {
        return new Point(this.x * scalar, this.y * scalar);
    }

    length(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    distanceTo(other: Point): number {
        const dx = other.x - this.x;
        const dy = other.y - this.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    normalize(): Point {
        const l = this.length();
        if (l > 0) {
            return new Point(this.x / l, this.y / l);
        }
        return new Point(1, 0);
    }

    perpendicular(): Point {
        return new Point(-this.y, this.x);
    }
}

enum KnotType {
    SMOOTH = 'smooth',
    SYMMETRIC = 'symmetric',
    LINE = 'line'
}

enum CloudType {
    STRATOCUMULUS = 'stratocumulus',
    CUMULUS = 'cumulus'
}

class Knot {
    constructor(public point: Point, public type: KnotType = KnotType.SMOOTH) { }
}

const FONT_SIZE = 12;
const STROKE_WIDTH = 0.8;
const MAX_GAP = 50;
const MIN_GAP = 20;
const KNOT_MARGIN = 15;
const FLUFF_GRID_SIZE = 15;
const BOTTOM_INSET = 15;

function bezierPoint(start: Point, cp1: Point, cp2: Point, end: Point, t: number): Point {
    const t2 = t * t;
    const t3 = t2 * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;

    const x = mt3 * start.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * end.x;
    const y = mt3 * start.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * end.y;

    return new Point(x, y);
}

function bezierTangent(start: Point, cp1: Point, cp2: Point, end: Point, t: number): Point {
    const mt = 1 - t;
    const tangent = new Point(
        3 * mt * mt * (cp1.x - start.x) + 6 * mt * t * (cp2.x - cp1.x) + 3 * t * t * (end.x - cp2.x),
        3 * mt * mt * (cp1.y - start.y) + 6 * mt * t * (cp2.y - cp1.y) + 3 * t * t * (end.y - cp2.y)
    );
    return tangent.normalize();
}

type BezierSegment = [Point, Point, Point, Point];

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

function subdivideKnots(knots: Point[], cloud: Cloud): Point[] {
    const result = [...knots];

    while (true) {
        let largestGap = 0;
        let gapIndex = -1;

        for (let i = 0; i < result.length - 1; i++) {
            const gap = result[i + 1].x - result[i].x;
            if (gap > largestGap) {
                largestGap = gap;
                gapIndex = i;
            }
        }

        if (largestGap <= MAX_GAP) {
            break;
        }

        const leftKnot = result[gapIndex];
        const rightKnot = result[gapIndex + 1];

        const xMin = leftKnot.x + KNOT_MARGIN;
        const xMax = rightKnot.x - KNOT_MARGIN;
        const newX = xMin + Math.random() * (xMax - xMin);

        const minY = Math.max(leftKnot.y, rightKnot.y) * 2 / 3;
        const avgY = (leftKnot.y + rightKnot.y) / 2;
        const newY = Math.min(minY, avgY + (Math.random() * 45 - 20));

        result.splice(gapIndex + 1, 0, new Point(newX, newY));
    }

    return result;
}


function normalizeAngle(angle: number): number {
    angle = angle % 360;
    if (angle > 180) {
        angle -= 360;
    }
    return angle;
}

function clampAngleDifference(diff: number): number {
    if (diff > 90) {
        return 180 - diff;
    }
    if (diff < -90) {
        return -180 - diff;
    }
    return diff;
}

function computeSmoothAngles(points: Point[], closed: boolean = false): { outAngles: number[]; inAngles: number[] } {
    const outAngles: number[] = [];
    const inAngles: number[] = [];

    for (let i = 0; i < points.length - 1; i++) {
        const delta = points[i + 1].sub(points[i]);
        const directAngle = Math.atan2(delta.y, delta.x) * (180 / Math.PI);
        const noise = Math.random() * 10 - 5;

        outAngles.push(directAngle + noise);
        inAngles.push(directAngle + 180 + noise);
    }

    const smoothCount = closed ? outAngles.length : outAngles.length - 1;
    for (let i = 0; i < smoothCount; i++) {
        const inAngle = inAngles[i];
        const outAngle = outAngles[(i + 1) % outAngles.length];

        const normalizedIn = (inAngle - 180) > outAngle ? (inAngle - 180) : (inAngle + 180);
        const angleDiff = normalizeAngle(normalizedIn - outAngle);
        const clampedDiff = clampAngleDifference(angleDiff);
        const adjustment = clampedDiff / 2;

        inAngles[i] -= adjustment;
        outAngles[(i + 1) % outAngles.length] += adjustment;
    }

    return { outAngles, inAngles };
}

function computeControlPointDistance(segmentLength: number): number {
    if (segmentLength < 30) {
        return segmentLength / 3.0;
    }
    if (segmentLength < 60) {
        const blend = (segmentLength - 30) / 30;
        return segmentLength * (1 / 3 + blend / 6);
    }
    return segmentLength / 2.0;
}

function computeSmoothBezierSegments(knots: Knot[], closed: boolean = false): BezierSegment[] {
    const allPoints = closed ? [...knots.map(k => k.point), knots[0].point] : knots.map(k => k.point);
    const { outAngles, inAngles } = computeSmoothAngles(allPoints, closed);

    const segments: BezierSegment[] = [];
    const segmentCount = closed ? knots.length : knots.length - 1;

    for (let i = 0; i < segmentCount; i++) {
        const start = allPoints[i];
        const end = allPoints[i + 1];
        const knot = closed && i === segmentCount - 1 ? knots[0] : knots[i + 1];

        const segmentLength = start.distanceTo(end);
        const dist = computeControlPointDistance(segmentLength);

        let cp1: Point;
        let cp2: Point;

        if (knot.type === KnotType.LINE) {
            const delta = end.sub(start).mul(1 / 3);
            cp1 = start.add(delta);
            cp2 = end.sub(delta);
        } else {
            const outAngle = outAngles[i] * (Math.PI / 180);
            const inAngle = inAngles[i] * (Math.PI / 180);

            cp1 = new Point(
                start.x + dist * Math.cos(outAngle),
                start.y + dist * Math.sin(outAngle)
            );
            cp2 = new Point(
                end.x + dist * Math.cos(inAngle),
                end.y + dist * Math.sin(inAngle)
            );
        }

        segments.push([start, cp1, cp2, end]);
    }

    return segments;
}

interface HarmonicParams {
    amplitude: number;
    frequency: number;
    phase: number;
}

function generateHarmonics(count: number, freq: number, ampl: number): HarmonicParams[] {
    const harmonics: HarmonicParams[] = [];
    const weights: number[] = [];
    let totalWeight = 0;

    for (let i = 0; i < count; i++) {
        const weight = Math.random();
        weights.push(weight);
        totalWeight += weight;
    }

    for (let i = 0; i < count; i++) {
        let ph = Math.random() * Math.PI * 2;
        if (freq == 0) ph = Math.PI / 2;
        harmonics.push({
            amplitude: (weights[i] / totalWeight) * ampl,
            frequency: freq,
            phase: ph
        });
    }
    return harmonics;
}

function evaluateHarmonicRadius(angle: number, baseRadius: number, harmonics: HarmonicParams[], rotation: number = 0): number {
    let offset = 0;
    for (const h of harmonics) {
        offset += h.amplitude * Math.sin(h.frequency * (angle + rotation) + h.phase);
    }

    let minOffset = 0;
    for (let testAngle = 0; testAngle < Math.PI * 2; testAngle += 0.1) {
        let testOffset = 0;
        for (const h of harmonics) {
            testOffset += h.amplitude * Math.sin(h.frequency * (testAngle + rotation) + h.phase);
        }
        minOffset = Math.min(minOffset, testOffset);
    }

    return baseRadius + offset - minOffset;
}

function generateCircleKnots(
    height: number,
    startAngle: number,
    endAngle: number,
    harmonics: HarmonicParams[],
    rotation: number = 0
): Point[] {
    const baseRadius = height / 2
    const MAX_ARC_LENGTH = height * 0.4;

    const totalAngle = Math.abs(endAngle - startAngle);
    const estimatedArcLength = baseRadius * totalAngle;
    const minKnots = 4;
    const knotCount = Math.max(minKnots, Math.ceil(estimatedArcLength / MAX_ARC_LENGTH));

    const knots: Point[] = [];
    const angleStep = (endAngle - startAngle) / (knotCount - 1);

    for (let i = 0; i < knotCount; i++) {
        const angle = startAngle + i * angleStep;
        const radius = evaluateHarmonicRadius(angle, baseRadius, harmonics, rotation);
        const x = radius * Math.cos(angle);
        const y = -radius * Math.sin(angle);
        knots.push(new Point(x, y));
    }

    const maxY = Math.max(...knots.map(k => k.y));
    for (const knot of knots) {
        knot.y -= maxY;
    }

    return knots;
}

function applyFluffiness(cloud: Cloud, baseSegments: BezierSegment[]): BezierSegment[] {
    const midSegIdx = Math.floor(baseSegments.length / 2);
    const [refStart, refCp1, refCp2, refEnd] = baseSegments[midSegIdx];
    const refMidPoint = bezierPoint(refStart, refCp1, refCp2, refEnd, 0.5);
    const refTangent = bezierTangent(refStart, refCp1, refCp2, refEnd, 0.5);
    const refNormal = refTangent.perpendicular();

    const cloudCenter = new Point(cloud.centerX, cloud.centerY);
    const outward = refMidPoint.sub(cloudCenter);

    const dotProduct = refNormal.x * outward.x + refNormal.y * outward.y;
    const normalSign = dotProduct >= 0 ? 1 : -1;

    const fluffySegments: BezierSegment[] = [];

    for (const [start, cp1, cp2, end] of baseSegments) {
        const tangent = bezierTangent(start, cp1, cp2, end, 0.5);
        const normal = tangent.perpendicular().mul(normalSign);

        const segmentLength = start.distanceTo(end);
        const fluffFactor = cloud.cloudType === CloudType.CUMULUS ? 1 : 0;
        const fluffyOffset1 = (Math.random() * 4 + 2) * fluffFactor * (segmentLength / 15);
        const fluffyOffset2 = (Math.random() * 4 + 2) * fluffFactor * (segmentLength / 15);

        const newCp1 = cp1.add(normal.mul(fluffyOffset1));
        const newCp2 = cp2.add(normal.mul(fluffyOffset2));

        fluffySegments.push([start, newCp1, newCp2, end]);
    }

    return fluffySegments;
}

function transformCircleKnots(circleKnots: Point[], startX: number): Point[] {
    const positions: Point[] = [];

    for (const knot of circleKnots) {
        const x = startX + knot.x;
        positions.push(new Point(x, knot.y));
    }

    return positions;
}

function getBottomX(positions: Point[]): number {
    let bottomX = positions[0].x;
    let maxY = positions[0].y;
    for (const pos of positions) {
        if (pos.y > maxY) {
            maxY = pos.y;
            bottomX = pos.x;
        }
    }
    return bottomX;
}

function getRandomInt(min: number, max: number): number {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (1 + max - min)) + min;
}

class Cloud {
    text: string;
    x: number;
    y: number;
    textHeight: number;
    textAscent: number;
    textDescent: number;
    minHeight: number;
    cloudType: CloudType;

    private _textLeft: number;
    private _textRight: number;

    knots: Knot[] = [];
    segments: BezierSegment[] = [];
    textWidth: number = 0;
    rightSideCount: number = 0;
    bottomCount: number = 0;
    leftSideCount: number = 0;

    rotation: number = 0;
    leftHarmonics: HarmonicParams[] = [];
    rightHarmonics: HarmonicParams[] = [];

    constructor(text: string, x: number = 0, y: number = 0, cloudType?: CloudType) {
        this.text = text;
        this.x = x;
        this.y = y;

        const metrics = getTextMetrics(text, FONT_SIZE);

        this.cloudType = cloudType ?? (Math.random() > 0.5 ? CloudType.CUMULUS : CloudType.STRATOCUMULUS);

        this.textWidth = metrics.width + BOTTOM_INSET;
        this.textHeight = metrics.height;
        this.textAscent = metrics.ascent;
        this.textDescent = metrics.descent;

        this._textLeft = 0;
        this._textRight = this.textWidth;

        const VERTICAL_PADDING = 6
        this.minHeight = this.textHeight + VERTICAL_PADDING;

        if (this.textWidth < 20) {
            this.cloudType = CloudType.STRATOCUMULUS;
        }

        this.leftHarmonics = [
            ...generateHarmonics(1, 0, Math.random() * 5),
            ...generateHarmonics(1, 1, Math.random() * 3),
            ...generateHarmonics(getRandomInt(6, 8), 2, Math.random() * 3),
        ];
        this.rightHarmonics = [
            ...generateHarmonics(1, 0, Math.random() * 5),
            ...generateHarmonics(1, 1, Math.random() * 3),
            ...generateHarmonics(getRandomInt(6, 8), 2, Math.random() * 3),
        ];

        this.generateKnots();
    }

    private generateKnots(): void {
        const margin = 2;
        const knots: Knot[] = [];

        const rightCircle = generateCircleKnots(this.rightHeight, Math.PI / 2, -Math.PI / 2, this.rightHarmonics, this.rotation);
        const rightSide = transformCircleKnots(rightCircle, this._textRight + margin);

        const leftCircle = generateCircleKnots(this.leftHeight, -Math.PI / 2, -3 * Math.PI / 2, this.leftHarmonics, this.rotation);
        const leftSide = transformCircleKnots(leftCircle, this._textLeft - margin);

        for (let i = 0; i < rightSide.length; i++) {
            const knotType = KnotType.SMOOTH;
            knots.push(new Knot(rightSide[i], knotType));
        }
        this.rightSideCount = rightSide.length;

        for (let i = 0; i < leftSide.length; i++) {
            const knotType = (i === 0) ? KnotType.LINE : KnotType.SMOOTH;
            knots.push(new Knot(leftSide[i], knotType));
        }
        this.leftSideCount = leftSide.length;
        this.bottomCount = 0;

        this.knots = knots;
        this.segments = computeSmoothBezierSegments(this.knots, true);
    }

    getKnotLabel(index: number): string {
        if (index < this.rightSideCount) {
            if (index === 0) return 'T';
            if (index === this.rightSideCount - 1) return 'B';
            return 'R';
        } else {
            const leftIndex = index - this.rightSideCount;
            if (leftIndex === 0) return 'B';
            if (leftIndex === this.leftSideCount - 1) return 'T';
            return 'L';
        }
    }

    logKnotPositions(): void {
        console.log(`\n=== Cloud: "${this.text}" ===`);
        this.knots.forEach((knot, i) => {
            const label = this.getKnotLabel(i);
            console.log(`Knot ${i} (${label}): x=${knot.point.x.toFixed(2)}, y=${knot.point.y.toFixed(2)}`);
        });
    }

    get textLeft(): number { return this._textLeft; }
    get textRight(): number { return this._textRight; }
    get centerX(): number { return (this._textLeft + this._textRight) / 2; }
    get centerY(): number {
        const topLeft = this.getTopLeft();
        const topRight = this.getTopRight();
        const lowerTop = Math.max(topLeft.y, topRight.y);
        return lowerTop / 2;
    }

    get leftHeight(): number {
        const minRadius = this.textHeight / 2;
        const leftCircle = generateCircleKnots(minRadius * 2, -Math.PI / 2, -3 * Math.PI / 2, this.leftHarmonics, this.rotation);
        const minY = Math.min(...leftCircle.map(k => k.y));
        return Math.max(this.minHeight, -minY);
    }

    get rightHeight(): number {
        const minRadius = this.textHeight / 2;
        const rightCircle = generateCircleKnots(minRadius * 2, Math.PI / 2, -Math.PI / 2, this.rightHarmonics, this.rotation);
        const minY = Math.min(...rightCircle.map(k => k.y));
        return Math.max(this.minHeight, -minY);
    }

    getTopLeft(): Point {
        return new Point(this.textLeft, -this.leftHeight);
    }

    getTopRight(): Point {
        return new Point(this.textRight, -this.rightHeight);
    }

    updateRotation(deltaRotation: number): void {
        this.rotation += deltaRotation;
        this.generateKnots();
    }

    generateOutlinePath(): string {
        const pathParts: string[] = [];

        const firstKnot = this.knots[0].point;
        pathParts.push(`M ${firstKnot.x},${firstKnot.y}`);

        for (const [start, cp1, cp2, end] of this.segments) {
            pathParts.push(`C ${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${end.x},${end.y}`);
        }

        pathParts.push('Z');
        return pathParts.join(' ');
    }
}

interface CloudInstance {
    cloud: Cloud;
    groupElement: SVGGElement;
    pathElement: SVGPathElement;
    textElement: SVGTextElement;
}

class CloudRenderer {
    private debug: boolean = true;

    setDebug(enabled: boolean): void {
        this.debug = enabled;
    }

    createCloudElements(cloud: Cloud, svgElement: SVGSVGElement, onSelect: () => void): CloudInstance {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', `translate(${cloud.x}, ${cloud.y})`);
        g.style.cursor = 'pointer';

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.style.strokeWidth = String(STROKE_WIDTH);
        path.style.pointerEvents = 'all';

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.style.fontFamily = 'sans-serif';
        text.style.fontSize = `${FONT_SIZE}px`;
        text.style.textAnchor = 'middle';
        text.style.fill = '#000000';
        text.style.fillOpacity = '1';
        text.style.pointerEvents = 'none';

        g.appendChild(path);
        g.appendChild(text);

        g.addEventListener('click', (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            onSelect();
        }, true);

        svgElement.appendChild(g);

        return { cloud, groupElement: g, pathElement: path, textElement: text };
    }

    render(instance: CloudInstance): void {
        const { cloud, groupElement, pathElement, textElement } = instance;

        groupElement.setAttribute('transform', `translate(${cloud.x}, ${cloud.y})`);

        if (this.debug) {
            pathElement.style.fill = 'yellow';
            pathElement.style.stroke = 'red';
        } else {
            pathElement.style.fill = 'white';
            pathElement.style.stroke = '#000000';
            pathElement.style.strokeOpacity = '1';
            pathElement.style.strokeLinejoin = 'round';
        }

        const outlinePath = cloud.generateOutlinePath();
        pathElement.setAttribute('d', outlinePath);

        while (groupElement.childNodes.length > 2) {
            groupElement.removeChild(groupElement.lastChild!);
        }

        if (this.debug) {
            this.renderDebugInfo(cloud, groupElement);
        }

        this.renderText(cloud, textElement);
    }

    private renderDebugInfo(cloud: Cloud, groupElement: SVGGElement): void {
        const rightTopKnotIndex = 0;
        const leftTopKnotIndex = cloud.knots.length - 1;
        const rightTopKnot = cloud.knots[rightTopKnotIndex];
        const leftTopKnot = cloud.knots[leftTopKnotIndex];

        const leftLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        leftLabel.setAttribute('x', String(leftTopKnot.point.x - 5));
        leftLabel.setAttribute('y', String(leftTopKnot.point.y));
        leftLabel.setAttribute('font-size', '6');
        leftLabel.setAttribute('fill', '#0000ff');
        leftLabel.setAttribute('text-anchor', 'end');
        leftLabel.textContent = `L ${(-leftTopKnot.point.y).toFixed(1)}`;
        groupElement.appendChild(leftLabel);

        const rightLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        rightLabel.setAttribute('x', String(rightTopKnot.point.x + 5));
        rightLabel.setAttribute('y', String(rightTopKnot.point.y));
        rightLabel.setAttribute('font-size', '6');
        rightLabel.setAttribute('fill', '#0000ff');
        rightLabel.setAttribute('text-anchor', 'start');
        rightLabel.textContent = `R ${(-rightTopKnot.point.y).toFixed(1)}`;
        groupElement.appendChild(rightLabel);

        for (let j = 0; j < cloud.knots.length; j++) {
            const knot = cloud.knots[j];
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(knot.point.x));
            circle.setAttribute('cy', String(knot.point.y));
            circle.setAttribute('r', '1');
            circle.setAttribute('fill', 'red');
            circle.setAttribute('opacity', '0.5');
            groupElement.appendChild(circle);

            const posLabel = cloud.getKnotLabel(j);
            const knotLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            knotLabel.setAttribute('x', String(knot.point.x));
            knotLabel.setAttribute('y', String(knot.point.y + 7));
            knotLabel.setAttribute('font-size', '5');
            knotLabel.setAttribute('fill', 'purple');
            knotLabel.textContent = `${j}(${posLabel})`;
            groupElement.appendChild(knotLabel);
        }
    }

    private renderText(cloud: Cloud, textElement: SVGTextElement): void {
        const textX = cloud.textLeft + cloud.textWidth / 2;
        const lines = cloud.text.split('\\n');
        const lineHeight = cloud.textAscent + cloud.textDescent;
        const totalTextHeight = lines.length * lineHeight;
        const topLeft = cloud.getTopLeft();
        const topRight = cloud.getTopRight();
        const lowerTop = Math.max(topLeft.y, topRight.y);
        const centerY = lowerTop / 2;
        const firstBaselineY = centerY - totalTextHeight / 2 + cloud.textAscent;

        textElement.setAttribute('x', String(textX));
        textElement.innerHTML = '';
        for (let j = 0; j < lines.length; j++) {
            const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspan.setAttribute('x', String(textX));
            tspan.setAttribute('y', String(firstBaselineY + j * lineHeight));
            tspan.textContent = lines[j];
            textElement.appendChild(tspan);
        }
    }

    remove(instance: CloudInstance, svgElement: SVGSVGElement): void {
        svgElement.removeChild(instance.groupElement);
    }
}

class CloudManager {
    private instances: CloudInstance[] = [];
    private svgElement: SVGSVGElement | null = null;
    private container: HTMLElement | null = null;
    private renderer: CloudRenderer = new CloudRenderer();
    private zoom: number = 1;
    private canvasWidth: number = 800;
    private canvasHeight: number = 600;
    private panX: number = 0;
    private panY: number = 0;
    private animating: boolean = false;
    private animationFrameId: number | null = null;
    private lastFrameTime: number = 0;
    private selectedCloud: Cloud | null = null;

    init(containerId: string): void {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`Container ${containerId} not found`);
            return;
        }

        this.svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svgElement.setAttribute('width', String(this.canvasWidth));
        this.svgElement.setAttribute('height', String(this.canvasHeight));
        this.svgElement.setAttribute('viewBox', `0 0 ${this.canvasWidth} ${this.canvasHeight}`);
        this.svgElement.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        this.svgElement.style.border = '1px solid #ccc';
        this.svgElement.style.background = '#f0f0f0';

        this.container.appendChild(this.svgElement);
    }

    addCloud(word: string, x?: number, y?: number, cloudType?: CloudType): void {
        if (!this.svgElement) return;

        const cloudX = x ?? Math.random() * (this.canvasWidth - 200);
        const cloudY = y ?? this.canvasHeight / 2 + (Math.random() * 60 - 30);

        const cloud = new Cloud(word, cloudX, cloudY, cloudType);
        const instance = this.renderer.createCloudElements(
            cloud,
            this.svgElement,
            () => this.selectCloud(cloud)
        );
        this.instances.push(instance);
        this.renderer.render(instance);
    }

    setDebug(enabled: boolean): void {
        this.renderer.setDebug(enabled);
        this.renderAll();
    }

    setZoom(zoomLevel: number): void {
        this.zoom = Math.max(0.1, Math.min(5, zoomLevel));
        this.updateViewBox();
    }

    centerOnPoint(x: number, y: number): void {
        this.panX = x;
        this.panY = y;
        this.updateViewBox();
    }

    private updateViewBox(): void {
        const scaledWidth = this.canvasWidth / this.zoom;
        const scaledHeight = this.canvasHeight / this.zoom;
        const viewBoxX = this.panX - scaledWidth / 2;
        const viewBoxY = this.panY - scaledHeight / 2;
        this.svgElement?.setAttribute('viewBox', `${viewBoxX} ${viewBoxY} ${scaledWidth} ${scaledHeight}`);
    }

    clear(): void {
        if (!this.svgElement) return;
        for (const instance of this.instances) {
            this.renderer.remove(instance, this.svgElement);
        }
        this.instances = [];
    }

    startAnimation(): void {
        if (this.animating) return;
        this.animating = true;
        this.lastFrameTime = performance.now();
        this.animate();
    }

    stopAnimation(): void {
        this.animating = false;
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    selectCloud(cloud: Cloud): void {
        this.selectedCloud = cloud;
        cloud.logKnotPositions();
        this.updateControlsPanel();
        const centerX = cloud.centerX + cloud.x;
        const centerY = cloud.centerY + cloud.y;
        this.centerOnPoint(centerX, centerY);
    }

    private updateControlsPanel(): void {
        const knotPositionsEl = document.getElementById('knot-positions');

        if (!knotPositionsEl) return;

        if (!this.selectedCloud) {
            knotPositionsEl.textContent = 'No cloud selected';
            return;
        }

        const cloud = this.selectedCloud;

        const leftCircleKnots = generateCircleKnots(cloud.leftHeight, -Math.PI / 2, -3 * Math.PI / 2, cloud.leftHarmonics, cloud.rotation);
        const rightCircleKnots = generateCircleKnots(cloud.rightHeight, Math.PI / 2, -Math.PI / 2, cloud.rightHarmonics, cloud.rotation);

        let html = `<strong>Selected: ${cloud.text}</strong><br>`;
        html += `<strong>Rotation:</strong> ${cloud.rotation.toFixed(3)} rad<br><br>`;

        html += `<div style="display: flex; gap: 1em;">`;

        html += `<div style="flex: 1;">`;
        html += `<strong style="color: blue;">Left Circle Knots:</strong><br>`;
        html += `<svg width="150" height="150" style="border: 1px dotted blue; background: #f9f9f9;">`;
        const leftMaxY = Math.max(...leftCircleKnots.map(k => Math.abs(k.y)));
        const leftScale = 60 / leftMaxY;

        const leftBaseRadius = cloud.leftHeight / 2;
        let leftContour = '';
        for (let angle = 0; angle < 2 * Math.PI; angle += 0.05) {
            const radius = evaluateHarmonicRadius(angle, leftBaseRadius, cloud.leftHarmonics, cloud.rotation);
            const px = 75 + (radius * Math.cos(angle)) * leftScale;
            const py = 75 - (radius * Math.sin(angle)) * leftScale;
            leftContour += (leftContour ? ' L' : 'M') + ` ${px},${py}`;
        }
        html += `<path d="${leftContour}" fill="none" stroke="cyan" stroke-width="1.5" opacity="0.6"/>`;

        leftCircleKnots.forEach((knot, i) => {
            const x = 75 + knot.x * leftScale;
            const y = 75 - knot.y * leftScale;
            html += `<circle cx="${x}" cy="${y}" r="2" fill="blue"/>`;
            html += `<text x="${x + 5}" y="${y}" font-size="8" fill="blue">${i}</text>`;
        });
        const rotX = 75 + 60 * Math.cos(cloud.rotation);
        const rotY = 75 - 60 * Math.sin(cloud.rotation);
        html += `<line x1="75" y1="75" x2="${rotX}" y2="${rotY}" stroke="blue" stroke-width="1.5"/>`;
        html += `<circle cx="75" cy="75" r="60" fill="none" stroke="blue" stroke-dasharray="2,2" opacity="0.3"/>`;
        html += `</svg>`;
        html += `</div>`;

        html += `<div style="flex: 1;">`;
        html += `<strong style="color: green;">Right Circle Knots:</strong><br>`;
        html += `<svg width="150" height="150" style="border: 1px dotted green; background: #f9f9f9;">`;
        const rightMaxY = Math.max(...rightCircleKnots.map(k => Math.abs(k.y)));
        const rightScale = 60 / rightMaxY;

        const rightBaseRadius = cloud.rightHeight / 2;
        let rightContour = '';
        for (let angle = 0; angle < 2 * Math.PI; angle += 0.05) {
            const radius = evaluateHarmonicRadius(angle, rightBaseRadius, cloud.rightHarmonics, cloud.rotation);
            const px = 75 + (radius * Math.cos(angle)) * rightScale;
            const py = 75 - (radius * Math.sin(angle)) * rightScale;
            rightContour += (rightContour ? ' L' : 'M') + ` ${px},${py}`;
        }
        html += `<path d="${rightContour}" fill="none" stroke="lime" stroke-width="1.5" opacity="0.6"/>`;

        rightCircleKnots.forEach((knot, i) => {
            const x = 75 + knot.x * rightScale;
            const y = 75 - knot.y * rightScale;
            html += `<circle cx="${x}" cy="${y}" r="2" fill="green"/>`;
            html += `<text x="${x + 5}" y="${y}" font-size="8" fill="green">${i}</text>`;
        });
        const rotX2 = 75 + 60 * Math.cos(cloud.rotation);
        const rotY2 = 75 - 60 * Math.sin(cloud.rotation);
        html += `<line x1="75" y1="75" x2="${rotX2}" y2="${rotY2}" stroke="green" stroke-width="1.5"/>`;
        html += `<circle cx="75" cy="75" r="60" fill="none" stroke="green" stroke-dasharray="2,2" opacity="0.3"/>`;
        html += `</svg>`;
        html += `</div>`;

        html += `</div><br>`;

        knotPositionsEl.innerHTML = html;
    }

    private animate(): void {
        if (!this.animating) return;

        const currentTime = performance.now();
        const deltaTime = (currentTime - this.lastFrameTime) / 1000;
        this.lastFrameTime = currentTime;

        const rotationSpeed = 0.1;
        const deltaRotation = rotationSpeed * deltaTime;

        for (const instance of this.instances) {
            instance.cloud.updateRotation(deltaRotation);
        }

        this.renderAll();
        this.animationFrameId = requestAnimationFrame(() => this.animate());
    }

    private renderAll(): void {
        for (const instance of this.instances) {
            this.renderer.render(instance);
        }
    }
}

export { CloudManager, CloudType };
