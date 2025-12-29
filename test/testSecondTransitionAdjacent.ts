import {
    getRenderSpec,
    STAR_OUTER_RADIUS,
    getAngleStep,
    normalizeAngle,
    type PlannedTransitionBundle,
    type TransitionDirection,
} from '../src/starAnimationCore.js';

const CENTER_X = 200;
const CENTER_Y = 200;

function toDeg(rad: number): number {
    return rad * 180 / Math.PI;
}

function normalizeToPositive(angle: number): number {
    return ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

interface ArmInfo {
    label: string;
    angle: number;
    halfStep: number;
}

function computeGaps(arms: ArmInfo[]): Map<string, number> {
    const sorted = [...arms].sort((a, b) => a.angle - b.angle);
    const gaps = new Map<string, number>();

    for (let i = 0; i < sorted.length; i++) {
        const curr = sorted[i];
        const next = sorted[(i + 1) % sorted.length];
        const currUpper = curr.angle + curr.halfStep;
        const nextLower = next.angle - next.halfStep;
        let gap = nextLower - currUpper;
        if (gap < -Math.PI) gap += 2 * Math.PI;
        gaps.set(curr.label + "->" + next.label, gap);
    }

    return gaps;
}

function testGapsDuringOverlappingTransition(): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    const configs: Array<{
        label: string;
        type: 'adding' | 'removing';
        startCount: number;
        firstSource: number;
        secondSource: number;
        direction: TransitionDirection;
        overlapStart: number;
        p2Values: number[];
    }> = [
        { label: 'ADD 5->7', type: 'adding', startCount: 5, firstSource: 2, secondSource: 5, direction: 1, overlapStart: 0.5, p2Values: [0.25, 0.5, 0.59, 0.75, 0.95] },
        { label: 'ADD 5->7 alt', type: 'adding', startCount: 5, firstSource: 0, secondSource: 3, direction: 1, overlapStart: 0.5, p2Values: [0.5, 0.75, 0.95] },
        { label: 'REM 7->5', type: 'removing', startCount: 7, firstSource: 1, secondSource: 4, direction: 1, overlapStart: 0.5, p2Values: [0.05, 0.25, 0.5] },
        { label: 'ADD 3->5 CCW', type: 'adding', startCount: 3, firstSource: 1, secondSource: 3, direction: -1, overlapStart: 0.42, p2Values: [0.05, 0.25, 0.5, 0.75, 0.95, 1.0] },
    ];

    for (const cfg of configs) {
        const { label, type, startCount, firstSource, secondSource, direction, overlapStart, p2Values } = cfg;
        const intermediateCount = type === 'adding' ? startCount + 1 : startCount - 1;
        const finalCount = type === 'adding' ? startCount + 2 : startCount - 2;
        const finalAngleStep = getAngleStep(finalCount);

        for (const p2 of p2Values) {
            const p1 = overlapStart + p2 * (1 - overlapStart);

            const bundle: PlannedTransitionBundle = {
                first: {
                    type,
                    direction,
                    progress: p1,
                    sourceArmIndex: firstSource,
                    startArmCount: startCount,
                },
                second: {
                    type,
                    direction,
                    progress: p2,
                    sourceArmIndex: secondSource,
                    startArmCount: intermediateCount,
                },
                overlapStart,
                
            };

            const spec = getRenderSpec({
                bundle,
                armCount: startCount,
                rotation: 0,
                centerX: CENTER_X,
                centerY: CENTER_Y,
                outerRadius: STAR_OUTER_RADIUS,
            });

            // Collect all arms
            const arms: ArmInfo[] = [];
            for (const [idx, arm] of spec.staticArms) {
                arms.push({ label: "S" + idx, angle: arm.tipAngle, halfStep: arm.halfStep });
            }
            if (spec.firstTransitionArm) {
                arms.push({ label: "T1", angle: spec.firstTransitionArm.tipAngle, halfStep: spec.firstTransitionArm.halfStep });
            }
            if (spec.secondTransitionArm) {
                arms.push({ label: "T2", angle: spec.secondTransitionArm.tipAngle, halfStep: spec.secondTransitionArm.halfStep });
            }

            // Check gaps between static arms only
            const staticArms = arms.filter(a => a.label.startsWith('S'));
            const staticGaps = computeGaps(staticArms);

            const maxNegative = -0.01; // ~0.5 degrees tolerance
            for (const [gapLabel, gapSize] of staticGaps) {
                if (gapSize < maxNegative) {
                    failed++;
                    failures.push(
                        `${label} p2=${p2}: negative gap ${gapLabel} = ${toDeg(gapSize).toFixed(1)}°`
                    );
                } else {
                    passed++;
                }
            }

            // Check: all static arms should have similar halfStep (approaching final)
            const halfSteps = [...spec.staticArms.values()].map(a => a.halfStep);
            const minHalf = Math.min(...halfSteps);
            const maxHalf = Math.max(...halfSteps);
            if (maxHalf - minHalf > 0.05) { // ~3 degrees tolerance
                failed++;
                failures.push(
                    `${label} p2=${p2}: inconsistent halfSteps: min=${toDeg(minHalf).toFixed(1)}°, max=${toDeg(maxHalf).toFixed(1)}°`
                );
            } else {
                passed++;
            }
        }
    }

    return { passed, failed, failures };
}

