export const STAR_RADIUS_SCALE = 4;
export const STAR_OUTER_RADIUS = 20 * STAR_RADIUS_SCALE;
export const STAR_INNER_RADIUS = 8 * STAR_RADIUS_SCALE;

export const FOUR_ARM_INNER_RADIUS_FACTOR = 0.5;

// Arm geometry:
// - T (tip): outer point of the arm
// - b1 (base1): CCW base point on inner circle
// - b2 (base2): CW base point on inner circle
//
// Direction is a signed integer: +1 for CW, -1 for CCW
// This determines which neighbor the animation targets and which base point is the pivot

export interface Point {
    x: number;
    y: number;
}

export interface ArmPoints {
    t: Point;
    b1: Point;
    b2: Point;
}

// +1 = clockwise, -1 = counterclockwise
export type TransitionDirection = 1 | -1;

export interface TransitionContext {
    type: 'adding' | 'removing';
    direction: TransitionDirection;
    progress: number;  // 0 to 1
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

// Modular index helper
function mod(n: number, m: number): number {
    return ((n % m) + m) % m;
}

// Select pivot base point based on direction: +1 uses b2, -1 uses b1
function getPivotBase(arm: ArmPoints, dir: TransitionDirection): Point {
    return dir === 1 ? arm.b2 : arm.b1;
}

function getSwingingBase(arm: ArmPoints, dir: TransitionDirection): Point {
    return dir === 1 ? arm.b1 : arm.b2;
}

// Main entry point
export function computeTransitionPosition(ctx: TransitionContext) {
    const arm = ctx.type === 'removing'
        ? computeRemoving(ctx)
        : computeAdding(ctx);
    return toFlatResult(arm);
}

// REMOVING Animation (unified for both directions)
// Phase 1: Pivot around source arm's base (b2 for +1, b1 for -1), rotate until T reaches adjacent neighbor
// Phase 2: Pivot around adjacent tip (moving), collapse base points onto adjacent arm
function computeRemoving(ctx: TransitionContext): ArmPoints {
    const { progress, sourceArmIndex, armCount, rotation, centerX, centerY, outerRadius, direction: dir } = ctx;

    const startInnerRadius = getInnerRadiusForArmCount(armCount);
    const endInnerRadius = getInnerRadiusForArmCount(armCount - 1);
    const angleStep = (2 * Math.PI) / armCount;
    const halfStep = angleStep / 2;

    // Source arm and adjacent arm (in direction dir)
    const srcAngle = rotation - Math.PI / 2 + sourceArmIndex * angleStep;
    const adjIndex = mod(sourceArmIndex + dir, armCount);
    const adjAngle = srcAngle + dir * angleStep;
    const S = getArmPoints(centerX, centerY, srcAngle, halfStep, startInnerRadius, outerRadius);
    const A = getArmPoints(centerX, centerY, adjAngle, halfStep, startInnerRadius, outerRadius);

    if (progress < 0.5) {
        // PHASE 1: Rigid rotation around pivot base
        const t = progress / 0.5;
        const pivot = getPivotBase(S, dir);
        const totalRotation = normalizeAngle(pointAngle(pivot, A.t) - pointAngle(pivot, S.t));

        const result: ArmPoints = {
            t: rotatePoint(pivot, S.t, totalRotation * t),
            b1: dir === 1 ? rotatePoint(pivot, S.b1, totalRotation * t) : pivot,
            b2: dir === 1 ? pivot : rotatePoint(pivot, S.b2, totalRotation * t),
        };
        return result;
    } else {
        // PHASE 2: Collapse onto adjacent arm
        const t = (progress - 0.5) / 0.5;
        const currentInnerRadius = lerp(startInnerRadius, endInnerRadius, t);

        // Adjacent arm moves during redistribution
        const targetAngleStep = (2 * Math.PI) / (armCount - 1);
        // After removal: all arms with index > sourceArmIndex shift down by 1
        const newAdjIndex = adjIndex > sourceArmIndex ? adjIndex - 1 : adjIndex;
        const adjStartAngle = rotation - Math.PI / 2 + adjIndex * angleStep;
        const adjEndAngle = rotation - Math.PI / 2 + newAdjIndex * targetAngleStep;
        const adjCurrentAngle = lerp(adjStartAngle, adjEndAngle, t);
        const adjCurrentHalfStep = lerp(halfStep, targetAngleStep / 2, t);
        const AMoving = getArmPoints(centerX, centerY, adjCurrentAngle, adjCurrentHalfStep, currentInnerRadius, outerRadius);

        // Where were bases at end of phase 1?
        const pivotAtPhase1 = getPivotBase(S, dir);
        const phase1Rotation = normalizeAngle(pointAngle(pivotAtPhase1, A.t) - pointAngle(pivotAtPhase1, S.t));
        const b1AtPhase1End = dir === 1 ? rotatePoint(pivotAtPhase1, S.b1, phase1Rotation) : pivotAtPhase1;
        const b2AtPhase1End = dir === 1 ? pivotAtPhase1 : rotatePoint(pivotAtPhase1, S.b2, phase1Rotation);

        // Rotate around moving tip - must go the "long way" (between 180° and 360°)
        const pivot = AMoving.t;
        const b1StartAngle = pointAngle(A.t, b1AtPhase1End);
        const b2StartAngle = pointAngle(A.t, b2AtPhase1End);
        const b1EndAngle = pointAngle(AMoving.t, AMoving.b1);
        const b2EndAngle = pointAngle(AMoving.t, AMoving.b2);
        let b1Rotation = normalizeAngle(b1EndAngle - b1StartAngle);
        let b2Rotation = normalizeAngle(b2EndAngle - b2StartAngle);
        // Force long way: if rotation is in wrong direction or too short, add full rotation
        if (dir === 1) {
            // CW: rotation should be positive and > π
            if (b1Rotation < Math.PI) b1Rotation += 2 * Math.PI;
            if (b2Rotation < Math.PI) b2Rotation += 2 * Math.PI;
        } else {
            // CCW: rotation should be negative and < -π
            if (b1Rotation > -Math.PI) b1Rotation -= 2 * Math.PI;
            if (b2Rotation > -Math.PI) b2Rotation -= 2 * Math.PI;
        }

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

// ADDING Animation (unified for both directions)
// Phase 1: Pivot around At (fixed), rotate in direction until pivot base reaches adjacent's opposite base
// Phase 2: Pivot base stays locked to adjacent's base (moving), swing out to final position
function computeAdding(ctx: TransitionContext): ArmPoints {
    const { progress, sourceArmIndex, armCount, rotation, centerX, centerY, outerRadius, direction: dir } = ctx;

    const startInnerRadius = getInnerRadiusForArmCount(armCount);
    const endInnerRadius = getInnerRadiusForArmCount(armCount + 1);
    const angleStep = (2 * Math.PI) / armCount;
    const halfStep = angleStep / 2;
    const targetAngleStep = (2 * Math.PI) / (armCount + 1);
    const targetHalfStep = targetAngleStep / 2;

    // Adjacent arm we unfold from
    const adjAngle = rotation - Math.PI / 2 + sourceArmIndex * angleStep;
    const A = getArmPoints(centerX, centerY, adjAngle, halfStep, startInnerRadius, outerRadius);

    // Final position of new arm - CW inserts on CW side, CCW inserts on CCW side
    const finalArmIndex = dir === 1 ? sourceArmIndex + 1 : sourceArmIndex;
    const finalAngle = rotation - Math.PI / 2 + finalArmIndex * targetAngleStep;
    const SFinal = getArmPoints(centerX, centerY, finalAngle, targetHalfStep, endInnerRadius, outerRadius);

    // Target base on adjacent arm: for -1 (CCW), pivot ends at A.b1; for +1 (CW), pivot ends at A.b2
    const targetBase = dir === 1 ? A.b2 : A.b1;
    const finalPivotBase = dir === 1 ? SFinal.b1 : SFinal.b2;
    const finalSwingingBase = dir === 1 ? SFinal.b2 : SFinal.b1;

    if (progress < 0.5) {
        // PHASE 1: Unfold from adjacent arm
        // Start collapsed onto A, rotate in direction with "long way" (dir * -2π for effective direction)
        const t = progress / 0.5;
        const pivot = A.t;
        const baseDist = pointDist(pivot, A.b1);  // same as pointDist(pivot, A.b2)

        const b1StartAngle = pointAngle(pivot, A.b1);
        const b2StartAngle = pointAngle(pivot, A.b2);
        // Rotation: move the swinging base to target base position, going "long way" in direction dir
        const swingingStartAngle = dir === 1 ? b1StartAngle : b2StartAngle;
        const targetAngle = pointAngle(pivot, targetBase);
        // For CW: want positive long-way rotation; for CCW: want negative long-way rotation
        const shortWay = normalizeAngle(targetAngle - swingingStartAngle);
        const totalRotation = shortWay + dir * 2 * Math.PI;

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
        // PHASE 2: Swing out to final position
        // Pivot base (b1 for CW, b2 for CCW) stays locked to adjacent's shared vertex as it moves
        // Swinging base (b2 for CW, b1 for CCW) and tip swing out to final position
        const t = (progress - 0.5) / 0.5;
        const currentInnerRadius = lerp(startInnerRadius, endInnerRadius, t);

        // Compute Phase 1 end state (where all three points are at t=0 of Phase 2)
        const baseDist = pointDist(A.t, A.b1);
        const b1StartAngleP1 = pointAngle(A.t, A.b1);
        const b2StartAngleP1 = pointAngle(A.t, A.b2);
        const swingingP1 = dir === 1 ? b1StartAngleP1 : b2StartAngleP1;
        const targetAngleP1 = pointAngle(A.t, targetBase);
        const phase1Rotation = normalizeAngle(targetAngleP1 - swingingP1) + dir * 2 * Math.PI;

        // All points at end of Phase 1 (tip at A.t, bases rotated by phase1Rotation)
        const tipAtP1End = A.t;
        const b1AtP1End: Point = {
            x: A.t.x + baseDist * Math.cos(b1StartAngleP1 + phase1Rotation),
            y: A.t.y + baseDist * Math.sin(b1StartAngleP1 + phase1Rotation),
        };
        const b2AtP1End: Point = {
            x: A.t.x + baseDist * Math.cos(b2StartAngleP1 + phase1Rotation),
            y: A.t.y + baseDist * Math.sin(b2StartAngleP1 + phase1Rotation),
        };
        // For CW: b1 ends at targetBase (A.b2), b2 is the swinging one
        // For CCW: b2 ends at targetBase (A.b1), b1 is the swinging one
        const pivotAtP1End = dir === 1 ? b1AtP1End : b2AtP1End;  // should equal targetBase
        const swingingAtP1End = dir === 1 ? b2AtP1End : b1AtP1End;

        // Adjacent arm moves from its original position to its final position in (N+1)-arm star
        // The source arm (adj) keeps its index, the new arm is inserted next to it
        // CW: new arm at sourceArmIndex+1, so adj stays at sourceArmIndex
        // CCW: new arm at sourceArmIndex, so adj shifts to sourceArmIndex+1
        const adjEndIndex = dir === 1 ? sourceArmIndex : sourceArmIndex + 1;
        const adjEndAngle = rotation - Math.PI / 2 + adjEndIndex * targetAngleStep;

        // Compute current adjacent arm position by interpolating tip angle and half-step
        const adjCurrentAngle = lerp(adjAngle, adjEndAngle, t);
        const adjCurrentHalfStep = lerp(halfStep, targetHalfStep, t);
        const AMoving = getArmPoints(centerX, centerY, adjCurrentAngle, adjCurrentHalfStep, currentInnerRadius, outerRadius);

        // Pivot follows the adjacent arm's shared base point as it moves
        const pivot = dir === 1 ? AMoving.b2 : AMoving.b1;

        // Final adjacent arm position
        const adjEnd = getArmPoints(centerX, centerY, adjEndAngle, targetHalfStep, endInnerRadius, outerRadius);
        const pivotAtEnd = dir === 1 ? adjEnd.b2 : adjEnd.b1;

        // Tip and swinging base: interpolate positions relative to a common moving reference frame
        // The key insight: we need to interpolate such that edge lengths change smoothly
        //
        // At t=0: tip at tipAtP1End, swinging at swingingAtP1End, relative to pivotAtP1End
        // At t=1: tip at SFinal.t, swinging at finalSwingingBase, relative to pivotAtEnd
        //
        // Strategy: compute where tip and swinging would be at current t using angles relative
        // to the current pivot position (not the start/end pivots)

        // Compute angles of tip and swinging relative to pivot at start and end
        const tipStartAngle = pointAngle(pivotAtP1End, tipAtP1End);
        const tipEndAngle = pointAngle(pivotAtEnd, SFinal.t);
        const swingingStartAngle = pointAngle(pivotAtP1End, swingingAtP1End);
        const swingingEndAngle = pointAngle(pivotAtEnd, finalSwingingBase);

        // Compute rotation amounts that preserve direction
        let tipRotation = normalizeAngle(tipEndAngle - tipStartAngle);
        let swingingRotation = normalizeAngle(swingingEndAngle - swingingStartAngle);
        if (dir === 1 && tipRotation < 0) tipRotation += 2 * Math.PI;
        if (dir === 1 && swingingRotation < 0) swingingRotation += 2 * Math.PI;
        if (dir === -1 && tipRotation > 0) tipRotation -= 2 * Math.PI;
        if (dir === -1 && swingingRotation > 0) swingingRotation -= 2 * Math.PI;

        // Compute distances from pivot at start and end
        const tipStartDist = pointDist(pivotAtP1End, tipAtP1End);
        const tipEndDist = pointDist(pivotAtEnd, SFinal.t);
        const swingingStartDist = pointDist(pivotAtP1End, swingingAtP1End);
        const swingingEndDist = pointDist(pivotAtEnd, finalSwingingBase);

        // Linearly interpolate angles and distances
        const tipCurrentAngle = tipStartAngle + tipRotation * t;
        const tipCurrentDist = lerp(tipStartDist, tipEndDist, t);
        const swingingCurrentAngle = swingingStartAngle + swingingRotation * t;
        const swingingCurrentDist = lerp(swingingStartDist, swingingEndDist, t);

        // Compute positions relative to current pivot
        const tipPos: Point = {
            x: pivot.x + tipCurrentDist * Math.cos(tipCurrentAngle),
            y: pivot.y + tipCurrentDist * Math.sin(tipCurrentAngle),
        };
        const swingingPos: Point = {
            x: pivot.x + swingingCurrentDist * Math.cos(swingingCurrentAngle),
            y: pivot.y + swingingCurrentDist * Math.sin(swingingCurrentAngle),
        };

        return {
            t: tipPos,
            b1: dir === 1 ? pivot : swingingPos,
            b2: dir === 1 ? swingingPos : pivot,
        };
    }
}

// Debug helpers

export function computeAdjacentArmPosition(ctx: TransitionContext) {
    const { type, direction: dir, progress, sourceArmIndex, armCount, rotation, centerX, centerY, innerRadius, outerRadius } = ctx;

    const angleStep = (2 * Math.PI) / armCount;
    const halfStep = angleStep / 2;

    const adjIndex = type === 'removing' ? mod(sourceArmIndex + dir, armCount) : sourceArmIndex;
    let adjTipAngle = rotation - Math.PI / 2 + adjIndex * angleStep;
    let adjHalfStep = halfStep;

    if (progress > 0.5) {
        const t = (progress - 0.5) / 0.5;
        if (type === 'removing') {
            const targetAngleStep = (2 * Math.PI) / (armCount - 1);
            const newAdjIndex = (dir === 1)
                ? (adjIndex > sourceArmIndex ? adjIndex - 1 : adjIndex)
                : (adjIndex < sourceArmIndex ? adjIndex : adjIndex);
            const targetAngle = rotation - Math.PI / 2 + newAdjIndex * targetAngleStep;
            adjTipAngle = lerp(adjTipAngle, targetAngle, t);
            adjHalfStep = lerp(halfStep, targetAngleStep / 2, t);
        } else {
            const targetAngleStep = (2 * Math.PI) / (armCount + 1);
            // CW: source arm stays at same index; CCW: source arm shifts to index+1
            const newAdjIndex = dir === 1 ? adjIndex : adjIndex + 1;
            const targetAngle = rotation - Math.PI / 2 + newAdjIndex * targetAngleStep;
            adjTipAngle = lerp(adjTipAngle, targetAngle, t);
            adjHalfStep = lerp(halfStep, targetAngleStep / 2, t);
        }
    }

    const arm = getArmPoints(centerX, centerY, adjTipAngle, adjHalfStep, innerRadius, outerRadius);
    return toFlatResult(arm);
}

export function computeSourceArmPosition(ctx: TransitionContext) {
    const { sourceArmIndex, armCount, rotation, centerX, centerY, innerRadius, outerRadius } = ctx;
    const angleStep = (2 * Math.PI) / armCount;
    const halfStep = angleStep / 2;
    const srcAngle = rotation - Math.PI / 2 + sourceArmIndex * angleStep;
    const arm = getArmPoints(centerX, centerY, srcAngle, halfStep, innerRadius, outerRadius);
    return toFlatResult(arm);
}

export function computeFinalArmPosition(ctx: TransitionContext) {
    if (ctx.type !== 'adding') return null;
    const { sourceArmIndex, armCount, rotation, centerX, centerY, innerRadius, outerRadius } = ctx;
    const targetAngleStep = (2 * Math.PI) / (armCount + 1);
    const targetHalfStep = targetAngleStep / 2;
    const finalAngle = rotation - Math.PI / 2 + sourceArmIndex * targetAngleStep;
    const arm = getArmPoints(centerX, centerY, finalAngle, targetHalfStep, innerRadius, outerRadius);
    return toFlatResult(arm);
}
