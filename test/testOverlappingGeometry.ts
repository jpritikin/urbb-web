import {
    createFirstTransitionGeometry,
    createSecondTransitionGeometry,
    buildStaticArms,
    computeTransitionWithGeometry,
    getRenderSpec,
    OverlappingTransitionParams,
    TransitionDirection,
    STAR_OUTER_RADIUS,
    getInnerRadiusForArmCount,
    dist,
    normalizeAngle,
    type PlannedTransitionBundle,
} from '../src/starAnimationCore.js';

const CENTER_X = 200;
const CENTER_Y = 200;

interface TestCase {
    firstType: 'adding' | 'removing';
    secondType: 'adding' | 'removing';
    firstDir: TransitionDirection;
    secondDir: TransitionDirection;
    startArmCount: number;
}

function createBundle(
    tc: TestCase,
    firstSourceIndex: number,
    secondSourceIndex: number,
    p1: number,
    p2: number,
    overlapStart: number
): PlannedTransitionBundle {
    const intermediateCount = tc.firstType === 'adding' ? tc.startArmCount + 1 : tc.startArmCount - 1;
    return {
        first: {
            type: tc.firstType,
            direction: tc.firstDir,
            progress: p1,
            sourceArmIndex: firstSourceIndex,
            startArmCount: tc.startArmCount,
        },
        second: {
            type: tc.secondType,
            direction: tc.secondDir,
            progress: p2,
            sourceArmIndex: secondSourceIndex,
            startArmCount: intermediateCount,
        },
        overlapStart,
        
    };
}