function testNoNegativeGapsWithTransitionArms(): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    const configs: Array<{
        label: string;
        type: 'adding' | 'removing';
        startCount: number;
        firstSource: number;
        secondSource: number;
        direction: TransitionDirection;
        overlapStart: number;
    }> = [
        { label: 'ADD 3->5 CCW', type: 'adding', startCount: 3, firstSource: 1, secondSource: 3, direction: -1, overlapStart: 0.42 },
        { label: 'ADD 5->7 CW', type: 'adding', startCount: 5, firstSource: 2, secondSource: 5, direction: 1, overlapStart: 0.5 },
    ];

    for (const cfg of configs) {
        const { label, type, startCount, firstSource, secondSource, direction, overlapStart } = cfg;
        const intermediateCount = type === 'adding' ? startCount + 1 : startCount - 1;

        for (const p2 of [0.5, 0.75, 0.9, 0.95, 0.99]) {
            const p1 = overlapStart + p2 * (1 - overlapStart);
            const bundle: PlannedTransitionBundle = {
                first: {
                    type,
                    direction,
                    progress: p1,
                    sourceArmIndex: firstSource,
                    startArmCount: startCount,
                },
                second: {
                    type,
                    direction,
                    progress: p2,
                    sourceArmIndex: secondSource,
                    startArmCount: intermediateCount,
                },
                overlapStart,
                
            };

            const spec = getRenderSpec({
                bundle,
                armCount: startCount,
                rotation: 0,
                centerX: CENTER_X,
                centerY: CENTER_Y,
                outerRadius: STAR_OUTER_RADIUS,
            });

            // Collect all arms including transition arms
            const allArms: Array<{label: string, angle: number, halfStep: number}> = [];
            for (const [idx, arm] of spec.staticArms) {
                allArms.push({label: `S${idx}`, angle: arm.tipAngle, halfStep: arm.halfStep});
            }
            if (spec.firstTransitionArm) {
                allArms.push({label: 'T1', angle: spec.firstTransitionArm.tipAngle, halfStep: spec.firstTransitionArm.halfStep});
            }
            if (spec.secondTransitionArm) {
                allArms.push({label: 'T2', angle: spec.secondTransitionArm.tipAngle, halfStep: spec.secondTransitionArm.halfStep});
            }
            allArms.sort((a, b) => a.angle - b.angle);

            // Check gaps between all arms
            const maxNegative = -0.02; // ~1 degree tolerance
            for (let i = 0; i < allArms.length; i++) {
                const curr = allArms[i];
                const next = allArms[(i + 1) % allArms.length];
                const currUpper = curr.angle + curr.halfStep;
                let nextLower = next.angle - next.halfStep;
                if (i === allArms.length - 1) nextLower += 2 * Math.PI;
                const gap = nextLower - currUpper;

                if (gap < maxNegative) {
                    failed++;
                    failures.push(
                        `${label} p2=${p2}: negative gap ${curr.label}->${next.label} = ${toDeg(gap).toFixed(1)}°`
                    );
                } else {
                    passed++;
                }
            }
        }
    }

    return { passed, failed, failures };
}

