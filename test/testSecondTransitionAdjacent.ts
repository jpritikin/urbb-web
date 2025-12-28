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
        p2Values: number[];
    }> = [
        { label: 'ADD 5->7', type: 'adding', startCount: 5, firstSource: 2, secondSource: 5, p2Values: [0.25, 0.5, 0.59, 0.75, 0.95] },
        { label: 'ADD 5->7 alt', type: 'adding', startCount: 5, firstSource: 0, secondSource: 3, p2Values: [0.5, 0.75, 0.95] },
        { label: 'REM 7->5', type: 'removing', startCount: 7, firstSource: 1, secondSource: 2, p2Values: [0.05, 0.25, 0.5] },
    ];

    for (const cfg of configs) {
        const { label, type, startCount, firstSource, secondSource, p2Values } = cfg;
        const direction: TransitionDirection = 1;
        const overlapStart = 0.5;
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
                firstCompleted: false,
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

export function runSecondTransitionAdjacentTests(): { passed: number; failed: number; failures: string[] } {
    return testGapsDuringOverlappingTransition();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const result = testGapsDuringOverlappingTransition();
    console.log(`${result.passed} passed, ${result.failed} failed`);
    for (const f of result.failures) {
        console.log(`  ${f}`);
    }
}
