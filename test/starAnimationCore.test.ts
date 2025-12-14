import {
    STAR_OUTER_RADIUS,
    STAR_INNER_RADIUS,
    FOUR_ARM_INNER_RADIUS_FACTOR,
    dist,
    getInnerRadiusForArmCount,
    getTransitionInnerRadius,
    computeTransitionPosition,
    TransitionContext,
} from '../src/starAnimationCore.js';

const TOLERANCE = 0.001;
const VERBOSE = false;

const CENTER_X = 200;
const CENTER_Y = 200;

function close(x1: number, y1: number, x2: number, y2: number): boolean {
    return dist(x1, y1, x2, y2) < TOLERANCE;
}

interface TestResult {
    name: string;
    passed: boolean;
    details: string;
    distance: number;
}

function check(name: string, x1: number, y1: number, x2: number, y2: number): TestResult {
    const d = dist(x1, y1, x2, y2);
    return {
        name,
        passed: d < TOLERANCE,
        details: `(${x1.toFixed(1)},${y1.toFixed(1)}) vs (${x2.toFixed(1)},${y2.toFixed(1)})`,
        distance: d,
    };
}

function makeCtx(type: 'adding' | 'removing', armCount: number, sourceArmIndex: number, progress: number): TransitionContext {
    return {
        type,
        progress,
        sourceArmIndex,
        armCount,
        rotation: 0,
        centerX: CENTER_X,
        centerY: CENTER_Y,
        innerRadius: getInnerRadius(armCount),
        outerRadius: STAR_OUTER_RADIUS,
    };
}

function getInnerRadius(armCount: number): number {
    return armCount <= 4 ? STAR_INNER_RADIUS * FOUR_ARM_INNER_RADIUS_FACTOR : STAR_INNER_RADIUS;
}

// Independent computation of arm geometry - source of truth
function getExpectedArm(armCount: number, armIndex: number): { tipX: number, tipY: number, base1X: number, base1Y: number, base2X: number, base2Y: number } {
    const angleStep = (2 * Math.PI) / armCount;
    const halfStep = angleStep / 2;
    const tipAngle = -Math.PI / 2 + armIndex * angleStep;
    const innerRadius = getInnerRadius(armCount);
    return {
        tipX: CENTER_X + STAR_OUTER_RADIUS * Math.cos(tipAngle),
        tipY: CENTER_Y + STAR_OUTER_RADIUS * Math.sin(tipAngle),
        base1X: CENTER_X + innerRadius * Math.cos(tipAngle - halfStep),
        base1Y: CENTER_Y + innerRadius * Math.sin(tipAngle - halfStep),
        base2X: CENTER_X + innerRadius * Math.cos(tipAngle + halfStep),
        base2Y: CENTER_Y + innerRadius * Math.sin(tipAngle + halfStep),
    };
}

function getInterpolatedArm(
    startArmCount: number, startArmIndex: number,
    endArmCount: number, endArmIndex: number,
    t: number
): { tipX: number, tipY: number, base1X: number, base1Y: number, base2X: number, base2Y: number } {
    const startAngleStep = (2 * Math.PI) / startArmCount;
    const endAngleStep = (2 * Math.PI) / endArmCount;
    const startTipAngle = -Math.PI / 2 + startArmIndex * startAngleStep;
    const endTipAngle = -Math.PI / 2 + endArmIndex * endAngleStep;

    const tipAngle = startTipAngle + (endTipAngle - startTipAngle) * t;
    const halfStep = startAngleStep / 2 + (endAngleStep / 2 - startAngleStep / 2) * t;
    const startInnerRadius = getInnerRadius(startArmCount);
    const endInnerRadius = getInnerRadius(endArmCount);
    const innerRadius = startInnerRadius + (endInnerRadius - startInnerRadius) * t;

    return {
        tipX: CENTER_X + STAR_OUTER_RADIUS * Math.cos(tipAngle),
        tipY: CENTER_Y + STAR_OUTER_RADIUS * Math.sin(tipAngle),
        base1X: CENTER_X + innerRadius * Math.cos(tipAngle - halfStep),
        base1Y: CENTER_Y + innerRadius * Math.sin(tipAngle - halfStep),
        base2X: CENTER_X + innerRadius * Math.cos(tipAngle + halfStep),
        base2Y: CENTER_Y + innerRadius * Math.sin(tipAngle + halfStep),
    };
}

