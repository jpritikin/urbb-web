import {
    getRenderSpec,
    normalizeAngle,
    TransitionDirection,
    STAR_OUTER_RADIUS,
} from '../src/starAnimationCore.js';

const CENTER_X = 200;
const CENTER_Y = 200;
const OUTER_R = STAR_OUTER_RADIUS;

function toDeg(rad: number): number {
    return rad * 180 / Math.PI;
}

function pointAngle(fromX: number, fromY: number, toX: number, toY: number): number {
    return Math.atan2(toY - fromY, toX - fromX);
}

interface TestResult {
    passed: boolean;
    message: string;
}

// Test that b1 = CCW base and b2 = CW base are computed correctly
// For adding CW from source arm S: new arm's b2 locks to adjacent's b1
// For adding CCW from source arm S: new arm's b1 locks to adjacent's b2
function testBaseAnglesCorrect(
    description: string,
    adjB1: number,
    adjB2: number,
    sourceIndex: number,
    armCount: number,
    direction: TransitionDirection,
    rotation: number
): TestResult {
    const angleStep = (2 * Math.PI) / armCount;
    const halfStep = angleStep / 2;
    const sourceTipAngle = rotation - Math.PI / 2 + sourceIndex * angleStep;

    // b1 should be CCW from tip = tipAngle - halfStep
    // b2 should be CW from tip = tipAngle + halfStep
    const expectedB1 = sourceTipAngle - halfStep;
    const expectedB2 = sourceTipAngle + halfStep;

    const b1Diff = Math.abs(normalizeAngle(adjB1 - expectedB1));
    const b2Diff = Math.abs(normalizeAngle(adjB2 - expectedB2));
    const tolerance = 0.001;
    const passed = b1Diff < tolerance && b2Diff < tolerance;

    if (!passed) {
        return {
            passed: false,
            message: `${description}: FAILED\n  adjB1: ${toDeg(adjB1).toFixed(1)}°, expected: ${toDeg(expectedB1).toFixed(1)}° (diff: ${toDeg(b1Diff).toFixed(1)}°)\n  adjB2: ${toDeg(adjB2).toFixed(1)}°, expected: ${toDeg(expectedB2).toFixed(1)}° (diff: ${toDeg(b2Diff).toFixed(1)}°)`
        };
    }
    return { passed: true, message: `${description}: OK` };
}

// Test the Phase 1 rotation - bases should rotate the "long way"
function testPhase1RotationDirection(
    description: string,
    adjB1: number,
    adjB2: number,
    direction: TransitionDirection,
    innerRadius: number
): TestResult {
    // Compute collapsed state: tip at midpoint of adj bases
    const adjTipAngle = (adjB1 + adjB2) / 2;
    const tipX = CENTER_X + OUTER_R * Math.cos(adjTipAngle);
    const tipY = CENTER_Y + OUTER_R * Math.sin(adjTipAngle);

    // For CW: pivot is b2, swinging is b1
    // For CCW: pivot is b1, swinging is b2
    const pivotAngle = direction === 1 ? adjB2 : adjB1;
    const swingAngle = direction === 1 ? adjB1 : adjB2;

    const pivotX = CENTER_X + innerRadius * Math.cos(pivotAngle);
    const pivotY = CENTER_Y + innerRadius * Math.sin(pivotAngle);
    const swingX = CENTER_X + innerRadius * Math.cos(swingAngle);
    const swingY = CENTER_Y + innerRadius * Math.sin(swingAngle);

    // Angles from tip to these points
    const pivotAngleFromTip = pointAngle(tipX, tipY, pivotX, pivotY);
    const swingAngleFromTip = pointAngle(tipX, tipY, swingX, swingY);

    // Short way rotation
    const shortWay = normalizeAngle(pivotAngleFromTip - swingAngleFromTip);
    // Long way rotation (opposite sign, larger magnitude)
    const longWay = shortWay > 0 ? shortWay - 2 * Math.PI : shortWay + 2 * Math.PI;

    // The actual rotation should be the long way in the transition direction
    const actualRotation = (direction === 1) === (longWay > 0) ? longWay : -longWay;

    // Check: actual rotation should have same sign as direction
    const rotationMatchesDirection = Math.sign(actualRotation) === direction;

    // Check: actual rotation magnitude should be > 180° (long way)
    const isLongWay = Math.abs(actualRotation) > Math.PI;

    const passed = rotationMatchesDirection && isLongWay;

    if (!passed) {
        const details = [
            `shortWay: ${toDeg(shortWay).toFixed(1)}°`,
            `longWay: ${toDeg(longWay).toFixed(1)}°`,
            `actualRotation: ${toDeg(actualRotation).toFixed(1)}° (expect ${direction === 1 ? 'positive' : 'negative'} and > 180°)`,
            `rotationMatchesDirection: ${rotationMatchesDirection}`,
            `isLongWay: ${isLongWay}`,
        ];
        return { passed: false, message: `${description}: FAILED\n  ${details.join('\n  ')}` };
    }

    return { passed: true, message: `${description}: OK` };
}

