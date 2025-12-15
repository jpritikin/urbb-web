import {
    createFirstTransitionGeometry,
    computeTransitionWithGeometry,
    getRenderSpec,
    OverlappingTransitionParams,
    TransitionDirection,
    STAR_OUTER_RADIUS,
    dist,
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
        firstCompleted: false,
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
            const firstGeom = createFirstTransitionGeometry(params, getSecondProgress);

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
                const tipOnOuterCircle = Math.abs(dist(result.t.x, result.t.y, CENTER_X, CENTER_Y) - STAR_OUTER_RADIUS) < 1;

                if (triangleValid && edgesReasonable && tipOnOuterCircle) {
                    passed++;
                } else {
                    failed++;
                    failures.push(`${prefix} FIRST final p1=1.0: triangle=${triangleValid} edges=${edgesReasonable} tipOnOuter=${tipOnOuterCircle}`);
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
                    const tipOnOuterCircle = Math.abs(dist(result.tip.x, result.tip.y, CENTER_X, CENTER_Y) - STAR_OUTER_RADIUS) < 1;

                    if (triangleValid && edgesReasonable && tipOnOuterCircle) {
                        passed++;
                    } else {
                        failed++;
                        failures.push(`${prefix} SECOND final p2=0.99: triangle=${triangleValid} edges=${edgesReasonable} tipOnOuter=${tipOnOuterCircle}`);
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

export function runOverlappingGeometryTests(): { passed: number; failed: number; failures: string[] } {
    return testOverlappingGeometryInvariants();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { passed, failed, failures } = runOverlappingGeometryTests();
    console.log(`Overlapping Geometry: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
    }
}
