export const STAR_RADIUS_SCALE = 4;
export const STAR_OUTER_RADIUS = 20 * STAR_RADIUS_SCALE;
export const STAR_INNER_RADIUS = 8 * STAR_RADIUS_SCALE;

export const THREE_ARM_INNER_RADIUS_FACTOR = 0.5;

export interface Point {
    x: number;
    y: number;
}

export interface ArmGeometry {
    tipX: number;
    tipY: number;
    base1X: number;
    base1Y: number;
    base2X: number;
    base2Y: number;
}

export interface TransitionResult {
    tipX: number;
    tipY: number;
    base1X: number;
    base1Y: number;
    base2X: number;
    base2Y: number;
}

export interface TransitionContext {
    type: 'adding' | 'removing';
    progress: number;
    sourceArmIndex: number;
    armCount: number;
    rotation: number;
    centerX: number;
    centerY: number;
    innerRadius: number;
    outerRadius: number;
}

export function dist(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

export function angle(fromX: number, fromY: number, toX: number, toY: number): number {
    return Math.atan2(toY - fromY, toX - fromX);
}

export function normalizeAngle(a: number): number {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}

export function lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t;
}

export function getArmGeometry(
    centerX: number,
    centerY: number,
    tipAngle: number,
    halfStep: number,
    innerR: number,
    outerR: number
): ArmGeometry {
    return {
        tipX: centerX + outerR * Math.cos(tipAngle),
        tipY: centerY + outerR * Math.sin(tipAngle),
        base1X: centerX + innerR * Math.cos(tipAngle - halfStep),
        base1Y: centerY + innerR * Math.sin(tipAngle - halfStep),
        base2X: centerX + innerR * Math.cos(tipAngle + halfStep),
        base2Y: centerY + innerR * Math.sin(tipAngle + halfStep),
    };
}