export function runGeometryProviderOrderTests(): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    // Test static arm angles via getRenderSpec
    for (const armCount of [4, 5, 6, 7]) {
        for (let sourceIndex = 0; sourceIndex < armCount; sourceIndex++) {
            for (const direction of [1, -1] as TransitionDirection[]) {
                for (const rotation of [0, Math.PI / 4, Math.PI / 2]) {
                    const spec = getRenderSpec({
                        bundle: {
                            first: {
                                type: 'adding',
                                sourceArmIndex: sourceIndex,
                                startArmCount: armCount,
                                direction,
                                progress: 0.5,
                            },
                            second: null,
                            overlapStart: 0,
                            firstCompleted: false,
                        },
                        armCount,
                        rotation,
                        centerX: CENTER_X,
                        centerY: CENTER_Y,
                        outerRadius: OUTER_R,
                        expansionMagnitude: 0,
                    });

                    // Get the adjacent arm's angle spec (source arm for adding)
                    const adjSpec = spec.staticArms.get(sourceIndex);
                    if (!adjSpec) {
                        failed++;
                        failures.push(`adding ${armCount}arms src${sourceIndex}: adjacent arm not found`);
                        continue;
                    }

                    const adjB1 = adjSpec.tipAngle - adjSpec.halfStep;
                    const adjB2 = adjSpec.tipAngle + adjSpec.halfStep;
                    const desc = `adding ${armCount}arms src${sourceIndex} ${direction === 1 ? 'CW' : 'CCW'} rot${toDeg(rotation).toFixed(0)}`;
                    const result = testBaseAnglesCorrect(desc, adjB1, adjB2, sourceIndex, armCount, direction, rotation);

                    if (result.passed) {
                        passed++;
                    } else {
                        failed++;
                        failures.push(result.message);
                    }
                }
            }
        }
    }

    // Test phase 1 rotation direction via getRenderSpec
    for (const type of ['adding', 'removing'] as const) {
        for (const armCount of [4, 5, 6, 7]) {
            for (let sourceIndex = 0; sourceIndex < armCount; sourceIndex++) {
                for (const direction of [1, -1] as TransitionDirection[]) {
                    const rotation = 0;
                    const spec = getRenderSpec({
                        bundle: {
                            first: {
                                type,
                                sourceArmIndex: sourceIndex,
                                startArmCount: armCount,
                                direction,
                                progress: 0,
                            },
                            second: null,
                            overlapStart: 0,
                            firstCompleted: false,
                        },
                        armCount,
                        rotation,
                        centerX: CENTER_X,
                        centerY: CENTER_Y,
                        outerRadius: OUTER_R,
                        expansionMagnitude: 0,
                    });

                    // Get the adjacent arm's angle spec
                    const adjIndex = type === 'adding' ? sourceIndex : (sourceIndex + direction + armCount) % armCount;
                    const adjSpec = spec.staticArms.get(adjIndex);
                    if (!adjSpec) {
                        failed++;
                        failures.push(`${type} ${armCount}arms src${sourceIndex}: adjacent arm not found`);
                        continue;
                    }

                    const innerRadius = spec.innerRadius;
                    const adjB1 = adjSpec.tipAngle - adjSpec.halfStep;
                    const adjB2 = adjSpec.tipAngle + adjSpec.halfStep;

                    const desc = `${type} ${armCount}arms src${sourceIndex} ${direction === 1 ? 'CW' : 'CCW'}`;
                    const result = testPhase1RotationDirection(desc, adjB1, adjB2, direction, innerRadius);

                    if (result.passed) {
                        passed++;
                    } else {
                        failed++;
                        failures.push(result.message);
                    }
                }
            }
        }
    }

    return { passed, failed, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { passed, failed, failures } = runGeometryProviderOrderTests();
    console.log(`Geometry Provider Order: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
    }
}
