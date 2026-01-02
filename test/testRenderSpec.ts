import {
    getRenderSpec,
    STAR_OUTER_RADIUS,
    type PlannedTransitionBundle,
    type RenderSpecParams,
    type TransitionDirection,
} from '../src/star/starAnimationCore.js';

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

function createSingleTransition(
    type: 'adding' | 'removing',
    startArmCount: number,
    sourceArmIndex: number,
    progress: number,
    direction: TransitionDirection = 1
): PlannedTransitionBundle {
    return {
        first: { type, direction, progress, sourceArmIndex, startArmCount },
        second: null,
        overlapStart: null,
        
    };
}

function createOverlappingTransition(
    type: 'adding' | 'removing',
    startArmCount: number,
    firstSourceIndex: number,
    secondSourceIndex: number,
    firstProgress: number,
    secondProgress: number,
    overlapStart: number,
    direction: TransitionDirection = 1
): PlannedTransitionBundle {
    const intermediateCount = type === 'adding' ? startArmCount + 1 : startArmCount - 1;
    return {
        first: { type, direction, progress: firstProgress, sourceArmIndex: firstSourceIndex, startArmCount },
        second: { type, direction, progress: secondProgress, sourceArmIndex: secondSourceIndex, startArmCount: intermediateCount },
        overlapStart,
    };
}

interface TestResult {
    name: string;
    passed: boolean;
    details: string;
}

const results: TestResult[] = [];

function test(name: string, passed: boolean, details: string = '') {
    results.push({ name, passed, details });
}