export function computeTransitionPosition(ctx: TransitionContext): TransitionResult {
    const { type, progress, sourceArmIndex, armCount, rotation, centerX, centerY, innerRadius, outerRadius } = ctx;

    const baseAngleStep = (2 * Math.PI) / armCount;
    const baseHalfStep = baseAngleStep / 2;
    const phase1End = 0.5;

    let tipX: number, tipY: number;
    let base1X: number, base1Y: number;
    let base2X: number, base2Y: number;

    if (type === 'removing') {
        const srcAngle = rotation - Math.PI / 2 + sourceArmIndex * baseAngleStep;
        const src = getArmGeometry(centerX, centerY, srcAngle, baseHalfStep, innerRadius, outerRadius);
        const adjAngle = srcAngle + baseAngleStep;
        const adj = getArmGeometry(centerX, centerY, adjAngle, baseHalfStep, innerRadius, outerRadius);

        const tipDistFromS2 = dist(src.tipX, src.tipY, src.base2X, src.base2Y);
        const base1DistFromS2 = dist(src.base1X, src.base1Y, src.base2X, src.base2Y);
        const tipAngleFromS2Start = angle(src.base2X, src.base2Y, src.tipX, src.tipY);
        const base1AngleFromS2Start = angle(src.base2X, src.base2Y, src.base1X, src.base1Y);
        const tipAngleFromS2End = angle(src.base2X, src.base2Y, adj.tipX, adj.tipY);
        const phase1Rotation = normalizeAngle(tipAngleFromS2End - tipAngleFromS2Start);

        if (progress < phase1End) {
            const t = progress / phase1End;
            const rot = phase1Rotation * t;
            base2X = src.base2X;
            base2Y = src.base2Y;
            tipX = src.base2X + tipDistFromS2 * Math.cos(tipAngleFromS2Start + rot);
            tipY = src.base2Y + tipDistFromS2 * Math.sin(tipAngleFromS2Start + rot);
            base1X = src.base2X + base1DistFromS2 * Math.cos(base1AngleFromS2Start + rot);
            base1Y = src.base2Y + base1DistFromS2 * Math.sin(base1AngleFromS2Start + rot);
        } else {
            const t = (progress - phase1End) / (1 - phase1End);
            const adjIndex = (sourceArmIndex + 1) % armCount;
            const targetAngleStep = (2 * Math.PI) / (armCount - 1);
            const targetHalfStep = targetAngleStep / 2;

            const adjStartAngle = rotation - Math.PI / 2 + adjIndex * baseAngleStep;
            // Adjacent arm's new index: arms after sourceArmIndex shift back by 1
            const newAdjIndex = adjIndex > sourceArmIndex ? adjIndex - 1 : adjIndex;
            const adjEndAngle = rotation - Math.PI / 2 + newAdjIndex * targetAngleStep;
            const adjCurrentAngle = lerp(adjStartAngle, adjEndAngle, t);

            tipX = centerX + outerRadius * Math.cos(adjCurrentAngle);
            tipY = centerY + outerRadius * Math.sin(adjCurrentAngle);

            const base1AtP1End = {
                x: src.base2X + base1DistFromS2 * Math.cos(base1AngleFromS2Start + phase1Rotation),
                y: src.base2Y + base1DistFromS2 * Math.sin(base1AngleFromS2Start + phase1Rotation)
            };

            const base1DistStart = dist(base1AtP1End.x, base1AtP1End.y, adj.tipX, adj.tipY);
            const base2DistStart = dist(src.base2X, src.base2Y, adj.tipX, adj.tipY);
            const base1AngleStart = angle(adj.tipX, adj.tipY, base1AtP1End.x, base1AtP1End.y);
            const base2AngleStart = angle(adj.tipX, adj.tipY, src.base2X, src.base2Y);

            const adjEnd = getArmGeometry(centerX, centerY, adjEndAngle, targetHalfStep, innerRadius, outerRadius);
            const base1DistEnd = dist(adjEnd.base1X, adjEnd.base1Y, adjEnd.tipX, adjEnd.tipY);
            const base2DistEnd = dist(adjEnd.base2X, adjEnd.base2Y, adjEnd.tipX, adjEnd.tipY);
            const base1AngleEnd = angle(adjEnd.tipX, adjEnd.tipY, adjEnd.base1X, adjEnd.base1Y);
            const base2AngleEnd = angle(adjEnd.tipX, adjEnd.tipY, adjEnd.base2X, adjEnd.base2Y);

            const base1Rot = normalizeAngle(base1AngleEnd - base1AngleStart) + 2 * Math.PI;
            const base2Rot = normalizeAngle(base2AngleEnd - base2AngleStart) + 2 * Math.PI;

            base1X = tipX + lerp(base1DistStart, base1DistEnd, t) * Math.cos(base1AngleStart + base1Rot * t);
            base1Y = tipY + lerp(base1DistStart, base1DistEnd, t) * Math.sin(base1AngleStart + base1Rot * t);
            base2X = tipX + lerp(base2DistStart, base2DistEnd, t) * Math.cos(base2AngleStart + base2Rot * t);
            base2Y = tipY + lerp(base2DistStart, base2DistEnd, t) * Math.sin(base2AngleStart + base2Rot * t);
        }
    } else {
        const targetArmCount = armCount + 1;
        const targetAngleStep = (2 * Math.PI) / targetArmCount;
        const targetHalfStep = targetAngleStep / 2;

        const adjIndex = sourceArmIndex;
        const adjStartAngle = rotation - Math.PI / 2 + adjIndex * baseAngleStep;
        const adj = getArmGeometry(centerX, centerY, adjStartAngle, baseHalfStep, innerRadius, outerRadius);

        const finalTipAngle = rotation - Math.PI / 2 + sourceArmIndex * targetAngleStep;
        const final = getArmGeometry(centerX, centerY, finalTipAngle, targetHalfStep, innerRadius, outerRadius);

        if (progress < phase1End) {
            const t = progress / phase1End;
            tipX = adj.tipX;
            tipY = adj.tipY;

            const base1AngleStart = angle(tipX, tipY, adj.base1X, adj.base1Y);
            const base2AngleStart = angle(tipX, tipY, adj.base2X, adj.base2Y);
            const base2AngleEnd = angle(tipX, tipY, adj.base1X, adj.base1Y);
            const baseDist = dist(adj.base1X, adj.base1Y, tipX, tipY);

            const rot = normalizeAngle(base2AngleEnd - base2AngleStart) - 2 * Math.PI;

            base1X = tipX + baseDist * Math.cos(base1AngleStart + rot * t);
            base1Y = tipY + baseDist * Math.sin(base1AngleStart + rot * t);
            base2X = tipX + baseDist * Math.cos(base2AngleStart + rot * t);
            base2Y = tipY + baseDist * Math.sin(base2AngleStart + rot * t);
        } else {
            const t = (progress - phase1End) / (1 - phase1End);

            const adjEndAngle = rotation - Math.PI / 2 + (adjIndex + 1) * targetAngleStep;
            const adjCurrentAngle = lerp(adjStartAngle, adjEndAngle, t);
            const adjCurrentHalfStep = lerp(baseHalfStep, targetHalfStep, t);
            const a1CurrentAngle = adjCurrentAngle - adjCurrentHalfStep;
            base2X = centerX + innerRadius * Math.cos(a1CurrentAngle);
            base2Y = centerY + innerRadius * Math.sin(a1CurrentAngle);

            const baseDist = dist(adj.base1X, adj.base1Y, adj.tipX, adj.tipY);
            const base2AngleStart = angle(adj.tipX, adj.tipY, adj.base2X, adj.base2Y);
            const base2AngleEnd = angle(adj.tipX, adj.tipY, adj.base1X, adj.base1Y);
            const phase1Rot = normalizeAngle(base2AngleEnd - base2AngleStart) - 2 * Math.PI;

            const base1AngleStart = angle(adj.tipX, adj.tipY, adj.base1X, adj.base1Y);
            const base1AtP1EndAngle = base1AngleStart + phase1Rot;
            const base1AtP1EndX = adj.tipX + baseDist * Math.cos(base1AtP1EndAngle);
            const base1AtP1EndY = adj.tipY + baseDist * Math.sin(base1AtP1EndAngle);

            const tipDistStart = dist(adj.tipX, adj.tipY, adj.base1X, adj.base1Y);
            const base1DistStart = dist(base1AtP1EndX, base1AtP1EndY, adj.base1X, adj.base1Y);
            const tipAngleStart = angle(adj.base1X, adj.base1Y, adj.tipX, adj.tipY);
            const base1AngleFromPivotStart = angle(adj.base1X, adj.base1Y, base1AtP1EndX, base1AtP1EndY);

            const tipDistEnd = dist(final.tipX, final.tipY, final.base2X, final.base2Y);
            const base1DistEnd = dist(final.base1X, final.base1Y, final.base2X, final.base2Y);
            const tipAngleEnd = angle(final.base2X, final.base2Y, final.tipX, final.tipY);
            const base1AngleFromPivotEnd = angle(final.base2X, final.base2Y, final.base1X, final.base1Y);

            const tipRot = normalizeAngle(tipAngleEnd - tipAngleStart);
            const base1Rot = normalizeAngle(base1AngleFromPivotEnd - base1AngleFromPivotStart);

            tipX = base2X + lerp(tipDistStart, tipDistEnd, t) * Math.cos(tipAngleStart + tipRot * t);
            tipY = base2Y + lerp(tipDistStart, tipDistEnd, t) * Math.sin(tipAngleStart + tipRot * t);
            base1X = base2X + lerp(base1DistStart, base1DistEnd, t) * Math.cos(base1AngleFromPivotStart + base1Rot * t);
            base1Y = base2Y + lerp(base1DistStart, base1DistEnd, t) * Math.sin(base1AngleFromPivotStart + base1Rot * t);
        }
    }

    return { tipX, tipY, base1X, base1Y, base2X, base2Y };
}

