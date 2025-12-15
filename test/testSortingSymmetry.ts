import {
    computeTransitionWithGeometry,
    createSingleTransitionGeometry,
    computeArmRedistribution,
    getArmPoints,
    getInnerRadiusForArmCount,
    STAR_OUTER_RADIUS,
} from '../src/starAnimationCore.js';

const CENTER_X = 200;
const CENTER_Y = 200;
const CROSSING_THRESHOLD = 0.01;

interface Point {
    x: number;
    y: number;
}

function getTipAngle(center: Point, tip: Point): number {
    return Math.atan2(tip.y - center.y, tip.x - center.x);
}

function getAdjacentArm(
    armCount: number,
    sourceIndex: number,
    direction: 1 | -1,
    progress: number,
    rotation: number
): { t: Point; b1: Point; b2: Point } {
    const angleStep = (2 * Math.PI) / armCount;
    const halfStep = angleStep / 2;
    const tipAngle = rotation - Math.PI / 2 + sourceIndex * angleStep;

    const redist = computeArmRedistribution(
        sourceIndex, tipAngle, halfStep, 'adding', progress,
        sourceIndex, direction, armCount, rotation
    );

    const innerRadius = getInnerRadiusForArmCount(armCount);
    return getArmPoints(CENTER_X, CENTER_Y, redist.tipAngle, redist.halfStep, innerRadius, STAR_OUTER_RADIUS);
}

interface TestCase {
    armCount: number;
    sourceIndex: number;
    direction: 1 | -1;
}

