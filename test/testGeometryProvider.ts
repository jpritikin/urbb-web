import {
    createSingleTransitionGeometry,
    buildStaticArms,
    computeTransitionWithGeometry,
    TransitionDirection,
    STAR_OUTER_RADIUS,
    getTransitionInnerRadius,
    dist,
    mod,
} from '../src/star/starAnimationCore.js';

const CENTER_X = 200;
const CENTER_Y = 200;

function testGeometryProvider(): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    for (const armCount of [4, 5, 6, 7]) {
        for (const type of ['adding', 'removing'] as const) {
            for (const direction of [1, -1] as TransitionDirection[]) {
                for (let sourceArmIndex = 0; sourceArmIndex < armCount; sourceArmIndex++) {
                    const prefix = `${type.toUpperCase()}-${direction === 1 ? 'CW' : 'CCW'} ${armCount}arms idx${sourceArmIndex}`;

                    const rotation = 0;

                    for (const progress of [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1.0]) {
                        const innerRadius = getTransitionInnerRadius(armCount, type, progress, STAR_OUTER_RADIUS);
                        const staticArms = buildStaticArms(armCount, rotation, CENTER_X, CENTER_Y, innerRadius, STAR_OUTER_RADIUS);
                        const geom = createSingleTransitionGeometry({
                            type,
                            sourceArmIndex,
                            armCount,
                            centerX: CENTER_X,
                            centerY: CENTER_Y,
                            outerRadius: STAR_OUTER_RADIUS,
                            rotation,
                            direction,
                        }, staticArms);

                        const result = computeTransitionWithGeometry(
                            geom,
                            { centerX: CENTER_X, centerY: CENTER_Y, outerRadius: STAR_OUTER_RADIUS, rotation: 0, direction },
                            type,
                            progress
                        );

                        // Test geometric invariants
                        const tipToB1 = dist(result.t.x, result.t.y, result.b1.x, result.b1.y);
                        const tipToB2 = dist(result.t.x, result.t.y, result.b2.x, result.b2.y);
                        const baseToBase = dist(result.b1.x, result.b1.y, result.b2.x, result.b2.y);

                        // Triangle inequality
                        const triangleValid = tipToB1 + tipToB2 > baseToBase &&
                                              tipToB1 + baseToBase > tipToB2 &&
                                              tipToB2 + baseToBase > tipToB1;

                        // Edge lengths should be reasonable (allow smaller at boundaries)
                        const minEdge = progress === 0 || progress === 1 ? 2 : 4;
                        const minBase = progress < 0.5 ? 0.5 : 1;
                        const edgesReasonable = tipToB1 > minEdge && tipToB1 < 40 &&
                                                tipToB2 > minEdge && tipToB2 < 40 &&
                                                baseToBase > minBase && baseToBase < 25;

                        // Edge lengths should match adjacent arm's edge lengths
                        const adjIndex = type === 'adding' ? sourceArmIndex : mod(sourceArmIndex + direction, armCount);
                        const adjArm = staticArms.get(adjIndex)!;
                        const adjTipToB1 = dist(adjArm.t.x, adjArm.t.y, adjArm.b1.x, adjArm.b1.y);
                        const adjTipToB2 = dist(adjArm.t.x, adjArm.t.y, adjArm.b2.x, adjArm.b2.y);
                        const edgeLengthsMatch = Math.abs(tipToB1 - adjTipToB1) < 0.01 &&
                                                  Math.abs(tipToB2 - adjTipToB2) < 0.01;

                        const allOk = triangleValid && edgesReasonable && edgeLengthsMatch;

                        if (allOk) {
                            passed++;
                        } else {
                            failed++;
                            failures.push(`${prefix} p=${progress}: tri=${triangleValid} edges=${edgesReasonable} edgeMatch=${edgeLengthsMatch}`);
                        }
                    }
                }
            }
        }
    }

    return { passed, failed, failures };
}

export function runGeometryProviderTests(): { passed: number; failed: number; failures: string[] } {
    return testGeometryProvider();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { passed, failed, failures } = testGeometryProvider();
    console.log(`Geometry Provider: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
    }
}
