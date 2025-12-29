export const STAR_OUTER_RADIUS = 20;
const TIP_ANGLE_OFFSET = -Math.PI / 2;

// ============== Geometry Primitives ==============

export interface Point {
    x: number;
    y: number;
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

export function mod(n: number, m: number): number {
    return ((n % m) + m) % m;
}

function polarToPoint(center: Point, radius: number, angle: number): Point {
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
}

function getTipAngle(rotation: number, armIndex: number, angleStep: number): number {
    return rotation + TIP_ANGLE_OFFSET + armIndex * angleStep;
}

// ============== Arm Geometry ==============

// Arm geometry:
// - T (tip): outer point of the arm
// - b1 (base1): CCW base point on inner circle
// - b2 (base2): CW base point on inner circle
//
// Direction is a signed integer: +1 for CW, -1 for CCW
// This determines which neighbor the animation targets and which base point is the pivot

export interface ArmPoints {
    t: Point;
    b1: Point;
    b2: Point;
}

export type TransitionDirection = 1 | -1;

export function getAngleStep(armCount: number): number {
    return (2 * Math.PI) / armCount;
}

export function getInnerRadiusRatio(armCount: number): number {
    return armCount <= 4 ? 0.2 : 0.4;
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

export interface ArmAngleSpec {
    tipAngle: number;
    halfStep: number;
}

export function getArmPoints(
    centerX: number,
    centerY: number,
    spec: ArmAngleSpec,
    innerR: number,
    outerR: number
): ArmPoints {
    const center = { x: centerX, y: centerY };
    const { tipAngle, halfStep } = spec;
    return {
        t: polarToPoint(center, outerR, tipAngle),
        b1: polarToPoint(center, innerR, tipAngle - halfStep),
        b2: polarToPoint(center, innerR, tipAngle + halfStep),
    };
}

export function buildStaticArmPoints(
    specs: Map<number, ArmAngleSpec>,
    centerX: number,
    centerY: number,
    innerRadius: number,
    outerRadius: number
): Map<number, ArmPoints> {
    const result = new Map<number, ArmPoints>();
    for (const [idx, spec] of specs) {
        result.set(idx, getArmPoints(centerX, centerY, spec, innerRadius, outerRadius));
    }
    return result;
}

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
        const tipAngle = getTipAngle(rotation, i, angleStep);
        result.set(i, getArmPoints(centerX, centerY, { tipAngle, halfStep }, innerRadius, outerRadius));
    }
    return result;
}

// ============== Base Role Assignment ==============

// Abstraction for base point roles - which base is the pivot vs which swings freely
interface BaseRoles {
    pivotBase: Point;
    swingingBase: Point;
}