function testFirstProgressBoundary(): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    // Test continuity at p1=0.99 vs p1=1.0 - arms should not jump
    const configs: Array<{
        label: string;
        type: 'adding' | 'removing';
        startCount: number;
        firstSource: number;
        secondSource: number;
        direction: TransitionDirection;
        overlapStart: number;
    }> = [
        { label: 'ADD 3->5 CCW', type: 'adding', startCount: 3, firstSource: 1, secondSource: 3, direction: -1, overlapStart: 0.42 },
        { label: 'ADD 5->7 CW', type: 'adding', startCount: 5, firstSource: 2, secondSource: 5, direction: 1, overlapStart: 0.5 },
    ];

    for (const cfg of configs) {
        const { label, type, startCount, firstSource, secondSource, direction, overlapStart } = cfg;
        const intermediateCount = type === 'adding' ? startCount + 1 : startCount - 1;
        const rotation = 0.5;
        const secondProgress = 0.8;

        const bundleBefore: PlannedTransitionBundle = {
            first: { type, direction, progress: 0.99, sourceArmIndex: firstSource, startArmCount: startCount },
            second: { type, direction, progress: secondProgress, sourceArmIndex: secondSource, startArmCount: intermediateCount },
            overlapStart,
        };
        const specBefore = getRenderSpec({
            bundle: bundleBefore,
            armCount: startCount,
            rotation,
            centerX: CENTER_X, centerY: CENTER_Y, outerRadius: STAR_OUTER_RADIUS,
        });

        const bundleAfter: PlannedTransitionBundle = {
            first: { type, direction, progress: 1.0, sourceArmIndex: firstSource, startArmCount: startCount },
            second: { type, direction, progress: secondProgress, sourceArmIndex: secondSource, startArmCount: intermediateCount },
            overlapStart,
        };
        const specAfter = getRenderSpec({
            bundle: bundleAfter,
            armCount: startCount,
            rotation,
            centerX: CENTER_X, centerY: CENTER_Y, outerRadius: STAR_OUTER_RADIUS,
        });

        const collectAngles = (spec: typeof specBefore) => {
            const angles: number[] = [];
            for (const arm of spec.staticArms.values()) angles.push(arm.tipAngle);
            if (spec.firstTransitionArm) angles.push(spec.firstTransitionArm.tipAngle);
            if (spec.secondTransitionArm) angles.push(spec.secondTransitionArm.tipAngle);
            return angles.sort((a, b) => a - b);
        };

        const beforeAngles = collectAngles(specBefore);
        const afterAngles = collectAngles(specAfter);

        const tolerance = 0.05;  // ~3 degrees
        for (const beforeAngle of beforeAngles) {
            let minDiff = Infinity;
            for (const afterAngle of afterAngles) {
                const diff = Math.abs(normalizeAngle(beforeAngle - afterAngle));
                if (diff < minDiff) minDiff = diff;
            }
            if (minDiff > tolerance) {
                failed++;
                failures.push(
                    `${label} p1 boundary: arm at ${toDeg(beforeAngle).toFixed(1)}° has no match ` +
                    `(closest diff=${toDeg(minDiff).toFixed(1)}°)`
                );
            } else {
                passed++;
            }
        }
    }

    return { passed, failed, failures };
}

