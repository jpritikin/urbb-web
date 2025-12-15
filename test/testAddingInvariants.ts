import {
    createSingleTransitionGeometry,
    computeTransitionWithGeometry,
    STAR_OUTER_RADIUS,
    getInnerRadiusForArmCount,
    getTransitionInnerRadius,
    getArmPoints,
    dist,
    computeArmRedistribution,
    normalizeAngle,
    TransitionDirection,
} from '../src/starAnimationCore.js';

const CENTER_X = 200;
const CENTER_Y = 200;
const TOLERANCE = 1.0;

interface Point {
    x: number;
    y: number;
}

function pointDist(a: Point, b: Point): number {
    return dist(a.x, a.y, b.x, b.y);
}

function pointAngle(from: Point, to: Point): number {
    return Math.atan2(to.y - from.y, to.x - from.x);
}

function toDeg(rad: number): number {
    return rad * 180 / Math.PI;
}

interface TestCase {
    type: 'adding' | 'removing';
    armCount: number;
    sourceIndex: number;
    direction: TransitionDirection;
}

interface TestResult {
    testCase: TestCase;
    phase1Rotation: number;
    phase2Rotation: number;
    phase1Pass: boolean;
    phase2Pass: boolean;
    sameDirectionPass: boolean;
    boundaryPass: boolean;
    midlinePass: boolean;
    transitionPass: boolean;
    baseRadiusPass: boolean;
    angleVariancePass: boolean;
    pivotAlignmentPass: boolean;
    tipMinRadiusPass: boolean;
    failures: string[];
}

// Returns positive if point is CCW from line (tip->center), negative if CW
function crossProduct(tip: Point, center: Point, point: Point): number {
    const dx1 = center.x - tip.x;
    const dy1 = center.y - tip.y;
    const dx2 = point.x - tip.x;
    const dy2 = point.y - tip.y;
    return dx1 * dy2 - dy1 * dx2;
}

function triangleAngles(t: Point, b1: Point, b2: Point): { atTip: number; atB1: number; atB2: number } {
    const tb1 = pointDist(t, b1);
    const tb2 = pointDist(t, b2);
    const b1b2 = pointDist(b1, b2);

    // Law of cosines: c² = a² + b² - 2ab*cos(C)
    // cos(C) = (a² + b² - c²) / (2ab)
    const atTip = Math.acos(Math.max(-1, Math.min(1, (tb1 * tb1 + tb2 * tb2 - b1b2 * b1b2) / (2 * tb1 * tb2))));
    const atB1 = Math.acos(Math.max(-1, Math.min(1, (tb1 * tb1 + b1b2 * b1b2 - tb2 * tb2) / (2 * tb1 * b1b2))));
    const atB2 = Math.acos(Math.max(-1, Math.min(1, (tb2 * tb2 + b1b2 * b1b2 - tb1 * tb1) / (2 * tb2 * b1b2))));

    return { atTip, atB1, atB2 };
}

function getAdjacentArm(
    armCount: number,
    sourceIndex: number,
    direction: TransitionDirection,
    rotation: number,
    progress: number
): { t: Point; b1: Point; b2: Point } {
    const angleStep = (2 * Math.PI) / armCount;
    const halfStep = angleStep / 2;
    const tipAngle = rotation - Math.PI / 2 + sourceIndex * angleStep;

    const redist = computeArmRedistribution(
        sourceIndex, tipAngle, halfStep, 'adding', progress,
        sourceIndex, direction, armCount, rotation
    );

    const innerRadius = getTransitionInnerRadius(armCount, 'adding', progress);
    return getArmPoints(CENTER_X, CENTER_Y, redist.tipAngle, redist.halfStep, innerRadius, STAR_OUTER_RADIUS);
}

function getFinalArm(
    armCount: number,
    sourceIndex: number,
    direction: TransitionDirection,
    rotation: number
): { t: Point; b1: Point; b2: Point } {
    const endArmCount = armCount + 1;
    const newArmIndex = direction === 1 ? sourceIndex + 1 : sourceIndex;
    const angleStep = (2 * Math.PI) / endArmCount;
    const halfStep = angleStep / 2;
    const tipAngle = rotation - Math.PI / 2 + newArmIndex * angleStep;
    const innerRadius = getInnerRadiusForArmCount(endArmCount);
    return getArmPoints(CENTER_X, CENTER_Y, tipAngle, halfStep, innerRadius, STAR_OUTER_RADIUS);
}

