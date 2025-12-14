export const STAR_RADIUS_SCALE = 4;
export const STAR_OUTER_RADIUS = 20 * STAR_RADIUS_SCALE;
export const STAR_INNER_RADIUS = 8 * STAR_RADIUS_SCALE;

export const FOUR_ARM_INNER_RADIUS_FACTOR = 0.5;

// Arm geometry follows the spec naming (see docs/star.txt):
// - T (tip): the outer point of the arm
// - 1 (base1): CCW base point on inner circle
// - 2 (base2): CW base point on inner circle
// Source arm (S): St, S1, S2 - the arm being removed or final position when adding
// Adjacent arm (A): At, A1, A2 - the neighboring arm used as reference

export interface Point {
    x: number;
    y: number;
}

export interface ArmPoints {
    t: Point;  // tip
    b1: Point; // base1 (CCW)
    b2: Point; // base2 (CW)
}

export interface TransitionContext {
    type: 'adding' | 'removing';
    progress: number;       // 0 to 1, phase 1 is 0-0.5, phase 2 is 0.5-1
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

function pointDist(p1: Point, p2: Point): number {
    return dist(p1.x, p1.y, p2.x, p2.y);
}

export function angle(fromX: number, fromY: number, toX: number, toY: number): number {
    return Math.atan2(toY - fromY, toX - fromX);
}

function pointAngle(from: Point, to: Point): number {
    return angle(from.x, from.y, to.x, to.y);
}

export function normalizeAngle(a: number): number {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}

export function lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t;
}

export function getInnerRadiusForArmCount(armCount: number): number {
    return armCount <= 4 ? STAR_INNER_RADIUS * FOUR_ARM_INNER_RADIUS_FACTOR : STAR_INNER_RADIUS;
}

export function getTransitionInnerRadius(
    armCount: number,
    transitionType: 'adding' | 'removing' | null,
    progress: number
): number {
    const startRadius = getInnerRadiusForArmCount(armCount);
    if (!transitionType || progress <= 0.5) {
        return startRadius;
    }
    const t = (progress - 0.5) / 0.5;
    const endArmCount = transitionType === 'adding' ? armCount + 1 : armCount - 1;
    const endRadius = getInnerRadiusForArmCount(endArmCount);
    return lerp(startRadius, endRadius, t);
}

function rotatePoint(pivot: Point, point: Point, radians: number): Point {
    const d = pointDist(pivot, point);
    const a = pointAngle(pivot, point) + radians;
    return { x: pivot.x + d * Math.cos(a), y: pivot.y + d * Math.sin(a) };
}

export function getArmPoints(
    centerX: number,
    centerY: number,
    tipAngle: number,
    halfStep: number,
    innerR: number,
    outerR: number
): ArmPoints {
    return {
        t: { x: centerX + outerR * Math.cos(tipAngle), y: centerY + outerR * Math.sin(tipAngle) },
        b1: { x: centerX + innerR * Math.cos(tipAngle - halfStep), y: centerY + innerR * Math.sin(tipAngle - halfStep) },
        b2: { x: centerX + innerR * Math.cos(tipAngle + halfStep), y: centerY + innerR * Math.sin(tipAngle + halfStep) },
    };
}

function toFlatResult(arm: ArmPoints) {
    return {
        tipX: arm.t.x, tipY: arm.t.y,
        base1X: arm.b1.x, base1Y: arm.b1.y,
        base2X: arm.b2.x, base2Y: arm.b2.y,
    };
}

// Main entry point for computing transition arm position
export function computeTransitionPosition(ctx: TransitionContext) {
    const arm = ctx.type === 'removing'
        ? computeRemovingPosition(ctx)
        : computeAddingPosition(ctx);
    return toFlatResult(arm);
}