function testRemovingPhase1(armCount: number, sourceArmIndex: number): TestResult[] {
    const results: TestResult[] = [];
    const prefix = `REM ${armCount}arms idx${sourceArmIndex}`;

    // Source arm S and adjacent arm A (in original N-arm star)
    const src = getExpectedArm(armCount, sourceArmIndex);
    const adjIndex = (sourceArmIndex + 1) % armCount;
    const adj = getExpectedArm(armCount, adjIndex);

    // P1 Start: T@St, 1@S1, 2@S2
    let ctx = makeCtx('removing', armCount, sourceArmIndex, 0);
    let pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-start T@St`, pos.tipX, pos.tipY, src.tipX, src.tipY));
    results.push(check(`${prefix} P1-start 1@S1`, pos.base1X, pos.base1Y, src.base1X, src.base1Y));
    results.push(check(`${prefix} P1-start 2@S2`, pos.base2X, pos.base2Y, src.base2X, src.base2Y));

    // P1 Mid: 2@S2 (pivot stays fixed)
    ctx = makeCtx('removing', armCount, sourceArmIndex, 0.25);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-mid 2@S2(pivot)`, pos.base2X, pos.base2Y, src.base2X, src.base2Y));

    // P1 End: T@At, 2@S2
    ctx = makeCtx('removing', armCount, sourceArmIndex, 0.5);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-end T@At`, pos.tipX, pos.tipY, adj.tipX, adj.tipY));
    results.push(check(`${prefix} P1-end 2@S2(pivot)`, pos.base2X, pos.base2Y, src.base2X, src.base2Y));

    return results;
}

function testRemovingPhase2(armCount: number, sourceArmIndex: number): TestResult[] {
    const results: TestResult[] = [];
    const prefix = `REM ${armCount}arms idx${sourceArmIndex}`;

    // Adjacent arm in original N-arm star, and its final position in (N-1)-arm star
    const adjIndex = (sourceArmIndex + 1) % armCount;
    const adjStart = getExpectedArm(armCount, adjIndex);
    // After removal, adj arm's new index: arms after sourceArmIndex shift back by 1
    const newAdjIndex = adjIndex > sourceArmIndex ? adjIndex - 1 : adjIndex;
    const adjEnd = getExpectedArm(armCount - 1, newAdjIndex);

    // P2 Start: T@At (at original position)
    let ctx = makeCtx('removing', armCount, sourceArmIndex, 0.5);
    let pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P2-start T@At`, pos.tipX, pos.tipY, adjStart.tipX, adjStart.tipY));

    // P2 Mid: T@At (pivot stays on moving At) - interpolated position via angle
    ctx = makeCtx('removing', armCount, sourceArmIndex, 0.75);
    pos = computeTransitionPosition(ctx);
    const adjMid = getInterpolatedArm(armCount, adjIndex, armCount - 1, newAdjIndex, 0.5);
    results.push(check(`${prefix} P2-mid T@At(pivot)`, pos.tipX, pos.tipY, adjMid.tipX, adjMid.tipY));

    // P2 End: T@At, 1@A1, 2@A2 (at final position in (N-1)-arm star)
    ctx = makeCtx('removing', armCount, sourceArmIndex, 1.0);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P2-end T@At`, pos.tipX, pos.tipY, adjEnd.tipX, adjEnd.tipY));
    results.push(check(`${prefix} P2-end 1@A1`, pos.base1X, pos.base1Y, adjEnd.base1X, adjEnd.base1Y));
    results.push(check(`${prefix} P2-end 2@A2`, pos.base2X, pos.base2Y, adjEnd.base2X, adjEnd.base2Y));

    return results;
}

function testAddingPhase1(armCount: number, sourceArmIndex: number): TestResult[] {
    const results: TestResult[] = [];
    const prefix = `ADD ${armCount}arms idx${sourceArmIndex}`;

    // Adjacent arm A (in original N-arm star) - we unfold from this arm
    const adjIndex = sourceArmIndex;
    const adj = getExpectedArm(armCount, adjIndex);

    // P1 Start: T@At, 1@A1, 2@A2
    let ctx = makeCtx('adding', armCount, sourceArmIndex, 0);
    let pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-start T@At`, pos.tipX, pos.tipY, adj.tipX, adj.tipY));
    results.push(check(`${prefix} P1-start 1@A1`, pos.base1X, pos.base1Y, adj.base1X, adj.base1Y));
    results.push(check(`${prefix} P1-start 2@A2`, pos.base2X, pos.base2Y, adj.base2X, adj.base2Y));

    // P1 Mid: T@At (pivot stays fixed)
    ctx = makeCtx('adding', armCount, sourceArmIndex, 0.25);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-mid T@At(pivot)`, pos.tipX, pos.tipY, adj.tipX, adj.tipY));

    // P1 End: T@At, 2@A1
    ctx = makeCtx('adding', armCount, sourceArmIndex, 0.5);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-end T@At`, pos.tipX, pos.tipY, adj.tipX, adj.tipY));
    results.push(check(`${prefix} P1-end 2@A1`, pos.base2X, pos.base2Y, adj.base1X, adj.base1Y));

    return results;
}