// SSOT for determining which base is pivot vs swinging.
// For ADDING CW: pivot is b1 (shares with adjacent's b2)
// For ADDING CCW: pivot is b2 (shares with adjacent's b1)
// For REMOVING: opposite
function assignBaseRoles(
    type: 'adding' | 'removing',
    direction: TransitionDirection,
    b1: Point,
    b2: Point
): BaseRoles {
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

// ============== Transition Phase Computation ==============

export interface MinimalTransitionContext {
    centerX: number;
    centerY: number;
    outerRadius: number;
    innerRadius: number;
    adjPoints: ArmPoints;
    pivotBase: Point;
    swingTargetBase: Point;
    progress: number;
    direction: TransitionDirection;
    type: 'adding' | 'removing';
}

// Phase 1: Long rotation around tip - bases swing "the long way" (180° < |rotation| < 360°)
// At t=0: collapsed onto adjacent
// At t=1: pivot base has swung to the pivot base position (for Phase 2)
function computePhase1(
    collapsed: { tip: Point; pivotBase: Point; swingingBase: Point },
    ctx: MinimalTransitionContext,
    t: number
): { tip: Point; pivotBase: Point; swingingBase: Point } {
    const { direction, pivotBase: targetPivotBase } = ctx;
    const tip = collapsed.tip;

    const baseDist = pointDist(tip, collapsed.pivotBase);
    const pivotStartAngle = pointAngle(tip, collapsed.pivotBase);
    const swingStartAngle = pointAngle(tip, collapsed.swingingBase);
    const pivotTargetAngle = pointAngle(tip, targetPivotBase);

    // Phase 1 rotates the "long way" (>180°) in the transition direction
    const diff = normalizeAngle(pivotTargetAngle - pivotStartAngle);
    const totalRotation = diff + direction * 2 * Math.PI;
    const currentRotation = totalRotation * t;

    return {
        tip,
        pivotBase: {
            x: tip.x + baseDist * Math.cos(pivotStartAngle + currentRotation),
            y: tip.y + baseDist * Math.sin(pivotStartAngle + currentRotation),
        },
        swingingBase: {
            x: tip.x + baseDist * Math.cos(swingStartAngle + currentRotation),
            y: tip.y + baseDist * Math.sin(swingStartAngle + currentRotation),
        },
    };
}

// Find the final tip position using circle-circle intersection.
// The final tip must be:
// 1. On the outer radius (distance outerRadius from center)
// 2. At distance edgeDist from pivotBase (sharedBase)
function computeFinalTipPosition(
    centerX: number,
    centerY: number,
    outerRadius: number,
    pivotBase: Point,
    edgeDist: number,
    adjTip: Point,
): Point {
    const d = pointDist({ x: centerX, y: centerY }, pivotBase);

    if (d > outerRadius + edgeDist || d < Math.abs(outerRadius - edgeDist)) {
        const tipAngle = pointAngle(pivotBase, adjTip);
        return {
            x: pivotBase.x + edgeDist * Math.cos(tipAngle),
            y: pivotBase.y + edgeDist * Math.sin(tipAngle),
        };
    }

    const a = (d * d + outerRadius * outerRadius - edgeDist * edgeDist) / (2 * d);
    const h = Math.sqrt(outerRadius * outerRadius - a * a);

    const ux = (pivotBase.x - centerX) / d;
    const uy = (pivotBase.y - centerY) / d;

    const px = centerX + a * ux;
    const py = centerY + a * uy;

    const ix1 = px + h * (-uy);
    const iy1 = py + h * ux;
    const ix2 = px - h * (-uy);
    const iy2 = py - h * ux;

    // Choose the intersection point that is NOT at adjTip (the Phase 2 START position)
    const dist1ToAdjTip = pointDist({ x: ix1, y: iy1 }, adjTip);
    const dist2ToAdjTip = pointDist({ x: ix2, y: iy2 }, adjTip);

    return dist1ToAdjTip > dist2ToAdjTip ? { x: ix1, y: iy1 } : { x: ix2, y: iy2 };
}

// Phase 2: Rotate around pivot base until arm reaches final position.
// The pivot base stays locked. Tip and swinging base rotate together.
function computePhase2(
    ctx: MinimalTransitionContext,
    t: number
): { tip: Point; pivotBase: Point; swingingBase: Point } {
    const { centerX, centerY, outerRadius, direction, adjPoints, pivotBase } = ctx;

    const edgeDist = pointDist(adjPoints.t, adjPoints.b1);
    const chordDist = pointDist(adjPoints.b1, adjPoints.b2);

    // Compute swingingBase start position from tip using arm triangle geometry
    const cosAngleAtTip = 1 - (chordDist * chordDist) / (2 * edgeDist * edgeDist);
    const angleAtTip = Math.acos(Math.max(-1, Math.min(1, cosAngleAtTip)));
    const tipToPivotAngle = pointAngle(adjPoints.t, pivotBase);
    const tipToSwingStartAngle = tipToPivotAngle - direction * angleAtTip;

    const swingStartPos: Point = {
        x: adjPoints.t.x + edgeDist * Math.cos(tipToSwingStartAngle),
        y: adjPoints.t.y + edgeDist * Math.sin(tipToSwingStartAngle),
    };

    const tipStartAngle = pointAngle(pivotBase, adjPoints.t);
    const swingStartAngle = pointAngle(pivotBase, swingStartPos);

    const finalTip = computeFinalTipPosition(
        centerX, centerY, outerRadius, pivotBase, edgeDist, adjPoints.t
    );
    const tipEndAngle = pointAngle(pivotBase, finalTip);

    let totalRotation = normalizeAngle(tipEndAngle - tipStartAngle);
    if (direction === 1 && totalRotation < 0) totalRotation += 2 * Math.PI;
    if (direction === -1 && totalRotation > 0) totalRotation -= 2 * Math.PI;

    const currentRotation = totalRotation * t;

    return {
        tip: {
            x: pivotBase.x + edgeDist * Math.cos(tipStartAngle + currentRotation),
            y: pivotBase.y + edgeDist * Math.sin(tipStartAngle + currentRotation),
        },
        pivotBase,
        swingingBase: {
            x: pivotBase.x + chordDist * Math.cos(swingStartAngle + currentRotation),
            y: pivotBase.y + chordDist * Math.sin(swingStartAngle + currentRotation),
        },
    };
}

export function computeMinimalTransition(ctx: MinimalTransitionContext): ArmPoints {
    const collapsed = ctx.adjPoints;
    const { progress, type, direction } = ctx;

    const collapsedRoles = assignBaseRoles(type, direction, collapsed.b1, collapsed.b2);

    let result: { tip: Point; pivotBase: Point; swingingBase: Point };

    if (progress <= 0.5) {
        result = computePhase1({ tip: collapsed.t, ...collapsedRoles }, ctx, progress / 0.5);
    } else {
        result = computePhase2(ctx, (progress - 0.5) / 0.5);
    }

    const bases = unassignBaseRoles(type, direction, {
        pivotBase: result.pivotBase,
        swingingBase: result.swingingBase,
    });

    return { t: result.tip, b1: bases.b1, b2: bases.b2 };
}

// ============== Transition Geometry Providers ==============

export interface TransitionGeometry {
    getAdjPoints(): ArmPoints;
    getPivotBase(): Point;
    getSwingTargetBase(): Point;
}

export interface TransitionGeometryParams {
    centerX: number;
    centerY: number;
    outerRadius: number;
    rotation: number;
    direction: TransitionDirection;
}

export interface SingleTransitionParams extends TransitionGeometryParams {
    type: 'adding' | 'removing';
    sourceArmIndex: number;
    armCount: number;
}

function getAddingDirection(type: 'adding' | 'removing', direction: TransitionDirection): TransitionDirection {
    return type === 'adding' ? direction : -direction as TransitionDirection;
}

function getAdjacentIndex(type: 'adding' | 'removing', sourceIndex: number, armCount: number, direction: TransitionDirection): number {
    return type === 'adding' ? sourceIndex : mod(sourceIndex + direction, armCount);
}

function createTransitionGeometryFromAdj(
    adjPoints: ArmPoints,
    otherNeighborPoints: ArmPoints,
    addingDirection: TransitionDirection
): TransitionGeometry {
    const pivotBase = addingDirection === 1 ? adjPoints.b2 : adjPoints.b1;
    const swingTargetBase = addingDirection === 1 ? otherNeighborPoints.b2 : otherNeighborPoints.b1;
    return {
        getAdjPoints: () => adjPoints,
        getPivotBase: () => pivotBase,
        getSwingTargetBase: () => swingTargetBase,
    };
}

function createTransitionGeometryCore(
    type: 'adding' | 'removing',
    sourceIndex: number,
    armCount: number,
    direction: TransitionDirection,
    staticArmPoints: Map<number, ArmPoints>
): TransitionGeometry {
    const addingDirection = getAddingDirection(type, direction);
    const adjIndex = getAdjacentIndex(type, sourceIndex, armCount, direction);
    const otherNeighborIndex = mod(adjIndex - addingDirection, armCount);
    return createTransitionGeometryFromAdj(
        staticArmPoints.get(adjIndex)!,
        staticArmPoints.get(otherNeighborIndex)!,
        addingDirection
    );
}

export function createSingleTransitionGeometry(
    params: SingleTransitionParams,
    staticArmPoints: Map<number, ArmPoints>
): TransitionGeometry {
    return createTransitionGeometryCore(
        params.type, params.sourceArmIndex, params.armCount, params.direction, staticArmPoints
    );
}

export function computeTransitionWithGeometry(
    geom: TransitionGeometry,
    params: TransitionGeometryParams,
    type: 'adding' | 'removing',
    progress: number,
    innerRadius: number
): ArmPoints {
    const { centerX, centerY, outerRadius, direction } = params;
    const effectiveProgress = type === 'adding' ? progress : 1 - progress;
    const effectiveDirection: TransitionDirection = type === 'adding' ? direction : -direction as TransitionDirection;

    return computeMinimalTransition({
        centerX,
        centerY,
        outerRadius,
        innerRadius,
        adjPoints: geom.getAdjPoints(),
        pivotBase: geom.getPivotBase(),
        swingTargetBase: geom.getSwingTargetBase(),
        progress: effectiveProgress,
        direction: effectiveDirection,
        type: 'adding',
    });
}

// ============== Overlapping Transition Geometry ==============

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
    staticArmPoints: Map<number, ArmPoints>
): TransitionGeometry {
    return createTransitionGeometryCore(
        params.firstType, params.firstSourceIndex, params.firstStartArmCount,
        params.firstDirection, staticArmPoints
    );
}