// REMOVING Animation (see docs/star.txt)
// Phase 1 (0→0.5): Pivot around S2, rotate CW until T reaches At
// Phase 2 (0.5→1): Pivot around At (moving), rotate base points CW until they collapse onto A
function computeRemovingPosition(ctx: TransitionContext): ArmPoints {
    const { progress, sourceArmIndex, armCount, rotation, centerX, centerY, outerRadius } = ctx;

    const startInnerRadius = getInnerRadiusForArmCount(armCount);
    const endInnerRadius = getInnerRadiusForArmCount(armCount - 1);

    const angleStep = (2 * Math.PI) / armCount;
    const halfStep = angleStep / 2;

    // S = source arm being removed, A = adjacent arm (CW neighbor at sourceArmIndex + 1)
    const srcAngle = rotation - Math.PI / 2 + sourceArmIndex * angleStep;
    const adjAngle = srcAngle + angleStep;
    const S = getArmPoints(centerX, centerY, srcAngle, halfStep, startInnerRadius, outerRadius);
    const A = getArmPoints(centerX, centerY, adjAngle, halfStep, startInnerRadius, outerRadius);

    if (progress < 0.5) {
        // PHASE 1: Rigid rotation around S2 (source arm's CW base)
        // Start: T at St, 1 at S1, 2 at S2
        // End: T aligns with At
        const t = progress / 0.5;
        const pivot = S.b2;
        const totalRotation = normalizeAngle(pointAngle(pivot, A.t) - pointAngle(pivot, S.t));

        return {
            t: rotatePoint(pivot, S.t, totalRotation * t),
            b1: rotatePoint(pivot, S.b1, totalRotation * t),
            b2: pivot,
        };
    } else {
        // PHASE 2: Base points collapse onto adjacent arm
        // Pivot is At (which moves as remaining arms redistribute)
        // Rotate CW "long way" (+2π) until base points align with A
        const t = (progress - 0.5) / 0.5;
        const currentInnerRadius = lerp(startInnerRadius, endInnerRadius, t);

        // Compute where adjacent arm moves to during redistribution
        const adjIndex = (sourceArmIndex + 1) % armCount;
        const targetAngleStep = (2 * Math.PI) / (armCount - 1);
        const newAdjIndex = adjIndex > sourceArmIndex ? adjIndex - 1 : adjIndex;
        const adjStartAngle = rotation - Math.PI / 2 + adjIndex * angleStep;
        const adjEndAngle = rotation - Math.PI / 2 + newAdjIndex * targetAngleStep;
        const adjCurrentAngle = lerp(adjStartAngle, adjEndAngle, t);
        const adjCurrentHalfStep = lerp(halfStep, targetAngleStep / 2, t);
        const AMoving = getArmPoints(centerX, centerY, adjCurrentAngle, adjCurrentHalfStep, currentInnerRadius, outerRadius);

        // Where were b1 and b2 at end of phase 1?
        const phase1Rotation = normalizeAngle(pointAngle(S.b2, A.t) - pointAngle(S.b2, S.t));
        const b1AtPhase1End = rotatePoint(S.b2, S.b1, phase1Rotation);
        const b2AtPhase1End = S.b2;

        // Rotate around moving tip with forced CW "long way" (+2π)
        const pivot = AMoving.t;
        const b1StartAngle = pointAngle(A.t, b1AtPhase1End);
        const b2StartAngle = pointAngle(A.t, b2AtPhase1End);
        const b1EndAngle = pointAngle(AMoving.t, AMoving.b1);
        const b2EndAngle = pointAngle(AMoving.t, AMoving.b2);
        const b1Rotation = normalizeAngle(b1EndAngle - b1StartAngle) + 2 * Math.PI;
        const b2Rotation = normalizeAngle(b2EndAngle - b2StartAngle) + 2 * Math.PI;

        const b1StartDist = pointDist(A.t, b1AtPhase1End);
        const b2StartDist = pointDist(A.t, b2AtPhase1End);
        const b1EndDist = pointDist(AMoving.t, AMoving.b1);
        const b2EndDist = pointDist(AMoving.t, AMoving.b2);

        return {
            t: pivot,
            b1: {
                x: pivot.x + lerp(b1StartDist, b1EndDist, t) * Math.cos(b1StartAngle + b1Rotation * t),
                y: pivot.y + lerp(b1StartDist, b1EndDist, t) * Math.sin(b1StartAngle + b1Rotation * t),
            },
            b2: {
                x: pivot.x + lerp(b2StartDist, b2EndDist, t) * Math.cos(b2StartAngle + b2Rotation * t),
                y: pivot.y + lerp(b2StartDist, b2EndDist, t) * Math.sin(b2StartAngle + b2Rotation * t),
            },
        };
    }
}