function testNoCrossing(): void {
    console.log('=== Testing No Crossing and Phase2 Consistency ===\n');

    let crossingPassed = 0;
    let crossingFailed = 0;
    let phase2Passed = 0;
    let phase2Failed = 0;
    const failures: string[] = [];

    const testCases: TestCase[] = [
        { armCount: 4, sourceIndex: 0, direction: 1 },
        { armCount: 4, sourceIndex: 0, direction: -1 },
        { armCount: 5, sourceIndex: 0, direction: 1 },
        { armCount: 5, sourceIndex: 0, direction: -1 },
        { armCount: 5, sourceIndex: 2, direction: 1 },
        { armCount: 6, sourceIndex: 0, direction: 1 },
        { armCount: 6, sourceIndex: 0, direction: -1 },
        { armCount: 6, sourceIndex: 3, direction: -1 },
    ];

    for (const tc of testCases) {
        const { armCount, sourceIndex, direction } = tc;
        const dirName = direction === 1 ? 'CW' : 'CCW';
        const prefix = `${armCount}arms idx${sourceIndex} ${dirName}`;

        const geom = createSingleTransitionGeometry({
            type: 'adding',
            sourceArmIndex: sourceIndex,
            armCount,
            centerX: CENTER_X,
            centerY: CENTER_Y,
            outerRadius: STAR_OUTER_RADIUS,
            rotation: 0,
            direction,
        });

        const params = {
            centerX: CENTER_X,
            centerY: CENTER_Y,
            outerRadius: STAR_OUTER_RADIUS,
            rotation: 0,
            direction,
        };

        const center = { x: CENTER_X, y: CENTER_Y };

        // Crossing check: compare base at p=0.125 (early phase 1, t=0.25) with tip at p=0.95 (late phase 2)
        // They should be on opposite sides of the adjacent arm's tip
        const earlyResult = computeTransitionWithGeometry(geom, params, 'adding', 0.125);
        const lateResult = computeTransitionWithGeometry(geom, params, 'adding', 0.95);
        const earlyAdj = getAdjacentArm(armCount, sourceIndex, direction, 0.125, 0);
        const lateAdj = getAdjacentArm(armCount, sourceIndex, direction, 0.95, 0);

        const adjTipAngleEarly = getTipAngle(center, earlyAdj.t);
        const adjTipAngleLate = getTipAngle(center, lateAdj.t);
        const baseAngleEarly = getTipAngle(center, earlyResult.b1);
        const tipAngleLate = getTipAngle(center, lateResult.t);

        // Angular difference relative to adjacent tip
        let baseDiff = baseAngleEarly - adjTipAngleEarly;
        while (baseDiff > Math.PI) baseDiff -= 2 * Math.PI;
        while (baseDiff < -Math.PI) baseDiff += 2 * Math.PI;

        let tipDiff = tipAngleLate - adjTipAngleLate;
        while (tipDiff > Math.PI) tipDiff -= 2 * Math.PI;
        while (tipDiff < -Math.PI) tipDiff += 2 * Math.PI;

        // They should be on opposite sides (different signs)
        const baseSign = Math.sign(baseDiff);
        const tipSign = Math.sign(tipDiff);
        const oppositeSides = baseSign !== tipSign && baseSign !== 0 && tipSign !== 0;

        if (oppositeSides) {
            crossingPassed++;
        } else {
            crossingFailed++;
            failures.push(`${prefix} SAME SIDE: base@0.125=${baseSign > 0 ? '+' : '-'} (${(baseDiff * 180 / Math.PI).toFixed(1)}°), tip@0.95=${tipSign > 0 ? '+' : '-'} (${(tipDiff * 180 / Math.PI).toFixed(1)}°)`);
        }

        // Phase 2 consistency check: no point should cross through the adjacent tip angle
        // A crossing is detected when the angular diff from adjacent tip changes sign
        // (starts on one side, ends on the other)
        // We skip early Phase 2 (p < 0.6) since the tip starts at the adjacent tip by design
        let phase2Crossing = false;
        let phase2CrossingProgress = -1;
        let phase2CrossingPoint = '';

        for (let p = 0.6; p <= 1.0; p += 0.025) {
            const progress = Math.round(p * 1000) / 1000;
            const result = computeTransitionWithGeometry(geom, params, 'adding', progress);
            const adj = getAdjacentArm(armCount, sourceIndex, direction, progress, 0);
            const adjTipAngle = getTipAngle(center, adj.t);

            const getDiff = (pt: Point): number => {
                let diff = getTipAngle(center, pt) - adjTipAngle;
                while (diff > Math.PI) diff -= 2 * Math.PI;
                while (diff < -Math.PI) diff += 2 * Math.PI;
                return diff;
            };

            const tipDiff = getDiff(result.t);
            const b1Diff = getDiff(result.b1);
            const b2Diff = getDiff(result.b2);

            // Check if any point is very close to the adjacent tip angle (crossing through 0)
            if (Math.abs(tipDiff) < CROSSING_THRESHOLD) {
                phase2Crossing = true;
                phase2CrossingProgress = progress;
                phase2CrossingPoint = `tip (${(tipDiff * 180 / Math.PI).toFixed(1)}°)`;
                break;
            }
            if (Math.abs(b1Diff) < CROSSING_THRESHOLD) {
                phase2Crossing = true;
                phase2CrossingProgress = progress;
                phase2CrossingPoint = `b1 (${(b1Diff * 180 / Math.PI).toFixed(1)}°)`;
                break;
            }
            if (Math.abs(b2Diff) < CROSSING_THRESHOLD) {
                phase2Crossing = true;
                phase2CrossingProgress = progress;
                phase2CrossingPoint = `b2 (${(b2Diff * 180 / Math.PI).toFixed(1)}°)`;
                break;
            }
        }

        if (!phase2Crossing) {
            phase2Passed++;
        } else {
            phase2Failed++;
            failures.push(`${prefix} PHASE2 CROSSING at p=${phase2CrossingProgress}: ${phase2CrossingPoint}`);
        }
    }

    console.log(`No-crossing: ${crossingPassed} passed, ${crossingFailed} failed`);
    console.log(`Phase2 consistency: ${phase2Passed} passed, ${phase2Failed} failed`);
    if (failures.length > 0) {
        console.log('\nFailures:');
        for (const f of failures) {
            console.log(`  ${f}`);
        }
    }
}