function getInsertIndex(type: 'adding' | 'removing', sourceIndex: number, direction: TransitionDirection): number {
    return type === 'adding' ? (direction === 1 ? sourceIndex + 1 : sourceIndex) : -1;
}

function mapIntermediateToOriginal(
    intermediateIdx: number,
    firstType: 'adding' | 'removing',
    firstSourceIndex: number,
    firstInsertIdx: number
): number {
    if (firstType === 'removing') {
        return intermediateIdx >= firstSourceIndex ? intermediateIdx + 1 : intermediateIdx;
    }
    return intermediateIdx > firstInsertIdx ? intermediateIdx - 1 : intermediateIdx;
}

export function createSecondTransitionGeometry(
    params: OverlappingTransitionParams,
    staticArmPoints: Map<number, ArmPoints>,
): TransitionGeometry {
    const {
        firstType, firstSourceIndex, firstStartArmCount, firstDirection,
        secondType, secondSourceIndex, secondDirection,
    } = params;

    const intermediateCount = firstType === 'adding' ? firstStartArmCount + 1 : firstStartArmCount - 1;
    const addingDirection = getAddingDirection(secondType, secondDirection);
    const adjInIntermediate = getAdjacentIndex(secondType, secondSourceIndex, intermediateCount, secondDirection);
    const firstInsertIdx = getInsertIndex(firstType, firstSourceIndex, firstDirection);

    if (firstType === 'adding' && adjInIntermediate === firstInsertIdx) {
        throw new Error('Second transition adjacent arm cannot be the new arm from first transition');
    }

    const adjLookupIndex = mapIntermediateToOriginal(adjInIntermediate, firstType, firstSourceIndex, firstInsertIdx);
    const adjPoints = staticArmPoints.get(adjLookupIndex);
    if (!adjPoints) {
        throw new Error(`Adjacent arm at index ${adjLookupIndex} not found in staticArmPoints`);
    }

    const otherNeighborInIntermediate = mod(adjInIntermediate - addingDirection, intermediateCount);
    if (firstType === 'adding' && otherNeighborInIntermediate === firstInsertIdx) {
        throw new Error('Second transition other neighbor cannot be the new arm from first transition');
    }

    const otherNeighborOriginal = mapIntermediateToOriginal(otherNeighborInIntermediate, firstType, firstSourceIndex, firstInsertIdx);
    const otherNeighborPoints = staticArmPoints.get(otherNeighborOriginal);
    if (!otherNeighborPoints) {
        throw new Error(`Other neighbor arm at index ${otherNeighborOriginal} not found in staticArmPoints`);
    }

    return createTransitionGeometryFromAdj(adjPoints, otherNeighborPoints, addingDirection);
}