// ADDING Animation (see docs/star.txt)
// Phase 1 (0→0.5): Pivot around At (fixed), rotate CCW until b2 reaches A1
// Phase 2 (0.5→1): Pivot around b2 (locked to A1 which moves), rotate until T and b1 reach final position
function computeAddingPosition(ctx: TransitionContext): ArmPoints {
    const { progress, sourceArmIndex, armCount, rotation, centerX, centerY, outerRadius } = ctx;

    const startInnerRadius = getInnerRadiusForArmCount(armCount);
    const endInnerRadius = getInnerRadiusForArmCount(armCount + 1);

    const angleStep = (2 * Math.PI) / armCount;
    const halfStep = angleStep / 2;
    const targetAngleStep = (2 * Math.PI) / (armCount + 1);
    const targetHalfStep = targetAngleStep / 2;

    // A = adjacent arm we unfold from, SFinal = final position of new arm
    const adjAngle = rotation - Math.PI / 2 + sourceArmIndex * angleStep;
    const A = getArmPoints(centerX, centerY, adjAngle, halfStep, startInnerRadius, outerRadius);
    const finalAngle = rotation - Math.PI / 2 + sourceArmIndex * targetAngleStep;
    const SFinal = getArmPoints(centerX, centerY, finalAngle, targetHalfStep, endInnerRadius, outerRadius);

    if (progress < 0.5) {
        // PHASE 1: New arm unfolds from adjacent arm
        // Pivot at At (fixed), start collapsed onto A, rotate CCW "long way" (-2π)
        // End: b2 aligns with A1
        const t = progress / 0.5;
        const pivot = A.t;
        const baseDist = pointDist(pivot, A.b1);

        const b1StartAngle = pointAngle(pivot, A.b1);
        const b2StartAngle = pointAngle(pivot, A.b2);
        const totalRotation = normalizeAngle(pointAngle(pivot, A.b1) - b2StartAngle) - 2 * Math.PI;

        return {
            t: pivot,
            b1: {
                x: pivot.x + baseDist * Math.cos(b1StartAngle + totalRotation * t),
                y: pivot.y + baseDist * Math.sin(b1StartAngle + totalRotation * t),
            },
            b2: {
                x: pivot.x + baseDist * Math.cos(b2StartAngle + totalRotation * t),
                y: pivot.y + baseDist * Math.sin(b2StartAngle + totalRotation * t),
            },
        };
    } else {
        // PHASE 2: T and b1 swing out to final position
        // Pivot is b2 (locked to A1, which moves as existing arms spread)
        const t = (progress - 0.5) / 0.5;
        const currentInnerRadius = lerp(startInnerRadius, endInnerRadius, t);

        // A1 moves as adjacent arm shifts to make room
        const adjEndAngle = rotation - Math.PI / 2 + (sourceArmIndex + 1) * targetAngleStep;
        const adjCurrentAngle = lerp(adjAngle, adjEndAngle, t);
        const adjCurrentHalfStep = lerp(halfStep, targetHalfStep, t);
        const a1CurrentAngle = adjCurrentAngle - adjCurrentHalfStep;
        const pivot: Point = {
            x: centerX + currentInnerRadius * Math.cos(a1CurrentAngle),
            y: centerY + currentInnerRadius * Math.sin(a1CurrentAngle),
        };

        // Where was b1 at end of phase 1?
        const baseDist = pointDist(A.t, A.b1);
        const phase1Rotation = normalizeAngle(pointAngle(A.t, A.b1) - pointAngle(A.t, A.b2)) - 2 * Math.PI;
        const b1AtPhase1End: Point = {
            x: A.t.x + baseDist * Math.cos(pointAngle(A.t, A.b1) + phase1Rotation),
            y: A.t.y + baseDist * Math.sin(pointAngle(A.t, A.b1) + phase1Rotation),
        };

        // Rotate T and b1 around moving pivot
        const tipStartAngle = pointAngle(A.b1, A.t);
        const tipEndAngle = pointAngle(SFinal.b2, SFinal.t);
        const b1StartAngle = pointAngle(A.b1, b1AtPhase1End);
        const b1EndAngle = pointAngle(SFinal.b2, SFinal.b1);

        const tipRotation = normalizeAngle(tipEndAngle - tipStartAngle);
        const b1Rotation = normalizeAngle(b1EndAngle - b1StartAngle);

        const tipStartDist = pointDist(A.b1, A.t);
        const tipEndDist = pointDist(SFinal.b2, SFinal.t);
        const b1StartDist = pointDist(A.b1, b1AtPhase1End);
        const b1EndDist = pointDist(SFinal.b2, SFinal.b1);

        return {
            t: {
                x: pivot.x + lerp(tipStartDist, tipEndDist, t) * Math.cos(tipStartAngle + tipRotation * t),
                y: pivot.y + lerp(tipStartDist, tipEndDist, t) * Math.sin(tipStartAngle + tipRotation * t),
            },
            b1: {
                x: pivot.x + lerp(b1StartDist, b1EndDist, t) * Math.cos(b1StartAngle + b1Rotation * t),
                y: pivot.y + lerp(b1StartDist, b1EndDist, t) * Math.sin(b1StartAngle + b1Rotation * t),
            },
            b2: pivot,
        };
    }
}

