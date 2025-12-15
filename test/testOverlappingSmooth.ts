import {
    getRenderSpec,
    STAR_OUTER_RADIUS,
    type PlannedTransitionBundle,
    type RenderSpecParams,
    type TransitionDirection,
    type TransitionArmRenderSpec,
} from '../src/starAnimationCore.js';

interface TransitionConfig {
    firstType: 'adding' | 'removing';
    secondType: 'adding' | 'removing';
    startArmCount: number;
    firstSourceIndex: number;
    secondSourceIndex: number;
    overlapStart: number;
    direction: TransitionDirection;
}

const CENTER_X = 100;
const CENTER_Y = 100;

function createParams(bundle: PlannedTransitionBundle | null, armCount: number): RenderSpecParams {
    return {
        bundle,
        armCount,
        rotation: 0,
        centerX: CENTER_X,
        centerY: CENTER_Y,
        outerRadius: STAR_OUTER_RADIUS,
        expansionMagnitude: 0.15,
    };
}

function createBundleAtProgress(
    config: TransitionConfig,
    overallProgress: number  // 0 to 1 covers entire overlapping transition
): { bundle: PlannedTransitionBundle; armCount: number } {
    // Map overall progress to first and second progress
    // First runs from 0 to overlapStart + (1-overlapStart)*x where it completes
    // Second starts at overlapStart and runs until overall=1
    //
    // Timeline:
    //   overall=0: first=0, second=N/A
    //   overall=overlapStart: first=overlapStart, second=0
    //   overall=(1+overlapStart)/2: first=1, second=0.5 (first completes mid-way through second)
    //   overall=1: first=1, second=1
    //
    // Let's use: firstProgress = overall / ((1+overlapStart)/2) clamped to [0,1]
    //            secondProgress = (overall - overlapStart) / (1 - overlapStart) clamped to [0,1]

    const firstCompletionPoint = (1 + config.overlapStart) / 2;
    const firstProgress = Math.min(1, overallProgress / firstCompletionPoint);
    const secondProgress = overallProgress < config.overlapStart
        ? 0
        : Math.min(1, (overallProgress - config.overlapStart) / (1 - config.overlapStart));

    const firstCompleted = firstProgress >= 1;
    const secondCompleted = secondProgress >= 1;
    const intermediateCount = config.firstType === 'adding'
        ? config.startArmCount + 1
        : config.startArmCount - 1;
    const finalCount = config.secondType === 'adding'
        ? intermediateCount + 1
        : intermediateCount - 1;

    let armCount: number;
    if (secondCompleted) {
        armCount = finalCount;
    } else if (firstCompleted) {
        armCount = intermediateCount;
    } else {
        armCount = config.startArmCount;
    }

    const bundle: PlannedTransitionBundle = {
        first: {
            type: config.firstType,
            direction: config.direction,
            progress: firstProgress,
            sourceArmIndex: config.firstSourceIndex,
            startArmCount: config.startArmCount,
        },
        second: {
            type: config.secondType,
            direction: config.direction,
            progress: secondProgress,
            sourceArmIndex: config.secondSourceIndex,
            startArmCount: intermediateCount,
        },
        overlapStart: config.overlapStart,
        firstCompleted,
    };

    return { bundle, armCount };
}

interface ArmSnapshot {
    tipX: number;
    tipY: number;
    b1X: number;
    b1Y: number;
    b2X: number;
    b2Y: number;
}

function armToSnapshot(arm: TransitionArmRenderSpec): ArmSnapshot {
    return {
        tipX: arm.tip.x,
        tipY: arm.tip.y,
        b1X: arm.b1.x,
        b1Y: arm.b1.y,
        b2X: arm.b2.x,
        b2Y: arm.b2.y,
    };
}

interface SmoothnessResult {
    maxDelta: number;
    maxDeltaProgress: number;
    avgDelta: number;
    passed: boolean;
    discontinuities: Array<{ progress: number; delta: number; field: string }>;
}