// ============== Arm Redistribution ==============

function computeRedistributionT(type: 'adding' | 'removing', progress: number): number {
    return type === 'adding'
        ? (progress <= 0.5 ? 0 : (progress - 0.5) / 0.5)
        : Math.min(progress / 0.5, 1);
}

function computeTargetArmIndex(
    armIndex: number,
    transitionType: 'adding' | 'removing',
    sourceIndex: number,
    direction: TransitionDirection
): number {
    if (transitionType === 'removing') {
        return armIndex > sourceIndex ? armIndex - 1 : armIndex;
    }
    const shouldShift = direction === 1
        ? (armIndex > sourceIndex)
        : (armIndex >= sourceIndex);
    return shouldShift ? armIndex + 1 : armIndex;
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
): ArmAngleSpec {
    const targetArmCount = transitionType === 'adding' ? currentArmCount + 1 : currentArmCount - 1;
    const targetAngleStep = getAngleStep(targetArmCount);
    const targetHalfStep = targetAngleStep / 2;
    const redistributionT = computeRedistributionT(transitionType, transitionProgress);

    const targetIdx = computeTargetArmIndex(armIndex, transitionType, transitionSourceIndex, transitionDirection);
    const targetTipAngle = getTipAngle(rotation, targetIdx, targetAngleStep);

    return {
        tipAngle: lerp(currentTipAngle, targetTipAngle, redistributionT),
        halfStep: lerp(currentHalfStep, targetHalfStep, redistributionT),
    };
}

