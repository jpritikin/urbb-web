import {
    STAR_OUTER_RADIUS,
    STAR_INNER_RADIUS,
    FOUR_ARM_INNER_RADIUS_FACTOR,
    dist,
    getInnerRadiusForArmCount,
    getTransitionInnerRadius,
    computeTransitionPosition,
    computeAdjacentArmPosition,
    TransitionContext,
    TransitionDirection,
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

function makeCtx(type: 'adding' | 'removing', armCount: number, sourceArmIndex: number, progress: number, direction: TransitionDirection = 1): TransitionContext {
    return {
        type,
        direction,
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

function testRemovingCWPhase1(armCount: number, sourceArmIndex: number): TestResult[] {
    const results: TestResult[] = [];
    const prefix = `REM-CW ${armCount}arms idx${sourceArmIndex}`;

    // Source arm S and adjacent arm A (CW neighbor, index + 1)
    const src = getExpectedArm(armCount, sourceArmIndex);
    const adjIndex = (sourceArmIndex + 1) % armCount;
    const adj = getExpectedArm(armCount, adjIndex);

    // P1 Start: T@St, 1@S1, 2@S2
    let ctx = makeCtx('removing', armCount, sourceArmIndex, 0, 1);
    let pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-start T@St`, pos.tipX, pos.tipY, src.tipX, src.tipY));
    results.push(check(`${prefix} P1-start 1@S1`, pos.base1X, pos.base1Y, src.base1X, src.base1Y));
    results.push(check(`${prefix} P1-start 2@S2`, pos.base2X, pos.base2Y, src.base2X, src.base2Y));

    // P1 Mid: 2@S2 (pivot stays fixed)
    ctx = makeCtx('removing', armCount, sourceArmIndex, 0.25, 1);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-mid 2@S2(pivot)`, pos.base2X, pos.base2Y, src.base2X, src.base2Y));

    // P1 End: T@At, 2@S2
    ctx = makeCtx('removing', armCount, sourceArmIndex, 0.5, 1);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-end T@At`, pos.tipX, pos.tipY, adj.tipX, adj.tipY));
    results.push(check(`${prefix} P1-end 2@S2(pivot)`, pos.base2X, pos.base2Y, src.base2X, src.base2Y));

    return results;
}

function testRemovingCCWPhase1(armCount: number, sourceArmIndex: number): TestResult[] {
    const results: TestResult[] = [];
    const prefix = `REM-CCW ${armCount}arms idx${sourceArmIndex}`;

    // Source arm S and adjacent arm A (CCW neighbor, index - 1)
    const src = getExpectedArm(armCount, sourceArmIndex);
    const adjIndex = (sourceArmIndex - 1 + armCount) % armCount;
    const adj = getExpectedArm(armCount, adjIndex);

    // P1 Start: T@St, 1@S1, 2@S2
    let ctx = makeCtx('removing', armCount, sourceArmIndex, 0, -1);
    let pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-start T@St`, pos.tipX, pos.tipY, src.tipX, src.tipY));
    results.push(check(`${prefix} P1-start 1@S1`, pos.base1X, pos.base1Y, src.base1X, src.base1Y));
    results.push(check(`${prefix} P1-start 2@S2`, pos.base2X, pos.base2Y, src.base2X, src.base2Y));

    // P1 Mid: 1@S1 (pivot stays fixed for CCW)
    ctx = makeCtx('removing', armCount, sourceArmIndex, 0.25, -1);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-mid 1@S1(pivot)`, pos.base1X, pos.base1Y, src.base1X, src.base1Y));

    // P1 End: T@At, 1@S1
    ctx = makeCtx('removing', armCount, sourceArmIndex, 0.5, -1);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-end T@At`, pos.tipX, pos.tipY, adj.tipX, adj.tipY));
    results.push(check(`${prefix} P1-end 1@S1(pivot)`, pos.base1X, pos.base1Y, src.base1X, src.base1Y));

    return results;
}

function testRemovingCWPhase2(armCount: number, sourceArmIndex: number): TestResult[] {
    const results: TestResult[] = [];
    const prefix = `REM-CW ${armCount}arms idx${sourceArmIndex}`;

    // Adjacent arm in original N-arm star (CW neighbor), and its final position in (N-1)-arm star
    const adjIndex = (sourceArmIndex + 1) % armCount;
    const adjStart = getExpectedArm(armCount, adjIndex);
    // After removal, adj arm's new index: arms after sourceArmIndex shift back by 1
    const newAdjIndex = adjIndex > sourceArmIndex ? adjIndex - 1 : adjIndex;
    const adjEnd = getExpectedArm(armCount - 1, newAdjIndex);

    // P2 Start: T@At (at original position)
    let ctx = makeCtx('removing', armCount, sourceArmIndex, 0.5, 1);
    let pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P2-start T@At`, pos.tipX, pos.tipY, adjStart.tipX, adjStart.tipY));

    // P2 Mid: T@At (pivot stays on moving At) - interpolated position via angle
    ctx = makeCtx('removing', armCount, sourceArmIndex, 0.75, 1);
    pos = computeTransitionPosition(ctx);
    const adjMid = getInterpolatedArm(armCount, adjIndex, armCount - 1, newAdjIndex, 0.5);
    results.push(check(`${prefix} P2-mid T@At(pivot)`, pos.tipX, pos.tipY, adjMid.tipX, adjMid.tipY));

    // P2 End: T@At, 1@A1, 2@A2 (at final position in (N-1)-arm star)
    ctx = makeCtx('removing', armCount, sourceArmIndex, 1.0, 1);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P2-end T@At`, pos.tipX, pos.tipY, adjEnd.tipX, adjEnd.tipY));
    results.push(check(`${prefix} P2-end 1@A1`, pos.base1X, pos.base1Y, adjEnd.base1X, adjEnd.base1Y));
    results.push(check(`${prefix} P2-end 2@A2`, pos.base2X, pos.base2Y, adjEnd.base2X, adjEnd.base2Y));

    return results;
}