function testSingleCase(testCase: TestCase): TestResult {
    const { type, armCount, sourceIndex, direction } = testCase;
    const rotation = 0;
    const failures: string[] = [];

    const geom = createSingleTransitionGeometry({
        type,
        sourceArmIndex: sourceIndex,
        armCount,
        centerX: CENTER_X,
        centerY: CENTER_Y,
        outerRadius: STAR_OUTER_RADIUS,
        rotation,
        direction,
    });

    const params = { centerX: CENTER_X, centerY: CENTER_Y, outerRadius: STAR_OUTER_RADIUS, rotation, direction };

    let prevPhase1Angle: number | null = null;
    let prevPhase2TipAngle: number | null = null;
    let phase1TotalRotation = 0;
    let phase2TotalRotation = 0;
    let boundaryPass = true;
    let midlinePass = true;
    let transitionPass = true;
    let baseRadiusPass = true;
    let angleVariancePass = true;
    let pivotAlignmentPass = true;
    let tipMinRadiusPass = true;
    const center = { x: CENTER_X, y: CENTER_Y };
    const MAX_TRANSITION_JUMP = 10; // max distance allowed between phase 1 end and phase 2 start
    const BASE_RADIUS_TOLERANCE = 6.0; // tolerance for base distance from inner circle
    const MAX_ANGLE_VARIANCE = 10; // max variance in degrees for interior angles
    const PIVOT_TOLERANCE = 0.01; // tight tolerance for pivot alignment

    const tipAngles: number[] = [];
    const b1Angles: number[] = [];
    const b2Angles: number[] = [];

    for (let p = 0; p <= 1.0; p += 0.025) {
        const progress = Math.round(p * 1000) / 1000;
        const result = computeTransitionWithGeometry(geom, params, type, progress);
        const adj = getAdjacentArm(armCount, sourceIndex, direction, rotation, progress);
        const final = getFinalArm(armCount, sourceIndex, direction, rotation);

        // Boundary conditions
        if (progress === 0) {
            const tipMatch = pointDist(result.t, adj.t) < TOLERANCE;
            const b1Match = pointDist(result.b1, adj.b1) < TOLERANCE;
            const b2Match = pointDist(result.b2, adj.b2) < TOLERANCE;
            if (!tipMatch || !b1Match || !b2Match) {
                boundaryPass = false;
                failures.push(`p=0: not collapsed on adjacent`);
            }
        }

        if (progress === 1) {
            const tipMatch = pointDist(result.t, final.t) < TOLERANCE;
            const b1Match = pointDist(result.b1, final.b1) < TOLERANCE;
            const b2Match = pointDist(result.b2, final.b2) < TOLERANCE;
            if (!tipMatch || !b1Match || !b2Match) {
                boundaryPass = false;
                failures.push(`p=1: not at final position`);
            }
        }

        // Midline invariant: b1 should be CCW from midline, b2 should be CW
        // The midline goes from tip through the midpoint of the two bases
        // This ensures bases don't swap sides during the animation
        const baseMidpoint = {
            x: (result.b1.x + result.b2.x) / 2,
            y: (result.b1.y + result.b2.y) / 2,
        };
        const b1Cross = crossProduct(result.t, baseMidpoint, result.b1);
        const b2Cross = crossProduct(result.t, baseMidpoint, result.b2);
        // b1 should be CCW (positive cross), b2 should be CW (negative cross)
        if (b1Cross < 0) {
            midlinePass = false;
            failures.push(`p=${progress}: b1 crossed to CW side of midline (cross=${b1Cross.toFixed(1)})`);
        }
        if (b2Cross > 0) {
            midlinePass = false;
            failures.push(`p=${progress}: b2 crossed to CCW side of midline (cross=${b2Cross.toFixed(1)})`);
        }

        // Collect interior angles of the arm triangle
        const angles = triangleAngles(result.t, result.b1, result.b2);
        tipAngles.push(toDeg(angles.atTip));
        b1Angles.push(toDeg(angles.atB1));
        b2Angles.push(toDeg(angles.atB2));

        // Tip minimum radius invariant: tip must stay at least innerRadius from center
        const innerRadius = getTransitionInnerRadius(armCount, type, progress);
        const tipDistFromCenter = pointDist(result.t, center);
        if (tipDistFromCenter < innerRadius - TOLERANCE) {
            tipMinRadiusPass = false;
            failures.push(`p=${progress}: tip too close to center (${tipDistFromCenter.toFixed(1)} < innerRadius ${innerRadius.toFixed(1)})`);
        }

        // Phase 1: rotation around tip (tip locked at adjacent tip)
        if (progress > 0 && progress <= 0.5) {
            // For CW (dir=1): forward=b2, backward=b1
            // For CCW (dir=-1): forward=b1, backward=b2
            const forwardBase = direction === 1 ? result.b2 : result.b1;
            const angleFromTip = pointAngle(result.t, forwardBase);

            if (prevPhase1Angle !== null) {
                const delta = normalizeAngle(angleFromTip - prevPhase1Angle);
                phase1TotalRotation += delta;
            }
            prevPhase1Angle = angleFromTip;

            // Pivot alignment: tip must be exactly at adjacent tip during Phase 1
            const tipDist = pointDist(result.t, adj.t);
            if (tipDist > PIVOT_TOLERANCE) {
                pivotAlignmentPass = false;
                failures.push(`p=${progress} Phase1: tip not at adj tip (dist=${tipDist.toFixed(4)})`);
            }
        }

        // Phase 2: rotation around pivot (pivot base locked to adjacent's shared base)
        if (progress > 0.5 && progress <= 1.0) {
            // For CW: pivot = b1 (locks to adj.b2), swinging = b2
            // For CCW: pivot = b2 (locks to adj.b1), swinging = b1
            const pivot = direction === 1 ? result.b1 : result.b2;
            const tipAngleFromPivot = pointAngle(pivot, result.t);

            if (prevPhase2TipAngle !== null) {
                const delta = normalizeAngle(tipAngleFromPivot - prevPhase2TipAngle);
                phase2TotalRotation += delta;
            }
            prevPhase2TipAngle = tipAngleFromPivot;

            // Pivot alignment: pivot base must stay at adjacent's shared base
            // For CW: pivot = b1, should align with adj.b2 (shared base)
            // For CCW: pivot = b2, should align with adj.b1 (shared base)
            const adjPivot = direction === 1 ? adj.b2 : adj.b1;
            const pivotDist = pointDist(pivot, adjPivot);
            if (pivotDist > PIVOT_TOLERANCE) {
                pivotAlignmentPass = false;
                failures.push(`p=${progress} Phase2: pivot not at adj base (dist=${pivotDist.toFixed(4)})`);
            }

            // Check base radius invariant: at end of Phase 2, both bases should be near inner circle
            if (progress >= 0.975) {
                const expectedInnerRadius = getTransitionInnerRadius(armCount, 'adding', progress);
                const b1DistFromCenter = pointDist(result.b1, center);
                const b2DistFromCenter = pointDist(result.b2, center);
                const b1Error = Math.abs(b1DistFromCenter - expectedInnerRadius);
                const b2Error = Math.abs(b2DistFromCenter - expectedInnerRadius);

                if (b1Error > BASE_RADIUS_TOLERANCE) {
                    baseRadiusPass = false;
                    failures.push(`p=${progress}: b1 distance from center is ${b1DistFromCenter.toFixed(1)}, expected ${expectedInnerRadius.toFixed(1)} (error=${b1Error.toFixed(1)})`);
                }
                if (b2Error > BASE_RADIUS_TOLERANCE) {
                    baseRadiusPass = false;
                    failures.push(`p=${progress}: b2 distance from center is ${b2DistFromCenter.toFixed(1)}, expected ${expectedInnerRadius.toFixed(1)} (error=${b2Error.toFixed(1)})`);
                }
            }
        }
    }

    // Check angle variance
    const variance = (arr: number[]) => {
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        return Math.sqrt(arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length);
    };
    const tipVariance = variance(tipAngles);
    const b1Variance = variance(b1Angles);
    const b2Variance = variance(b2Angles);
    const maxVariance = Math.max(tipVariance, b1Variance, b2Variance);
    if (maxVariance > MAX_ANGLE_VARIANCE) {
        angleVariancePass = false;
        failures.push(`Interior angle variance too high: tip=${tipVariance.toFixed(1)}°, b1=${b1Variance.toFixed(1)}°, b2=${b2Variance.toFixed(1)}°`);
    }

    // Phase 1: should be "long way" (180° < |rotation| < 360°)
    const phase1Mag = Math.abs(phase1TotalRotation);
    const phase1Pass = phase1Mag > Math.PI && phase1Mag < 2 * Math.PI;
    if (!phase1Pass) {
        failures.push(`Phase1 rotation magnitude should be 180°-360°, got ${toDeg(phase1Mag).toFixed(1)}°`);
    }

    // Phase 2: should be "short way" (|rotation| < 180°)
    const phase2Mag = Math.abs(phase2TotalRotation);
    const phase2Pass = phase2Mag < Math.PI;
    if (!phase2Pass) {
        failures.push(`Phase2 rotation magnitude should be < 180°, got ${toDeg(phase2Mag).toFixed(1)}°`);
    }

    // Both phases should rotate in the same direction
    const sameDirectionPass = Math.sign(phase1TotalRotation) === Math.sign(phase2TotalRotation);
    if (!sameDirectionPass) {
        failures.push(`Phase rotations in opposite directions: phase1=${toDeg(phase1TotalRotation).toFixed(1)}°, phase2=${toDeg(phase2TotalRotation).toFixed(1)}°`);
    }

    // Phase transition: check continuity at p=0.49 vs p=0.51
    const before = computeTransitionWithGeometry(geom, params, type, 0.49);
    const after = computeTransitionWithGeometry(geom, params, type, 0.51);

    const distB1toB1 = pointDist(before.b1, after.b1);
    const distB2toB2 = pointDist(before.b2, after.b2);
    const distB1toB2 = pointDist(before.b1, after.b2);
    const distB2toB1 = pointDist(before.b2, after.b1);

    // Allow either same mapping or swapped mapping
    const sameMapping = Math.max(distB1toB1, distB2toB2);
    const swappedMapping = Math.max(distB1toB2, distB2toB1);
    const minJump = Math.min(sameMapping, swappedMapping);

    if (minJump > MAX_TRANSITION_JUMP) {
        transitionPass = false;
        failures.push(`Phase transition jump too large: ${minJump.toFixed(1)} > ${MAX_TRANSITION_JUMP}`);
    }

    return {
        testCase,
        phase1Rotation: phase1TotalRotation,
        phase2Rotation: phase2TotalRotation,
        phase1Pass,
        phase2Pass,
        sameDirectionPass,
        boundaryPass,
        midlinePass,
        transitionPass,
        baseRadiusPass,
        angleVariancePass,
        pivotAlignmentPass,
        tipMinRadiusPass,
        failures,
    };
}