export interface OverlappingRedistributionParams {
    originalArmIndex: number;
    startArmCount: number;
    firstSourceIndex: number;
    secondSourceIndex: number;
    firstType: 'adding' | 'removing';
    secondType: 'adding' | 'removing';
    firstDirection: TransitionDirection;
    secondDirection: TransitionDirection;
    p1: number;
    p2: number;
    rotation: number;
}

export function computeOverlappingArmRedistribution(params: OverlappingRedistributionParams): ArmAngleSpec {
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

    const firstInsertIdx = getInsertIndex(firstType, firstSourceIndex, firstDirection);
    const intermediateCount = firstType === 'adding' ? startArmCount + 1 : startArmCount - 1;

    const firstT = computeRedistributionT(firstType, p1);
    const secondT = computeRedistributionT(secondType, p2);

    const firstDelta = firstType === 'adding' ? firstT : -firstT;
    const secondDelta = secondType === 'adding' ? secondT : -secondT;
    const totalArmUnits = startArmCount + firstDelta + secondDelta;
    const anglePerArm = 2 * Math.PI / totalArmUnits;
    const halfStep = anglePerArm / 2;

    const firstGap = anglePerArm * firstDelta;
    const secondGap = anglePerArm * secondDelta;

    let gapsBefore = 0;
    if (firstType === 'adding') {
        if (i >= firstInsertIdx) gapsBefore += firstGap;
    } else {
        if (i > firstSourceIndex) gapsBefore += firstGap;
    }

    const secondInsertIdx = secondDirection === 1
        ? mod(secondSourceIndex + 1, intermediateCount)
        : secondSourceIndex;

    let intermediateIdx = i;
    if (firstType === 'adding' && i >= firstInsertIdx) intermediateIdx++;
    else if (firstType === 'removing' && i > firstSourceIndex) intermediateIdx--;

    if (secondType === 'adding') {
        if (intermediateIdx >= secondInsertIdx) gapsBefore += secondGap;
    } else {
        if (intermediateIdx > secondSourceIndex) gapsBefore += secondGap;
    }

    return {
        tipAngle: rotation + TIP_ANGLE_OFFSET + i * anglePerArm + gapsBefore,
        halfStep,
    };
}