function testRemovingCCWPhase2(armCount: number, sourceArmIndex: number): TestResult[] {
    const results: TestResult[] = [];
    const prefix = `REM-CCW ${armCount}arms idx${sourceArmIndex}`;

    // Adjacent arm in original N-arm star (CCW neighbor), and its final position in (N-1)-arm star
    const adjIndex = (sourceArmIndex - 1 + armCount) % armCount;
    const adjStart = getExpectedArm(armCount, adjIndex);
    // After removal, arms with index > sourceArmIndex shift down by 1
    const newAdjIndex = adjIndex > sourceArmIndex ? adjIndex - 1 : adjIndex;
    const adjEnd = getExpectedArm(armCount - 1, newAdjIndex);

    // P2 Start: T@At (at original position)
    let ctx = makeCtx('removing', armCount, sourceArmIndex, 0.5, -1);
    let pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P2-start T@At`, pos.tipX, pos.tipY, adjStart.tipX, adjStart.tipY));

    // P2 Mid: T@At (pivot stays on moving At) - interpolated position via angle
    ctx = makeCtx('removing', armCount, sourceArmIndex, 0.75, -1);
    pos = computeTransitionPosition(ctx);
    const adjMid = getInterpolatedArm(armCount, adjIndex, armCount - 1, newAdjIndex, 0.5);
    results.push(check(`${prefix} P2-mid T@At(pivot)`, pos.tipX, pos.tipY, adjMid.tipX, adjMid.tipY));

    // P2 End: T@At, 1@A1, 2@A2 (at final position in (N-1)-arm star)
    ctx = makeCtx('removing', armCount, sourceArmIndex, 1.0, -1);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P2-end T@At`, pos.tipX, pos.tipY, adjEnd.tipX, adjEnd.tipY));
    results.push(check(`${prefix} P2-end 1@A1`, pos.base1X, pos.base1Y, adjEnd.base1X, adjEnd.base1Y));
    results.push(check(`${prefix} P2-end 2@A2`, pos.base2X, pos.base2Y, adjEnd.base2X, adjEnd.base2Y));

    return results;
}

function testAddingCCWPhase1(armCount: number, sourceArmIndex: number): TestResult[] {
    const results: TestResult[] = [];
    const prefix = `ADD-CCW ${armCount}arms idx${sourceArmIndex}`;

    // Adjacent arm A (in original N-arm star) - we unfold from this arm
    const adjIndex = sourceArmIndex;
    const adj = getExpectedArm(armCount, adjIndex);

    // P1 Start: T@At, 1@A1, 2@A2
    let ctx = makeCtx('adding', armCount, sourceArmIndex, 0, -1);
    let pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-start T@At`, pos.tipX, pos.tipY, adj.tipX, adj.tipY));
    results.push(check(`${prefix} P1-start 1@A1`, pos.base1X, pos.base1Y, adj.base1X, adj.base1Y));
    results.push(check(`${prefix} P1-start 2@A2`, pos.base2X, pos.base2Y, adj.base2X, adj.base2Y));

    // P1 Mid: T@At (pivot stays fixed)
    ctx = makeCtx('adding', armCount, sourceArmIndex, 0.25, -1);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-mid T@At(pivot)`, pos.tipX, pos.tipY, adj.tipX, adj.tipY));

    // P1 End: T@At, 2@A1
    ctx = makeCtx('adding', armCount, sourceArmIndex, 0.5, -1);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-end T@At`, pos.tipX, pos.tipY, adj.tipX, adj.tipY));
    results.push(check(`${prefix} P1-end 2@A1`, pos.base2X, pos.base2Y, adj.base1X, adj.base1Y));

    return results;
}

function testAddingCWPhase1(armCount: number, sourceArmIndex: number): TestResult[] {
    const results: TestResult[] = [];
    const prefix = `ADD-CW ${armCount}arms idx${sourceArmIndex}`;

    // Adjacent arm A (in original N-arm star) - we unfold from this arm
    const adjIndex = sourceArmIndex;
    const adj = getExpectedArm(armCount, adjIndex);

    // P1 Start: T@At, 1@A1, 2@A2
    let ctx = makeCtx('adding', armCount, sourceArmIndex, 0, 1);
    let pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-start T@At`, pos.tipX, pos.tipY, adj.tipX, adj.tipY));
    results.push(check(`${prefix} P1-start 1@A1`, pos.base1X, pos.base1Y, adj.base1X, adj.base1Y));
    results.push(check(`${prefix} P1-start 2@A2`, pos.base2X, pos.base2Y, adj.base2X, adj.base2Y));

    // P1 Mid: T@At (pivot stays fixed)
    ctx = makeCtx('adding', armCount, sourceArmIndex, 0.25, 1);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-mid T@At(pivot)`, pos.tipX, pos.tipY, adj.tipX, adj.tipY));

    // P1 End: T@At, 1@A2
    ctx = makeCtx('adding', armCount, sourceArmIndex, 0.5, 1);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P1-end T@At`, pos.tipX, pos.tipY, adj.tipX, adj.tipY));
    results.push(check(`${prefix} P1-end 1@A2`, pos.base1X, pos.base1Y, adj.base2X, adj.base2Y));

    return results;
}