export function runSortingSymmetryTests(): { passed: number; failed: number; failures: string[] } {
    let totalPassed = 0;
    let totalFailed = 0;
    const failures: string[] = [];

    const testCases: TestCase[] = [
        { armCount: 4, sourceIndex: 0, direction: 1 },
        { armCount: 4, sourceIndex: 0, direction: -1 },
        { armCount: 5, sourceIndex: 0, direction: 1 },
        { armCount: 5, sourceIndex: 0, direction: -1 },
        { armCount: 5, sourceIndex: 2, direction: 1 },
        { armCount: 6, sourceIndex: 0, direction: 1 },
        { armCount: 6, sourceIndex: 0, direction: -1 },
        { armCount: 6, sourceIndex: 3, direction: -1 },
    ];

    for (const tc of testCases) {
        const { armCount, sourceIndex, direction } = tc;
        const dirName = direction === 1 ? 'CW' : 'CCW';
        const prefix = `${armCount}arms idx${sourceIndex} ${dirName}`;

        const geom = createSingleTransitionGeometry({
            type: 'adding',
            sourceArmIndex: sourceIndex,
            armCount,
            centerX: CENTER_X,
            centerY: CENTER_Y,
            outerRadius: STAR_OUTER_RADIUS,
            rotation: 0,
            direction,
        });

        const params = {
            centerX: CENTER_X,
            centerY: CENTER_Y,
            outerRadius: STAR_OUTER_RADIUS,
            rotation: 0,
            direction,
        };

        const center = { x: CENTER_X, y: CENTER_Y };

        const earlyResult = computeTransitionWithGeometry(geom, params, 'adding', 0.125);
        const lateResult = computeTransitionWithGeometry(geom, params, 'adding', 0.95);
        const earlyAdj = getAdjacentArm(armCount, sourceIndex, direction, 0.125, 0);
        const lateAdj = getAdjacentArm(armCount, sourceIndex, direction, 0.95, 0);

        const adjTipAngleEarly = getTipAngle(center, earlyAdj.t);
        const adjTipAngleLate = getTipAngle(center, lateAdj.t);
        const baseAngleEarly = getTipAngle(center, earlyResult.b1);
        const tipAngleLate = getTipAngle(center, lateResult.t);

        let baseDiff = baseAngleEarly - adjTipAngleEarly;
        while (baseDiff > Math.PI) baseDiff -= 2 * Math.PI;
        while (baseDiff < -Math.PI) baseDiff += 2 * Math.PI;

        let tipDiff = tipAngleLate - adjTipAngleLate;
        while (tipDiff > Math.PI) tipDiff -= 2 * Math.PI;
        while (tipDiff < -Math.PI) tipDiff += 2 * Math.PI;

        const baseSign = Math.sign(baseDiff);
        const tipSign = Math.sign(tipDiff);
        const oppositeSides = baseSign !== tipSign && baseSign !== 0 && tipSign !== 0;

        if (oppositeSides) {
            totalPassed++;
        } else {
            totalFailed++;
            failures.push(`${prefix} SAME SIDE: base@0.125=${baseSign > 0 ? '+' : '-'}, tip@0.95=${tipSign > 0 ? '+' : '-'}`);
        }

        let phase2Crossing = false;
        for (let p = 0.6; p <= 1.0; p += 0.025) {
            const progress = Math.round(p * 1000) / 1000;
            const result = computeTransitionWithGeometry(geom, params, 'adding', progress);
            const adj = getAdjacentArm(armCount, sourceIndex, direction, progress, 0);
            const adjTipAngle = getTipAngle(center, adj.t);

            const getDiff = (pt: Point): number => {
                let diff = getTipAngle(center, pt) - adjTipAngle;
                while (diff > Math.PI) diff -= 2 * Math.PI;
                while (diff < -Math.PI) diff += 2 * Math.PI;
                return diff;
            };

            const td = getDiff(result.t);
            const b1d = getDiff(result.b1);
            const b2d = getDiff(result.b2);

            if (Math.abs(td) < CROSSING_THRESHOLD || Math.abs(b1d) < CROSSING_THRESHOLD || Math.abs(b2d) < CROSSING_THRESHOLD) {
                phase2Crossing = true;
                break;
            }
        }

        if (!phase2Crossing) {
            totalPassed++;
        } else {
            totalFailed++;
            failures.push(`${prefix} PHASE2 CROSSING detected`);
        }
    }

    return { passed: totalPassed, failed: totalFailed, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { passed, failed, failures } = runSortingSymmetryTests();
    console.log(`Sorting Symmetry: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
    }
}