export function runAddingInvariantsTests(): { passed: number; failed: number; failures: string[] } {
    const testCases: TestCase[] = [];

    // Only test 'adding' - removing is just time-reversed adding (SSOT)
    for (const armCount of [4, 5, 6, 7]) {
        for (let sourceIndex = 0; sourceIndex < armCount; sourceIndex++) {
            for (const direction of [1, -1] as TransitionDirection[]) {
                testCases.push({ type: 'adding', armCount, sourceIndex, direction });
            }
        }
    }

    let totalPassed = 0;
    let totalFailed = 0;
    const failures: string[] = [];

    for (const testCase of testCases) {
        const result = testSingleCase(testCase);
        const passed = result.phase1Pass && result.phase2Pass && result.sameDirectionPass && result.boundaryPass && result.midlinePass && result.transitionPass && result.baseRadiusPass && result.angleVariancePass && result.pivotAlignmentPass && result.tipMinRadiusPass;

        if (passed) {
            totalPassed++;
        } else {
            totalFailed++;
            const { type, armCount, sourceIndex, direction } = result.testCase;
            const dirStr = direction === 1 ? 'CW' : 'CCW';
            failures.push(`${type} ${armCount}arms src${sourceIndex} ${dirStr}: ${result.failures[0] || 'unknown'}`);
        }
    }

    return { passed: totalPassed, failed: totalFailed, failures };
}

// Allow running standalone or as module
if (import.meta.url === `file://${process.argv[1]}`) {
    const { passed, failed, failures } = runAddingInvariantsTests();
    console.log(`Adding Invariants: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        console.log('Failures:');
        for (const f of failures) console.log(`  ${f}`);
    }
}
