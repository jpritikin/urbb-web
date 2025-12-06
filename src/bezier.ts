import { Point, Knot, KnotType } from './geometry.js';

export type BezierSegment = [Point, Point, Point, Point];

export function bezierPoint(start: Point, cp1: Point, cp2: Point, end: Point, t: number): Point {
    const t2 = t * t;
    const t3 = t2 * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;

    const x = mt3 * start.x + 3 * mt2 * t * cp1.x + 3 * mt * t2 * cp2.x + t3 * end.x;
    const y = mt3 * start.y + 3 * mt2 * t * cp1.y + 3 * mt * t2 * cp2.y + t3 * end.y;

    return new Point(x, y);
}

export function bezierTangent(start: Point, cp1: Point, cp2: Point, end: Point, t: number): Point {
    const mt = 1 - t;
    const tangent = new Point(
        3 * mt * mt * (cp1.x - start.x) + 6 * mt * t * (cp2.x - cp1.x) + 3 * t * t * (end.x - cp2.x),
        3 * mt * mt * (cp1.y - start.y) + 6 * mt * t * (cp2.y - cp1.y) + 3 * t * t * (end.y - cp2.y)
    );
    return tangent.normalize();
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

export function computeSmoothBezierSegments(knots: Knot[], closed: boolean = false): BezierSegment[] {
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