function testOverlappingGeometryInvariants(): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    const testCases: TestCase[] = [
        { firstType: 'adding', secondType: 'adding', firstDir: 1, secondDir: 1, startArmCount: 5 },
        { firstType: 'adding', secondType: 'adding', firstDir: -1, secondDir: -1, startArmCount: 5 },
        { firstType: 'removing', secondType: 'adding', firstDir: 1, secondDir: 1, startArmCount: 5 },
        { firstType: 'removing', secondType: 'removing', firstDir: 1, secondDir: 1, startArmCount: 6 },
        { firstType: 'adding', secondType: 'removing', firstDir: 1, secondDir: 1, startArmCount: 5 },
    ];

    for (const tc of testCases) {
        const intermediateCount = tc.firstType === 'adding' ? tc.startArmCount + 1 : tc.startArmCount - 1;
        const finalCount = tc.secondType === 'adding' ? intermediateCount + 1 : intermediateCount - 1;
        const firstSourceIndex = 0;
        const secondSourceIndex = Math.floor(intermediateCount / 2);

        const prefix = `${tc.firstType[0].toUpperCase()}+${tc.secondType[0].toUpperCase()} ${tc.startArmCount}→${finalCount}`;

        for (const overlapStart of [0.3, 0.5, 0.7]) {
            const params: OverlappingTransitionParams = {
                centerX: CENTER_X,
                centerY: CENTER_Y,
                outerRadius: STAR_OUTER_RADIUS,
                rotation: 0,
                direction: tc.firstDir,
                firstType: tc.firstType,
                firstSourceIndex,
                firstStartArmCount: tc.startArmCount,
                firstDirection: tc.firstDir,
                secondType: tc.secondType,
                secondSourceIndex,
                secondDirection: tc.secondDir,
            };

            const getSecondProgress = (fp: number) => Math.max(0, (fp - overlapStart) / (1 - overlapStart));
            const innerRadius = getInnerRadiusForArmCount(tc.startArmCount);
            const staticArms = buildStaticArms(tc.startArmCount, 0, CENTER_X, CENTER_Y, innerRadius, STAR_OUTER_RADIUS);
            const firstGeom = createFirstTransitionGeometry(params, getSecondProgress, staticArms);

            // Test first transition at boundary p1=overlapStart (p2=0): should be collapsed onto adjacent
            {
                const result = computeTransitionWithGeometry(
                    firstGeom,
                    { centerX: CENTER_X, centerY: CENTER_Y, outerRadius: STAR_OUTER_RADIUS, rotation: 0, direction: tc.firstDir },
                    tc.firstType,
                    overlapStart
                );

                const tipToB1 = dist(result.t.x, result.t.y, result.b1.x, result.b1.y);
                const tipToB2 = dist(result.t.x, result.t.y, result.b2.x, result.b2.y);
                const baseToBase = dist(result.b1.x, result.b1.y, result.b2.x, result.b2.y);

                const triangleValid = tipToB1 + tipToB2 > baseToBase &&
                    tipToB1 + baseToBase > tipToB2 &&
                    tipToB2 + baseToBase > tipToB1;
                const edgesReasonable = tipToB1 > 5 && tipToB1 < 40 && tipToB2 > 5 && tipToB2 < 40;

                if (triangleValid && edgesReasonable) {
                    passed++;
                } else {
                    failed++;
                    failures.push(`${prefix} FIRST boundary p1=${overlapStart.toFixed(2)}: triangle=${triangleValid} edges=${edgesReasonable}`);
                }
            }

            // Test first transition at p1=1: should have valid triangle at final position
            {
                const result = computeTransitionWithGeometry(
                    firstGeom,
                    { centerX: CENTER_X, centerY: CENTER_Y, outerRadius: STAR_OUTER_RADIUS, rotation: 0, direction: tc.firstDir },
                    tc.firstType,
                    1.0
                );

                const tipToB1 = dist(result.t.x, result.t.y, result.b1.x, result.b1.y);
                const tipToB2 = dist(result.t.x, result.t.y, result.b2.x, result.b2.y);
                const baseToBase = dist(result.b1.x, result.b1.y, result.b2.x, result.b2.y);

                const triangleValid = tipToB1 + tipToB2 > baseToBase &&
                    tipToB1 + baseToBase > tipToB2 &&
                    tipToB2 + baseToBase > tipToB1;
                const edgesReasonable = tipToB1 > 5 && tipToB1 < 40 && tipToB2 > 5 && tipToB2 < 40;

                if (triangleValid && edgesReasonable) {
                    passed++;
                } else {
                    failed++;
                    failures.push(`${prefix} FIRST final p1=1.0: triangle=${triangleValid} edges=${edgesReasonable}`);
                }
            }

            // Test second transition at p2=0.01 using getRenderSpec (SSOT for static arms)
            {
                const p2 = 0.01;
                const p1 = overlapStart + p2 * (1 - overlapStart);
                const bundle = createBundle(tc, firstSourceIndex, secondSourceIndex, p1, p2, overlapStart);
                const spec = getRenderSpec({
                    bundle,
                    armCount: tc.startArmCount,
                    rotation: 0,
                    centerX: CENTER_X,
                    centerY: CENTER_Y,
                    outerRadius: STAR_OUTER_RADIUS,
                    expansionMagnitude: 0,
                });

                if (spec.secondTransitionArm) {
                    const result = spec.secondTransitionArm;
                    const tipToB1 = dist(result.tip.x, result.tip.y, result.b1.x, result.b1.y);
                    const tipToB2 = dist(result.tip.x, result.tip.y, result.b2.x, result.b2.y);
                    const baseToBase = dist(result.b1.x, result.b1.y, result.b2.x, result.b2.y);

                    const triangleValid = tipToB1 + tipToB2 > baseToBase &&
                        tipToB1 + baseToBase > tipToB2 &&
                        tipToB2 + baseToBase > tipToB1;
                    const edgesReasonable = tipToB1 > 5 && tipToB1 < 40 && tipToB2 > 5 && tipToB2 < 40;

                    if (triangleValid && edgesReasonable) {
                        passed++;
                    } else {
                        failed++;
                        failures.push(`${prefix} SECOND boundary p2=0.01: triangle=${triangleValid} edges=(${tipToB1.toFixed(1)}, ${tipToB2.toFixed(1)}, ${baseToBase.toFixed(1)})`);
                    }
                } else {
                    failed++;
                    failures.push(`${prefix} SECOND boundary p2=0.01: no secondTransitionArm`);
                }
            }

            // Test second transition at p2=0.99 using getRenderSpec
            {
                const p2 = 0.99;
                const p1 = overlapStart + p2 * (1 - overlapStart);
                const bundle = createBundle(tc, firstSourceIndex, secondSourceIndex, p1, p2, overlapStart);
                const spec = getRenderSpec({
                    bundle,
                    armCount: tc.startArmCount,
                    rotation: 0,
                    centerX: CENTER_X,
                    centerY: CENTER_Y,
                    outerRadius: STAR_OUTER_RADIUS,
                    expansionMagnitude: 0,
                });

                if (spec.secondTransitionArm) {
                    const result = spec.secondTransitionArm;
                    const tipToB1 = dist(result.tip.x, result.tip.y, result.b1.x, result.b1.y);
                    const tipToB2 = dist(result.tip.x, result.tip.y, result.b2.x, result.b2.y);
                    const baseToBase = dist(result.b1.x, result.b1.y, result.b2.x, result.b2.y);

                    const triangleValid = tipToB1 + tipToB2 > baseToBase &&
                        tipToB1 + baseToBase > tipToB2 &&
                        tipToB2 + baseToBase > tipToB1;
                    const edgesReasonable = tipToB1 > 5 && tipToB1 < 40 && tipToB2 > 5 && tipToB2 < 40;

                    if (triangleValid && edgesReasonable) {
                        passed++;
                    } else {
                        failed++;
                        failures.push(`${prefix} SECOND final p2=0.99: triangle=${triangleValid} edges=${edgesReasonable}`);
                    }
                } else {
                    failed++;
                    failures.push(`${prefix} SECOND final p2=0.99: no secondTransitionArm`);
                }
            }

            // Test smoothness: check that intermediate positions form valid triangles
            for (const p1 of [overlapStart + 0.1, overlapStart + 0.2, overlapStart + 0.3]) {
                if (p1 > 1) continue;
                const p2 = (p1 - overlapStart) / (1 - overlapStart);

                const firstResult = computeTransitionWithGeometry(
                    firstGeom,
                    { centerX: CENTER_X, centerY: CENTER_Y, outerRadius: STAR_OUTER_RADIUS, rotation: 0, direction: tc.firstDir },
                    tc.firstType,
                    p1
                );

                const tipToB1 = dist(firstResult.t.x, firstResult.t.y, firstResult.b1.x, firstResult.b1.y);
                const tipToB2 = dist(firstResult.t.x, firstResult.t.y, firstResult.b2.x, firstResult.b2.y);
                const baseToBase = dist(firstResult.b1.x, firstResult.b1.y, firstResult.b2.x, firstResult.b2.y);

                const triangleValid = tipToB1 + tipToB2 > baseToBase &&
                    tipToB1 + baseToBase > tipToB2 &&
                    tipToB2 + baseToBase > tipToB1;
                const edgesReasonable = tipToB1 > 4 && tipToB1 < 40 && tipToB2 > 4 && tipToB2 < 40 && baseToBase > 1 && baseToBase < 25;

                if (triangleValid && edgesReasonable) {
                    passed++;
                } else {
                    failed++;
                    failures.push(`${prefix} FIRST mid p1=${p1.toFixed(2)} p2=${p2.toFixed(2)}: edges=(${tipToB1.toFixed(1)}, ${tipToB2.toFixed(1)}, ${baseToBase.toFixed(1)})`);
                }
            }
        }
    }

    return { passed, failed, failures };
}

