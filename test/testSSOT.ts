import {
    getRenderSpec,
    computeStaticArmSpec,
    STAR_OUTER_RADIUS,
    dist,
    type PlannedTransitionBundle,
    type TransitionDirection,
} from '../src/starAnimationCore.js';

const CENTER_X = 100;
const CENTER_Y = 100;
const TOLERANCE = 0.01;

interface TestResult {
    passed: number;
    failed: number;
    failures: string[];
}

// Test that computeStaticArmSpec produces continuous results at the firstCompleted boundary
// At p1=1 (first just completing), the two code paths should produce identical positions
function testFirstCompletedBoundaryContinuity(): TestResult {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    // Only test valid transition combinations: ADD+ADD or REM+REM
    // Also ensure we don't go below 3 arms
    const testCases = [
        { firstType: 'adding' as const, secondType: 'adding' as const, startCount: 5, src1: 0, src2: 3, dir: 1 as TransitionDirection },
        { firstType: 'adding' as const, secondType: 'adding' as const, startCount: 4, src1: 2, src2: 1, dir: -1 as TransitionDirection },
        { firstType: 'removing' as const, secondType: 'removing' as const, startCount: 7, src1: 0, src2: 3, dir: 1 as TransitionDirection },
        { firstType: 'removing' as const, secondType: 'removing' as const, startCount: 6, src1: 2, src2: 1, dir: -1 as TransitionDirection },
    ];

    for (const tc of testCases) {
        const intermediateCount = tc.firstType === 'adding' ? tc.startCount + 1 : tc.startCount - 1;
        const p2 = 0.5; // Some progress on second transition

        // Create bundle just BEFORE firstCompleted (p1 = 0.999)
        const bundleBefore: PlannedTransitionBundle = {
            first: {
                type: tc.firstType,
                direction: tc.dir,
                progress: 0.999,
                sourceArmIndex: tc.src1,
                startArmCount: tc.startCount,
            },
            second: {
                type: tc.secondType,
                direction: tc.dir,
                progress: p2,
                sourceArmIndex: tc.src2,
                startArmCount: intermediateCount,
            },
            overlapStart: 0.5,
            firstCompleted: false,
        };

        // Create bundle just AFTER firstCompleted (p1 = 1.0)
        const bundleAfter: PlannedTransitionBundle = {
            first: {
                type: tc.firstType,
                direction: tc.dir,
                progress: 1.0,
                sourceArmIndex: tc.src1,
                startArmCount: tc.startCount,
            },
            second: {
                type: tc.secondType,
                direction: tc.dir,
                progress: p2,
                sourceArmIndex: tc.src2,
                startArmCount: intermediateCount,
            },
            overlapStart: 0.5,
            firstCompleted: true,
        };

        // Test each static arm - map between original and intermediate indices
        // Before: original indices (0..startCount-1)
        // After: intermediate indices (0..intermediateCount-1)
        // Need to compare corresponding arms across the firstCompleted boundary

        const insertIdx = tc.dir === 1 ? tc.src1 + 1 : tc.src1;

        for (let origIdx = 0; origIdx < tc.startCount; origIdx++) {
            // Skip hidden arms (first source for removing)
            if (tc.firstType === 'removing' && origIdx === tc.src1) continue;

            // Map original index to intermediate index
            let interIdx: number;
            if (tc.firstType === 'adding') {
                interIdx = origIdx >= insertIdx ? origIdx + 1 : origIdx;
            } else {
                interIdx = origIdx > tc.src1 ? origIdx - 1 : origIdx;
            }

            // Skip if this arm is the second source (hidden for removing)
            if (tc.secondType === 'removing' && interIdx === tc.src2) continue;

            const specBefore = computeStaticArmSpec(origIdx, bundleBefore, tc.startCount, 0);
            const specAfter = computeStaticArmSpec(interIdx, bundleAfter, intermediateCount, 0);

            if (!specBefore || !specAfter) continue;

            const angleDiff = Math.abs(specBefore.tipAngle - specAfter.tipAngle);
            const halfStepDiff = Math.abs(specBefore.halfStep - specAfter.halfStep);

            if (angleDiff < TOLERANCE && halfStepDiff < TOLERANCE) {
                passed++;
            } else {
                failed++;
                failures.push(
                    `${tc.firstType}+${tc.secondType} arm${origIdx}->${interIdx}: ` +
                    `angleDiff=${angleDiff.toFixed(4)} halfStepDiff=${halfStepDiff.toFixed(4)}`
                );
            }
        }
    }

    return { passed, failed, failures };
}

function testSecondArmSmoothness(): void {
    const config = {
        firstType: 'adding' as const,
        secondType: 'adding' as const,
        startArmCount: 5,
        firstSourceIndex: 0,
        secondSourceIndex: 3,
        overlapStart: 0.5,
        direction: 1 as TransitionDirection,
    };

    const intermediateCount = config.startArmCount + 1;

    console.log('Testing second arm smoothness');
    console.log('overall\tp1\tp2\tfc\ttipX\ttipY\tdelta');

    let prev: { tipX: number; tipY: number } | null = null;
    const numSteps = 100;

    for (let i = 0; i <= numSteps; i++) {
        const overallProgress = i / numSteps;

        const firstCompletionPoint = (1 + config.overlapStart) / 2;
        const p1 = Math.min(1, overallProgress / firstCompletionPoint);
        const p2 = overallProgress < config.overlapStart
            ? 0
            : Math.min(1, (overallProgress - config.overlapStart) / (1 - config.overlapStart));

        if (p2 <= 0 || p2 >= 1) continue;

        const firstCompleted = p1 >= 1;

        const bundle: PlannedTransitionBundle = {
            first: {
                type: config.firstType,
                direction: config.direction,
                progress: p1,
                sourceArmIndex: config.firstSourceIndex,
                startArmCount: config.startArmCount,
            },
            second: {
                type: config.secondType,
                direction: config.direction,
                progress: p2,
                sourceArmIndex: config.secondSourceIndex,
                startArmCount: intermediateCount,
            },
            overlapStart: config.overlapStart,
            firstCompleted,
        };

        const armCount = firstCompleted ? intermediateCount : config.startArmCount;
        const spec = getRenderSpec({
            bundle,
            armCount,
            rotation: 0,
            centerX: CENTER_X,
            centerY: CENTER_Y,
            outerRadius: STAR_OUTER_RADIUS,
            expansionMagnitude: 0,
        });

        if (!spec.secondTransitionArm) continue;

        const arm = spec.secondTransitionArm;
        let delta = 0;
        if (prev) {
            delta = dist(arm.tip.x, arm.tip.y, prev.tipX, prev.tipY);
        }

        const fc = firstCompleted ? 'Y' : 'N';
        if (delta > 3) {
            console.log(`${overallProgress.toFixed(3)}\t${p1.toFixed(3)}\t${p2.toFixed(3)}\t${fc}\t${arm.tip.x.toFixed(2)}\t${arm.tip.y.toFixed(2)}\t*** ${delta.toFixed(2)}`);
        }

        prev = { tipX: arm.tip.x, tipY: arm.tip.y };
    }
}

export function runSSOTTests(): TestResult {
    return testFirstCompletedBoundaryContinuity();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { passed, failed, failures } = runSSOTTests();
    console.log(`SSOT Boundary Continuity: ${passed} passed, ${failed} failed`);
    for (const f of failures.slice(0, 20)) {
        console.log(`  ${f}`);
    }
    console.log('');
    testSecondArmSmoothness();
}
