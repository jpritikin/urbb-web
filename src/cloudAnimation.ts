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

function bezierArcLength(segments: BezierSegment[], numSamples = 20): number {
    let totalLength = 0;
    for (const [start, cp1, cp2, end] of segments) {
        let prevPoint = start;
        for (let i = 1; i <= numSamples; i++) {
            const t = i / numSamples;
            const point = bezierPoint(start, cp1, cp2, end, t);
            const dx = point.x - prevPoint.x;
            const dy = point.y - prevPoint.y;
            totalLength += Math.sqrt(dx * dx + dy * dy);
            prevPoint = point;
        }
    }
    return totalLength;
}

function findPointAtArcLength(segments: BezierSegment[], targetLength: number, numSamples = 20): { point: Point; tangent: Point } | null {
    let accumulatedLength = 0;

    for (const [start, cp1, cp2, end] of segments) {
        let prevPoint = start;

        for (let i = 1; i <= numSamples; i++) {
            const t = i / numSamples;
            const point = bezierPoint(start, cp1, cp2, end, t);
            const dx = point.x - prevPoint.x;
            const dy = point.y - prevPoint.y;
            const segmentLen = Math.sqrt(dx * dx + dy * dy);

            if (accumulatedLength + segmentLen >= targetLength) {
                const ratio = segmentLen > 0 ? (targetLength - accumulatedLength) / segmentLen : 0;
                const interpolatedT = ((i - 1) + ratio) / numSamples;
                const resultPoint = bezierPoint(start, cp1, cp2, end, interpolatedT);
                const resultTangent = bezierTangent(start, cp1, cp2, end, interpolatedT);
                return { point: resultPoint, tangent: resultTangent };
            }

            accumulatedLength += segmentLen;
            prevPoint = point;
        }
    }

    return null;
}

function getTextMetrics(text: string, fontSize: number): { width: number; height: number; advances: number[] } {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = `${fontSize}px sans-serif`;

    const metrics = ctx.measureText(text);
    const width = metrics.width;
    const height = fontSize * 1.2;

    const advances: number[] = [];
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const charMetrics = ctx.measureText(char);
        advances.push(charMetrics.width);
    }

    return { width, height, advances };
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

        const minY = (Math.max(leftKnot.y, rightKnot.y) * 2 + cloud.bottomY) / 3;
        const avgY = (leftKnot.y + rightKnot.y) / 2;
        const newY = Math.min(minY, avgY + (Math.random() * 45 - 20));

        result.splice(gapIndex + 1, 0, new Point(newX, newY));
    }

    return result;
}

function removeCloseKnots(knots: Point[]): Point[] {
    const result = [...knots];
    let i = 1;

    while (i < result.length - 1) {
        const gapToPrev = result[i].x - result[i - 1].x;
        const gapToNext = result[i + 1].x - result[i].x;

        if (gapToPrev < MIN_GAP || gapToNext < MIN_GAP) {
            result.splice(i, 1);
        } else {
            i++;
        }
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

function computeSmoothAngles(points: Point[]): { outAngles: number[]; inAngles: number[] } {
    const outAngles: number[] = [];
    const inAngles: number[] = [];

    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i];
        const end = points[i + 1];

        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const directAngle = Math.atan2(dy, dx) * (180 / Math.PI);

        const noise = Math.random() * 10 - 5;

        const outAngle = directAngle + noise;
        const inAngle = directAngle + 180 + noise;

        outAngles.push(outAngle);
        inAngles.push(inAngle);
    }

    for (let i = 0; i < outAngles.length - 1; i++) {
        let currentIn = inAngles[i];
        const currentOut = outAngles[i + 1];
        currentIn = (currentIn - 180) > currentOut ? (currentIn - 180) : (currentIn + 180);

        let diff = normalizeAngle(currentIn - currentOut);
        if (diff > 90) {
            diff = 180 - diff;
        } else if (diff < -90) {
            diff = -180 - diff;
        }

        const adjustment = diff / 2;

        inAngles[i] = inAngles[i] - adjustment;
        outAngles[i + 1] = outAngles[i + 1] + adjustment;
    }

    return { outAngles, inAngles };
}