function testOverlappingInitialConditions(): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];
    const TOLERANCE = 0.5;

    const testCases: Array<{
        type: 'adding' | 'removing';
        startArmCount: number;
        firstSourceIndex: number;
        secondSourceIndex: number;
        overlapStart: number;
        direction: TransitionDirection;
    }> = [
            // The reported bug case
            { type: 'removing', startArmCount: 5, firstSourceIndex: 4, secondSourceIndex: 2, overlapStart: 0.37, direction: 1 },
            // Other cases
            { type: 'removing', startArmCount: 6, firstSourceIndex: 0, secondSourceIndex: 3, overlapStart: 0.5, direction: 1 },
            { type: 'removing', startArmCount: 7, firstSourceIndex: 3, secondSourceIndex: 0, overlapStart: 0.37, direction: 1 },
            { type: 'adding', startArmCount: 5, firstSourceIndex: 0, secondSourceIndex: 3, overlapStart: 0.5, direction: 1 },
        ];

    for (const tc of testCases) {
        const intermediateCount = tc.type === 'adding' ? tc.startArmCount + 1 : tc.startArmCount - 1;
        const prefix = `${tc.type} ${tc.startArmCount}→${intermediateCount} first=${tc.firstSourceIndex} second=${tc.secondSourceIndex}`;

        // Test FIRST transition at p1=0 (beginning of phase 1)
        {
            const bundle: PlannedTransitionBundle = {
                first: {
                    type: tc.type,
                    direction: tc.direction,
                    progress: 0,
                    sourceArmIndex: tc.firstSourceIndex,
                    startArmCount: tc.startArmCount,
                },
                second: null,
                overlapStart: tc.overlapStart,
                
            };

            const spec = getRenderSpec({
                bundle,
                armCount: tc.startArmCount,
                rotation: 0,
                centerX: CENTER_X,
                centerY: CENTER_Y,
                outerRadius: STAR_OUTER_RADIUS,
                expansionMagnitude: 0,
            });

            // Build static arms for comparison
            const staticArms = buildStaticArms(tc.startArmCount, 0, CENTER_X, CENTER_Y, spec.innerRadius, STAR_OUTER_RADIUS);

            if (spec.firstTransitionArm) {
                const arm = spec.firstTransitionArm;

                // For removing at p=0: arm should match its own static position
                // For adding at p=0: arm should be collapsed onto adjacent
                let expectedArm: { t: { x: number; y: number }; b1: { x: number; y: number }; b2: { x: number; y: number } };
                if (tc.type === 'removing') {
                    expectedArm = staticArms.get(tc.firstSourceIndex)!;
                } else {
                    // Adding: collapsed onto source (adjacent) arm
                    expectedArm = staticArms.get(tc.firstSourceIndex)!;
                }

                // Check tip is on outer radius
                const tipDistFromCenter = dist(arm.tip.x, arm.tip.y, CENTER_X, CENTER_Y);
                const tipOnRadius = Math.abs(tipDistFromCenter - STAR_OUTER_RADIUS) < TOLERANCE;

                // Check bases match static arm bases
                const b1Match = dist(arm.b1.x, arm.b1.y, expectedArm.b1.x, expectedArm.b1.y) < TOLERANCE;
                const b2Match = dist(arm.b2.x, arm.b2.y, expectedArm.b2.x, expectedArm.b2.y) < TOLERANCE;

                if (tipOnRadius && b1Match && b2Match) {
                    passed++;
                } else {
                    failed++;
                    const details: string[] = [];
                    if (!tipOnRadius) details.push(`tip not on radius (dist=${tipDistFromCenter.toFixed(1)}, expected=${STAR_OUTER_RADIUS})`);
                    if (!b1Match) details.push(`b1 mismatch (dist=${dist(arm.b1.x, arm.b1.y, expectedArm.b1.x, expectedArm.b1.y).toFixed(1)})`);
                    if (!b2Match) details.push(`b2 mismatch (dist=${dist(arm.b2.x, arm.b2.y, expectedArm.b2.x, expectedArm.b2.y).toFixed(1)})`);
                    failures.push(`${prefix} FIRST at p1=0: ${details.join(', ')}`);
                }
            } else {
                failed++;
                failures.push(`${prefix} FIRST at p1=0: no firstTransitionArm`);
            }
        }

        // Test SECOND transition at p2=0.99
        // For removing: arm should be collapsed onto adjacent
        // For adding: arm should be at its final position in target star
        {
            const p2 = 0.99;
            const p1 = tc.overlapStart + p2 * (1 - tc.overlapStart);

            const bundle: PlannedTransitionBundle = {
                first: {
                    type: tc.type,
                    direction: tc.direction,
                    progress: p1,
                    sourceArmIndex: tc.firstSourceIndex,
                    startArmCount: tc.startArmCount,
                },
                second: {
                    type: tc.type,
                    direction: tc.direction,
                    progress: p2,
                    sourceArmIndex: tc.secondSourceIndex,
                    startArmCount: intermediateCount,
                },
                overlapStart: tc.overlapStart,
                
            };

            const spec = getRenderSpec({
                bundle,
                armCount: tc.startArmCount,
                rotation: 0,
                centerX: CENTER_X,
                centerY: CENTER_Y,
                outerRadius: STAR_OUTER_RADIUS,
                expansionMagnitude: 0,
            });

            if (!spec.secondTransitionArm) {
                failed++;
                failures.push(`${prefix} SECOND at p2=${p2}: no secondTransitionArm`);
            } else {
                const arm = spec.secondTransitionArm;

                if (tc.type === 'removing') {
                    // For removing at p2≈1: arm should be collapsed onto adjacent
                    const adjIndexIntermediate = (tc.secondSourceIndex + tc.direction + intermediateCount) % intermediateCount;
                    const adjIndexOriginal = adjIndexIntermediate >= tc.firstSourceIndex
                        ? adjIndexIntermediate + 1
                        : adjIndexIntermediate;

                    const adjSpec = spec.staticArms.get(adjIndexOriginal);
                    if (!adjSpec) {
                        failed++;
                        failures.push(`${prefix} SECOND at p2=${p2}: adjacent arm ${adjIndexOriginal} not in staticArms`);
                    } else {
                        const adjTip = {
                            x: CENTER_X + STAR_OUTER_RADIUS * Math.cos(adjSpec.tipAngle),
                            y: CENTER_Y + STAR_OUTER_RADIUS * Math.sin(adjSpec.tipAngle),
                        };
                        const tipMatch = dist(arm.tip.x, arm.tip.y, adjTip.x, adjTip.y) < TOLERANCE;
                        if (tipMatch) {
                            passed++;
                        } else {
                            failed++;
                            failures.push(`${prefix} SECOND at p2=${p2}: tip doesn't match adjacent (dist=${dist(arm.tip.x, arm.tip.y, adjTip.x, adjTip.y).toFixed(1)})`);
                        }
                    }
                } else {
                    // For adding at p2≈1: arm should be near final position (tip on outer radius, valid triangle)
                    const tipDistFromCenter = dist(arm.tip.x, arm.tip.y, CENTER_X, CENTER_Y);
                    const tipOnRadius = Math.abs(tipDistFromCenter - STAR_OUTER_RADIUS) < TOLERANCE;
                    const tipToB1 = dist(arm.tip.x, arm.tip.y, arm.b1.x, arm.b1.y);
                    const tipToB2 = dist(arm.tip.x, arm.tip.y, arm.b2.x, arm.b2.y);
                    const edgesReasonable = tipToB1 > 5 && tipToB1 < 40 && tipToB2 > 5 && tipToB2 < 40;

                    if (tipOnRadius && edgesReasonable) {
                        passed++;
                    } else {
                        failed++;
                        const details: string[] = [];
                        if (!tipOnRadius) details.push(`tip not on radius (dist=${tipDistFromCenter.toFixed(1)})`);
                        if (!edgesReasonable) details.push(`edges out of range (${tipToB1.toFixed(1)}, ${tipToB2.toFixed(1)})`);
                        failures.push(`${prefix} SECOND at p2=${p2}: ${details.join(', ')}`);
                    }
                }
            }
        }
    }

    return { passed, failed, failures };
}