function testGapsWhenFirstComplete(): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    const configs: Array<{
        label: string;
        type: 'adding' | 'removing';
        startCount: number;
        firstSource: number;
        secondSource: number;
        direction: TransitionDirection;
        overlapStart: number;
    }> = [
        { label: 'ADD 3->5 CCW', type: 'adding', startCount: 3, firstSource: 1, secondSource: 3, direction: -1, overlapStart: 0.42 },
        { label: 'ADD 5->7 CW', type: 'adding', startCount: 5, firstSource: 2, secondSource: 5, direction: 1, overlapStart: 0.5 },
    ];

    // Test with non-zero rotation to catch bugs where rotation affects relative gaps
    const testRotations = [0, 0.5, 1.5];

    for (const cfg of configs) {
        const { label, type, startCount, firstSource, secondSource, direction, overlapStart } = cfg;
        const intermediateCount = type === 'adding' ? startCount + 1 : startCount - 1;
        const finalCount = type === 'adding' ? startCount + 2 : startCount - 2;
        const expectedGap = 360 / finalCount;

        for (const rotation of testRotations) {
            for (const p2 of [0.8, 0.9, 0.95, 0.99]) {
                const bundle: PlannedTransitionBundle = {
                    first: {
                        type,
                        direction,
                        progress: 1.0,
                        sourceArmIndex: firstSource,
                        startArmCount: startCount,
                    },
                    second: {
                        type,
                        direction,
                        progress: p2,
                        sourceArmIndex: secondSource,
                        startArmCount: intermediateCount,
                    },
                    overlapStart,
                    
                };

                const spec = getRenderSpec({
                    bundle,
                    armCount: startCount,  // armCount stays at original throughout transition
                    rotation,
                    centerX: CENTER_X,
                    centerY: CENTER_Y,
                    outerRadius: STAR_OUTER_RADIUS,
                });

                // Collect all arms (static + transition) with normalized angles
                const arms: ArmInfo[] = [];
                for (const [idx, arm] of spec.staticArms) {
                    arms.push({ label: `S${idx}`, angle: normalizeToPositive(arm.tipAngle), halfStep: arm.halfStep });
                }
                if (spec.firstTransitionArm) {
                    arms.push({ label: 'T1', angle: normalizeToPositive(spec.firstTransitionArm.tipAngle), halfStep: spec.firstTransitionArm.halfStep });
                }
                if (spec.secondTransitionArm) {
                    arms.push({ label: 'T2', angle: normalizeToPositive(spec.secondTransitionArm.tipAngle), halfStep: spec.secondTransitionArm.halfStep });
                }
                arms.sort((a, b) => a.angle - b.angle);

                // Check that gaps are reasonably uniform (within 15° of expected)
                const tolerance = 15 * Math.PI / 180;
                for (let i = 0; i < arms.length; i++) {
                    const curr = arms[i];
                    const next = arms[(i + 1) % arms.length];
                    let gap = next.angle - curr.angle;
                    if (gap < 0) gap += 2 * Math.PI;

                    const expectedGapRad = expectedGap * Math.PI / 180;
                    const diff = Math.abs(gap - expectedGapRad);

                    if (diff > tolerance) {
                        failed++;
                        failures.push(
                            `${label} rot=${rotation.toFixed(1)} p2=${p2} p1=1.0: gap ${curr.label}->${next.label} = ${toDeg(gap).toFixed(1)}° (expected ~${expectedGap.toFixed(1)}°, diff=${toDeg(diff).toFixed(1)}°)`
                        );
                    } else {
                        passed++;
                    }
                }
            }
        }
    }

    return { passed, failed, failures };
}

export function runSecondTransitionAdjacentTests(): { passed: number; failed: number; failures: string[] } {
    const results = [
        testGapsDuringOverlappingTransition(),
        testFirstProgressBoundary(),
        testGapsWhenFirstComplete(),
    ];

    return {
        passed: results.reduce((sum, r) => sum + r.passed, 0),
        failed: results.reduce((sum, r) => sum + r.failed, 0),
        failures: results.flatMap(r => r.failures),
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const result = runSecondTransitionAdjacentTests();
    console.log(`${result.passed} passed, ${result.failed} failed`);
    for (const f of result.failures) {
        console.log(`  ${f}`);
    }
}