// Compute current position of adjacent arm (for debug visualization)
export function computeAdjacentArmPosition(ctx: TransitionContext) {
    const { type, progress, sourceArmIndex, armCount, rotation, centerX, centerY, innerRadius, outerRadius } = ctx;

    const angleStep = (2 * Math.PI) / armCount;
    const halfStep = angleStep / 2;

    // For removing: adjacent is CW neighbor (sourceArmIndex + 1)
    // For adding: adjacent is the arm we unfold from (sourceArmIndex)
    const adjIndex = type === 'removing' ? (sourceArmIndex + 1) % armCount : sourceArmIndex;

    let adjTipAngle = rotation - Math.PI / 2 + adjIndex * angleStep;
    let adjHalfStep = halfStep;

    // During phase 2, adjacent arm shifts as arms redistribute
    if (progress > 0.5) {
        const t = (progress - 0.5) / 0.5;
        if (type === 'removing') {
            const targetAngleStep = (2 * Math.PI) / (armCount - 1);
            const newAdjIndex = adjIndex > sourceArmIndex ? adjIndex - 1 : adjIndex;
            const targetAngle = rotation - Math.PI / 2 + newAdjIndex * targetAngleStep;
            adjTipAngle = lerp(adjTipAngle, targetAngle, t);
            adjHalfStep = lerp(halfStep, targetAngleStep / 2, t);
        } else {
            const targetAngleStep = (2 * Math.PI) / (armCount + 1);
            const targetAngle = rotation - Math.PI / 2 + (adjIndex + 1) * targetAngleStep;
            adjTipAngle = lerp(adjTipAngle, targetAngle, t);
            adjHalfStep = lerp(halfStep, targetAngleStep / 2, t);
        }
    }

    const arm = getArmPoints(centerX, centerY, adjTipAngle, adjHalfStep, innerRadius, outerRadius);
    return toFlatResult(arm);
}

// Compute source arm's initial position (for debug visualization)
export function computeSourceArmPosition(ctx: TransitionContext) {
    const { sourceArmIndex, armCount, rotation, centerX, centerY, innerRadius, outerRadius } = ctx;

    const angleStep = (2 * Math.PI) / armCount;
    const halfStep = angleStep / 2;
    const srcAngle = rotation - Math.PI / 2 + sourceArmIndex * angleStep;

    const arm = getArmPoints(centerX, centerY, srcAngle, halfStep, innerRadius, outerRadius);
    return toFlatResult(arm);
}

// Compute final position of new arm (for adding, debug visualization)
export function computeFinalArmPosition(ctx: TransitionContext) {
    if (ctx.type !== 'adding') return null;

    const { sourceArmIndex, armCount, rotation, centerX, centerY, innerRadius, outerRadius } = ctx;
    const targetAngleStep = (2 * Math.PI) / (armCount + 1);
    const targetHalfStep = targetAngleStep / 2;
    const finalAngle = rotation - Math.PI / 2 + sourceArmIndex * targetAngleStep;

    const arm = getArmPoints(centerX, centerY, finalAngle, targetHalfStep, innerRadius, outerRadius);
    return toFlatResult(arm);
}