function pointAngleFromCenter(p: { x: number; y: number }): number {
    return Math.atan2(p.y - CENTER_Y, p.x - CENTER_X);
}

function toDeg(rad: number): number {
    return rad * 180 / Math.PI;
}

function testStaticArmBasePointOrdering(): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    // Test the reported bug case: during overlapping transitions, the second source arm
    // doesn't participate in first transition's redistribution at p2≈0, causing overlap
    const testCases = [
        { type: 'removing' as const, startArmCount: 5, firstSourceIndex: 4, secondSourceIndex: 2, overlapStart: 0.37, direction: 1 as TransitionDirection },
        { type: 'removing' as const, startArmCount: 6, firstSourceIndex: 0, secondSourceIndex: 3, overlapStart: 0.5, direction: 1 as TransitionDirection },
    ];

    for (const tc of testCases) {
        const intermediateCount = tc.type === 'adding' ? tc.startArmCount + 1 : tc.startArmCount - 1;
        const prefix = `${tc.type} ${tc.startArmCount}→${intermediateCount} src1=${tc.firstSourceIndex} src2=${tc.secondSourceIndex}`;

        // Test at p1=overlapStart (p2=0) - this is where the bug manifests
        // The second source arm should still redistribute with first transition
        for (const p1 of [tc.overlapStart, tc.overlapStart + 0.03]) {
            const p2 = (p1 - tc.overlapStart) / (1 - tc.overlapStart);

            const bundle: PlannedTransitionBundle = {
                first: {
                    type: tc.type,
                    direction: tc.direction,
                    progress: p1,
                    sourceArmIndex: tc.firstSourceIndex,
                    startArmCount: tc.startArmCount,
                },
                second: {
                    type: tc.type,
                    direction: tc.direction,
                    progress: p2,
                    sourceArmIndex: tc.secondSourceIndex,
                    startArmCount: intermediateCount,
                },
                overlapStart: tc.overlapStart,
                
            };

            const spec = getRenderSpec({
                bundle,
                armCount: tc.startArmCount,
                rotation: 0,
                centerX: CENTER_X,
                centerY: CENTER_Y,
                outerRadius: STAR_OUTER_RADIUS,
            });

            const armIndices = Array.from(spec.staticArms.keys()).sort((a, b) => a - b);

            for (let idx = 0; idx < armIndices.length; idx++) {
                const currIdx = armIndices[idx];
                const nextIdx = armIndices[(idx + 1) % armIndices.length];

                const currSpec = spec.staticArms.get(currIdx)!;
                const nextSpec = spec.staticArms.get(nextIdx)!;

                const currB2Angle = currSpec.tipAngle + currSpec.halfStep;
                const nextB1Angle = nextSpec.tipAngle - nextSpec.halfStep;

                const gap = normalizeAngle(nextB1Angle - currB2Angle);

                const TOLERANCE = 0.0001;
                if (gap < -TOLERANCE) {
                    failed++;
                    failures.push(`${prefix} p1=${p1.toFixed(2)} p2=${p2.toFixed(2)}: arms ${currIdx}→${nextIdx} bases overlap by ${toDeg(-gap).toFixed(2)}°`);
                } else {
                    passed++;
                }
            }
        }
    }

    return { passed, failed, failures };
}