function testAddingPhase2(armCount: number, sourceArmIndex: number): TestResult[] {
    const results: TestResult[] = [];
    const prefix = `ADD ${armCount}arms idx${sourceArmIndex}`;

    // Adjacent arm in original N-arm star, and its final position in (N+1)-arm star
    const adjIndex = sourceArmIndex;
    const adjStart = getExpectedArm(armCount, adjIndex);
    // After adding, adj arm shifts to index+1 in the new star
    const newAdjIndex = adjIndex + 1;
    const adjEnd = getExpectedArm(armCount + 1, newAdjIndex);

    // Final position of the new arm being added
    const finalArm = getExpectedArm(armCount + 1, sourceArmIndex);

    // P2 Start: 2@A1, T@At
    let ctx = makeCtx('adding', armCount, sourceArmIndex, 0.5);
    let pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P2-start T@At`, pos.tipX, pos.tipY, adjStart.tipX, adjStart.tipY));
    results.push(check(`${prefix} P2-start 2@A1`, pos.base2X, pos.base2Y, adjStart.base1X, adjStart.base1Y));

    // P2 Mid: 2@A1 (pivot stays on moving A1) - interpolated position via angle
    ctx = makeCtx('adding', armCount, sourceArmIndex, 0.75);
    pos = computeTransitionPosition(ctx);
    const adjMid = getInterpolatedArm(armCount, adjIndex, armCount + 1, newAdjIndex, 0.5);
    results.push(check(`${prefix} P2-mid 2@A1(pivot)`, pos.base2X, pos.base2Y, adjMid.base1X, adjMid.base1Y));

    // P2 End: T@fin, 1@fin, 2@A1 (A1 is now at adjEnd.base1)
    ctx = makeCtx('adding', armCount, sourceArmIndex, 1.0);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P2-end T@fin`, pos.tipX, pos.tipY, finalArm.tipX, finalArm.tipY));
    results.push(check(`${prefix} P2-end 1@fin`, pos.base1X, pos.base1Y, finalArm.base1X, finalArm.base1Y));
    results.push(check(`${prefix} P2-end 2@A1`, pos.base2X, pos.base2Y, adjEnd.base1X, adjEnd.base1Y));

    return results;
}