// ============== Render Spec System ==============

export interface ArmRenderSpec extends ArmAngleSpec {
    tip: Point;
    b1: Point;
    b2: Point;
}

export interface TransitionRenderSpec {
    staticArms: Map<number, ArmRenderSpec>;
    firstTransitionArm: ArmRenderSpec | null;
    secondTransitionArm: ArmRenderSpec | null;
    innerRadius: number;
}

export interface SingleTransitionState {
    type: 'adding' | 'removing';
    direction: TransitionDirection;
    progress: number;
    sourceArmIndex: number;
    startArmCount: number;
}

export type FirstTransitionState = SingleTransitionState;

export interface PlannedTransitionBundle {
    first: SingleTransitionState;
    second: SingleTransitionState | null;
    overlapStart: number | null;
}

export function computeTransitionProgress(
    bundleProgress: number,
    overlapStart: number
): { p1: number; p2: number } {
    // Each transition runs at the same speed (0→1 takes the same time)
    // Bundle completes when second transition finishes
    // Total duration = 1 + (1 - overlapStart) = 2 - overlapStart
    const totalDuration = 2 - overlapStart;

    const p1 = Math.min(bundleProgress * totalDuration, 1);
    const p2 = Math.max(0, Math.min((bundleProgress * totalDuration - overlapStart), 1));

    return { p1, p2 };
}

export interface RenderSpecParams {
    bundle: PlannedTransitionBundle | null;
    armCount: number;
    rotation: number;
    centerX: number;
    centerY: number;
    outerRadius: number;
}

