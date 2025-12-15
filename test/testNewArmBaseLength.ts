import {
    createSingleTransitionGeometry,
    computeTransitionWithGeometry,
    TransitionDirection,
    STAR_OUTER_RADIUS,
    getInnerRadius,
    getInnerRadiusForArmCount,
    dist,
} from '../src/starAnimationCore.js';

const CENTER_X = 200;
const CENTER_Y = 200;

// For a static arm with n arms:
// - halfStep = π/n radians
// - Base chord length = 2 * innerRadius * sin(halfStep)
// - Arc length between bases = innerRadius * 2 * halfStep
function getStaticArmArcLength(armCount: number, outerRadius: number = STAR_OUTER_RADIUS): number {
    const innerRadius = getInnerRadius(armCount, outerRadius);
    const halfStep = Math.PI / armCount;
    return innerRadius * 2 * halfStep;
}

function getStaticArmChordLength(armCount: number, outerRadius: number = STAR_OUTER_RADIUS): number {
    const innerRadius = getInnerRadius(armCount, outerRadius);
    const halfStep = Math.PI / armCount;
    return 2 * innerRadius * Math.sin(halfStep);
}

function testNewArmBaseLengthWithScale(radiusScale: number): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    const scaledOuterRadius = STAR_OUTER_RADIUS * radiusScale;

    for (const startArmCount of [4, 5, 6, 7]) {
        const targetArmCount = startArmCount + 1;

        for (const direction of [1, -1] as TransitionDirection[]) {
            for (let sourceArmIndex = 0; sourceArmIndex < startArmCount; sourceArmIndex++) {
                const prefix = `scale=${radiusScale} ADDING-${direction === 1 ? 'CW' : 'CCW'} ${startArmCount}→${targetArmCount}arms src=${sourceArmIndex}`;

                const geom = createSingleTransitionGeometry({
                    type: 'adding',
                    sourceArmIndex,
                    armCount: startArmCount,
                    centerX: CENTER_X,
                    centerY: CENTER_Y,
                    outerRadius: scaledOuterRadius,
                    rotation: 0,
                    direction,
                });

                const result = computeTransitionWithGeometry(
                    geom,
                    { centerX: CENTER_X, centerY: CENTER_Y, outerRadius: scaledOuterRadius, rotation: 0, direction },
                    'adding',
                    1.0
                );

                const newArmBaseLength = dist(result.b1.x, result.b1.y, result.b2.x, result.b2.y);
                const staticChordLength = getStaticArmChordLength(targetArmCount, scaledOuterRadius);

                const chordDiff = Math.abs(newArmBaseLength - staticChordLength);
                const chordRelDiff = chordDiff / staticChordLength;
                const chordOk = chordRelDiff < 0.05;

                if (chordOk) {
                    passed++;
                } else {
                    failed++;
                    failures.push(
                        `${prefix}: baseLen=${newArmBaseLength.toFixed(3)}, ` +
                        `staticChord=${staticChordLength.toFixed(3)} (diff=${chordRelDiff.toFixed(3)})`
                    );
                }
            }
        }
    }

    return { passed, failed, failures };
}

export function runNewArmBaseLengthTests(): { passed: number; failed: number; failures: string[] } {
    let totalPassed = 0;
    let totalFailed = 0;
    const allFailures: string[] = [];

    for (const radiusScale of [0.5, 1.0, 2.0, 4.0]) {
        const { passed, failed, failures } = testNewArmBaseLengthWithScale(radiusScale);
        totalPassed += passed;
        totalFailed += failed;
        allFailures.push(...failures);
    }

    return { passed: totalPassed, failed: totalFailed, failures: allFailures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { passed, failed, failures } = runNewArmBaseLengthTests();
    console.log(`New Arm Base Length: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
    }
}