function runRenderSpecTests() {
    results.length = 0;

    // Test 1: No bundle - all arms visible
    {
        const spec = getRenderSpec(createParams(null, 5));
        test('No bundle: all 5 arms visible', spec.staticArms.size === 5,
            `expected 5, got ${spec.staticArms.size}`);
        test('No bundle: no transition arms',
            spec.firstTransitionArm === null && spec.secondTransitionArm === null,
            `first=${spec.firstTransitionArm !== null}, second=${spec.secondTransitionArm !== null}`);
    }

    // Test 2: Single adding transition - all arms visible (adding doesn't hide source)
    {
        const bundle = createSingleTransition('adding', 5, 2, 0.5);
        const spec = getRenderSpec(createParams(bundle, 5));
        test('Single adding: all 5 arms visible', spec.staticArms.size === 5,
            `expected 5, got ${spec.staticArms.size}`);
        test('Single adding: has first transition arm', spec.firstTransitionArm !== null,
            'firstTransitionArm is null');
    }

    // Test 3: Single removing transition - source arm hidden
    {
        const bundle = createSingleTransition('removing', 5, 2, 0.5);
        const spec = getRenderSpec(createParams(bundle, 5));
        test('Single removing: 4 arms visible', spec.staticArms.size === 4,
            `expected 4, got ${spec.staticArms.size}`);
        test('Single removing: arm 2 hidden', !spec.staticArms.has(2),
            'arm 2 should be hidden');
        test('Single removing: has first transition arm', spec.firstTransitionArm !== null,
            'firstTransitionArm is null');
    }

    // Test 4: Single removing at progress=1 - no transition arm
    {
        const bundle = createSingleTransition('removing', 5, 2, 1.0);
        const spec = getRenderSpec(createParams(bundle, 5));
        test('Removing complete: no first transition arm', spec.firstTransitionArm === null,
            'firstTransitionArm should be null at progress=1');
    }

    // Test 5: Double removing, first completed
    // Scenario: 7→6→5, first removes arm 3, second removes arm 0 (in 6-arm space)
    // With new model: armCount stays at 7, T1 stays visible at final position
    {
        const bundle = createOverlappingTransition(
            'removing', 7, 3, 0,  // start=7, first removes 3, second removes 0
            1.0, 0.5,             // first complete, second in progress
            0.37
        );
        const spec = getRenderSpec(createParams(bundle, 7));  // armCount stays at 7

        test('First complete: 5 static arms visible',
            spec.staticArms.size === 5,
            `expected 5, got ${spec.staticArms.size} (hidden: ${[...Array(7).keys()].filter(i => !spec.staticArms.has(i)).join(',')})`);

        test('First complete: arm 0 hidden (second source mapped)',
            !spec.staticArms.has(0),
            'arm 0 should be hidden');

        test('First complete: arm 3 hidden (first source)',
            !spec.staticArms.has(3),
            'arm 3 should be hidden');

        test('First complete: first transition arm present (at final state)',
            spec.firstTransitionArm !== null,
            'first transition arm should exist at final position');

        test('First complete: second transition arm present',
            spec.secondTransitionArm !== null,
            'second transition arm should exist');
    }

    // Test 6: Double removing, both in progress
    // In original 7-arm space: first removes 3, second removes 0 (maps to original 0)
    {
        const bundle = createOverlappingTransition(
            'removing', 7, 3, 0,  // start=7, first removes 3, second removes 0 in intermediate
            0.8, 0.3,             // both in progress
            0.37
        );
        const spec = getRenderSpec(createParams(bundle, 7));  // armCount stays at 7

        // Second source 0 in 6-arm space maps to 0 in 7-arm space (0 < 3)
        test('Double removing in progress: 5 arms visible',
            spec.staticArms.size === 5,
            `expected 5, got ${spec.staticArms.size}`);

        test('Double removing: arm 3 hidden (first source)',
            !spec.staticArms.has(3),
            'arm 3 should be hidden');

        test('Double removing: arm 0 hidden (second source mapped)',
            !spec.staticArms.has(0),
            'arm 0 should be hidden');

        test('Double removing: both transition arms present',
            spec.firstTransitionArm !== null && spec.secondTransitionArm !== null,
            `first=${spec.firstTransitionArm !== null}, second=${spec.secondTransitionArm !== null}`);
    }

    // Test 7: Double adding - no arms hidden
    {
        const bundle = createOverlappingTransition(
            'adding', 5, 0, 3,
            0.8, 0.3,
            0.5
        );
        const spec = getRenderSpec(createParams(bundle, 5));

        test('Double adding: all 5 arms visible',
            spec.staticArms.size === 5,
            `expected 5, got ${spec.staticArms.size}`);
    }

    // Test 8: Continuity check - arms shouldn't jump when first.progress goes from 0.99 to 1.0
    // star.testOverlappingTransition('removing', 7, 3, 0, 0.37, 1)
    {
        // Before first completes (p1=0.99)
        const bundleBefore = createOverlappingTransition(
            'removing', 7, 3, 0,
            0.99, 0.62 * 0.99,  // second progress proportional
            0.37
        );
        const specBefore = getRenderSpec(createParams(bundleBefore, 7));

        test('Continuity before: 5 visible',
            specBefore.staticArms.size === 5,
            `expected 5, got ${specBefore.staticArms.size}`);

        // After first completes (p1=1.0, armCount stays at 7)
        const bundleAfter = createOverlappingTransition(
            'removing', 7, 3, 0,
            1.0, 0.7,
            0.37
        );
        const specAfter = getRenderSpec(createParams(bundleAfter, 7));

        test('Issue case after complete: 5 visible',
            specAfter.staticArms.size === 5,
            `expected 5, got ${specAfter.staticArms.size}`);
    }

    // Test 9: Inner radius changes during transition
    {
        const bundle = createSingleTransition('adding', 5, 0, 0.5);
        const spec = getRenderSpec(createParams(bundle, 5));

        test('Inner radius computed',
            spec.innerRadius > 0,
            `innerRadius=${spec.innerRadius}`);
    }


    // Test 11: Static arm positions are continuous across p1=0.99 to p1=1.0
    // With the new model, armCount stays constant so static arms should not jump.
    {
        const TOLERANCE = 0.01; // radians, about 0.5 degrees

        // ADD+ADD 5→7: test continuity at p1=1.0 boundary
        {
            const overlapStart = 0.5;
            const p2Before = (0.999 - overlapStart) / (1 - overlapStart);
            const bundleBefore: PlannedTransitionBundle = {
                first: { type: 'adding', direction: 1, progress: 0.999, sourceArmIndex: 0, startArmCount: 5 },
                second: { type: 'adding', direction: 1, progress: p2Before, sourceArmIndex: 3, startArmCount: 6 },
                overlapStart,
            };
            const specBefore = getRenderSpec(createParams(bundleBefore, 5));

            const p2After = (1.0 - overlapStart) / (1 - overlapStart);
            const bundleAfter: PlannedTransitionBundle = {
                first: { type: 'adding', direction: 1, progress: 1.0, sourceArmIndex: 0, startArmCount: 5 },
                second: { type: 'adding', direction: 1, progress: p2After, sourceArmIndex: 3, startArmCount: 6 },
                overlapStart,
            };
            const specAfter = getRenderSpec(createParams(bundleAfter, 5));  // armCount stays at 5

            // With constant armCount, same indices should have continuous positions
            for (let i = 0; i < 5; i++) {
                const armBefore = specBefore.staticArms.get(i);
                const armAfter = specAfter.staticArms.get(i);

                if (armBefore && armAfter) {
                    const angleDiff = Math.abs(armBefore.tipAngle - armAfter.tipAngle);
                    const normalizedDiff = angleDiff > Math.PI ? 2 * Math.PI - angleDiff : angleDiff;
                    test(`ADD+ADD continuity: arm ${i} tipAngle`,
                        normalizedDiff < TOLERANCE,
                        `jump of ${(normalizedDiff * 180 / Math.PI).toFixed(2)}° at p1=1.0`);
                }
            }
        }

        // REM+REM 7→5: test continuity at p1=1.0 boundary
        {
            const overlapStart = 0.5;
            const p2Before = (0.999 - overlapStart) / (1 - overlapStart);
            const bundleBefore: PlannedTransitionBundle = {
                first: { type: 'removing', direction: 1, progress: 0.999, sourceArmIndex: 3, startArmCount: 7 },
                second: { type: 'removing', direction: 1, progress: p2Before, sourceArmIndex: 0, startArmCount: 6 },
                overlapStart,
            };
            const specBefore = getRenderSpec(createParams(bundleBefore, 7));

            const p2After = (1.0 - overlapStart) / (1 - overlapStart);
            const bundleAfter: PlannedTransitionBundle = {
                first: { type: 'removing', direction: 1, progress: 1.0, sourceArmIndex: 3, startArmCount: 7 },
                second: { type: 'removing', direction: 1, progress: p2After, sourceArmIndex: 0, startArmCount: 6 },
                overlapStart,
            };
            const specAfter = getRenderSpec(createParams(bundleAfter, 7));  // armCount stays at 7

            // Same indices should have continuous positions
            for (let i = 0; i < 7; i++) {
                const armBefore = specBefore.staticArms.get(i);
                const armAfter = specAfter.staticArms.get(i);

                if (armBefore && armAfter) {
                    const angleDiff = Math.abs(armBefore.tipAngle - armAfter.tipAngle);
                    const normalizedDiff = angleDiff > Math.PI ? 2 * Math.PI - angleDiff : angleDiff;
                    test(`REM+REM continuity: arm ${i} tipAngle`,
                        normalizedDiff < TOLERANCE,
                        `jump of ${(normalizedDiff * 180 / Math.PI).toFixed(2)}° at p1=1.0`);
                }
            }
        }
    }
}

export function runRenderSpecTestSuite(): { passed: number; failed: number; failures: string[] } {
    runRenderSpecTests();
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const failures = results.filter(r => !r.passed).map(r => r.details ? `${r.name}: ${r.details}` : r.name);
    return { passed, failed, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { passed, failed, failures } = runRenderSpecTestSuite();
    console.log(`Render Spec: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        console.log('\nFailures:');
        for (const f of failures) {
            console.log(`  ${f}`);
        }
    }
}