function computeHiddenIndices(bundle: PlannedTransitionBundle, armCount: number): Set<number> {
    const hidden = new Set<number>();
    const { first, second } = bundle;

    if (first.type === 'removing') {
        hidden.add(first.sourceArmIndex);
    }

    if (second?.type === 'removing' && second.progress > 0 && second.progress < 1) {
        let originalIndex: number;
        if (first.type === 'removing') {
            originalIndex = second.sourceArmIndex >= first.sourceArmIndex
                ? second.sourceArmIndex + 1
                : second.sourceArmIndex;
        } else {
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
): ArmAngleSpec {
    const baseAngleStep = getAngleStep(armCount);
    const tipAngle = getTipAngle(rotation, armIndex, baseAngleStep);
    const halfStep = baseAngleStep / 2;

    if (!bundle) {
        return { tipAngle, halfStep };
    }

    const { first, second } = bundle;

    if (second) {
        return computeOverlappingArmRedistribution({
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
    }

    return computeArmRedistribution(
        armIndex, tipAngle, halfStep,
        first.type, first.progress,
        first.sourceArmIndex, first.direction,
        armCount, rotation
    );
}

function armPointsToRenderSpec(arm: ArmPoints, centerX: number, centerY: number): ArmRenderSpec {
    const b1Angle = angle(centerX, centerY, arm.b1.x, arm.b1.y);
    const b2Angle = angle(centerX, centerY, arm.b2.x, arm.b2.y);
    let tipAngle = (b1Angle + b2Angle) / 2;
    if (Math.abs(b2Angle - b1Angle) > Math.PI) {
        tipAngle = tipAngle + (tipAngle > 0 ? -Math.PI : Math.PI);
    }
    const halfStep = Math.abs(normalizeAngle(b2Angle - b1Angle)) / 2;

    return { tipAngle, halfStep, tip: arm.t, b1: arm.b1, b2: arm.b2 };
}

interface TransitionComputeParams {
    centerX: number;
    centerY: number;
    outerRadius: number;
    rotation: number;
    innerRadius: number;
}

function buildOverlappingParams(
    bundle: PlannedTransitionBundle,
    params: TransitionComputeParams
): OverlappingTransitionParams {
    const { first, second } = bundle;
    const { centerX, centerY, outerRadius, rotation } = params;
    return {
        centerX, centerY, outerRadius, rotation,
        direction: first.direction,
        firstType: first.type,
        firstSourceIndex: first.sourceArmIndex,
        firstStartArmCount: first.startArmCount,
        firstDirection: first.direction,
        secondType: second!.type,
        secondSourceIndex: second!.sourceArmIndex,
        secondDirection: second!.direction,
    };
}

function computeFirstTransitionArm(
    bundle: PlannedTransitionBundle,
    params: TransitionComputeParams,
    staticArmPoints: Map<number, ArmPoints>
): ArmRenderSpec | null {
    const { first, second } = bundle;
    if (!second && first.progress >= 1) return null;

    const { centerX, centerY, outerRadius, rotation, innerRadius } = params;
    const firstProgress = Math.min(first.progress, 1);

    const geom = second
        ? createFirstTransitionGeometry(buildOverlappingParams(bundle, params), staticArmPoints)
        : createSingleTransitionGeometry({
            type: first.type,
            sourceArmIndex: first.sourceArmIndex,
            armCount: first.startArmCount,
            centerX, centerY, outerRadius, rotation,
            direction: first.direction,
        }, staticArmPoints);

    const arm = computeTransitionWithGeometry(
        geom,
        { centerX, centerY, outerRadius, rotation, direction: first.direction },
        first.type,
        firstProgress,
        innerRadius
    );

    return armPointsToRenderSpec(arm, centerX, centerY);
}

function computeSecondTransitionArm(
    bundle: PlannedTransitionBundle,
    params: TransitionComputeParams,
    staticArmPoints: Map<number, ArmPoints>,
): ArmRenderSpec | null {
    const { second } = bundle;
    if (!second || second.progress <= 0 || second.progress >= 1) return null;

    const { centerX, centerY, outerRadius, rotation, innerRadius } = params;

    const geom = createSecondTransitionGeometry(buildOverlappingParams(bundle, params), staticArmPoints);
    const arm = computeTransitionWithGeometry(
        geom,
        { centerX, centerY, outerRadius, rotation, direction: second.direction },
        second.type,
        second.progress,
        innerRadius
    );

    return armPointsToRenderSpec(arm, centerX, centerY);
}

function specToRenderSpec(
    spec: ArmAngleSpec,
    centerX: number, centerY: number,
    innerRadius: number, outerRadius: number
): ArmRenderSpec {
    const points = getArmPoints(centerX, centerY, spec, innerRadius, outerRadius);
    return { ...spec, tip: points.t, b1: points.b1, b2: points.b2 };
}

export function getRenderSpec(params: RenderSpecParams): TransitionRenderSpec {
    const { bundle, armCount, rotation, centerX, centerY, outerRadius } = params;

    const innerRadius = bundle ? computeBundleInnerRadius(bundle) : getInnerRadiusForArmCount(armCount);
    const hidden = bundle ? computeHiddenIndices(bundle, armCount) : new Set<number>();

    const allAngleSpecs = new Map<number, ArmAngleSpec>();
    for (let i = 0; i < armCount; i++) {
        allAngleSpecs.set(i, computeStaticArmSpec(i, bundle, armCount, rotation));
    }
    const allArmPoints = buildStaticArmPoints(allAngleSpecs, centerX, centerY, innerRadius, outerRadius);

    const staticArms = new Map<number, ArmRenderSpec>();
    for (const [i, spec] of allAngleSpecs) {
        if (hidden.has(i)) continue;
        staticArms.set(i, specToRenderSpec(spec, centerX, centerY, innerRadius, outerRadius));
    }

    let firstTransitionArm: ArmRenderSpec | null = null;
    let secondTransitionArm: ArmRenderSpec | null = null;
    if (bundle) {
        const transitionParams = { centerX, centerY, outerRadius, rotation, innerRadius };
        firstTransitionArm = computeFirstTransitionArm(bundle, transitionParams, allArmPoints);
        secondTransitionArm = computeSecondTransitionArm(bundle, transitionParams, allArmPoints);
    }

    return { staticArms, firstTransitionArm, secondTransitionArm, innerRadius };
}
