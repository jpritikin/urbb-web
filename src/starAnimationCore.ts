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

function toFlatResult(arm: ArmPoints) {
    return {
        tipX: arm.t.x, tipY: arm.t.y,
        base1X: arm.b1.x, base1Y: arm.b1.y,
        base2X: arm.b2.x, base2Y: arm.b2.y,
    };
}

// Modular index helper
export function mod(n: number, m: number): number {
    return ((n % m) + m) % m;
}

// ============== New Minimal Transition System ==============

export interface MinimalTransitionContext {
    centerX: number;
    centerY: number;
    innerRadius: number;
    outerRadius: number;
    // Adjacent arm base angles (for collapsed state at progress=0)
    // b1 = CCW base, b2 = CW base (standard star arm convention)
    adjB1Angle: number;
    adjB2Angle: number;
    // Final position base angles (for extended state at progress=1)
    finalB1Angle: number;
    finalB2Angle: number;
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
function getCollapsedState(ctx: MinimalTransitionContext): { tip: Point; b1: Point; b2: Point } {
    const { centerX, centerY, innerRadius, outerRadius, adjB1Angle, adjB2Angle } = ctx;

    const b1: Point = {
        x: centerX + innerRadius * Math.cos(adjB1Angle),
        y: centerY + innerRadius * Math.sin(adjB1Angle),
    };
    const b2: Point = {
        x: centerX + innerRadius * Math.cos(adjB2Angle),
        y: centerY + innerRadius * Math.sin(adjB2Angle),
    };

    const adjTipAngle = (adjB1Angle + adjB2Angle) / 2;
    const tip: Point = {
        x: centerX + outerRadius * Math.cos(adjTipAngle),
        y: centerY + outerRadius * Math.sin(adjTipAngle),
    };

    return { tip, b1, b2 };
}

function getExtendedState(ctx: MinimalTransitionContext): { tip: Point; b1: Point; b2: Point } {
    const { centerX, centerY, innerRadius, outerRadius, finalB1Angle, finalB2Angle } = ctx;

    const b1: Point = {
        x: centerX + innerRadius * Math.cos(finalB1Angle),
        y: centerY + innerRadius * Math.sin(finalB1Angle),
    };
    const b2: Point = {
        x: centerX + innerRadius * Math.cos(finalB2Angle),
        y: centerY + innerRadius * Math.sin(finalB2Angle),
    };

    const tipAngle = (finalB1Angle + finalB2Angle) / 2;
    const tip: Point = {
        x: centerX + outerRadius * Math.cos(tipAngle),
        y: centerY + outerRadius * Math.sin(tipAngle),
    };

    return { tip, b1, b2 };
}

// Phase 1: Long rotation around tip - bases swing "the long way" (180° < |rotation| < 360°)
// At t=0: collapsed onto adjacent
// At t=1: pivot base has swung to the adjacent's base position (for Phase 2)
function computePhase1(
    collapsed: { tip: Point; pivotBase: Point; swingingBase: Point },
    ctx: MinimalTransitionContext,
    t: number
): { tip: Point; pivotBase: Point; swingingBase: Point } {
    const { centerX, centerY, innerRadius, adjB1Angle, adjB2Angle, type, direction } = ctx;
    const tip = collapsed.tip; // Tip stays fixed at adjacent tip during Phase 1

    const startDist = pointDist(tip, collapsed.pivotBase);
    const pivotStartAngle = pointAngle(tip, collapsed.pivotBase);
    const swingStartAngle = pointAngle(tip, collapsed.swingingBase);

    // Target: pivot base swings to the adjacent's shared base position
    // Per docs/star.txt: S2 locks to A1 (for the CCW case described in spec)
    // For CW direction (mirrored): S1 locks to A2
    const sharedBaseAngle = direction === 1 ? adjB2Angle : adjB1Angle;
    const targetPivotAngle = sharedBaseAngle;
    const targetPoint: Point = {
        x: centerX + innerRadius * Math.cos(targetPivotAngle),
        y: centerY + innerRadius * Math.sin(targetPivotAngle),
    };
    const pivotTargetAngle = pointAngle(tip, targetPoint);
    const targetDist = pointDist(tip, targetPoint);

    // Phase 1 rotates the "long way" (>180°) in the transition direction
    const diff = normalizeAngle(pivotTargetAngle - pivotStartAngle);
    const totalRotation = diff + direction * 2 * Math.PI;

    const currentRotation = totalRotation * t;
    const currentDist = lerp(startDist, targetDist, t);

    const pivotBase: Point = {
        x: tip.x + currentDist * Math.cos(pivotStartAngle + currentRotation),
        y: tip.y + currentDist * Math.sin(pivotStartAngle + currentRotation),
    };
    const swingingBase: Point = {
        x: tip.x + currentDist * Math.cos(swingStartAngle + currentRotation),
        y: tip.y + currentDist * Math.sin(swingStartAngle + currentRotation),
    };

    return { tip, pivotBase, swingingBase };
}

// Phase 2: Rotate around pivot from phase1End to final position
// The pivot base is locked to the adjacent arm's base - tip and swinging base rotate around it
// Phase 2 rotates the "short way" (<180°) but must continue in the same direction as Phase 1
function computePhase2(
    phase1End: { tip: Point; pivotBase: Point; swingingBase: Point },
    extended: { tip: Point; pivotBase: Point; swingingBase: Point },
    ctx: MinimalTransitionContext,
    t: number
): { tip: Point; pivotBase: Point; swingingBase: Point } {
    const { centerX, centerY, innerRadius, adjB1Angle, adjB2Angle, direction } = ctx;

    // Pivot base tracks the adjacent arm's shared base (which moves during redistribution)
    // Per docs/star.txt: S2 locks to A1 (for the CCW case described in spec)
    // For CW direction (mirrored): S1 locks to A2
    const sharedBaseAngle = direction === 1 ? adjB2Angle : adjB1Angle;
    const pivotBase: Point = {
        x: centerX + innerRadius * Math.cos(sharedBaseAngle),
        y: centerY + innerRadius * Math.sin(sharedBaseAngle),
    };

    // Rotate tip and swingingBase around the pivot from phase1End to extended
    const rotateAroundPivot = (start: Point, end: Point): Point => {
        const startAngle = pointAngle(pivotBase, start);
        const endAngle = pointAngle(pivotBase, end);
        const startDist = pointDist(pivotBase, start);
        const endDist = pointDist(pivotBase, end);

        let diff = normalizeAngle(endAngle - startAngle);
        if (direction === 1 && diff < 0) {
            diff += 2 * Math.PI;
        } else if (direction === -1 && diff > 0) {
            diff -= 2 * Math.PI;
        }

        const a = startAngle + diff * t;
        const d = lerp(startDist, endDist, t);
        return { x: pivotBase.x + d * Math.cos(a), y: pivotBase.y + d * Math.sin(a) };
    };

    return {
        tip: rotateAroundPivot(phase1End.tip, extended.tip),
        pivotBase,
        swingingBase: rotateAroundPivot(phase1End.swingingBase, extended.swingingBase),
    };
}

// Main transition function using minimal context
export function computeMinimalTransition(ctx: MinimalTransitionContext): ArmPoints {
    const collapsed = getCollapsedState(ctx);
    const extended = getExtendedState(ctx);

    const { progress, type, direction } = ctx;

    // Convert b1/b2 bases to pivot/swinging roles based on type and direction
    const collapsedRoles = assignBaseRoles(type, direction, collapsed.b1, collapsed.b2);
    const extendedRoles = assignBaseRoles(type, direction, extended.b1, extended.b2);

    let result: { tip: Point; pivotBase: Point; swingingBase: Point };

    if (progress <= 0.5) {
        const t = progress / 0.5;
        result = computePhase1(
            { tip: collapsed.tip, ...collapsedRoles },
            ctx,
            t
        );
    } else {
        const t = (progress - 0.5) / 0.5;
        const phase1End = computePhase1(
            { tip: collapsed.tip, ...collapsedRoles },
            ctx,
            1.0
        );
        result = computePhase2(
            phase1End,
            { tip: extended.tip, ...extendedRoles },
            ctx,
            t
        );
    }

    // Convert back from roles to b1/b2
    const bases = unassignBaseRoles(type, direction, { pivotBase: result.pivotBase, swingingBase: result.swingingBase });

    return { t: result.tip, b1: bases.b1, b2: bases.b2 };
}

// ============== TransitionGeometry Provider Interface ==============

export interface TransitionGeometryParams {
    centerX: number;
    centerY: number;
    outerRadius: number;
    rotation: number;
    direction: TransitionDirection;
}

export interface TransitionGeometry {
    getInnerRadius(progress: number): number;
    // Adjacent arm base angles (b1 = CCW, b2 = CW)
    getAdjB1Angle(progress: number): number;
    getAdjB2Angle(progress: number): number;
    // Final position base angles
    getFinalB1Angle(): number;
    getFinalB2Angle(): number;
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
    // New arm goes to the target star position
    const targetArmCount = addingArmCount + 1;
    const targetAngleStep = (2 * Math.PI) / targetArmCount;
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
    // For removing: the "extended" position is the arm's original position
    const angleStep = (2 * Math.PI) / armCount;
    return {
        tipAngle: rotation - Math.PI / 2 + sourceArmIndex * angleStep,
        halfStep: angleStep / 2,
    };
}

export function createSingleTransitionGeometry(params: SingleTransitionParams): TransitionGeometry {
    const { type, sourceArmIndex, armCount, outerRadius, rotation, direction } = params;

    const { addingArmCount, addingDirection, addingSourceIndex } = toAddingCoordinates(type, sourceArmIndex, armCount, direction);

    const angleStep = (2 * Math.PI) / addingArmCount;
    const halfStep = angleStep / 2;

    // Adjacent is always the source arm for adding (we unfold FROM it)
    const adjIndex = addingSourceIndex;
    const adjTipAngleStart = rotation - Math.PI / 2 + adjIndex * angleStep;

    const finalPos = type === 'adding'
        ? computFinalPositionForAdding(addingSourceIndex, addingDirection, addingArmCount, rotation)
        : computeFinalPositionForRemoving(sourceArmIndex, armCount, rotation);
    const finalTipAngle = finalPos.tipAngle;
    const finalHalfStep = finalPos.halfStep;

    return {
        getInnerRadius(progress: number): number {
            return getTransitionInnerRadius(addingArmCount, 'adding', progress, outerRadius);
        },

        // b1 = CCW base = tipAngle - halfStep
        getAdjB1Angle(progress: number): number {
            const adjRedist = computeArmRedistribution(
                adjIndex, adjTipAngleStart, halfStep, 'adding', progress,
                addingSourceIndex, addingDirection, addingArmCount, rotation
            );
            return adjRedist.tipAngle - adjRedist.halfStep;
        },

        // b2 = CW base = tipAngle + halfStep
        getAdjB2Angle(progress: number): number {
            const adjRedist = computeArmRedistribution(
                adjIndex, adjTipAngleStart, halfStep, 'adding', progress,
                addingSourceIndex, addingDirection, addingArmCount, rotation
            );
            return adjRedist.tipAngle + adjRedist.halfStep;
        },

        getFinalB1Angle(): number {
            return finalTipAngle - finalHalfStep;
        },

        getFinalB2Angle(): number {
            return finalTipAngle + finalHalfStep;
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
    // Also use type='adding' since everything is in adding coordinates internally
    const effectiveDirection: TransitionDirection = type === 'adding' ? direction : -direction as TransitionDirection;

    const minCtx: MinimalTransitionContext = {
        centerX,
        centerY,
        innerRadius: geom.getInnerRadius(effectiveProgress),
        outerRadius,
        adjB1Angle: geom.getAdjB1Angle(effectiveProgress),
        adjB2Angle: geom.getAdjB2Angle(effectiveProgress),
        finalB1Angle: geom.getFinalB1Angle(),
        finalB2Angle: geom.getFinalB2Angle(),
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
    getSecondProgress: (firstProgress: number) => number
): TransitionGeometry {
    const {
        firstType, firstSourceIndex, firstStartArmCount, firstDirection,
        secondType, secondSourceIndex, secondDirection, rotation
    } = params;

    const { addingArmCount, addingDirection, addingSourceIndex } = toAddingCoordinates(
        firstType, firstSourceIndex, firstStartArmCount, firstDirection
    );

    const angleStep = (2 * Math.PI) / addingArmCount;
    const halfStep = angleStep / 2;
    const targetArmCount = addingArmCount + 1;
    const targetAngleStep = (2 * Math.PI) / targetArmCount;
    const targetHalfStep = targetAngleStep / 2;

    // Adjacent is always the source arm for adding (we unfold FROM it)
    const adjIndex = addingSourceIndex;

    const finalPos = firstType === 'adding'
        ? computFinalPositionForAdding(addingSourceIndex, addingDirection, addingArmCount, rotation)
        : computeFinalPositionForRemoving(firstSourceIndex, firstStartArmCount, rotation);
    const finalTipAngle = finalPos.tipAngle;
    const finalHalfStep = finalPos.halfStep;

    // Map progress from adding coordinates back to original coordinates for redistribution
    const getOriginalProgress = (addingProgress: number): number => {
        return firstType === 'adding' ? addingProgress : 1 - addingProgress;
    };

    // The original index of the adjacent arm (for redistribution lookup)
    const adjOriginalIndex = firstType === 'adding' ? adjIndex : mod(firstSourceIndex + firstDirection, firstStartArmCount);

    const getAdjRedist = (addingProgress: number): ArmRedistributionResult => {
        const origP1 = getOriginalProgress(addingProgress);
        const p2 = getSecondProgress(origP1);
        const result = computeOverlappingArmRedistribution({
            originalArmIndex: adjOriginalIndex,
            startArmCount: firstStartArmCount,
            firstSourceIndex,
            secondSourceIndex,
            firstType,
            secondType,
            firstDirection,
            secondDirection,
            p1: origP1,
            p2,
            rotation,
        });
        if (result) return result;
        const adjTipAngle = rotation - Math.PI / 2 + adjIndex * angleStep;
        return { tipAngle: adjTipAngle, halfStep };
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

        getAdjB1Angle(addingProgress: number): number {
            const redist = getAdjRedist(addingProgress);
            return redist.tipAngle - redist.halfStep;
        },

        getAdjB2Angle(addingProgress: number): number {
            const redist = getAdjRedist(addingProgress);
            return redist.tipAngle + redist.halfStep;
        },

        getFinalB1Angle(): number {
            return finalTipAngle - finalHalfStep;
        },

        getFinalB2Angle(): number {
            return finalTipAngle + finalHalfStep;
        },
    };
}

export function createSecondTransitionGeometry(
    params: OverlappingTransitionParams,
    getFirstProgress: (secondProgress: number) => number,
    staticArms: Map<number, ArmRenderSpec>,
    firstTransitionArm: TransitionArmRenderSpec | null,
    firstCompleted: boolean
): TransitionGeometry {
    const {
        firstType, firstSourceIndex, firstStartArmCount, firstDirection,
        secondType, secondSourceIndex, secondDirection, rotation,
    } = params;

    const intermediateCount = firstType === 'adding' ? firstStartArmCount + 1 : firstStartArmCount - 1;

    // Convert to adding coordinates using the shared helper
    const { addingArmCount, addingDirection, addingSourceIndex } = toAddingCoordinates(
        secondType, secondSourceIndex, intermediateCount, secondDirection
    );

    const finalPos = secondType === 'adding'
        ? computFinalPositionForAdding(addingSourceIndex, addingDirection, addingArmCount, rotation)
        : computeFinalPositionForRemoving(secondSourceIndex, intermediateCount, rotation);
    const finalTipAngle = finalPos.tipAngle;
    const finalHalfStep = finalPos.halfStep;

    const getOriginalProgress = (addingProgress: number): number => {
        return secondType === 'adding' ? addingProgress : 1 - addingProgress;
    };

    // The adjacent arm in intermediate star space (not mapped to adding space)
    // For adding: adjacent = source arm we unfold from
    // For removing: adjacent = arm in direction we collapse toward
    const secondAdjIndexInIntermediate = secondType === 'adding'
        ? secondSourceIndex
        : mod(secondSourceIndex + secondDirection, intermediateCount);

    // Check if the adjacent arm is the new arm from first transition
    const firstInsertIdx = firstType === 'adding'
        ? (firstDirection === 1 ? firstSourceIndex + 1 : firstSourceIndex)
        : -1;
    const isSecondAdjNewArm = firstType === 'adding' && secondAdjIndexInIntermediate === firstInsertIdx;

    const mapToOriginalIndex = (intermediateIdx: number): number | null => {
        if (firstType === 'removing') {
            return intermediateIdx >= firstSourceIndex ? intermediateIdx + 1 : intermediateIdx;
        } else {
            const insertIdx = firstDirection === 1 ? firstSourceIndex + 1 : firstSourceIndex;
            if (intermediateIdx === insertIdx) return null;
            return intermediateIdx > insertIdx ? intermediateIdx - 1 : intermediateIdx;
        }
    };

    // SSOT: Use static arms as the source of truth for adjacent arm position
    const getAdjFromStaticArms = (): ArmRedistributionResult => {
        // If first transition is still in progress, use firstTransitionArm for the new arm
        if (isSecondAdjNewArm && firstTransitionArm) {
            return { tipAngle: firstTransitionArm.tipAngle, halfStep: firstTransitionArm.halfStep };
        }

        // After firstCompleted, staticArms is keyed by intermediate indices
        // Before firstCompleted, staticArms is keyed by original indices
        if (firstCompleted) {
            // Direct lookup in intermediate space
            const adjSpec = staticArms.get(secondAdjIndexInIntermediate);
            if (adjSpec) {
                return { tipAngle: adjSpec.tipAngle, halfStep: adjSpec.halfStep };
            }
        } else {
            // Map to original space for lookup
            const adjOrigIndex = mapToOriginalIndex(secondAdjIndexInIntermediate);
            if (adjOrigIndex !== null) {
                const adjSpec = staticArms.get(adjOrigIndex);
                if (adjSpec) {
                    return { tipAngle: adjSpec.tipAngle, halfStep: adjSpec.halfStep };
                }
            }
        }

        // Fallback to intermediate positions
        const addingArmCount = secondType === 'adding' ? intermediateCount : intermediateCount - 1;
        const angleStep = (2 * Math.PI) / addingArmCount;
        const halfStep = angleStep / 2;
        const adjTipAngle = rotation - Math.PI / 2 + addingSourceIndex * angleStep;
        return { tipAngle: adjTipAngle, halfStep };
    };

    const adjSpec = getAdjFromStaticArms();

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

        getAdjB1Angle(): number {
            return adjSpec.tipAngle - adjSpec.halfStep;
        },

        getAdjB2Angle(): number {
            return adjSpec.tipAngle + adjSpec.halfStep;
        },

        getFinalB1Angle(): number {
            return finalTipAngle - finalHalfStep;
        },

        getFinalB2Angle(): number {
            return finalTipAngle + finalHalfStep;
        },
    };
}

// ============== Normalized Index System ==============
//
// For each transition, we use a "local" coordinate system where:
// - Local index 0: The source arm (being removed, or unfolding from)
// - Local index 1: The adjacent arm in the transition direction (target for Phase 1)
// - Local indices 2, 3, ...: Other arms going in the transition direction
//
// This makes the transition logic direction-agnostic:
// - Pivot base is always between local 0 and local 1 (the "forward" base)
// - Swinging base is always between local 0 and local (N-1) (the "backward" base)
// - Phase 1 always rotates toward local index 1
// - Redistribution: arms with local index > 1 shift toward local index 1

/**
 * Convert global arm index to local index relative to source arm.
 * Local 0 = source, Local 1 = adjacent in transition direction, etc.
 */
function toLocalIndex(globalIndex: number, sourceIndex: number, armCount: number, direction: TransitionDirection): number {
    const offset = mod(globalIndex - sourceIndex, armCount);
    // For CW (dir=1): offset is already correct (0, 1, 2, ... going CW)
    // For CCW (dir=-1): we need to reverse (0, N-1, N-2, ... going CCW becomes 0, 1, 2, ...)
    return direction === 1 ? offset : (offset === 0 ? 0 : armCount - offset);
}

/**
 * Convert local index back to global arm index.
 */
function toGlobalIndex(localIndex: number, sourceIndex: number, armCount: number, direction: TransitionDirection): number {
    // Inverse of toLocalIndex
    // For CW: global = source + local
    // For CCW: global = source - local (mod armCount)
    const offset = direction === 1 ? localIndex : mod(-localIndex, armCount);
    return mod(sourceIndex + offset, armCount);
}

/**
 * Get the arm angle for a given local index.
 * Local index 0 is at sourceAngle, local index 1 is one step in the transition direction, etc.
 */
function getLocalArmAngle(localIndex: number, sourceAngle: number, angleStep: number, direction: TransitionDirection): number {
    // Positive direction always means "toward local index 1"
    return sourceAngle + localIndex * direction * angleStep;
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

export function computeAdditiveExpansionFactor(
    firstProgress: number | null,
    secondProgress: number | null,
    expansionMagnitude: number
): number {
    let expansion = 0;

    if (firstProgress !== null) {
        const ep1 = firstProgress < 0.5
            ? firstProgress * 2
            : 2 - firstProgress * 2;
        expansion += expansionMagnitude * ep1;
    }

    if (secondProgress !== null) {
        const ep2 = secondProgress < 0.5
            ? secondProgress * 2
            : 2 - secondProgress * 2;
        expansion += expansionMagnitude * ep2;
    }

    return expansion;
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
    const targetAngleStep = (2 * Math.PI) / targetArmCount;
    const targetHalfStep = targetAngleStep / 2;

    // Phase timing differs for adding vs removing:
    // - REMOVING: Phase 1 is when other arms redistribute (making room as source collapses)
    // - ADDING: Phase 2 is when other arms redistribute (spreading apart as new arm extends)
    // Both angular position and halfStep follow the same phase timing
    const redistributionT = transitionType === 'removing'
        ? Math.min(transitionProgress / 0.5, 1)  // Complete by p=0.5
        : (transitionProgress <= 0.5 ? 0 : (transitionProgress - 0.5) / 0.5);  // Start at p=0.5

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

    // Skip first source arm only for removing
    if (firstType === 'removing' && i === firstSourceIndex) return null;

    // Map second source back to original to check if this arm is the second source
    const firstInsertIdx = firstDirection === 1 ? firstSourceIndex + 1 : firstSourceIndex;
    let secondSourceOriginal: number;
    if (firstType === 'removing') {
        secondSourceOriginal = secondSourceIndex >= firstSourceIndex
            ? secondSourceIndex + 1
            : secondSourceIndex;
    } else {
        secondSourceOriginal = secondSourceIndex > firstInsertIdx
            ? secondSourceIndex - 1
            : secondSourceIndex;
    }
    // Skip second source arm only for removing
    if (secondType === 'removing' && i === secondSourceOriginal) return null;

    const baseAngleStep = (2 * Math.PI) / startArmCount;
    const intermediateCount = firstType === 'adding' ? startArmCount + 1 : startArmCount - 1;
    const finalCount = secondType === 'adding' ? intermediateCount + 1 : intermediateCount - 1;
    const finalAngleStep = (2 * Math.PI) / finalCount;
    const finalHalfStep = finalAngleStep / 2;

    const origTipAngle = rotation - Math.PI / 2 + i * baseAngleStep;
    const origHalfStep = baseAngleStep / 2;

    // Compute final index directly from original, accounting for both transitions
    // For each transition: adding shifts indices >= insertIdx up, removing shifts indices > sourceIdx down
    let finalIndex = i;

    // Apply first transition's effect on index
    if (firstType === 'adding') {
        if (i >= firstInsertIdx) finalIndex++;
    } else {
        if (i > firstSourceIndex) finalIndex--;
    }

    // Apply second transition's effect on index (using intermediate indices)
    // Need to map secondSourceIndex to where it would insert/remove in the final indexing
    const secondInsertIdx = secondDirection === 1 ? secondSourceIndex + 1 : secondSourceIndex;
    if (secondType === 'adding') {
        if (finalIndex >= secondInsertIdx) finalIndex++;
    } else {
        if (finalIndex > secondSourceIndex) finalIndex--;
    }

    const finalTipAngle = rotation - Math.PI / 2 + finalIndex * finalAngleStep;

    // Compute redistribution progress for each transition:
    // - REMOVING: redistribution happens in Phase 1 (complete by p=0.5)
    // - ADDING: redistribution happens in Phase 2 (starts at p=0.5)
    const firstT = firstType === 'removing'
        ? Math.min(p1 / 0.5, 1)
        : (p1 <= 0.5 ? 0 : (p1 - 0.5) / 0.5);
    const secondT = secondType === 'removing'
        ? Math.min(p2 / 0.5, 1)
        : (p2 <= 0.5 ? 0 : (p2 - 0.5) / 0.5);

    // Compute how much of the total angle change comes from each transition
    const totalAngleChange = finalTipAngle - origTipAngle;
    const totalHalfStepChange = finalHalfStep - origHalfStep;

    // Determine which portion of the change is due to each transition
    // by computing what the intermediate position would be
    let intermediateIndex = i;
    if (firstType === 'adding') {
        if (i >= firstInsertIdx) intermediateIndex++;
    } else {
        if (i > firstSourceIndex) intermediateIndex--;
    }
    const intermediateAngleStep = (2 * Math.PI) / intermediateCount;
    const intermediateTipAngle = rotation - Math.PI / 2 + intermediateIndex * intermediateAngleStep;
    const intermediateHalfStep = intermediateAngleStep / 2;

    const firstAngleChange = intermediateTipAngle - origTipAngle;
    const secondAngleChange = finalTipAngle - intermediateTipAngle;
    const firstHalfStepChange = intermediateHalfStep - origHalfStep;
    const secondHalfStepChange = finalHalfStep - intermediateHalfStep;

    // Apply each transition's contribution based on its phase timing
    const tipAngle = origTipAngle + firstAngleChange * firstT + secondAngleChange * secondT;
    const halfStep = origHalfStep + firstHalfStepChange * firstT + secondHalfStepChange * secondT;

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
    expansionFactor: number;
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
    firstCompleted: boolean;
}

export interface RenderSpecParams {
    bundle: PlannedTransitionBundle | null;
    armCount: number;
    rotation: number;
    centerX: number;
    centerY: number;
    outerRadius: number;
    expansionMagnitude: number;
}

function computeHiddenIndices(
    bundle: PlannedTransitionBundle,
    armCount: number
): Set<number> {
    const hidden = new Set<number>();

    if (bundle.firstCompleted) {
        // After first completes, we're in INTERMEDIATE star space
        // Only hide the second transition's source if still in progress
        if (bundle.second?.type === 'removing' && bundle.second.progress < 1) {
            hidden.add(bundle.second.sourceArmIndex);
        }
    } else {
        // In ORIGINAL star space
        if (bundle.first.type === 'removing' && bundle.first.progress < 1) {
            hidden.add(bundle.first.sourceArmIndex);
        }

        // For second transition (if active and in progress), map its intermediate index to original
        if (bundle.second?.type === 'removing' && bundle.second.progress > 0 && bundle.second.progress < 1) {
            const { first, second } = bundle;
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
    }

    return hidden;
}

function computeExpansionFactor(bundle: PlannedTransitionBundle | null, magnitude: number): number {
    if (!bundle) return 0;

    let expansion = 0;
    const p1 = bundle.first.progress;
    const ep1 = p1 < 0.5 ? p1 * 2 : 2 - p1 * 2;
    expansion += magnitude * ep1;

    if (bundle.second) {
        const p2 = bundle.second.progress;
        const ep2 = p2 < 0.5 ? p2 * 2 : 2 - p2 * 2;
        expansion += magnitude * ep2;
    }

    return expansion;
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

function computeStaticArmSpec(
    armIndex: number,
    bundle: PlannedTransitionBundle | null,
    armCount: number,
    rotation: number
): ArmRenderSpec {
    const baseAngleStep = (2 * Math.PI) / armCount;
    let tipAngle = rotation - Math.PI / 2 + armIndex * baseAngleStep;
    let halfStep = baseAngleStep / 2;

    if (!bundle) {
        return { tipAngle, halfStep };
    }

    const { first, second } = bundle;

    if (second && !bundle.firstCompleted) {
        // Both transitions active in original space
        const result = computeOverlappingArmRedistribution({
            originalArmIndex: armIndex,
            startArmCount: armCount,
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
    } else if (second && bundle.firstCompleted) {
        // First completed, only second active in intermediate space
        const result = computeArmRedistribution(
            armIndex, tipAngle, halfStep,
            second.type, second.progress,
            second.sourceArmIndex, second.direction,
            armCount, rotation
        );
        return result;
    } else if (!second) {
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
    params: TransitionComputeParams
): TransitionArmRenderSpec | null {
    const { first, second, overlapStart } = bundle;
    if (first.progress >= 1) return null;

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

        const geom = createFirstTransitionGeometry(overlappingParams, getSecondProgress);
        arm = computeTransitionWithGeometry(
            geom,
            { centerX, centerY, outerRadius, rotation, direction: first.direction },
            first.type,
            first.progress
        );
    } else {
        const geom = createSingleTransitionGeometry({
            type: first.type,
            sourceArmIndex: first.sourceArmIndex,
            armCount: first.startArmCount,
            centerX, centerY, outerRadius, rotation,
            direction: first.direction,
        });
        arm = computeTransitionWithGeometry(
            geom,
            { centerX, centerY, outerRadius, rotation, direction: first.direction },
            first.type,
            first.progress
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
    staticArms: Map<number, ArmRenderSpec>,
    firstTransitionArm: TransitionArmRenderSpec | null
): TransitionArmRenderSpec | null {
    const { first, second, overlapStart } = bundle;
    if (!second || second.progress <= 0 || second.progress >= 1) return null;

    const { centerX, centerY, outerRadius, rotation } = params;
    const overlap = overlapStart ?? 0;
    const getFirstProgress = (sp: number) => overlap + sp * (1 - overlap);

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

    const geom = createSecondTransitionGeometry(overlappingParams, getFirstProgress, staticArms, firstTransitionArm, bundle.firstCompleted);
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
    const { bundle, armCount, rotation, centerX, centerY, outerRadius, expansionMagnitude } = params;

    const staticArms = new Map<number, ArmRenderSpec>();
    let innerRadius: number;
    let expansionFactor: number;
    let firstTransitionArm: TransitionArmRenderSpec | null = null;
    let secondTransitionArm: TransitionArmRenderSpec | null = null;

    if (!bundle) {
        innerRadius = getInnerRadiusForArmCount(armCount);
        expansionFactor = 0;
        const baseAngleStep = (2 * Math.PI) / armCount;
        for (let i = 0; i < armCount; i++) {
            staticArms.set(i, {
                tipAngle: rotation - Math.PI / 2 + i * baseAngleStep,
                halfStep: baseAngleStep / 2,
            });
        }
    } else {
        innerRadius = computeBundleInnerRadius(bundle);
        expansionFactor = computeExpansionFactor(bundle, expansionMagnitude);
        const hidden = computeHiddenIndices(bundle, armCount);

        for (let i = 0; i < armCount; i++) {
            if (hidden.has(i)) continue;

            const spec = computeStaticArmSpec(i, bundle, armCount, rotation);
            if (spec) {
                staticArms.set(i, spec);
            }
        }

        const transitionParams = { centerX, centerY, outerRadius, rotation };
        firstTransitionArm = computeFirstTransitionArm(bundle, transitionParams);
        secondTransitionArm = computeSecondTransitionArm(bundle, transitionParams, staticArms, firstTransitionArm);
    }

    return {
        staticArms,
        firstTransitionArm,
        secondTransitionArm,
        innerRadius,
        expansionFactor,
    };
}