export interface AdjacentArmPosition {
    tipX: number;
    tipY: number;
    base1X: number;
    base1Y: number;
    base2X: number;
    base2Y: number;
}

export function computeAdjacentArmPosition(ctx: TransitionContext): AdjacentArmPosition {
    const { type, progress, sourceArmIndex, armCount, rotation, centerX, centerY, innerRadius, outerRadius } = ctx;

    const baseAngleStep = (2 * Math.PI) / armCount;
    const phase1End = 0.5;

    const adjIndex = type === 'removing'
        ? (sourceArmIndex + 1) % armCount
        : sourceArmIndex;

    let adjTipAngle = rotation - Math.PI / 2 + adjIndex * baseAngleStep;
    let adjHalfStep = baseAngleStep / 2;

    if (type === 'removing' && progress > phase1End) {
        const phase2Progress = (progress - phase1End) / (1 - phase1End);
        const targetAngleStep = (2 * Math.PI) / (armCount - 1);
        const currentAngle = rotation - Math.PI / 2 + adjIndex * baseAngleStep;
        // Adjacent arm's new index: arms after sourceArmIndex shift back by 1
        const newAdjIndex = adjIndex > sourceArmIndex ? adjIndex - 1 : adjIndex;
        const targetAngle = rotation - Math.PI / 2 + newAdjIndex * targetAngleStep;
        adjTipAngle = currentAngle + (targetAngle - currentAngle) * phase2Progress;
        adjHalfStep = baseAngleStep / 2 + (targetAngleStep / 2 - baseAngleStep / 2) * phase2Progress;
    }

    if (type === 'adding' && progress > phase1End) {
        const phase2Progress = (progress - phase1End) / (1 - phase1End);
        const targetAngleStep = (2 * Math.PI) / (armCount + 1);
        const currentAngle = rotation - Math.PI / 2 + adjIndex * baseAngleStep;
        const targetAngle = rotation - Math.PI / 2 + (adjIndex + 1) * targetAngleStep;
        adjTipAngle = currentAngle + (targetAngle - currentAngle) * phase2Progress;
        adjHalfStep = baseAngleStep / 2 + (targetAngleStep / 2 - baseAngleStep / 2) * phase2Progress;
    }

    const adjBase1Angle = adjTipAngle - adjHalfStep;
    const adjBase2Angle = adjTipAngle + adjHalfStep;

    return {
        tipX: centerX + outerRadius * Math.cos(adjTipAngle),
        tipY: centerY + outerRadius * Math.sin(adjTipAngle),
        base1X: centerX + innerRadius * Math.cos(adjBase1Angle),
        base1Y: centerY + innerRadius * Math.sin(adjBase1Angle),
        base2X: centerX + innerRadius * Math.cos(adjBase2Angle),
        base2Y: centerY + innerRadius * Math.sin(adjBase2Angle),
    };
}

export function computeSourceArmPosition(ctx: TransitionContext): ArmGeometry {
    const { sourceArmIndex, armCount, rotation, centerX, centerY, innerRadius, outerRadius } = ctx;

    const baseAngleStep = (2 * Math.PI) / armCount;
    const srcTipAngle = rotation - Math.PI / 2 + sourceArmIndex * baseAngleStep;
    const srcHalfStep = baseAngleStep / 2;

    return getArmGeometry(centerX, centerY, srcTipAngle, srcHalfStep, innerRadius, outerRadius);
}

export function computeFinalArmPosition(ctx: TransitionContext): ArmGeometry | null {
    if (ctx.type !== 'adding') return null;

    const { sourceArmIndex, armCount, rotation, centerX, centerY, innerRadius, outerRadius } = ctx;
    const targetArmCount = armCount + 1;
    const targetAngleStep = (2 * Math.PI) / targetArmCount;
    const targetHalfStep = targetAngleStep / 2;
    const finalTipAngle = rotation - Math.PI / 2 + sourceArmIndex * targetAngleStep;

    return getArmGeometry(centerX, centerY, finalTipAngle, targetHalfStep, innerRadius, outerRadius);
}
