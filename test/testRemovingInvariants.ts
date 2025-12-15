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
    type: 'removing';
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
    tipMinRadiusPass: boolean;
    failures: string[];
}

function getStartArm(
    armCount: number,
    sourceIndex: number,
    rotation: number
): { t: Point; b1: Point; b2: Point } {
    const angleStep = (2 * Math.PI) / armCount;
    const halfStep = angleStep / 2;
    const tipAngle = rotation - Math.PI / 2 + sourceIndex * angleStep;
    const innerRadius = getInnerRadiusForArmCount(armCount);
    return getArmPoints(CENTER_X, CENTER_Y, tipAngle, halfStep, innerRadius, STAR_OUTER_RADIUS);
}

function getAdjacentArmForRemoving(
    armCount: number,
    sourceIndex: number,
    direction: TransitionDirection,
    rotation: number,
    progress: number
): { t: Point; b1: Point; b2: Point } {
    const adjIndex = (sourceIndex + direction + armCount) % armCount;
    const angleStep = (2 * Math.PI) / armCount;
    const halfStep = angleStep / 2;
    const tipAngle = rotation - Math.PI / 2 + adjIndex * angleStep;

    const redist = computeArmRedistribution(
        adjIndex, tipAngle, halfStep, 'removing', progress,
        sourceIndex, direction, armCount, rotation
    );

    const innerRadius = getTransitionInnerRadius(armCount, 'removing', progress);
    return getArmPoints(CENTER_X, CENTER_Y, redist.tipAngle, redist.halfStep, innerRadius, STAR_OUTER_RADIUS);
}

function testSingleCase(testCase: TestCase): TestResult {
    const { armCount, sourceIndex, direction } = testCase;
    const type = 'removing';
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
    const center = { x: CENTER_X, y: CENTER_Y };

    let prevPhase1Angle: number | null = null;
    let prevPhase2TipAngle: number | null = null;
    let phase1TotalRotation = 0;
    let phase2TotalRotation = 0;
    let tipMinRadiusPass = true;

    for (let p = 0; p <= 1.0; p += 0.025) {
        const progress = Math.round(p * 1000) / 1000;
        const result = computeTransitionWithGeometry(geom, params, type, progress);

        // Tip minimum radius invariant
        const innerRadius = getTransitionInnerRadius(armCount, type, progress);
        const tipDistFromCenter = pointDist(result.t, center);
        if (tipDistFromCenter < innerRadius - TOLERANCE) {
            tipMinRadiusPass = false;
            failures.push(`p=${progress}: tip too close to center (${tipDistFromCenter.toFixed(1)} < innerRadius ${innerRadius.toFixed(1)})`);
        }

        // Phase 1: rotation around pivot base (short way, < 180°)
        if (progress > 0 && progress <= 0.5) {
            const pivot = direction === 1 ? result.b1 : result.b2;
            const tipAngleFromPivot = pointAngle(pivot, result.t);

            if (prevPhase1Angle !== null) {
                const delta = normalizeAngle(tipAngleFromPivot - prevPhase1Angle);
                phase1TotalRotation += delta;
            }
            prevPhase1Angle = tipAngleFromPivot;
        }

        // Phase 2: rotation around tip (long way, 180°-360°)
        if (progress > 0.5 && progress <= 1.0) {
            const forwardBase = direction === 1 ? result.b2 : result.b1;
            const angleFromTip = pointAngle(result.t, forwardBase);

            if (prevPhase2TipAngle !== null) {
                const delta = normalizeAngle(angleFromTip - prevPhase2TipAngle);
                phase2TotalRotation += delta;
            }
            prevPhase2TipAngle = angleFromTip;
        }
    }

    // For removing, phase 1 should be short way (< 180°), phase 2 should be long way (180°-360°)
    const phase1Mag = Math.abs(phase1TotalRotation);
    const phase1Pass = phase1Mag < Math.PI;
    if (!phase1Pass) {
        failures.push(`Phase1 rotation magnitude should be < 180°, got ${toDeg(phase1Mag).toFixed(1)}°`);
    }

    const phase2Mag = Math.abs(phase2TotalRotation);
    const phase2Pass = phase2Mag > Math.PI && phase2Mag < 2 * Math.PI;
    if (!phase2Pass) {
        failures.push(`Phase2 rotation magnitude should be 180°-360°, got ${toDeg(phase2Mag).toFixed(1)}°`);
    }

    const sameDirectionPass = Math.sign(phase1TotalRotation) === Math.sign(phase2TotalRotation);
    if (!sameDirectionPass) {
        failures.push(`Phase rotations in opposite directions: phase1=${toDeg(phase1TotalRotation).toFixed(1)}°, phase2=${toDeg(phase2TotalRotation).toFixed(1)}°`);
    }

    return {
        testCase,
        phase1Rotation: phase1TotalRotation,
        phase2Rotation: phase2TotalRotation,
        phase1Pass,
        phase2Pass,
        sameDirectionPass,
        tipMinRadiusPass,
        failures,
    };
}

export function runRemovingInvariantsTests(): { passed: number; failed: number; failures: string[] } {
    const testCases: TestCase[] = [];

    for (const armCount of [4, 5, 6, 7]) {
        for (let sourceIndex = 0; sourceIndex < armCount; sourceIndex++) {
            for (const direction of [1, -1] as TransitionDirection[]) {
                testCases.push({ type: 'removing', armCount, sourceIndex, direction });
            }
        }
    }

    let totalPassed = 0;
    let totalFailed = 0;
    const failures: string[] = [];

    for (const testCase of testCases) {
        const result = testSingleCase(testCase);
        const passed = result.phase1Pass && result.phase2Pass && result.sameDirectionPass && result.tipMinRadiusPass;

        if (passed) {
            totalPassed++;
        } else {
            totalFailed++;
            const { armCount, sourceIndex, direction } = result.testCase;
            const dirStr = direction === 1 ? 'CW' : 'CCW';
            failures.push(`removing ${armCount}arms src${sourceIndex} ${dirStr}: ${result.failures[0] || 'unknown'}`);
        }
    }

    return { passed: totalPassed, failed: totalFailed, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { passed, failed, failures } = runRemovingInvariantsTests();
    console.log(`Removing Invariants: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        console.log('Failures:');
        for (const f of failures) console.log(`  ${f}`);
    }
}