function computeSmoothBezierSegments(knots: Knot[]): BezierSegment[] {
    const allPoints = knots.map(k => k.point);
    const { outAngles, inAngles } = computeSmoothAngles(allPoints);

    const segments: BezierSegment[] = [];

    for (let i = 0; i < allPoints.length - 1; i++) {
        const start = allPoints[i];
        const end = allPoints[i + 1];
        const knot = knots[i + 1];

        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const segmentLength = Math.sqrt(dx * dx + dy * dy);

        let dist: number;
        if (segmentLength < 30) {
            dist = segmentLength / 3.0;
        } else if (segmentLength < 60) {
            const blendFactor = (segmentLength - 30) / 30;
            const smallDist = segmentLength / 3.0;
            const normalDist = segmentLength / 2.0;
            dist = smallDist + blendFactor * (normalDist - smallDist);
        } else {
            dist = segmentLength / 2.0;
        }

        let cp1: Point;
        let cp2: Point;

        if (knot.type === KnotType.LINE) {
            cp1 = new Point(start.x + dx / 3.0, start.y + dy / 3.0);
            cp2 = new Point(end.x - dx / 3.0, end.y - dy / 3.0);
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

function generateSideKnots(startAngle: number, targetHeight: number, endAngle: number): Point[] {
    const baseHeight = 25.0;
    const baseStep = Math.PI / 4;
    const angleStep = Math.min(0.85, baseStep * Math.pow(baseHeight / targetHeight, 0.5));

    const knots: Point[] = [];
    let currentAngle = startAngle;

    const INITIAL_LENGTH = 5;
    const LENGTH_STEP = 2 * INITIAL_LENGTH / 5;
    let slen = 5 + LENGTH_STEP * Math.abs((startAngle - endAngle) / angleStep);

    while (Math.abs(endAngle - (currentAngle + angleStep)) > Math.abs(angleStep)) {
        const stepDistance = slen;
        slen -= LENGTH_STEP;
        currentAngle += angleStep;
        const dx = stepDistance * Math.cos(currentAngle);
        const dy = stepDistance * Math.sin(currentAngle);
        knots.push(new Point(dx, dy));
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

        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const segmentLength = Math.sqrt(dx * dx + dy * dy);

        const fluffFactor = cloud.cloudType === CloudType.CUMULUS ? 1 : 0;
        const fluffyOffset1 = (Math.random() * 4 + 2) * fluffFactor * (segmentLength / 15);
        const fluffyOffset2 = (Math.random() * 4 + 2) * fluffFactor * (segmentLength / 15);

        const newCp1 = cp1.add(normal.mul(fluffyOffset1));
        const newCp2 = cp2.add(normal.mul(fluffyOffset2));

        fluffySegments.push([start, newCp1, newCp2, end]);
    }

    return fluffySegments;
}

class Cloud {
    word: string;
    centerY: number;
    xOffset: number = 0;
    yOffset: number = 0;
    textHeight: number;
    leftHeight: number;
    rightHeight: number;
    bottomY: number;
    cloudType: CloudType;

    private _textLeft: number;
    private _textRight: number;
    private _textTop: number;
    private _textBottom: number;

    wavyKnots: Point[] = [];
    topSegments: BezierSegment[] = [];
    knots: Knot[] = [];
    baseSegments: BezierSegment[] = [];
    centerX: number = 0;
    textWidth: number = 0;
    rightSideCount: number = 0;
    bottomCount: number = 0;
    leftSideCount: number = 0;

    constructor(word: string, leftX: number, centerY: number, cloudType: CloudType = CloudType.CUMULUS) {
        this.word = word;
        this.centerY = centerY;
        this.cloudType = cloudType;

        const metrics = getTextMetrics(word, FONT_SIZE);
        const textWidth = metrics.width;
        this.textHeight = metrics.height;

        this._textLeft = leftX;
        this._textRight = leftX + textWidth;
        this._textTop = centerY - this.textHeight / 2;
        this._textBottom = centerY + this.textHeight / 2;

        const minHeight = 25;

        if (textWidth < 20) {
            this.cloudType = CloudType.STRATOCUMULUS;
            this.leftHeight = minHeight;
            this.rightHeight = minHeight;
        } else {
            this.leftHeight = Math.random() * 10 + minHeight;
            this.rightHeight = Math.random() * 10 + minHeight;
        }

        this.bottomY = this._textBottom + Math.max(this.leftHeight, this.rightHeight);

        this.generateWavyPath(textWidth);
        this.generateBottomKnots();

        this.centerX = (this._textLeft + this._textRight) / 2;
        this.textWidth = this._textRight - this._textLeft;

        const topKnots = [
            new Knot(this.getTopLeft(), KnotType.SMOOTH),
            new Knot(this.getTopRight(), KnotType.LINE)
        ];
        const topBaseSegments = computeSmoothBezierSegments(topKnots);
        this.topSegments = topBaseSegments;

        const baseSegments = computeSmoothBezierSegments(this.knots);
        this.baseSegments = baseSegments;
    }

    private generateWavyPath(textWidth: number): void {
        const start = this.getTopLeft();
        const end = this.getTopRight();

        let knots = [start, end];
        knots = subdivideKnots(knots, this);

        const maxIterations = 20;
        for (let iteration = 0; iteration < maxIterations; iteration++) {
            const knotObjects = knots.map(k => new Knot(k, KnotType.SMOOTH));
            const segments = computeSmoothBezierSegments(knotObjects);
            const arcLength = bezierArcLength(segments);

            const ratio = textWidth / arcLength;

            if (1 > ratio && ratio > 0.97) {
                break;
            }

            const scaledKnots = [start];
            for (let i = 1; i < knots.length; i++) {
                const knot = knots[i];
                const dx = knot.x - start.x;
                const scaledX = start.x + dx * (ratio + 0.005);
                scaledKnots.push(new Point(scaledX, knot.y));
            }

            knots = scaledKnots;

            if (ratio < 1.0) {
                knots = removeCloseKnots(knots);
            }

            if (ratio > 1.0) {
                knots = subdivideKnots(knots, this);
            }
        }

        this._textRight = knots[knots.length - 1].x;
        this.wavyKnots = knots;
    }

    private generateBottomKnots(): void {
        const margin = 2;
        const knots: Knot[] = [];

        const rightDeltas = generateSideKnots(0, this.rightHeight, Math.PI - (Math.random() * 0.1 - 0.05) * Math.PI);

        const totalDy = rightDeltas.reduce((sum, d) => sum + d.y, 0);
        const requiredDy = -(this.rightHeight);
        const scaleY = Math.abs(totalDy) > 0.1 ? requiredDy / totalDy : 1.0;

        const totalDx = rightDeltas.reduce((sum, d) => sum + d.x, 0);
        const xOffsetRight = (this._textRight + margin) - totalDx;

        const rightStart = new Point(xOffsetRight, this.bottomY);
        const rightPositions: Point[] = [];
        let currentPos = rightStart;

        for (const delta of rightDeltas) {
            const scaledDelta = new Point(delta.x, delta.y * scaleY);
            currentPos = currentPos.add(scaledDelta);
            rightPositions.push(currentPos);
        }

        rightPositions.reverse();
        const rightTop = rightPositions[0];
        const rightBottom = rightPositions[rightPositions.length - 1];

        const leftDeltas = generateSideKnots(0, this.leftHeight, Math.PI - (Math.random() * 0.1 - 0.05) * Math.PI);
        const reflectedDeltas = leftDeltas.map(d => new Point(-d.x, d.y));

        const totalDyLeft = reflectedDeltas.reduce((sum, d) => sum + d.y, 0);
        const requiredDyLeft = -(this.leftHeight);
        const scaleYLeft = Math.abs(totalDyLeft) > 0.1 ? requiredDyLeft / totalDyLeft : 1.0;

        const totalDxLeft = reflectedDeltas.reduce((sum, d) => sum + d.x, 0);
        const xOffsetLeft = (this._textLeft - margin) - totalDxLeft;

        const leftStart = new Point(xOffsetLeft, this.bottomY);
        const leftPositions: Point[] = [];
        currentPos = leftStart;

        for (const delta of reflectedDeltas) {
            const scaledDelta = new Point(delta.x, delta.y * scaleYLeft);
            currentPos = currentPos.add(scaledDelta);
            leftPositions.push(currentPos);
        }

        const leftTop = leftPositions[leftPositions.length - 1];
        const leftBottom = leftPositions[0];

        const inset = 15;
        const rightBottomInset = new Point(rightBottom.x - inset, this.bottomY);
        const leftBottomInset = new Point(leftBottom.x + inset, this.bottomY);

        if (rightBottomInset.x <= leftBottomInset.x) {
            for (let i = 0; i < rightPositions.length - 1; i++) {
                knots.push(new Knot(rightPositions[i], KnotType.SMOOTH));
            }
            this.rightSideCount = rightPositions.length - 1;

            const centerX = (rightBottom.x + leftBottom.x) / 2;
            const maxRightX = Math.max(...rightPositions.map(p => p.x));
            const minLeftX = Math.min(...leftPositions.map(p => p.x));
            const rightCenter = new Point((centerX + maxRightX) / 2, this.bottomY);
            const leftCenter = new Point((centerX + minLeftX) / 2, this.bottomY);
            knots.push(new Knot(rightCenter, KnotType.SMOOTH));
            knots.push(new Knot(leftCenter, KnotType.LINE));
            this.bottomCount = 1;

            for (let i = 1; i < leftPositions.length; i++) {
                knots.push(new Knot(leftPositions[i], KnotType.SMOOTH));
            }
            this.leftSideCount = leftPositions.length - 1;
        } else {
            for (const pos of rightPositions) {
                knots.push(new Knot(pos, KnotType.SMOOTH));
            }
            this.rightSideCount = rightPositions.length;

            knots.push(new Knot(rightBottomInset, KnotType.SMOOTH));
            knots.push(new Knot(leftBottomInset, KnotType.LINE));
            this.bottomCount = 1;

            for (const pos of leftPositions) {
                knots.push(new Knot(pos, KnotType.SMOOTH));
            }
            this.leftSideCount = leftPositions.length;
        }

        this.knots = knots;
    }

    move(newLeftX: number, newCenterY: number): void {
        this.xOffset = newLeftX - this._textLeft;
        this.yOffset = newCenterY - this.centerY;
    }

    get textLeft(): number { return this._textLeft + this.xOffset; }
    get textRight(): number { return this._textRight + this.xOffset; }
    get textTop(): number { return this._textTop + this.yOffset; }
    get textBottom(): number { return this._textBottom + this.yOffset; }
    get wavyTop(): number { return Math.min(...this.wavyKnots.map(k => k.y)) + this.yOffset; }
    get tippyTop(): number { return this.wavyTop - this.textHeight - 5; }
    get bottomYOffset(): number { return this.bottomY + this.yOffset; }

    getTopLeft(): Point {
        return new Point(this.textLeft, this.bottomYOffset - this.leftHeight);
    }

    getTopRight(): Point {
        return new Point(this.textRight, this.bottomYOffset - this.rightHeight);
    }

    toSVG(idx: number, debug: boolean = false): string {
        const elements: string[] = [];

        const outlinePath = this.generateOutlinePath();

        if (debug) {
            elements.push(`<path style="fill:yellow;stroke:red;stroke-width:${STROKE_WIDTH}" d="${outlinePath}" />`);
        } else {
            elements.push(`<path style="fill:white;stroke:#000000;stroke-width:${STROKE_WIDTH};stroke-opacity:1;stroke-linejoin:round" d="${outlinePath}" />`);
        }

        const textX = this.textLeft + this.textWidth / 2;
        const lines = this.word.split('\\n');
        const lineHeight = FONT_SIZE * 1.2;
        const totalTextHeight = lines.length * lineHeight;
        const textBottomMargin = 8;
        const startY = this.bottomYOffset - totalTextHeight - textBottomMargin;

        elements.push(`<text x="${textX}" font-family="sans-serif" font-size="${FONT_SIZE}" text-anchor="middle" style="fill:#000000;fill-opacity:1">`);
        for (let i = 0; i < lines.length; i++) {
            const y = startY + (i + 0.8) * lineHeight;
            elements.push(`<tspan x="${textX}" y="${y}">${lines[i]}</tspan>`);
        }
        elements.push(`</text>`);

        if (debug) {
            const topLeft = this.getTopLeft();
            const topRight = this.getTopRight();

            elements.push(`<text x="${topLeft.x - 5}" y="${topLeft.y}" font-size="6" fill="#0000ff" text-anchor="end">L ${this.leftHeight.toFixed(1)}</text>`);
            elements.push(`<text x="${topRight.x + 5}" y="${topRight.y}" font-size="6" fill="#0000ff" text-anchor="start">R ${this.rightHeight.toFixed(1)}</text>`);

            for (let i = 0; i < this.knots.length; i++) {
                const knot = this.knots[i];
                elements.push(`<circle cx="${knot.point.x + this.xOffset}" cy="${knot.point.y + this.yOffset}" r="1" fill="red" opacity="0.5"/>`);
                elements.push(`<text x="${knot.point.x + this.xOffset}" y="${knot.point.y + this.yOffset + 7}" font-size="5" fill="purple">${i}</text>`);
            }
        }

        return elements.join('\n');
    }

    private generateOutlinePath(): string {
        const pathParts: string[] = [];

        const topLeft = this.getTopLeft();
        pathParts.push(`M ${topLeft.x},${topLeft.y}`);

        for (const [start, cp1, cp2, end] of this.topSegments) {
            const cp1Abs = new Point(cp1.x + this.xOffset, cp1.y + this.yOffset);
            const cp2Abs = new Point(cp2.x + this.xOffset, cp2.y + this.yOffset);
            const endAbs = new Point(end.x + this.xOffset, end.y + this.yOffset);
            pathParts.push(`C ${cp1Abs.x},${cp1Abs.y} ${cp2Abs.x},${cp2Abs.y} ${endAbs.x},${endAbs.y}`);
        }

        for (const [start, cp1, cp2, end] of this.baseSegments) {
            const cp1Abs = new Point(cp1.x + this.xOffset, cp1.y + this.yOffset);
            const cp2Abs = new Point(cp2.x + this.xOffset, cp2.y + this.yOffset);
            const endAbs = new Point(end.x + this.xOffset, end.y + this.yOffset);
            pathParts.push(`C ${cp1Abs.x},${cp1Abs.y} ${cp2Abs.x},${cp2Abs.y} ${endAbs.x},${endAbs.y}`);
        }

        pathParts.push('Z');
        return pathParts.join(' ');
    }
}

class CloudManager {
    private clouds: Cloud[] = [];
    private svgElement: SVGSVGElement | null = null;
    private container: HTMLElement | null = null;
    private debug: boolean = true;
    private zoom: number = 1;
    private canvasWidth: number = 800;
    private canvasHeight: number = 600;
    private panX: number = 0;
    private panY: number = 0;

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
        const cloudX = x ?? Math.random() * (this.canvasWidth - 200);
        const cloudY = y ?? this.canvasHeight / 2 + (Math.random() * 60 - 30);
        const type = cloudType ?? (Math.random() > 0.5 ? CloudType.CUMULUS : CloudType.STRATOCUMULUS);

        const cloud = new Cloud(word, cloudX, cloudY, type);
        this.clouds.push(cloud);
        this.render();
    }

    setDebug(enabled: boolean): void {
        this.debug = enabled;
        this.render();
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
        this.clouds = [];
        this.render();
    }

    private render(): void {
        if (!this.svgElement) return;

        this.svgElement.innerHTML = '';

        for (let i = 0; i < this.clouds.length; i++) {
            const cloud = this.clouds[i];
            const svgContent = cloud.toSVG(i, this.debug);

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.innerHTML = svgContent;
            g.style.cursor = 'pointer';
            g.addEventListener('click', () => {
                this.centerOnPoint(cloud.centerX + cloud.xOffset, cloud.centerY + cloud.yOffset);
            });
            this.svgElement.appendChild(g);
        }
    }
}

export { CloudManager, CloudType };