function testAddingCCWPhase2(armCount: number, sourceArmIndex: number): TestResult[] {
    const results: TestResult[] = [];
    const prefix = `ADD-CCW ${armCount}arms idx${sourceArmIndex}`;

    // Adjacent arm in original N-arm star, and its final position in (N+1)-arm star
    const adjIndex = sourceArmIndex;
    const adjStart = getExpectedArm(armCount, adjIndex);
    // After adding, adj arm shifts to index+1 in the new star
    const newAdjIndex = adjIndex + 1;
    const adjEnd = getExpectedArm(armCount + 1, newAdjIndex);

    // Final position of the new arm being added
    const finalArm = getExpectedArm(armCount + 1, sourceArmIndex);

    // P2 Start: 2@A1, T@At
    let ctx = makeCtx('adding', armCount, sourceArmIndex, 0.5, -1);
    let pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P2-start T@At`, pos.tipX, pos.tipY, adjStart.tipX, adjStart.tipY));
    results.push(check(`${prefix} P2-start 2@A1`, pos.base2X, pos.base2Y, adjStart.base1X, adjStart.base1Y));

    // P2 Mid: 2@A1 (pivot stays on moving A1) - interpolated position via angle
    ctx = makeCtx('adding', armCount, sourceArmIndex, 0.75, -1);
    pos = computeTransitionPosition(ctx);
    const adjMid = getInterpolatedArm(armCount, adjIndex, armCount + 1, newAdjIndex, 0.5);
    results.push(check(`${prefix} P2-mid 2@A1(pivot)`, pos.base2X, pos.base2Y, adjMid.base1X, adjMid.base1Y));

    // P2 End: T@fin, 1@fin, 2@A1 (A1 is now at adjEnd.base1)
    ctx = makeCtx('adding', armCount, sourceArmIndex, 1.0, -1);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P2-end T@fin`, pos.tipX, pos.tipY, finalArm.tipX, finalArm.tipY));
    results.push(check(`${prefix} P2-end 1@fin`, pos.base1X, pos.base1Y, finalArm.base1X, finalArm.base1Y));
    results.push(check(`${prefix} P2-end 2@A1`, pos.base2X, pos.base2Y, adjEnd.base1X, adjEnd.base1Y));

    return results;
}

