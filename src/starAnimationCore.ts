export const STAR_OUTER_RADIUS = 20;

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

export function getAngleStep(armCount: number): number {
    return (2 * Math.PI) / armCount;
}

export function getInnerRadiusRatio(armCount: number): number {
    if (armCount <= 4) {
        return .2;
    } else {
        return .4;
    }
}

export function getInnerRadiusForArmCount(armCount: number): number {
    return getInnerRadiusRatio(armCount) * STAR_OUTER_RADIUS;
}

export function getInnerRadius(armCount: number, outerRadius: number): number {
    return getInnerRadiusRatio(armCount) * outerRadius;
}

export function getTransitionInnerRadius(
    armCount: number,
    transitionType: 'adding' | 'removing' | null,
    progress: number,
    outerRadius: number = STAR_OUTER_RADIUS
): number {
    const startRatio = getInnerRadiusRatio(armCount);
    if (!transitionType) {
        return startRatio * outerRadius;
    }
    const endArmCount = transitionType === 'adding' ? armCount + 1 : armCount - 1;
    const endRatio = getInnerRadiusRatio(endArmCount);
    return lerp(startRatio, endRatio, progress) * outerRadius;
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

export function mod(n: number, m: number): number {
    return ((n % m) + m) % m;
}

// ============== New Minimal Transition System ==============

export interface MinimalTransitionContext {
    centerX: number;
    centerY: number;
    outerRadius: number;
    innerRadius: number;
    // Adjacent arm points (SSOT - all geometry derives from this)
    adjPoints: ArmPoints;
    // Shared base point (where pivot locks in Phase 2)
    sharedBase: Point;
    progress: number;               // 0→1 for adding, 1→0 for removing
    direction: TransitionDirection;
    type: 'adding' | 'removing';
}

// Abstraction for base point roles - which base is the pivot vs which swings freely
interface BaseRoles {
    pivotBase: Point;     // The base that locks to adjacent's base during Phase 2
    swingingBase: Point;  // The base that rotates freely around the pivot
}

// SSOT for determining which base is pivot vs swinging
// For ADDING: new arm unfolds from adjacent, sharing one base point
// - ADDING CW: new arm's b1 (CCW base) shares position with adjacent's b2 (CW base)
// - ADDING CCW: new arm's b2 (CW base) shares position with adjacent's b1 (CCW base)
// The shared base becomes the pivot in Phase 2
// - REMOVING is the reverse
function assignBaseRoles(
    type: 'adding' | 'removing',
    direction: TransitionDirection,
    b1: Point,
    b2: Point
): BaseRoles {
    // For ADDING CW: pivot is b1 (shares with adjacent's b2)
    // For ADDING CCW: pivot is b2 (shares with adjacent's b1)
    // For REMOVING: opposite
    const addingPivotIsB1 = direction === 1;
    const pivotIsB1 = type === 'adding' ? addingPivotIsB1 : !addingPivotIsB1;

    return pivotIsB1
        ? { pivotBase: b1, swingingBase: b2 }
        : { pivotBase: b2, swingingBase: b1 };
}

function unassignBaseRoles(
    type: 'adding' | 'removing',
    direction: TransitionDirection,
    roles: BaseRoles
): { b1: Point; b2: Point } {
    const addingPivotIsB1 = direction === 1;
    const pivotIsB1 = type === 'adding' ? addingPivotIsB1 : !addingPivotIsB1;

    return pivotIsB1
        ? { b1: roles.pivotBase, b2: roles.swingingBase }
        : { b1: roles.swingingBase, b2: roles.pivotBase };
}


// Compute the "collapsed" state: arm fully overlapping adjacent arm
// SSOT: Uses pre-computed adjacent arm points directly
function getCollapsedState(ctx: MinimalTransitionContext): ArmPoints {
    // All points come directly from adjacent arm (SSOT)
    return ctx.adjPoints;
}

// Phase 1: Long rotation around tip - bases swing "the long way" (180° < |rotation| < 360°)
// At t=0: collapsed onto adjacent
// At t=1: pivot base has swung to the shared base position (for Phase 2)
// Distances are constant - measured from static arm geometry.
function computePhase1(
    collapsed: { tip: Point; pivotBase: Point; swingingBase: Point },
    sharedBase: Point,
    ctx: MinimalTransitionContext,
    t: number
): { tip: Point; pivotBase: Point; swingingBase: Point } {
    const { direction } = ctx;
    const tip = collapsed.tip;

    // Distance from tip to base is constant (from static arm geometry)
    const baseDist = pointDist(tip, collapsed.pivotBase);

    const pivotStartAngle = pointAngle(tip, collapsed.pivotBase);
    const swingStartAngle = pointAngle(tip, collapsed.swingingBase);
    const pivotTargetAngle = pointAngle(tip, sharedBase);

    // Phase 1 rotates the "long way" (>180°) in the transition direction
    const diff = normalizeAngle(pivotTargetAngle - pivotStartAngle);
    const totalRotation = diff + direction * 2 * Math.PI;

    const currentRotation = totalRotation * t;

    const pivotBase: Point = {
        x: tip.x + baseDist * Math.cos(pivotStartAngle + currentRotation),
        y: tip.y + baseDist * Math.sin(pivotStartAngle + currentRotation),
    };
    const swingingBase: Point = {
        x: tip.x + baseDist * Math.cos(swingStartAngle + currentRotation),
        y: tip.y + baseDist * Math.sin(swingStartAngle + currentRotation),
    };

    return { tip, pivotBase, swingingBase };
}

// Find the final tip position using circle-circle intersection.
// The final tip must be:
// 1. On the outer radius (distance outerRadius from center)
// 2. At distance edgeDist from pivotBase (sharedBase)
// Returns the intersection point in the correct direction.
function computeFinalTipPosition(
    centerX: number,
    centerY: number,
    outerRadius: number,
    pivotBase: Point,
    edgeDist: number,
    adjTip: Point,
    direction: TransitionDirection
): Point {
    const d = pointDist({ x: centerX, y: centerY }, pivotBase);

    // Check if circles intersect
    if (d > outerRadius + edgeDist || d < Math.abs(outerRadius - edgeDist)) {
        // No intersection - fall back to keeping tip at edgeDist from pivot
        const tipAngle = pointAngle(pivotBase, adjTip);
        return {
            x: pivotBase.x + edgeDist * Math.cos(tipAngle),
            y: pivotBase.y + edgeDist * Math.sin(tipAngle),
        };
    }

    // Find intersection points using circle-circle intersection formula
    const a = (d * d + outerRadius * outerRadius - edgeDist * edgeDist) / (2 * d);
    const h = Math.sqrt(outerRadius * outerRadius - a * a);

    // Unit vector from center to pivotBase
    const ux = (pivotBase.x - centerX) / d;
    const uy = (pivotBase.y - centerY) / d;

    // Point P on the line between centers, at distance a from center
    const px = centerX + a * ux;
    const py = centerY + a * uy;

    // Two intersection points (perpendicular to the line between centers)
    const ix1 = px + h * (-uy);
    const iy1 = py + h * ux;
    const ix2 = px - h * (-uy);
    const iy2 = py - h * ux;

    // Choose the intersection point that is NOT at adjTip (the Phase 2 START position).
    // Since both intersection points are at distance edgeDist from pivotBase and on the outer radius,
    // one of them is at adjTip (Phase 2 start) and the other is the final tip position.
    const dist1ToAdjTip = pointDist({ x: ix1, y: iy1 }, adjTip);
    const dist2ToAdjTip = pointDist({ x: ix2, y: iy2 }, adjTip);

    // Choose the point that is farther from adjTip (i.e., NOT the start position)
    return dist1ToAdjTip > dist2ToAdjTip ? { x: ix1, y: iy1 } : { x: ix2, y: iy2 };
}

// Phase 2: Rotate around pivot base until arm reaches final position
// The pivot base stays locked at sharedBase. Tip and swinging base rotate together.
// Final tip position is computed using circle-circle intersection to ensure it lands on outer radius.
function computePhase2(
    ctx: MinimalTransitionContext,
    t: number
): { tip: Point; pivotBase: Point; swingingBase: Point } {
    const { centerX, centerY, outerRadius, direction, adjPoints, sharedBase } = ctx;
    const pivotBase = sharedBase;

    // Distances from adjacent arm geometry
    const edgeDist = pointDist(adjPoints.t, adjPoints.b1);  // tip to base
    const chordDist = pointDist(adjPoints.b1, adjPoints.b2);  // base to base

    // Compute swingingBase start position from tip using arm triangle geometry
    const cosAngleAtTip = 1 - (chordDist * chordDist) / (2 * edgeDist * edgeDist);
    const angleAtTip = Math.acos(Math.max(-1, Math.min(1, cosAngleAtTip)));
    const tipToPivotAngle = pointAngle(adjPoints.t, pivotBase);
    const tipToSwingStartAngle = tipToPivotAngle - direction * angleAtTip;

    const swingStartPos: Point = {
        x: adjPoints.t.x + edgeDist * Math.cos(tipToSwingStartAngle),
        y: adjPoints.t.y + edgeDist * Math.sin(tipToSwingStartAngle),
    };

    // Compute start and end angles for the rotation around pivotBase
    const tipStartAngle = pointAngle(pivotBase, adjPoints.t);
    const swingStartAngle = pointAngle(pivotBase, swingStartPos);

    // Compute final tip position using circle-circle intersection
    const finalTip = computeFinalTipPosition(
        centerX, centerY, outerRadius, pivotBase, edgeDist, adjPoints.t, direction
    );
    const tipEndAngle = pointAngle(pivotBase, finalTip);

    // Total rotation from start to end angle
    let totalRotation = normalizeAngle(tipEndAngle - tipStartAngle);
    // Ensure rotation is in the correct direction (short way for adding)
    // For CW adding, rotation should be positive (CW)
    // For CCW adding, rotation should be negative (CCW)
    if (direction === 1 && totalRotation < 0) totalRotation += 2 * Math.PI;
    if (direction === -1 && totalRotation > 0) totalRotation -= 2 * Math.PI;

    const currentRotation = totalRotation * t;

    const tip: Point = {
        x: pivotBase.x + edgeDist * Math.cos(tipStartAngle + currentRotation),
        y: pivotBase.y + edgeDist * Math.sin(tipStartAngle + currentRotation),
    };

    const swingingBase: Point = {
        x: pivotBase.x + chordDist * Math.cos(swingStartAngle + currentRotation),
        y: pivotBase.y + chordDist * Math.sin(swingStartAngle + currentRotation),
    };

    return { tip, pivotBase, swingingBase };
}

// Main transition function using minimal context
export function computeMinimalTransition(ctx: MinimalTransitionContext): ArmPoints {
    const collapsed = getCollapsedState(ctx);
    const { sharedBase, progress, type, direction } = ctx;

    // Convert b1/b2 bases to pivot/swinging roles based on type and direction
    const collapsedRoles = assignBaseRoles(type, direction, collapsed.b1, collapsed.b2);

    let result: { tip: Point; pivotBase: Point; swingingBase: Point };

    if (progress <= 0.5) {
        const t = progress / 0.5;
        result = computePhase1(
            { tip: collapsed.t, ...collapsedRoles },
            sharedBase,
            ctx,
            t
        );
    } else {
        const t = (progress - 0.5) / 0.5;
        result = computePhase2(ctx, t);
    }

    // Convert back from roles to b1/b2
    const bases = unassignBaseRoles(type, direction, { pivotBase: result.pivotBase, swingingBase: result.swingingBase });

    return { t: result.tip, b1: bases.b1, b2: bases.b2 };
}

// ============== TransitionGeometry Provider Interface ==============

// Compute point positions from angle spec
export function computeArmPoints(
    spec: ArmRenderSpec,
    centerX: number,
    centerY: number,
    innerRadius: number,
    outerRadius: number
): ArmPoints {
    return getArmPoints(centerX, centerY, spec.tipAngle, spec.halfStep, innerRadius, outerRadius);
}

// Build static arm points from specs - computes positions once
export function buildStaticArmPoints(
    specs: Map<number, ArmRenderSpec>,
    centerX: number,
    centerY: number,
    innerRadius: number,
    outerRadius: number
): Map<number, ArmPoints> {
    const result = new Map<number, ArmPoints>();
    for (const [idx, spec] of specs) {
        result.set(idx, computeArmPoints(spec, centerX, centerY, innerRadius, outerRadius));
    }
    return result;
}

// Convenience function for tests: build static arm points from basic star parameters
export function buildStaticArms(
    armCount: number,
    rotation: number,
    centerX: number,
    centerY: number,
    innerRadius: number,
    outerRadius: number
): Map<number, ArmPoints> {
    const angleStep = getAngleStep(armCount);
    const halfStep = angleStep / 2;
    const result = new Map<number, ArmPoints>();
    for (let i = 0; i < armCount; i++) {
        const tipAngle = rotation - Math.PI / 2 + i * angleStep;
        result.set(i, getArmPoints(centerX, centerY, tipAngle, halfStep, innerRadius, outerRadius));
    }
    return result;
}

export interface TransitionGeometryParams {
    centerX: number;
    centerY: number;
    outerRadius: number;
    rotation: number;
    direction: TransitionDirection;
}

export interface TransitionGeometry {
    getInnerRadius(progress: number): number;
    // Adjacent arm points (SSOT - all geometry derives from this)
    getAdjPoints(): ArmPoints;
    // Shared base point (where pivot locks in Phase 2)
    getSharedBase(): Point;
}

export interface SingleTransitionParams extends TransitionGeometryParams {
    type: 'adding' | 'removing';
    sourceArmIndex: number;
    armCount: number;
}

interface AddingCoordinates {
    addingArmCount: number;
    addingDirection: TransitionDirection;
    addingSourceIndex: number;
}

function toAddingCoordinates(
    type: 'adding' | 'removing',
    sourceArmIndex: number,
    armCount: number,
    direction: TransitionDirection
): AddingCoordinates {
    const addingArmCount = type === 'adding' ? armCount : armCount - 1;
    const addingDirection: TransitionDirection = type === 'adding' ? direction : -direction as TransitionDirection;

    let addingSourceIndex: number;
    if (type === 'adding') {
        addingSourceIndex = sourceArmIndex;
    } else {
        // For removing: the adjacent arm in the original star becomes the source for adding
        // Map its original index to the smaller star's index system
        const originalAdjIndex = mod(sourceArmIndex + direction, armCount);
        // Indices after the removed arm shift down by 1
        addingSourceIndex = originalAdjIndex > sourceArmIndex
            ? originalAdjIndex - 1
            : originalAdjIndex;
    }

    return { addingArmCount, addingDirection, addingSourceIndex };
}

interface FinalPositionResult {
    tipAngle: number;
    halfStep: number;
}

function computFinalPositionForAdding(
    addingSourceIndex: number,
    addingDirection: TransitionDirection,
    addingArmCount: number,
    rotation: number
): FinalPositionResult {
    const targetArmCount = addingArmCount + 1;
    const targetAngleStep = getAngleStep(targetArmCount);
    const finalArmIndex = addingDirection === 1 ? addingSourceIndex + 1 : addingSourceIndex;
    return {
        tipAngle: rotation - Math.PI / 2 + finalArmIndex * targetAngleStep,
        halfStep: targetAngleStep / 2,
    };
}

function computeFinalPositionForRemoving(
    sourceArmIndex: number,
    armCount: number,
    rotation: number
): FinalPositionResult {
    const angleStep = getAngleStep(armCount);
    return {
        tipAngle: rotation - Math.PI / 2 + sourceArmIndex * angleStep,
        halfStep: angleStep / 2,
    };
}

export function createSingleTransitionGeometry(
    params: SingleTransitionParams,
    staticArmPoints: Map<number, ArmPoints>
): TransitionGeometry {
    const { type, sourceArmIndex, armCount, direction, outerRadius } = params;

    const { addingArmCount, addingDirection } = toAddingCoordinates(type, sourceArmIndex, armCount, direction);

    // The original index of the adjacent arm (for staticArmPoints lookup)
    const adjOriginalIndex = type === 'adding' ? sourceArmIndex : mod(sourceArmIndex + direction, armCount);

    // SSOT: Get adjacent arm points directly
    const adjPoints = staticArmPoints.get(adjOriginalIndex)!;

    // Shared base: where pivot locks in Phase 2
    // For CW: new arm's b1 shares with adjacent's b2
    // For CCW: new arm's b2 shares with adjacent's b1
    const sharedBase = addingDirection === 1 ? adjPoints.b2 : adjPoints.b1;

    return {
        getInnerRadius(progress: number): number {
            return getTransitionInnerRadius(addingArmCount, 'adding', progress, outerRadius);
        },

        getAdjPoints(): ArmPoints {
            return adjPoints;
        },

        getSharedBase(): Point {
            return sharedBase;
        },
    };
}

export function computeTransitionWithGeometry(
    geom: TransitionGeometry,
    params: TransitionGeometryParams,
    type: 'adding' | 'removing',
    progress: number
): ArmPoints {
    const { centerX, centerY, outerRadius, direction } = params;
    // SSOT: geometry provider works in "adding" coordinates, so use effectiveProgress
    const effectiveProgress = type === 'adding' ? progress : 1 - progress;
    // For removing, the geometry was created with opposite direction, so use that in computation
    const effectiveDirection: TransitionDirection = type === 'adding' ? direction : -direction as TransitionDirection;

    const minCtx: MinimalTransitionContext = {
        centerX,
        centerY,
        outerRadius,
        innerRadius: geom.getInnerRadius(effectiveProgress),
        adjPoints: geom.getAdjPoints(),
        sharedBase: geom.getSharedBase(),
        progress: effectiveProgress,
        direction: effectiveDirection,
        type: 'adding',  // Always use 'adding' since geometry is in adding coordinates
    };

    return computeMinimalTransition(minCtx);
}

export interface OverlappingTransitionParams extends TransitionGeometryParams {
    firstType: 'adding' | 'removing';
    firstSourceIndex: number;
    firstStartArmCount: number;
    firstDirection: TransitionDirection;
    secondType: 'adding' | 'removing';
    secondSourceIndex: number;
    secondDirection: TransitionDirection;
}

export function createFirstTransitionGeometry(
    params: OverlappingTransitionParams,
    getSecondProgress: (firstProgress: number) => number,
    staticArmPoints: Map<number, ArmPoints>
): TransitionGeometry {
    const {
        firstType, firstSourceIndex, firstStartArmCount, firstDirection,
        secondType, secondSourceIndex, secondDirection,
        outerRadius
    } = params;

    const { addingArmCount, addingDirection } = toAddingCoordinates(
        firstType, firstSourceIndex, firstStartArmCount, firstDirection
    );

    const targetArmCount = addingArmCount + 1;

    // The original index of the adjacent arm (for staticArmPoints lookup)
    const adjOriginalIndex = firstType === 'adding' ? firstSourceIndex : mod(firstSourceIndex + firstDirection, firstStartArmCount);

    // SSOT: Get adjacent arm points directly
    const adjPoints = staticArmPoints.get(adjOriginalIndex)!;

    // Shared base: where pivot locks in Phase 2
    const sharedBase = addingDirection === 1 ? adjPoints.b2 : adjPoints.b1;

    const getOriginalProgress = (addingProgress: number): number => {
        return firstType === 'adding' ? addingProgress : 1 - addingProgress;
    };

    return {
        getInnerRadius(addingProgress: number): number {
            const origP1 = getOriginalProgress(addingProgress);
            const p2 = getSecondProgress(origP1);
            return computeOverlappingInnerRadius({
                firstType,
                firstProgress: origP1,
                firstSourceIndex,
                firstStartArmCount,
                secondProgress: p2,
                secondSourceIndex,
                secondStartArmCount: targetArmCount,
            });
        },

        getAdjPoints(): ArmPoints {
            return adjPoints;
        },

        getSharedBase(): Point {
            return sharedBase;
        },
    };
}

export function createSecondTransitionGeometry(
    params: OverlappingTransitionParams,
    getFirstProgress: (secondProgress: number) => number,
    staticArmPoints: Map<number, ArmPoints>,
    firstTransitionArm: TransitionArmRenderSpec | null,
): TransitionGeometry {
    const {
        firstType, firstSourceIndex, firstStartArmCount, firstDirection,
        secondType, secondSourceIndex, secondDirection,
        outerRadius
    } = params;

    const intermediateCount = firstType === 'adding' ? firstStartArmCount + 1 : firstStartArmCount - 1;

    // Convert to adding coordinates using the shared helper
    const { addingArmCount, addingDirection } = toAddingCoordinates(
        secondType, secondSourceIndex, intermediateCount, secondDirection
    );

    const getOriginalProgress = (addingProgress: number): number => {
        return secondType === 'adding' ? addingProgress : 1 - addingProgress;
    };

    // The adjacent arm in intermediate star space (not mapped to adding space)
    // For adding: adjacent = source arm we unfold from
    // For removing: adjacent = arm in direction we collapse toward
    const secondAdjIndexInIntermediate = secondType === 'adding'
        ? secondSourceIndex
        : mod(secondSourceIndex + secondDirection, intermediateCount);

    // Check if the adjacent arm is the new arm from first transition (prohibited)
    const firstInsertIdx = firstType === 'adding'
        ? (firstDirection === 1 ? firstSourceIndex + 1 : firstSourceIndex)
        : -1;
    const isSecondAdjNewArm = firstType === 'adding' && secondAdjIndexInIntermediate === firstInsertIdx;

    if (isSecondAdjNewArm) {
        throw new Error('Second transition adjacent arm cannot be the new arm from first transition');
    }

    // Look up adjacent arm from staticArmPoints
    // staticArmPoints is always keyed by original indices (armCount stays at original throughout)
    // Map intermediate index to original
    let adjLookupIndex: number;
    if (firstType === 'removing') {
        adjLookupIndex = secondAdjIndexInIntermediate >= firstSourceIndex
            ? secondAdjIndexInIntermediate + 1
            : secondAdjIndexInIntermediate;
    } else {
        adjLookupIndex = secondAdjIndexInIntermediate > firstInsertIdx
            ? secondAdjIndexInIntermediate - 1
            : secondAdjIndexInIntermediate;
    }

    const adjPoints = staticArmPoints.get(adjLookupIndex);
    if (!adjPoints) {
        throw new Error(`Adjacent arm at index ${adjLookupIndex} not found in staticArmPoints`);
    }

    // Shared base: where pivot locks in Phase 2
    const sharedBase = addingDirection === 1 ? adjPoints.b2 : adjPoints.b1;

    return {
        getInnerRadius(addingProgress: number): number {
            const origP2 = getOriginalProgress(addingProgress);
            const p1 = getFirstProgress(origP2);
            return computeOverlappingInnerRadius({
                firstType,
                firstProgress: p1,
                firstSourceIndex,
                firstStartArmCount,
                secondProgress: origP2,
                secondSourceIndex,
                secondStartArmCount: intermediateCount,
            });
        },

        getAdjPoints(): ArmPoints {
            return adjPoints;
        },

        getSharedBase(): Point {
            return sharedBase;
        },
    };
}

// ============== Overlapping Transition Support ==============

export interface OverlappingTransitionState {
    firstType: 'adding' | 'removing';
    firstProgress: number;
    firstSourceIndex: number;
    firstStartArmCount: number;
    secondProgress: number | null;  // null if second hasn't started
    secondSourceIndex: number | null;
    secondStartArmCount: number | null;
}

export function selectDisjointSourceArm(firstSourceIndex: number, armCount: number): number {
    const offset = Math.floor(armCount / 2);
    return (firstSourceIndex + offset) % armCount;
}

export function computeOverlappingInnerRadius(state: OverlappingTransitionState): number {
    const startCount = state.firstStartArmCount;
    const endCount = state.secondStartArmCount !== null
        ? state.secondStartArmCount + (state.firstType === 'adding' ? 1 : -1)
        : startCount + (state.firstType === 'adding' ? 1 : -1);

    let combinedProgress: number;
    if (state.secondProgress !== null) {
        combinedProgress = (state.firstProgress + state.secondProgress) / 2;
    } else {
        combinedProgress = state.firstProgress;
    }

    const startRatio = getInnerRadiusRatio(startCount);
    const endRatio = getInnerRadiusRatio(endCount);
    return lerp(startRatio, endRatio, combinedProgress) * STAR_OUTER_RADIUS;
}


export interface ArmRedistributionResult {
    tipAngle: number;
    halfStep: number;
}

export function computeArmRedistribution(
    armIndex: number,
    currentTipAngle: number,
    currentHalfStep: number,
    transitionType: 'adding' | 'removing',
    transitionProgress: number,
    transitionSourceIndex: number,
    transitionDirection: TransitionDirection,
    currentArmCount: number,
    rotation: number
): ArmRedistributionResult {
    // Redistribution has two components:
    // 1. Angular redistribution: arms move to new angular positions
    // 2. HalfStep change: arms shrink/expand to make room for new arm
    //
    // Phase timing (per star.txt):
    // - Phase 1: Transitioning arm rotates, other arms only change halfStep (no angular movement)
    // - Phase 2: Transitioning arm pivots, other arms redistribute angularly
    //
    // For ADDING:
    //   Phase 1: New arm unfolds from adjacent, others stay put (only halfStep shrinks)
    //   Phase 2: New arm pivots to final position, others redistribute angularly
    //
    // For REMOVING:
    //   Phase 1: Source arm rotates to adjacent tip, others stay put (only halfStep expands)
    //   Phase 2: Source arm collapses onto adjacent, others redistribute angularly

    const targetArmCount = transitionType === 'adding' ? currentArmCount + 1 : currentArmCount - 1;
    const targetAngleStep = getAngleStep(targetArmCount);
    const targetHalfStep = targetAngleStep / 2;

    // Phase timing differs for adding vs removing (they are inverses):
    // - ADDING Phase 2: other arms spread apart as new arm pivots from base to final position
    // - REMOVING Phase 1: other arms close gap as source arm rotates to adjacent tip
    const redistributionT = transitionType === 'adding'
        ? (transitionProgress <= 0.5 ? 0 : (transitionProgress - 0.5) / 0.5)  // Start at p=0.5
        : Math.min(transitionProgress / 0.5, 1);  // Complete by p=0.5

    // Compute target angular position
    let targetTipAngle: number;
    if (transitionType === 'removing') {
        // For removing: arms shift to fill the gap left by source
        if (armIndex > transitionSourceIndex) {
            targetTipAngle = rotation - Math.PI / 2 + (armIndex - 1) * targetAngleStep;
        } else {
            targetTipAngle = rotation - Math.PI / 2 + armIndex * targetAngleStep;
        }
    } else {
        // For adding: arms shift to make room for new arm
        // Insert position depends on direction
        const shouldShift = transitionDirection === 1
            ? (armIndex > transitionSourceIndex)
            : (armIndex >= transitionSourceIndex);

        if (shouldShift) {
            targetTipAngle = rotation - Math.PI / 2 + (armIndex + 1) * targetAngleStep;
        } else {
            targetTipAngle = rotation - Math.PI / 2 + armIndex * targetAngleStep;
        }
    }

    // Interpolate both angular position and halfStep using the same phase timing
    const tipAngle = currentTipAngle + (targetTipAngle - currentTipAngle) * redistributionT;
    const halfStep = currentHalfStep + (targetHalfStep - currentHalfStep) * redistributionT;

    return { tipAngle, halfStep };
}

export interface OverlappingRedistributionParams {
    originalArmIndex: number;
    startArmCount: number;
    firstSourceIndex: number;
    secondSourceIndex: number; // index in INTERMEDIATE star
    firstType: 'adding' | 'removing';
    secondType: 'adding' | 'removing';
    firstDirection: TransitionDirection;
    secondDirection: TransitionDirection;
    p1: number;
    p2: number;
    rotation: number;
}

export function computeOverlappingArmRedistribution(params: OverlappingRedistributionParams): ArmRedistributionResult | null {
    const {
        originalArmIndex: i,
        startArmCount,
        firstSourceIndex,
        secondSourceIndex,
        firstType,
        secondType,
        firstDirection,
        secondDirection,
        p1,
        p2,
        rotation,
    } = params;

    // Skip source arms for removing transitions
    if (firstType === 'removing' && i === firstSourceIndex) return null;

    const firstInsertIdx = firstDirection === 1 ? firstSourceIndex + 1 : firstSourceIndex;

    // Map second source to original index space
    let secondSourceOriginal: number;
    if (firstType === 'removing') {
        secondSourceOriginal = secondSourceIndex >= firstSourceIndex
            ? secondSourceIndex + 1 : secondSourceIndex;
    } else {
        secondSourceOriginal = secondSourceIndex > firstInsertIdx
            ? secondSourceIndex - 1 : secondSourceIndex;
    }
    if (secondType === 'removing' && i === secondSourceOriginal && p2 > 0) return null;

    // Arm counts at each stage
    const intermediateCount = firstType === 'adding' ? startArmCount + 1 : startArmCount - 1;
    const finalCount = secondType === 'adding' ? intermediateCount + 1 : intermediateCount - 1;

    // Angle steps
    const origAngleStep = getAngleStep(startArmCount);
    const finalAngleStep = getAngleStep(finalCount);

    // Original position
    const origTipAngle = rotation - Math.PI / 2 + i * origAngleStep;
    const origHalfStep = origAngleStep / 2;

    // Final index after both transitions
    let finalIndex = i;
    if (firstType === 'adding') {
        if (i >= firstInsertIdx) finalIndex++;
    } else {
        if (i > firstSourceIndex) finalIndex--;
    }
    const secondInsertIdx = secondDirection === 1
        ? mod(secondSourceIndex + 1, intermediateCount)
        : secondSourceIndex;
    if (secondType === 'adding') {
        if (finalIndex >= secondInsertIdx) finalIndex++;
    } else {
        if (finalIndex > secondSourceIndex) finalIndex--;
    }

    // Final position
    const finalTipAngle = rotation - Math.PI / 2 + finalIndex * finalAngleStep;
    const finalHalfStep = finalAngleStep / 2;

    // Redistribution progress: for adding it's Phase 2, for removing it's Phase 1
    const firstT = firstType === 'adding'
        ? (p1 <= 0.5 ? 0 : (p1 - 0.5) / 0.5)
        : Math.min(p1 / 0.5, 1);
    const secondT = secondType === 'adding'
        ? (p2 <= 0.5 ? 0 : (p2 - 0.5) / 0.5)
        : Math.min(p2 / 0.5, 1);

    // Total "arm units" = static arms +/- fractional arms from transitions
    const firstDelta = firstType === 'adding' ? firstT : -firstT;
    const secondDelta = secondType === 'adding' ? secondT : -secondT;
    const totalArmUnits = startArmCount + firstDelta + secondDelta;
    const anglePerArm = 2 * Math.PI / totalArmUnits;
    const halfStep = anglePerArm / 2;

    // Gap sizes (positive for adding, negative for removing)
    const firstGap = anglePerArm * firstDelta;
    const secondGap = anglePerArm * secondDelta;

    // Count gaps before this arm's position
    let gapsBefore = 0;
    if (firstType === 'adding') {
        if (i >= firstInsertIdx) gapsBefore += firstGap;
    } else {
        if (i > firstSourceIndex) gapsBefore += firstGap;
    }
    if (secondType === 'adding') {
        let intermediateIdx = i;
        if (firstType === 'adding' && i >= firstInsertIdx) intermediateIdx++;
        else if (firstType === 'removing' && i > firstSourceIndex) intermediateIdx--;
        if (intermediateIdx >= secondInsertIdx) gapsBefore += secondGap;
    } else {
        let intermediateIdx = i;
        if (firstType === 'adding' && i >= firstInsertIdx) intermediateIdx++;
        else if (firstType === 'removing' && i > firstSourceIndex) intermediateIdx--;
        if (intermediateIdx > secondSourceIndex) gapsBefore += secondGap;
    }

    const tipAngle = rotation - Math.PI / 2 + i * anglePerArm + gapsBefore;

    return { tipAngle, halfStep };
}

// ============== Overlapping Transition Input Transformation ==============

export interface FirstTransitionState {
    type: 'adding' | 'removing';
    direction: TransitionDirection;
    progress: number;
    sourceArmIndex: number;
    startArmCount: number;
}

// ============== Render Spec System ==============

export interface ArmRenderSpec {
    tipAngle: number;
    halfStep: number;
}

export interface StaticArmPoints extends ArmPoints {
    armIndex: number;
}

export interface TransitionArmRenderSpec extends ArmRenderSpec {
    tip: Point;
    b1: Point;
    b2: Point;
}

export interface TransitionRenderSpec {
    staticArms: Map<number, ArmRenderSpec>;
    firstTransitionArm: TransitionArmRenderSpec | null;
    secondTransitionArm: TransitionArmRenderSpec | null;
    innerRadius: number;
}

export interface SingleTransitionState {
    type: 'adding' | 'removing';
    direction: TransitionDirection;
    progress: number;
    sourceArmIndex: number;
    startArmCount: number;
}

export interface PlannedTransitionBundle {
    first: SingleTransitionState;
    second: SingleTransitionState | null;
    overlapStart: number | null;
}

export interface RenderSpecParams {
    bundle: PlannedTransitionBundle | null;
    armCount: number;
    rotation: number;
    centerX: number;
    centerY: number;
    outerRadius: number;
}

function computeHiddenIndices(
    bundle: PlannedTransitionBundle,
    armCount: number
): Set<number> {
    const hidden = new Set<number>();
    const { first, second } = bundle;

    // armCount stays at original value throughout the transition
    // Static arms are always indexed in original space

    // Hide first transition's source arm if removing (throughout the entire bundle)
    if (first.type === 'removing') {
        hidden.add(first.sourceArmIndex);
    }

    // Hide second transition's source arm if removing (map intermediate index to original)
    if (second?.type === 'removing' && second.progress > 0 && second.progress < 1) {
        let originalIndex: number;
        if (first.type === 'removing') {
            // First is removing: intermediate indices >= first.sourceArmIndex shift up
            originalIndex = second.sourceArmIndex >= first.sourceArmIndex
                ? second.sourceArmIndex + 1
                : second.sourceArmIndex;
        } else {
            // First is adding: intermediate indices > insertIdx shift down
            const insertIdx = first.direction === 1
                ? first.sourceArmIndex + 1
                : first.sourceArmIndex;
            originalIndex = second.sourceArmIndex > insertIdx
                ? second.sourceArmIndex - 1
                : second.sourceArmIndex;
        }
        hidden.add(originalIndex);
    }

    return hidden;
}

function computeBundleInnerRadius(bundle: PlannedTransitionBundle): number {
    const { first, second } = bundle;
    if (second) {
        const combinedProgress = (first.progress + second.progress) / 2;
        const endCount = second.startArmCount + (second.type === 'adding' ? 1 : -1);
        const startRatio = getInnerRadiusRatio(first.startArmCount);
        const endRatio = getInnerRadiusRatio(endCount);
        return lerp(startRatio, endRatio, combinedProgress) * STAR_OUTER_RADIUS;
    }
    return getTransitionInnerRadius(first.startArmCount, first.type, first.progress);
}

export function computeStaticArmSpec(
    armIndex: number,
    bundle: PlannedTransitionBundle | null,
    armCount: number,
    rotation: number
): ArmRenderSpec {
    const baseAngleStep = getAngleStep(armCount);
    let tipAngle = rotation - Math.PI / 2 + armIndex * baseAngleStep;
    let halfStep = baseAngleStep / 2;

    if (!bundle) {
        return { tipAngle, halfStep };
    }

    const { first, second } = bundle;

    if (second) {
        // Both transitions - use overlapping redistribution
        // armCount stays at original value throughout the transition
        const result = computeOverlappingArmRedistribution({
            originalArmIndex: armIndex,
            startArmCount: first.startArmCount,
            firstSourceIndex: first.sourceArmIndex,
            secondSourceIndex: second.sourceArmIndex,
            firstType: first.type,
            secondType: second.type,
            firstDirection: first.direction,
            secondDirection: second.direction,
            p1: first.progress,
            p2: second.progress,
            rotation,
        });
        if (result) {
            return result;
        }
    } else {
        // Only first transition active
        const result = computeArmRedistribution(
            armIndex, tipAngle, halfStep,
            first.type, first.progress,
            first.sourceArmIndex, first.direction,
            armCount, rotation
        );
        return result;
    }

    return { tipAngle, halfStep };
}

interface TransitionComputeParams {
    centerX: number;
    centerY: number;
    outerRadius: number;
    rotation: number;
}

function computeFirstTransitionArm(
    bundle: PlannedTransitionBundle,
    params: TransitionComputeParams,
    staticArmPoints: Map<number, ArmPoints>
): TransitionArmRenderSpec | null {
    const { first, second, overlapStart } = bundle;

    // When there's no second transition and first is complete, return null
    if (!second && first.progress >= 1) return null;

    // When first is complete but second is still going, cap progress at 1
    const firstProgress = Math.min(first.progress, 1);

    const { centerX, centerY, outerRadius, rotation } = params;

    let arm: ArmPoints;
    if (second) {
        const overlap = overlapStart ?? 0;
        const getSecondProgress = (fp: number) => Math.max(0, (fp - overlap) / (1 - overlap));

        const overlappingParams: OverlappingTransitionParams = {
            centerX, centerY, outerRadius, rotation,
            direction: first.direction,
            firstType: first.type,
            firstSourceIndex: first.sourceArmIndex,
            firstStartArmCount: first.startArmCount,
            firstDirection: first.direction,
            secondType: second.type,
            secondSourceIndex: second.sourceArmIndex,
            secondDirection: second.direction,
        };

        const geom = createFirstTransitionGeometry(overlappingParams, getSecondProgress, staticArmPoints);
        arm = computeTransitionWithGeometry(
            geom,
            { centerX, centerY, outerRadius, rotation, direction: first.direction },
            first.type,
            firstProgress
        );
    } else {
        const geom = createSingleTransitionGeometry({
            type: first.type,
            sourceArmIndex: first.sourceArmIndex,
            armCount: first.startArmCount,
            centerX, centerY, outerRadius, rotation,
            direction: first.direction,
        }, staticArmPoints);
        arm = computeTransitionWithGeometry(
            geom,
            { centerX, centerY, outerRadius, rotation, direction: first.direction },
            first.type,
            firstProgress
        );
    }

    const b1Angle = angle(centerX, centerY, arm.b1.x, arm.b1.y);
    const b2Angle = angle(centerX, centerY, arm.b2.x, arm.b2.y);
    let tipAngle = (b1Angle + b2Angle) / 2;
    if (Math.abs(b2Angle - b1Angle) > Math.PI) {
        tipAngle = tipAngle + (tipAngle > 0 ? -Math.PI : Math.PI);
    }
    const halfStep = Math.abs(normalizeAngle(b2Angle - b1Angle)) / 2;

    return { tipAngle, halfStep, tip: arm.t, b1: arm.b1, b2: arm.b2 };
}

function computeSecondTransitionArm(
    bundle: PlannedTransitionBundle,
    params: TransitionComputeParams,
    staticArmPoints: Map<number, ArmPoints>,
    firstTransitionArm: TransitionArmRenderSpec | null
): TransitionArmRenderSpec | null {
    const { first, second, overlapStart } = bundle;
    if (!second || second.progress <= 0 || second.progress >= 1) return null;

    const { centerX, centerY, outerRadius, rotation } = params;
    const overlap = overlapStart ?? 0;
    const getFirstProgress = (sp: number) => overlap + sp * (1 - overlap);

    // staticArmPoints is always keyed by original indices (armCount stays at original throughout)

    const overlappingParams: OverlappingTransitionParams = {
        centerX, centerY, outerRadius, rotation,
        direction: first.direction,
        firstType: first.type,
        firstSourceIndex: first.sourceArmIndex,
        firstStartArmCount: first.startArmCount,
        firstDirection: first.direction,
        secondType: second.type,
        secondSourceIndex: second.sourceArmIndex,
        secondDirection: second.direction,
    };

    const geom = createSecondTransitionGeometry(overlappingParams, getFirstProgress, staticArmPoints, firstTransitionArm);
    const arm = computeTransitionWithGeometry(
        geom,
        { centerX, centerY, outerRadius, rotation, direction: second.direction },
        second.type,
        second.progress
    );

    const b1Angle = angle(centerX, centerY, arm.b1.x, arm.b1.y);
    const b2Angle = angle(centerX, centerY, arm.b2.x, arm.b2.y);
    let tipAngle = (b1Angle + b2Angle) / 2;
    if (Math.abs(b2Angle - b1Angle) > Math.PI) {
        tipAngle = tipAngle + (tipAngle > 0 ? -Math.PI : Math.PI);
    }
    const halfStep = Math.abs(normalizeAngle(b2Angle - b1Angle)) / 2;

    return { tipAngle, halfStep, tip: arm.t, b1: arm.b1, b2: arm.b2 };
}

export function getRenderSpec(params: RenderSpecParams): TransitionRenderSpec {
    const { bundle, armCount, rotation, centerX, centerY, outerRadius } = params;

    const staticArms = new Map<number, ArmRenderSpec>();
    let innerRadius: number;
    let firstTransitionArm: TransitionArmRenderSpec | null = null;
    let secondTransitionArm: TransitionArmRenderSpec | null = null;

    if (!bundle) {
        innerRadius = getInnerRadiusForArmCount(armCount);
        const baseAngleStep = getAngleStep(armCount);
        for (let i = 0; i < armCount; i++) {
            staticArms.set(i, {
                tipAngle: rotation - Math.PI / 2 + i * baseAngleStep,
                halfStep: baseAngleStep / 2,
            });
        }
    } else {
        innerRadius = computeBundleInnerRadius(bundle);
        const hidden = computeHiddenIndices(bundle, armCount);

        for (let i = 0; i < armCount; i++) {
            if (hidden.has(i)) continue;

            const spec = computeStaticArmSpec(i, bundle, armCount, rotation);
            if (spec) {
                staticArms.set(i, spec);
            }
        }

        // Compute point positions from specs (SSOT - computed once)
        const staticArmPoints = buildStaticArmPoints(staticArms, centerX, centerY, innerRadius, outerRadius);

        const transitionParams = { centerX, centerY, outerRadius, rotation };
        firstTransitionArm = computeFirstTransitionArm(bundle, transitionParams, staticArmPoints);
        secondTransitionArm = computeSecondTransitionArm(bundle, transitionParams, staticArmPoints, firstTransitionArm);
    }

    return {
        staticArms,
        firstTransitionArm,
        secondTransitionArm,
        innerRadius,
    };
}