function testSecondTransitionMonotonicity(): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];
    const MIN_DELTA = 0.001;

    const testCases = [
        { type: 'removing' as const, startArmCount: 5, firstSourceIndex: 4, secondSourceIndex: 2, overlapStart: 0.37, direction: 1 as TransitionDirection },
        { type: 'removing' as const, startArmCount: 6, firstSourceIndex: 0, secondSourceIndex: 3, overlapStart: 0.5, direction: 1 as TransitionDirection },
    ];

    for (const tc of testCases) {
        const intermediateCount = tc.type === 'adding' ? tc.startArmCount + 1 : tc.startArmCount - 1;
        const prefix = `${tc.type} ${tc.startArmCount}→${intermediateCount} first=${tc.firstSourceIndex} second=${tc.secondSourceIndex}`;

        const intermediateInnerRadius = getInnerRadiusForArmCount(intermediateCount);
        const staticArms = buildStaticArms(tc.startArmCount, 0, CENTER_X, CENTER_Y, intermediateInnerRadius, STAR_OUTER_RADIUS);

        const overlappingParams: OverlappingTransitionParams = {
            centerX: CENTER_X,
            centerY: CENTER_Y,
            outerRadius: STAR_OUTER_RADIUS,
            rotation: 0,
            direction: tc.direction,
            firstType: tc.type,
            firstSourceIndex: tc.firstSourceIndex,
            firstStartArmCount: tc.startArmCount,
            firstDirection: tc.direction,
            secondType: tc.type,
            secondSourceIndex: tc.secondSourceIndex,
            secondDirection: tc.direction,
        };

        const getFirstProgress = (p2: number) => tc.overlapStart + p2 * (1 - tc.overlapStart);
        const geom = createSecondTransitionGeometry(overlappingParams, getFirstProgress, staticArms, null, false);

        let prevTipAngle: number | null = null;
        let expectedSign: number | null = null;
        let monotonic = true;
        let nonzero = true;
        let failureDetail = '';

        for (let p = 0; p <= 1.0; p += 0.025) {
            const progress = Math.round(p * 1000) / 1000;
            const arm = computeTransitionWithGeometry(
                geom,
                { centerX: CENTER_X, centerY: CENTER_Y, outerRadius: STAR_OUTER_RADIUS, rotation: 0, direction: tc.direction },
                tc.type,
                progress
            );

            const tipAngle = pointAngleFromCenter(arm.t);

            if (prevTipAngle !== null) {
                const delta = normalizeAngle(tipAngle - prevTipAngle);
                // For removing, tip stops moving at p=0.5 (phase 1 in adding terms)
                // So we only check during the first half for removing
                const checkRange = progress > 0.05 && progress < 0.45;
                if (Math.abs(delta) < MIN_DELTA && checkRange) {
                    nonzero = false;
                    failureDetail = `p=${progress}: delta too small (${toDeg(delta).toFixed(3)}°)`;
                } else if (expectedSign === null && Math.abs(delta) >= MIN_DELTA) {
                    expectedSign = Math.sign(delta);
                } else if (expectedSign !== null && Math.abs(delta) >= MIN_DELTA && Math.sign(delta) !== expectedSign) {
                    monotonic = false;
                    failureDetail = `p=${progress}: not monotonic (delta=${toDeg(delta).toFixed(1)}°, expected sign=${expectedSign})`;
                }
            }
            prevTipAngle = tipAngle;
        }

        if (monotonic && nonzero) {
            passed++;
        } else {
            failed++;
            failures.push(`${prefix}: ${failureDetail}`);
        }
    }

    return { passed, failed, failures };
}

export function runOverlappingGeometryTests(): { passed: number; failed: number; failures: string[] } {
    const geomResults = testOverlappingGeometryInvariants();
    const initResults = testOverlappingInitialConditions();
    const monoResults = testSecondTransitionMonotonicity();
    const orderingResults = testStaticArmBasePointOrdering();
    return {
        passed: geomResults.passed + initResults.passed + monoResults.passed + orderingResults.passed,
        failed: geomResults.failed + initResults.failed + monoResults.failed + orderingResults.failed,
        failures: [...geomResults.failures, ...initResults.failures, ...monoResults.failures, ...orderingResults.failures],
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { passed, failed, failures } = runOverlappingGeometryTests();
    console.log(`Overlapping Geometry: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
    }
}