function testAddingCWPhase2(armCount: number, sourceArmIndex: number): TestResult[] {
    const results: TestResult[] = [];
    const prefix = `ADD-CW ${armCount}arms idx${sourceArmIndex}`;

    // Adjacent arm in original N-arm star, and its final position in (N+1)-arm star
    const adjIndex = sourceArmIndex;
    const adjStart = getExpectedArm(armCount, adjIndex);
    // After adding CW, adj arm stays at same index (new arm is inserted at index+1)
    const newAdjIndex = adjIndex;
    const adjEnd = getExpectedArm(armCount + 1, newAdjIndex);

    // Final position of the new arm being added (CW: inserted at sourceArmIndex+1)
    const finalArm = getExpectedArm(armCount + 1, sourceArmIndex + 1);

    // P2 Start: 1@A2, T@At
    let ctx = makeCtx('adding', armCount, sourceArmIndex, 0.5, 1);
    let pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P2-start T@At`, pos.tipX, pos.tipY, adjStart.tipX, adjStart.tipY));
    results.push(check(`${prefix} P2-start 1@A2`, pos.base1X, pos.base1Y, adjStart.base2X, adjStart.base2Y));

    // P2 Mid: 1@A2 (pivot stays on moving A2) - interpolated position via angle
    ctx = makeCtx('adding', armCount, sourceArmIndex, 0.75, 1);
    pos = computeTransitionPosition(ctx);
    const adjMid = getInterpolatedArm(armCount, adjIndex, armCount + 1, newAdjIndex, 0.5);
    results.push(check(`${prefix} P2-mid 1@A2(pivot)`, pos.base1X, pos.base1Y, adjMid.base2X, adjMid.base2Y));

    // P2 End: T@fin, 1@A2 (pivot stays at adjEnd.b2), 2@fin
    ctx = makeCtx('adding', armCount, sourceArmIndex, 1.0, 1);
    pos = computeTransitionPosition(ctx);
    results.push(check(`${prefix} P2-end T@fin`, pos.tipX, pos.tipY, finalArm.tipX, finalArm.tipY));
    results.push(check(`${prefix} P2-end 1@A2`, pos.base1X, pos.base1Y, adjEnd.base2X, adjEnd.base2Y));
    results.push(check(`${prefix} P2-end 2@fin`, pos.base2X, pos.base2Y, finalArm.base2X, finalArm.base2Y));

    return results;
}

interface EdgeLengths {
    tipToBase1: number;
    tipToBase2: number;
    base1ToBase2: number;
}

function getEdgeLengths(pos: { tipX: number, tipY: number, base1X: number, base1Y: number, base2X: number, base2Y: number }): EdgeLengths {
    return {
        tipToBase1: dist(pos.tipX, pos.tipY, pos.base1X, pos.base1Y),
        tipToBase2: dist(pos.tipX, pos.tipY, pos.base2X, pos.base2Y),
        base1ToBase2: dist(pos.base1X, pos.base1Y, pos.base2X, pos.base2Y),
    };
}

function checkEdgeLength(name: string, actual: number, expected: number, tolerance: number = TOLERANCE): TestResult {
    const diff = Math.abs(actual - expected);
    return {
        name,
        passed: diff < tolerance,
        details: `got ${actual.toFixed(3)}, expected ${expected.toFixed(3)}, diff=${diff.toFixed(4)}`,
        distance: diff,
    };
}

function testEdgeLengthsPhase1Rigid(
    type: 'adding' | 'removing',
    armCount: number,
    sourceArmIndex: number,
    direction: TransitionDirection
): TestResult[] {
    const results: TestResult[] = [];
    const dirLabel = direction === 1 ? 'CW' : 'CCW';
    const prefix = `${type.toUpperCase()}-${dirLabel} ${armCount}arms idx${sourceArmIndex} P1-edges`;

    // Get edge lengths at start
    const ctxStart = makeCtx(type, armCount, sourceArmIndex, 0, direction);
    const posStart = computeTransitionPosition(ctxStart);
    const edgesStart = getEdgeLengths(posStart);

    // Phase 1 is rigid rotation - all edges should remain constant throughout
    const progressPoints = [0.1, 0.25, 0.4, 0.5];
    for (const p of progressPoints) {
        const ctx = makeCtx(type, armCount, sourceArmIndex, p, direction);
        const pos = computeTransitionPosition(ctx);
        const edges = getEdgeLengths(pos);

        results.push(checkEdgeLength(`${prefix} p=${p} T-b1`, edges.tipToBase1, edgesStart.tipToBase1));
        results.push(checkEdgeLength(`${prefix} p=${p} T-b2`, edges.tipToBase2, edgesStart.tipToBase2));
        results.push(checkEdgeLength(`${prefix} p=${p} b1-b2`, edges.base1ToBase2, edgesStart.base1ToBase2));
    }

    return results;
}

function testPhase1RotationDirection(
    type: 'adding' | 'removing',
    armCount: number,
    sourceArmIndex: number,
    direction: TransitionDirection
): TestResult[] {
    const results: TestResult[] = [];
    const dirLabel = direction === 1 ? 'CW' : 'CCW';
    const prefix = `${type.toUpperCase()}-${dirLabel} ${armCount}arms idx${sourceArmIndex} P1-rot`;

    const progressPoints = [0, 0.1, 0.2, 0.3, 0.4, 0.5];

    // Track angle of tip relative to pivot
    // For removing: pivot is one base point (b2 for CW, b1 for CCW)
    // For adding: pivot is the tip (A.t)
    const angleHistory: { p: number; tipAngle: number }[] = [];

    for (const p of progressPoints) {
        const ctx = makeCtx(type, armCount, sourceArmIndex, p, direction);
        const pos = computeTransitionPosition(ctx);

        let tipAngle: number;
        if (type === 'removing') {
            // Pivot is b2 for CW, b1 for CCW
            if (direction === 1) {
                tipAngle = Math.atan2(pos.tipY - pos.base2Y, pos.tipX - pos.base2X);
            } else {
                tipAngle = Math.atan2(pos.tipY - pos.base1Y, pos.tipX - pos.base1X);
            }
        } else {
            // For adding, tip stays at pivot (A.t), so track b1 or b2 instead
            // b1 swings for CW, b2 swings for CCW
            if (direction === 1) {
                tipAngle = Math.atan2(pos.base1Y - pos.tipY, pos.base1X - pos.tipX);
            } else {
                tipAngle = Math.atan2(pos.base2Y - pos.tipY, pos.base2X - pos.tipX);
            }
        }
        angleHistory.push({ p, tipAngle });
    }

    // Check rotation direction
    const tolerance = 0.01;
    for (let i = 1; i < angleHistory.length; i++) {
        const prev = angleHistory[i - 1];
        const curr = angleHistory[i];
        let delta = curr.tipAngle - prev.tipAngle;

        // Handle wrap-around
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;

        // For removing: CW rotation means tip moves CW (positive delta)
        // For adding: the swinging base moves in direction dir
        const correctDirection = direction === 1 ? delta >= -tolerance : delta <= tolerance;

        results.push({
            name: `${prefix} dir p=${prev.p.toFixed(2)}→${curr.p.toFixed(2)}`,
            passed: correctDirection,
            details: `delta=${(delta * 180 / Math.PI).toFixed(1)}° (expect ${direction === 1 ? '≥0' : '≤0'})`,
            distance: correctDirection ? 0 : Math.abs(delta),
        });
    }

    return results;
}

function testEdgeLengthsPhase2Monotonic(
    type: 'adding' | 'removing',
    armCount: number,
    sourceArmIndex: number,
    direction: TransitionDirection
): TestResult[] {
    const results: TestResult[] = [];
    const dirLabel = direction === 1 ? 'CW' : 'CCW';
    const prefix = `${type.toUpperCase()}-${dirLabel} ${armCount}arms idx${sourceArmIndex} P2-monotonic`;

    // Sample many points throughout phase 2
    const progressPoints = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0];
    const edgeHistory: { p: number; edges: EdgeLengths }[] = [];

    for (const p of progressPoints) {
        const ctx = makeCtx(type, armCount, sourceArmIndex, p, direction);
        const pos = computeTransitionPosition(ctx);
        edgeHistory.push({ p, edges: getEdgeLengths(pos) });
    }

    // Check that edges don't have wild jumps (more than 50% change between samples)
    for (let i = 1; i < edgeHistory.length; i++) {
        const prev = edgeHistory[i - 1];
        const curr = edgeHistory[i];

        // For ADDING-CW, the swinging base travels the "long way" (~340°) to maintain
        // rotation direction continuity with Phase 1. This causes larger edge length variations.
        const jumpThreshold = 0.35; // 35% max change per step

        const t1Change = Math.abs(curr.edges.tipToBase1 - prev.edges.tipToBase1) / Math.max(prev.edges.tipToBase1, 0.001);
        const t2Change = Math.abs(curr.edges.tipToBase2 - prev.edges.tipToBase2) / Math.max(prev.edges.tipToBase2, 0.001);
        const bChange = Math.abs(curr.edges.base1ToBase2 - prev.edges.base1ToBase2) / Math.max(prev.edges.base1ToBase2, 0.001);

        results.push({
            name: `${prefix} T-b1 jump p=${prev.p}→${curr.p}`,
            passed: t1Change < jumpThreshold,
            details: `${prev.edges.tipToBase1.toFixed(1)}→${curr.edges.tipToBase1.toFixed(1)} (${(t1Change * 100).toFixed(0)}%)`,
            distance: t1Change,
        });
        results.push({
            name: `${prefix} T-b2 jump p=${prev.p}→${curr.p}`,
            passed: t2Change < jumpThreshold,
            details: `${prev.edges.tipToBase2.toFixed(1)}→${curr.edges.tipToBase2.toFixed(1)} (${(t2Change * 100).toFixed(0)}%)`,
            distance: t2Change,
        });
        results.push({
            name: `${prefix} b1-b2 jump p=${prev.p}→${curr.p}`,
            passed: bChange < jumpThreshold,
            details: `${prev.edges.base1ToBase2.toFixed(1)}→${curr.edges.base1ToBase2.toFixed(1)} (${(bChange * 100).toFixed(0)}%)`,
            distance: bChange,
        });
    }

    return results;
}

function normalizeAngleTest(a: number): number {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
}

function testPhase2Rotation(
    type: 'adding' | 'removing',
    armCount: number,
    sourceArmIndex: number,
    direction: TransitionDirection
): TestResult[] {
    const results: TestResult[] = [];
    const dirLabel = direction === 1 ? 'CW' : 'CCW';
    const prefix = `${type.toUpperCase()}-${dirLabel} ${armCount}arms idx${sourceArmIndex} P2-rot`;

    const progressPoints = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0];

    // Track angles of swinging points relative to pivot
    // For removing: pivot is tip, track b1 and b2
    // For adding CW: pivot is b1, track tip and b2
    // For adding CCW: pivot is b2, track tip and b1
    const angleHistory: { p: number; angles: number[] }[] = [];

    for (const p of progressPoints) {
        const ctx = makeCtx(type, armCount, sourceArmIndex, p, direction);
        const pos = computeTransitionPosition(ctx);

        let angles: number[];
        if (type === 'removing') {
            angles = [
                Math.atan2(pos.base1Y - pos.tipY, pos.base1X - pos.tipX),
                Math.atan2(pos.base2Y - pos.tipY, pos.base2X - pos.tipX),
            ];
        } else if (direction === 1) {
            angles = [
                Math.atan2(pos.tipY - pos.base1Y, pos.tipX - pos.base1X),
                Math.atan2(pos.base2Y - pos.base1Y, pos.base2X - pos.base1X),
            ];
        } else {
            angles = [
                Math.atan2(pos.tipY - pos.base2Y, pos.tipX - pos.base2X),
                Math.atan2(pos.base1Y - pos.base2Y, pos.base1X - pos.base2X),
            ];
        }
        angleHistory.push({ p, angles });
    }

    const tolerance = 0.01;
    for (let i = 1; i < angleHistory.length; i++) {
        const prev = angleHistory[i - 1];
        const curr = angleHistory[i];

        for (let j = 0; j < prev.angles.length; j++) {
            const label = j === 0 ? (type === 'removing' ? 'b1' : 'tip') : (type === 'removing' ? 'b2' : (direction === 1 ? 'b2' : 'b1'));
            let delta = curr.angles[j] - prev.angles[j];

            // Handle wrap-around to get shortest delta
            if (delta > Math.PI) delta -= 2 * Math.PI;
            if (delta < -Math.PI) delta += 2 * Math.PI;

            // Both adding and removing phase 2 must rotate in direction dir
            // CW (dir=1): delta should be positive
            // CCW (dir=-1): delta should be negative
            const correctDirection = direction === 1 ? delta >= -tolerance : delta <= tolerance;
            results.push({
                name: `${prefix} ${label} dir p=${prev.p.toFixed(2)}→${curr.p.toFixed(2)}`,
                passed: correctDirection,
                details: `delta=${(delta * 180 / Math.PI).toFixed(1)}° (expect ${direction === 1 ? '≥0' : '≤0'})`,
                distance: correctDirection ? 0 : Math.abs(delta),
            });
        }
    }

    return results;
}

function testEdgeLengthsEndState(
    type: 'adding' | 'removing',
    armCount: number,
    sourceArmIndex: number,
    direction: TransitionDirection
): TestResult[] {
    const results: TestResult[] = [];
    const dirLabel = direction === 1 ? 'CW' : 'CCW';
    const prefix = `${type.toUpperCase()}-${dirLabel} ${armCount}arms idx${sourceArmIndex} end-edges`;

    // Get edge lengths at end of transition
    const ctxEnd = makeCtx(type, armCount, sourceArmIndex, 1.0, direction);
    const posEnd = computeTransitionPosition(ctxEnd);
    const edgesEnd = getEdgeLengths(posEnd);

    // The transition arm ends as an ASYMMETRIC triangle:
    // - One base point is at the final arm's standard position
    // - The other base point (the pivot) is at the adjacent arm's shared vertex
    //
    // For adding CW: b1 is pivot at adjEnd.b2, b2 at finalArm.b2
    // For adding CCW: b2 is pivot at adjEnd.b1, b1 at finalArm.b1
    // For removing: arm collapses onto adjacent arm
    //
    // So we only check that T-b2 (for CW) or T-b1 (for CCW) matches expected geometry
    // and that b1-b2 is reasonable (not collapsed).

    const finalArmCount = type === 'adding' ? armCount + 1 : armCount - 1;
    const finalInnerRadius = getInnerRadius(finalArmCount);
    const finalAngleStep = (2 * Math.PI) / finalArmCount;
    const finalHalfStep = finalAngleStep / 2;

    // Expected tip-to-base distance for the non-pivot base
    const expectedTipToBase = Math.sqrt(
        Math.pow(STAR_OUTER_RADIUS - finalInnerRadius * Math.cos(finalHalfStep), 2) +
        Math.pow(finalInnerRadius * Math.sin(finalHalfStep), 2)
    );
    // Expected base-to-base distance (chord on inner circle)
    const expectedBaseToBase = 2 * finalInnerRadius * Math.sin(finalHalfStep);

    const looseTolerance = 1.0;

    if (type === 'adding') {
        // For adding, one edge matches the final arm geometry
        if (direction === 1) {
            // CW: b2 is at final position, b1 is pivot
            results.push(checkEdgeLength(`${prefix} T-b2 final`, edgesEnd.tipToBase2, expectedTipToBase, looseTolerance));
        } else {
            // CCW: b1 is at final position, b2 is pivot
            results.push(checkEdgeLength(`${prefix} T-b1 final`, edgesEnd.tipToBase1, expectedTipToBase, looseTolerance));
        }
    } else {
        // For removing, arm collapses onto adjacent - both edges should match adjacent arm
        results.push(checkEdgeLength(`${prefix} T-b1 final`, edgesEnd.tipToBase1, expectedTipToBase, looseTolerance));
        results.push(checkEdgeLength(`${prefix} T-b2 final`, edgesEnd.tipToBase2, expectedTipToBase, looseTolerance));
    }
    results.push(checkEdgeLength(`${prefix} b1-b2 final`, edgesEnd.base1ToBase2, expectedBaseToBase, looseTolerance));

    return results;
}

// Test that existing arms redistribute correctly during Phase 2 of adding
// For CW: source arm stays at same index, arms CW of source shift by +1
// For CCW: source arm shifts to index+1, arms CCW of source stay at same index
function testAddingArmRedistribution(armCount: number, sourceArmIndex: number, direction: TransitionDirection): TestResult[] {
    const results: TestResult[] = [];
    const dirLabel = direction === 1 ? 'CW' : 'CCW';
    const prefix = `ADD-${dirLabel} ${armCount}arms idx${sourceArmIndex} redistribution`;

    const angleStep = (2 * Math.PI) / armCount;
    const targetAngleStep = (2 * Math.PI) / (armCount + 1);

    // Test at end of transition (p=1.0) where arms should be at final positions
    // We use computeAdjacentArmPosition to check the source arm's final position
    const ctx = makeCtx('adding', armCount, sourceArmIndex, 1.0, direction);
    const adjPos = computeAdjacentArmPosition(ctx);
    const adjTipAngle = Math.atan2(adjPos.tipY - CENTER_Y, adjPos.tipX - CENTER_X);

    // Expected final position of source arm
    // CW: source stays at same index
    // CCW: source shifts to index+1
    const expectedFinalIndex = direction === 1 ? sourceArmIndex : sourceArmIndex + 1;
    const expectedFinalAngle = -Math.PI / 2 + expectedFinalIndex * targetAngleStep;

    // Normalize both angles for comparison
    const normalizeAngle = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const actualNorm = normalizeAngle(adjTipAngle);
    const expectedNorm = normalizeAngle(expectedFinalAngle);
    const angleDiff = Math.abs(actualNorm - expectedNorm);
    const angleClose = angleDiff < 0.01 || angleDiff > (2 * Math.PI - 0.01);

    results.push({
        name: `${prefix} source-arm-final-position`,
        passed: angleClose,
        details: `source arm at ${(actualNorm * 180 / Math.PI).toFixed(1)}°, expected idx ${expectedFinalIndex} at ${(expectedNorm * 180 / Math.PI).toFixed(1)}°`,
        distance: angleClose ? 0 : angleDiff,
    });

    // Also verify the new arm's final position is correct
    const transPos = computeTransitionPosition(ctx);
    const transTipAngle = Math.atan2(transPos.tipY - CENTER_Y, transPos.tipX - CENTER_X);

    // New arm position
    // CW: new arm at sourceArmIndex+1
    // CCW: new arm at sourceArmIndex
    const newArmFinalIndex = direction === 1 ? sourceArmIndex + 1 : sourceArmIndex;
    const newArmExpectedAngle = -Math.PI / 2 + newArmFinalIndex * targetAngleStep;

    const transNorm = normalizeAngle(transTipAngle);
    const newArmExpectedNorm = normalizeAngle(newArmExpectedAngle);
    const transAngleDiff = Math.abs(transNorm - newArmExpectedNorm);
    const transAngleClose = transAngleDiff < 0.01 || transAngleDiff > (2 * Math.PI - 0.01);

    results.push({
        name: `${prefix} new-arm-final-position`,
        passed: transAngleClose,
        details: `new arm at ${(transNorm * 180 / Math.PI).toFixed(1)}°, expected idx ${newArmFinalIndex} at ${(newArmExpectedNorm * 180 / Math.PI).toFixed(1)}°`,
        distance: transAngleClose ? 0 : transAngleDiff,
    });

    return results;
}

// Test that the gap opens in the correct location during Phase 2 of adding
// For CW: new arm inserts at sourceArmIndex+1, gap should open between source and its CW neighbor
// For CCW: new arm inserts at sourceArmIndex, gap should open between source's CCW neighbor and source
function testAddingGapLocation(armCount: number, sourceArmIndex: number, direction: TransitionDirection): TestResult[] {
    const results: TestResult[] = [];
    const dirLabel = direction === 1 ? 'CW' : 'CCW';
    const prefix = `ADD-${dirLabel} ${armCount}arms idx${sourceArmIndex} gap-location`;

    // At Phase 2 mid-point (p=0.75), check where the transition arm's bases are
    const ctx = makeCtx('adding', armCount, sourceArmIndex, 0.75, direction);
    const pos = computeTransitionPosition(ctx);

    // Get positions of existing arms at the same progress point
    const angleStep = (2 * Math.PI) / armCount;
    const halfStep = angleStep / 2;
    const targetAngleStep = (2 * Math.PI) / (armCount + 1);
    const targetHalfStep = targetAngleStep / 2;
    const innerRadius = getTransitionInnerRadius(armCount, 'adding', 0.75);

    // The transition arm should be positioned between:
    // - CW: source arm and its CW neighbor (source+1 in original indexing)
    // - CCW: source's CCW neighbor (source-1) and source arm
    const sourceAngle = -Math.PI / 2 + sourceArmIndex * angleStep;

    if (direction === 1) {
        // CW: new arm at sourceArmIndex+1 in final star
        // The transition arm's b1 (pivot) should be tracking toward where the source arm's b2 will be
        // The transition arm's b2 (swinging) should be moving toward its final position

        // The gap opens CW from the source arm
        // Check: transition arm tip should be roughly between source tip angle and (source+1) tip angle
        const sourceTipAngle = sourceAngle;
        const cwNeighborAngle = sourceAngle + angleStep;
        const transitionTipAngle = Math.atan2(pos.tipY - CENTER_Y, pos.tipX - CENTER_X);

        // Normalize angles for comparison
        const normalizedSource = ((sourceTipAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const normalizedNeighbor = ((cwNeighborAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const normalizedTrans = ((transitionTipAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

        // The transition tip should be between source and CW neighbor (going CW)
        // This means: source < trans < neighbor (with wraparound handling)
        let isBetween: boolean;
        if (normalizedSource < normalizedNeighbor) {
            isBetween = normalizedTrans > normalizedSource && normalizedTrans < normalizedNeighbor;
        } else {
            // Wraparound case
            isBetween = normalizedTrans > normalizedSource || normalizedTrans < normalizedNeighbor;
        }

        results.push({
            name: `${prefix} tip-between-source-and-CW-neighbor`,
            passed: isBetween,
            details: `trans=${(normalizedTrans * 180 / Math.PI).toFixed(1)}° should be CW of source=${(normalizedSource * 180 / Math.PI).toFixed(1)}° and CCW of neighbor=${(normalizedNeighbor * 180 / Math.PI).toFixed(1)}°`,
            distance: isBetween ? 0 : 1,
        });
    } else {
        // CCW: new arm at sourceArmIndex in final star (existing arms shift CW)
        // The gap opens CCW from the source arm
        const sourceTipAngle = sourceAngle;
        const ccwNeighborAngle = sourceAngle - angleStep;
        const transitionTipAngle = Math.atan2(pos.tipY - CENTER_Y, pos.tipX - CENTER_X);

        const normalizedSource = ((sourceTipAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const normalizedNeighbor = ((ccwNeighborAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const normalizedTrans = ((transitionTipAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

        // The transition tip should be between CCW neighbor and source (going CW)
        let isBetween: boolean;
        if (normalizedNeighbor < normalizedSource) {
            isBetween = normalizedTrans > normalizedNeighbor && normalizedTrans < normalizedSource;
        } else {
            isBetween = normalizedTrans > normalizedNeighbor || normalizedTrans < normalizedSource;
        }

        results.push({
            name: `${prefix} tip-between-CCW-neighbor-and-source`,
            passed: isBetween,
            details: `trans=${(normalizedTrans * 180 / Math.PI).toFixed(1)}° should be CW of neighbor=${(normalizedNeighbor * 180 / Math.PI).toFixed(1)}° and CCW of source=${(normalizedSource * 180 / Math.PI).toFixed(1)}°`,
            distance: isBetween ? 0 : 1,
        });
    }

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

function runAllTests(filterType?: 'adding' | 'removing', filterArmCount?: number, filterIdx?: number, filterDirection?: TransitionDirection): void {
    const allResults: TestResult[] = [];

    // Inner radius interpolation tests
    allResults.push(...testInnerRadiusInterpolation());

    const armCounts = filterArmCount ? [filterArmCount] : [4, 5, 6, 7];

    for (const armCount of armCounts) {
        const indices = filterIdx !== undefined ? [filterIdx] : Array.from({length: armCount}, (_, i) => i);
        for (const idx of indices) {
            if (!filterType || filterType === 'removing') {
                if (!filterDirection || filterDirection === 1) {
                    allResults.push(...testRemovingCWPhase1(armCount, idx));
                    allResults.push(...testRemovingCWPhase2(armCount, idx));
                    allResults.push(...testEdgeLengthsPhase1Rigid('removing', armCount, idx, 1));
                    allResults.push(...testPhase1RotationDirection('removing', armCount, idx, 1));
                    allResults.push(...testEdgeLengthsPhase2Monotonic('removing', armCount, idx, 1));
                    allResults.push(...testPhase2Rotation('removing', armCount, idx, 1));
                    allResults.push(...testEdgeLengthsEndState('removing', armCount, idx, 1));
                }
                if (!filterDirection || filterDirection === -1) {
                    allResults.push(...testRemovingCCWPhase1(armCount, idx));
                    allResults.push(...testRemovingCCWPhase2(armCount, idx));
                    allResults.push(...testEdgeLengthsPhase1Rigid('removing', armCount, idx, -1));
                    allResults.push(...testPhase1RotationDirection('removing', armCount, idx, -1));
                    allResults.push(...testEdgeLengthsPhase2Monotonic('removing', armCount, idx, -1));
                    allResults.push(...testPhase2Rotation('removing', armCount, idx, -1));
                    allResults.push(...testEdgeLengthsEndState('removing', armCount, idx, -1));
                }
            }
            if (!filterType || filterType === 'adding') {
                if (!filterDirection || filterDirection === -1) {
                    allResults.push(...testAddingCCWPhase1(armCount, idx));
                    allResults.push(...testAddingCCWPhase2(armCount, idx));
                    allResults.push(...testEdgeLengthsPhase1Rigid('adding', armCount, idx, -1));
                    allResults.push(...testPhase1RotationDirection('adding', armCount, idx, -1));
                    allResults.push(...testEdgeLengthsPhase2Monotonic('adding', armCount, idx, -1));
                    allResults.push(...testPhase2Rotation('adding', armCount, idx, -1));
                    allResults.push(...testEdgeLengthsEndState('adding', armCount, idx, -1));
                    allResults.push(...testAddingArmRedistribution(armCount, idx, -1));
                    allResults.push(...testAddingGapLocation(armCount, idx, -1));
                }
                if (!filterDirection || filterDirection === 1) {
                    allResults.push(...testAddingCWPhase1(armCount, idx));
                    allResults.push(...testAddingCWPhase2(armCount, idx));
                    allResults.push(...testEdgeLengthsPhase1Rigid('adding', armCount, idx, 1));
                    allResults.push(...testPhase1RotationDirection('adding', armCount, idx, 1));
                    allResults.push(...testEdgeLengthsPhase2Monotonic('adding', armCount, idx, 1));
                    allResults.push(...testPhase2Rotation('adding', armCount, idx, 1));
                    allResults.push(...testEdgeLengthsEndState('adding', armCount, idx, 1));
                    allResults.push(...testAddingArmRedistribution(armCount, idx, 1));
                    allResults.push(...testAddingGapLocation(armCount, idx, 1));
                }
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

// Parse command line: [type] [armCount] [idx] [direction]
// e.g.: npx tsx test/starAnimationCore.test.ts removing 6 5 -1
const args = typeof process !== 'undefined' ? process.argv.slice(2) : [];
const filterType = args[0] as 'adding' | 'removing' | undefined;
const filterArmCount = args[1] ? parseInt(args[1]) : undefined;
const filterIdx = args[2] ? parseInt(args[2]) : undefined;
const filterDirection = args[3] ? (parseInt(args[3]) as TransitionDirection) : undefined;

runAllTests(filterType, filterArmCount, filterIdx, filterDirection);