function pointDist(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function testArmSmoothness(
    config: TransitionConfig,
    armIndex: 1 | 2,
    numSteps: number = 200
): SmoothnessResult {
    const dt = 1 / numSteps;
    let prev: ArmSnapshot | null = null;

    let maxDelta = 0;
    let maxDeltaProgress = -1;
    let totalDelta = 0;
    let deltaCount = 0;
    const positionDeltas: { progress: number; delta: number; field: string }[] = [];
    const discontinuities: SmoothnessResult['discontinuities'] = [];

    for (let i = 0; i <= numSteps; i++) {
        const progress = i / numSteps;
        const { bundle, armCount } = createBundleAtProgress(config, progress);
        const spec = getRenderSpec(createParams(bundle, armCount));

        const transitionArm = armIndex === 1 ? spec.firstTransitionArm : spec.secondTransitionArm;
        if (!transitionArm) continue;

        const snap = armToSnapshot(transitionArm);

        if (prev) {
            const tipDelta = pointDist(snap.tipX, snap.tipY, prev.tipX, prev.tipY);
            const b1Delta = pointDist(snap.b1X, snap.b1Y, prev.b1X, prev.b1Y);
            const b2Delta = pointDist(snap.b2X, snap.b2Y, prev.b2X, prev.b2Y);

            positionDeltas.push({ progress, delta: tipDelta, field: 'tip' });
            positionDeltas.push({ progress, delta: b1Delta, field: 'b1' });
            positionDeltas.push({ progress, delta: b2Delta, field: 'b2' });

            const maxFieldDelta = Math.max(tipDelta, b1Delta, b2Delta);
            totalDelta += maxFieldDelta / dt;
            deltaCount++;

            if (maxFieldDelta / dt > maxDelta) {
                maxDelta = maxFieldDelta / dt;
                maxDeltaProgress = progress;
            }
        }

        prev = snap;
    }

    const sortedDeltas = positionDeltas.map(d => d.delta).sort((a, b) => a - b);
    const medianDelta = sortedDeltas[Math.floor(sortedDeltas.length / 2)] || 0;

    const threshold = Math.max(medianDelta * 10, 10);

    for (const d of positionDeltas) {
        if (d.delta > threshold) {
            discontinuities.push(d);
        }
    }

    return {
        maxDelta,
        maxDeltaProgress,
        avgDelta: deltaCount > 0 ? totalDelta / deltaCount : 0,
        passed: discontinuities.length === 0,
        discontinuities,
    };
}

interface ArmCountResult {
    passed: boolean;
    issues: Array<{ progress: number; message: string }>;
}

function testArmCountConsistency(config: TransitionConfig, numSteps: number = 200): ArmCountResult {
    const issues: ArmCountResult['issues'] = [];

    // Compute expected final arm count
    let finalCount = config.startArmCount;
    if (config.firstType === 'adding') finalCount++;
    else finalCount--;
    if (config.secondType === 'adding') finalCount++;
    else finalCount--;

    let prevCount: number | null = null;

    for (let i = 0; i <= numSteps; i++) {
        const progress = i / numSteps;
        const { bundle, armCount } = createBundleAtProgress(config, progress);
        const spec = getRenderSpec(createParams(bundle, armCount));

        let totalVisible = spec.staticArms.size;
        if (spec.firstTransitionArm) totalVisible++;
        if (spec.secondTransitionArm) totalVisible++;

        // Check for unexpected jumps (more than 1 arm change per step)
        if (prevCount !== null && Math.abs(totalVisible - prevCount) > 1) {
            issues.push({
                progress,
                message: `jump from ${prevCount} to ${totalVisible}`
            });
        }

        // Check monotonicity: adding should only increase, removing should only decrease
        if (prevCount !== null) {
            const bothAdding = config.firstType === 'adding' && config.secondType === 'adding';
            const bothRemoving = config.firstType === 'removing' && config.secondType === 'removing';

            if (bothAdding && totalVisible < prevCount) {
                issues.push({
                    progress,
                    message: `non-monotonic (adding): decreased from ${prevCount} to ${totalVisible}`
                });
            }
            if (bothRemoving && totalVisible > prevCount) {
                issues.push({
                    progress,
                    message: `non-monotonic (removing): increased from ${prevCount} to ${totalVisible}`
                });
            }
        }

        // Check arm count is within valid range
        const minExpected = Math.min(config.startArmCount, finalCount);
        const maxExpected = Math.max(config.startArmCount, finalCount)
            + (config.firstType === 'adding' ? 1 : 0)
            + (config.secondType === 'adding' ? 1 : 0);

        if (totalVisible < minExpected || totalVisible > maxExpected) {
            issues.push({
                progress,
                message: `count ${totalVisible} outside range [${minExpected}, ${maxExpected}]`
            });
        }

        prevCount = totalVisible;
    }

    // Verify final state matches expected (after both transitions complete, bundle is cleared)
    const finalSpec = getRenderSpec(createParams(null, finalCount));
    const finalVisible = finalSpec.staticArms.size;

    if (finalVisible !== finalCount) {
        issues.push({
            progress: 1.0,
            message: `final count ${finalVisible} != expected ${finalCount}`
        });
    }

    return { passed: issues.length === 0, issues };
}

interface TestResult {
    smoothnessPassed: boolean;
    armCountPassed: boolean;
    arm1Discontinuities: number;
    arm2Discontinuities: number;
    armCountIssues: string[];
}

function collectTestResult(config: TransitionConfig): TestResult {
    const arm1 = testArmSmoothness(config, 1);
    const arm2 = testArmSmoothness(config, 2);
    const armCount = testArmCountConsistency(config);

    return {
        smoothnessPassed: arm1.passed && arm2.passed,
        armCountPassed: armCount.passed,
        arm1Discontinuities: arm1.discontinuities.length,
        arm2Discontinuities: arm2.discontinuities.length,
        armCountIssues: armCount.issues.map(i => `p=${i.progress.toFixed(3)}: ${i.message}`),
    };
}

export function runOverlappingSmoothTests(): { passed: number; failed: number; failures: string[] } {
    let totalPassed = 0;
    let totalFailed = 0;
    const failures: string[] = [];

    function checkResult(name: string, result: TestResult) {
        const passed = result.smoothnessPassed && result.armCountPassed;
        if (passed) {
            totalPassed++;
        } else {
            totalFailed++;
            const issues: string[] = [];
            if (!result.smoothnessPassed) {
                issues.push(`smoothness(arm1=${result.arm1Discontinuities},arm2=${result.arm2Discontinuities})`);
            }
            if (!result.armCountPassed) {
                issues.push(`armCount: ${result.armCountIssues.slice(0, 2).join('; ')}`);
            }
            failures.push(`${name}: ${issues.join(', ')}`);
        }
    }

    const overlapValues = [0.1, 0.25, 0.5, 0.75, 0.9];

    for (const overlap of overlapValues) {
        checkResult(`ADD+ADD overlap=${overlap} CW`, collectTestResult({
            firstType: 'adding',
            secondType: 'adding',
            startArmCount: 5,
            firstSourceIndex: 0,
            secondSourceIndex: 3,
            overlapStart: overlap,
            direction: 1,
        }));
    }

    for (const overlap of [0.25, 0.5, 0.75]) {
        checkResult(`ADD+ADD overlap=${overlap} CCW`, collectTestResult({
            firstType: 'adding',
            secondType: 'adding',
            startArmCount: 5,
            firstSourceIndex: 0,
            secondSourceIndex: 3,
            overlapStart: overlap,
            direction: -1,
        }));
    }

    for (const overlap of overlapValues) {
        checkResult(`REM+REM overlap=${overlap} CW`, collectTestResult({
            firstType: 'removing',
            secondType: 'removing',
            startArmCount: 7,
            firstSourceIndex: 0,
            secondSourceIndex: 3,
            overlapStart: overlap,
            direction: 1,
        }));
    }

    checkResult(`ADD+ADD 4→5→6 overlap=0.5`, collectTestResult({
        firstType: 'adding',
        secondType: 'adding',
        startArmCount: 4,
        firstSourceIndex: 0,
        secondSourceIndex: 2,
        overlapStart: 0.5,
        direction: 1,
    }));

    checkResult(`REM+REM 6→5→4 overlap=0.5`, collectTestResult({
        firstType: 'removing',
        secondType: 'removing',
        startArmCount: 6,
        firstSourceIndex: 0,
        secondSourceIndex: 2,
        overlapStart: 0.5,
        direction: 1,
    }));

    for (const src2 of [1, 2, 4, 5]) {
        checkResult(`ADD+ADD src1=0 src2=${src2}`, collectTestResult({
            firstType: 'adding',
            secondType: 'adding',
            startArmCount: 5,
            firstSourceIndex: 0,
            secondSourceIndex: src2,
            overlapStart: 0.5,
            direction: 1,
        }));
    }

    return { passed: totalPassed, failed: totalFailed, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { passed, failed, failures } = runOverlappingSmoothTests();
    console.log(`Overlapping Smooth: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
    }
}