function testInnerRadiusInterpolation(): TestResult[] {
    const results: TestResult[] = [];
    const r4 = getInnerRadiusForArmCount(4);
    const r5 = getInnerRadiusForArmCount(5);

    // No transition: should return base radius
    let actual = getTransitionInnerRadius(4, null, 0);
    results.push({
        name: 'No transition at 4 arms',
        passed: Math.abs(actual - r4) < TOLERANCE,
        details: `got ${actual}, expected ${r4}`,
        distance: Math.abs(actual - r4),
    });

    actual = getTransitionInnerRadius(5, null, 0);
    results.push({
        name: 'No transition at 5 arms',
        passed: Math.abs(actual - r5) < TOLERANCE,
        details: `got ${actual}, expected ${r5}`,
        distance: Math.abs(actual - r5),
    });

    // Phase 1 (progress <= 0.5): should return start radius, no interpolation
    actual = getTransitionInnerRadius(4, 'adding', 0.25);
    results.push({
        name: 'Adding from 4, phase 1 (p=0.25)',
        passed: Math.abs(actual - r4) < TOLERANCE,
        details: `got ${actual}, expected ${r4}`,
        distance: Math.abs(actual - r4),
    });

    actual = getTransitionInnerRadius(4, 'adding', 0.5);
    results.push({
        name: 'Adding from 4, phase 1 end (p=0.5)',
        passed: Math.abs(actual - r4) < TOLERANCE,
        details: `got ${actual}, expected ${r4}`,
        distance: Math.abs(actual - r4),
    });

    // Phase 2 adding from 4->5: should interpolate from r4 to r5
    actual = getTransitionInnerRadius(4, 'adding', 0.75);
    let expected = r4 + (r5 - r4) * 0.5;
    results.push({
        name: 'Adding 4->5, phase 2 mid (p=0.75)',
        passed: Math.abs(actual - expected) < TOLERANCE,
        details: `got ${actual}, expected ${expected}`,
        distance: Math.abs(actual - expected),
    });

    actual = getTransitionInnerRadius(4, 'adding', 1.0);
    results.push({
        name: 'Adding 4->5, phase 2 end (p=1.0)',
        passed: Math.abs(actual - r5) < TOLERANCE,
        details: `got ${actual}, expected ${r5}`,
        distance: Math.abs(actual - r5),
    });

    // Phase 2 removing from 5->4: should interpolate from r5 to r4
    actual = getTransitionInnerRadius(5, 'removing', 0.75);
    expected = r5 + (r4 - r5) * 0.5;
    results.push({
        name: 'Removing 5->4, phase 2 mid (p=0.75)',
        passed: Math.abs(actual - expected) < TOLERANCE,
        details: `got ${actual}, expected ${expected}`,
        distance: Math.abs(actual - expected),
    });

    actual = getTransitionInnerRadius(5, 'removing', 1.0);
    results.push({
        name: 'Removing 5->4, phase 2 end (p=1.0)',
        passed: Math.abs(actual - r4) < TOLERANCE,
        details: `got ${actual}, expected ${r4}`,
        distance: Math.abs(actual - r4),
    });

    // Non-threshold transitions (5->6, 6->5) should have no radius change
    const r6 = getInnerRadiusForArmCount(6);
    actual = getTransitionInnerRadius(5, 'adding', 0.75);
    results.push({
        name: 'Adding 5->6, phase 2 mid (no change)',
        passed: Math.abs(actual - r5) < TOLERANCE && Math.abs(r5 - r6) < TOLERANCE,
        details: `got ${actual}, r5=${r5}, r6=${r6}`,
        distance: Math.abs(actual - r5),
    });

    return results;
}

function runAllTests(filterType?: 'adding' | 'removing', filterArmCount?: number, filterIdx?: number): void {
    const allResults: TestResult[] = [];

    // Inner radius interpolation tests
    allResults.push(...testInnerRadiusInterpolation());

    const armCounts = filterArmCount ? [filterArmCount] : [4, 5, 6, 7];

    for (const armCount of armCounts) {
        const indices = filterIdx !== undefined ? [filterIdx] : Array.from({length: armCount}, (_, i) => i);
        for (const idx of indices) {
            if (!filterType || filterType === 'removing') {
                allResults.push(...testRemovingPhase1(armCount, idx));
                allResults.push(...testRemovingPhase2(armCount, idx));
            }
            if (!filterType || filterType === 'adding') {
                allResults.push(...testAddingPhase1(armCount, idx));
                allResults.push(...testAddingPhase2(armCount, idx));
            }
        }
    }

    const passed = allResults.filter(r => r.passed);
    const failed = allResults.filter(r => !r.passed);

    console.log(`\n=== STAR ANIMATION TEST RESULTS (tolerance=${TOLERANCE}) ===`);
    console.log(`Passed: ${passed.length}/${allResults.length}`);

    if (VERBOSE || allResults.length <= 30) {
        console.log(`\nALL TESTS:`);
        for (const r of allResults) {
            const status = r.passed ? '✓' : '✗';
            console.log(`  ${status} ${r.name} d=${r.distance.toFixed(4)} ${r.details}`);
        }
    } else if (failed.length > 0) {
        console.log(`\nFAILED TESTS:`);
        for (const f of failed) {
            console.log(`  ✗ ${f.name} d=${f.distance.toFixed(4)} ${f.details}`);
        }
    }

    if (failed.length === 0) {
        console.log(`\nAll tests passed!`);
    } else {
        throw new Error(`${failed.length} tests failed`);
    }
}

// Parse command line: [type] [armCount] [idx]
// e.g.: npx tsx test/starAnimationCore.test.ts removing 6 5
const args = typeof process !== 'undefined' ? process.argv.slice(2) : [];
const filterType = args[0] as 'adding' | 'removing' | undefined;
const filterArmCount = args[1] ? parseInt(args[1]) : undefined;
const filterIdx = args[2] ? parseInt(args[2]) : undefined;

runAllTests(filterType, filterArmCount, filterIdx);
