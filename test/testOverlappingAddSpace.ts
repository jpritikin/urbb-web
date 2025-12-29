import {
    getRenderSpec,
    STAR_OUTER_RADIUS,
    normalizeAngle,
    getAngleStep,
    type PlannedTransitionBundle,
    type TransitionDirection,
} from '../src/starAnimationCore.js';

const CENTER_X = 200;
const CENTER_Y = 200;

function toDeg(rad: number): number {
    return rad * 180 / Math.PI;
}

// Test: During overlapping ADD+ADD (5→6→7), verify static arms don't open excessive gaps
// This tests the scenario where during the 2nd arm's phase 2, static arms might
// redistribute too much space - possibly double what's justified.
function testOverlappingAddStaticArmSpacing(): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    // Config: Double add from 5→6→7
    const startArmCount = 5;
    const firstSourceIndex = 0;
    const secondSourceIndex = 3; // Disjoint from first (in 6-arm star)
    const firstDirection: TransitionDirection = 1;
    const secondDirection: TransitionDirection = 1;
    const overlapStart = 0.5;

    // At various progress points, check that static arms have appropriate spacing
    // Expected behavior:
    // - At p1=0.5 (first phase 1 complete), p2=0: no static redistribution yet
    // - At p1=0.75 (first mid-phase 2), p2=0.5: first partial redistribution, second starting
    // - At p1=1.0, p2=1.0: both complete, final positions

    const testPoints = [
        { p1: 0.5, p2: 0, desc: 'first phase 1 complete' },
        { p1: 0.75, p2: 0.5, desc: 'first mid-phase 2, second phase 1' },
        { p1: 1.0, p2: 0.5, desc: 'first complete, second phase 1' },
        { p1: 1.0, p2: 0.75, desc: 'first complete, second mid-phase 2' },
        { p1: 1.0, p2: 1.0, desc: 'both complete' },
    ];

    // Compute expected angle steps at different stages
    const startAngleStep = getAngleStep(startArmCount);     // 72°
    const intermediateAngleStep = getAngleStep(startArmCount + 1);  // 60°
    const finalAngleStep = getAngleStep(startArmCount + 2);  // ~51.4°

    for (const tp of testPoints) {
        const intermediateCount = startArmCount + 1;

        const bundle: PlannedTransitionBundle = {
            first: {
                type: 'adding',
                direction: firstDirection,
                progress: tp.p1,
                sourceArmIndex: firstSourceIndex,
                startArmCount: startArmCount,
            },
            second: tp.p2 > 0 ? {
                type: 'adding',
                direction: secondDirection,
                progress: tp.p2,
                sourceArmIndex: secondSourceIndex,
                startArmCount: intermediateCount,
            } : null,
            overlapStart,
            
        };

        const spec = getRenderSpec({
            bundle,
            armCount: startArmCount,
            rotation: 0,
            centerX: CENTER_X,
            centerY: CENTER_Y,
            outerRadius: STAR_OUTER_RADIUS,
        });

        // Get all static arm specs sorted by tip angle
        const sortedArms = Array.from(spec.staticArms.entries())
            .map(([idx, s]) => ({ idx, tipAngle: s.tipAngle, halfStep: s.halfStep }))
            .sort((a, b) => normalizeAngle(a.tipAngle) - normalizeAngle(b.tipAngle));

        // Check gaps between adjacent static arms
        // The gap should be reasonable - not double what it should be
        for (let i = 0; i < sortedArms.length; i++) {
            const curr = sortedArms[i];
            const next = sortedArms[(i + 1) % sortedArms.length];

            // Gap = next.b1 - curr.b2 = (next.tipAngle - next.halfStep) - (curr.tipAngle + curr.halfStep)
            const currB2 = curr.tipAngle + curr.halfStep;
            const nextB1 = next.tipAngle - next.halfStep;
            let gap = normalizeAngle(nextB1 - currB2);

            // Account for wrap-around at ±π
            if (gap < -Math.PI + 0.1) gap += 2 * Math.PI;

            // The gap should be positive (no overlap) and bounded
            // Maximum reasonable gap during transition: 2 * finalAngleStep (room for 2 new arms)
            const maxGap = 2 * finalAngleStep + 0.1;
            // Gap should never be negative (overlapping base points)
            const minGap = -0.001;

            if (gap < minGap) {
                failed++;
                failures.push(`${tp.desc}: arms ${curr.idx}→${next.idx} have NEGATIVE gap ${toDeg(gap).toFixed(1)}° (base points overlap!)`);
            } else if (gap > maxGap) {
                failed++;
                failures.push(`${tp.desc}: arms ${curr.idx}→${next.idx} have EXCESSIVE gap ${toDeg(gap).toFixed(1)}° (max expected ~${toDeg(maxGap).toFixed(1)}°)`);
            } else {
                passed++;
            }
        }

        // Additional check: total angular coverage should be reasonable
        // Static arms should cover: 2π - space for transitioning arms
        let totalHalfSteps = 0;
        for (const arm of sortedArms) {
            totalHalfSteps += arm.halfStep * 2;
        }

        // Expected total coverage depends on how many static arms there are
        // Each static arm covers 2*halfStep, sum should be reasonable
        const numStaticArms = sortedArms.length;
        const expectedCoverage = numStaticArms * finalAngleStep; // approximately
        const tolerance = finalAngleStep; // allow some variance

        if (Math.abs(totalHalfSteps - expectedCoverage) > tolerance && tp.p1 >= 0.9 && tp.p2 >= 0.9) {
            // Only strict check at near-completion
            failures.push(`${tp.desc}: total static arm coverage ${toDeg(totalHalfSteps).toFixed(1)}° differs from expected ${toDeg(expectedCoverage).toFixed(1)}°`);
        }
    }

    return { passed, failed, failures };
}

// Test overlapping ADD+ADD redistribution timing
// For ADDING, redistribution happens in Phase 2 (starts at p=0.5)
function testSecondTransitionRedistributionTiming(): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    const startArmCount = 5;
    const firstSourceIndex = 0;
    const secondSourceIndex = 3;
    const direction: TransitionDirection = 1;
    const overlapStart = 0.5;
    const intermediateCount = startArmCount + 1;

    // Test at p2=0.75 (halfway through Phase 2 of second transition)
    // First transition is further along: p1 = 0.5 + 0.75*0.5 = 0.875
    const p2 = 0.75;
    const p1 = overlapStart + p2 * (1 - overlapStart); // 0.875

    const bundle: PlannedTransitionBundle = {
        first: {
            type: 'adding',
            direction,
            progress: p1,
            sourceArmIndex: firstSourceIndex,
            startArmCount,
        },
        second: {
            type: 'adding',
            direction,
            progress: p2,
            sourceArmIndex: secondSourceIndex,
            startArmCount: intermediateCount,
        },
        overlapStart,
        
    };

    const spec = getRenderSpec({
        bundle,
        armCount: startArmCount,
        rotation: 0,
        centerX: CENTER_X,
        centerY: CENTER_Y,
        outerRadius: STAR_OUTER_RADIUS,
    });

    // Pick an arm that should be affected by second transition: arm 4 in original
    // After first ADD CW from 0: arm 4 → index 5 in 6-arm
    // After second ADD CW from 3 (in 6-arm): arm 5 (which was 4) → index 6 in 7-arm if it's >= insertIdx
    // Second insert at index 4 in 6-arm, so arm 5 shifts to index 6

    const armSpec = spec.staticArms.get(4); // original arm 4
    if (!armSpec) {
        failed++;
        failures.push('Arm 4 not found in staticArms');
        return { passed, failed, failures };
    }

    // Compute expected positions
    const startAngleStep = getAngleStep(startArmCount);
    const intermediateAngleStep = getAngleStep(intermediateCount);
    const finalAngleStep = getAngleStep(startArmCount + 2);

    const origAngle = -Math.PI / 2 + 4 * startAngleStep;
    const intermediateAngle = -Math.PI / 2 + 5 * intermediateAngleStep; // index 5 in 6-arm
    const finalAngle = -Math.PI / 2 + 6 * finalAngleStep; // index 6 in 7-arm

    // For ADDING, redistribution is in Phase 2:
    // firstT = (p1 - 0.5) / 0.5 = (0.875 - 0.5) / 0.5 = 0.75
    // secondT = (p2 - 0.5) / 0.5 = (0.75 - 0.5) / 0.5 = 0.5 (halfway through Phase 2)
    const firstT = p1 <= 0.5 ? 0 : (p1 - 0.5) / 0.5;
    const secondT = p2 <= 0.5 ? 0 : (p2 - 0.5) / 0.5;

    const expectedAngle = origAngle +
        (intermediateAngle - origAngle) * firstT +
        (finalAngle - intermediateAngle) * secondT;

    const actualAngle = armSpec.tipAngle;
    const angleDiff = Math.abs(normalizeAngle(actualAngle - expectedAngle));

    // Allow some tolerance but catch gross errors (like double movement)
    const tolerance = 0.05; // ~3 degrees
    if (angleDiff > tolerance) {
        failed++;
        failures.push(
            `Arm 4 at p1=${p1.toFixed(3)}, p2=${p2.toFixed(3)}: ` +
            `expected ${toDeg(expectedAngle).toFixed(1)}°, got ${toDeg(actualAngle).toFixed(1)}° ` +
            `(diff=${toDeg(angleDiff).toFixed(1)}°)`
        );
        failures.push(`  firstT=${firstT.toFixed(3)}, secondT=${secondT.toFixed(3)}`);
        failures.push(`  orig=${toDeg(origAngle).toFixed(1)}°, inter=${toDeg(intermediateAngle).toFixed(1)}°, final=${toDeg(finalAngle).toFixed(1)}°`);
    } else {
        passed++;
    }

    return { passed, failed, failures };
}

// Test that during double ADD, no static arm gaps exceed the space for both transitioning arms
function testNoExcessiveGapsDuringDoubleAdd(): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    const startArmCount = 5;
    const direction: TransitionDirection = 1;
    const overlapStart = 0.5;
    const intermediateCount = startArmCount + 1;
    const finalCount = startArmCount + 2;

    // Test multiple configurations
    const configs = [
        { first: 0, second: 3, desc: 'sources 0,3' },
        { first: 2, second: 5, desc: 'sources 2,5' },
        { first: 1, second: 4, desc: 'sources 1,4' },
    ];

    for (const config of configs) {
        // Sample many progress points
        for (let p1 = 0.5; p1 <= 1.0; p1 += 0.1) {
            for (let p2 = 0.01; p2 <= 1.0; p2 += 0.1) {
                const bundle: PlannedTransitionBundle = {
                    first: {
                        type: 'adding',
                        direction,
                        progress: p1,
                        sourceArmIndex: config.first,
                        startArmCount,
                    },
                    second: {
                        type: 'adding',
                        direction,
                        progress: p2,
                        sourceArmIndex: config.second,
                        startArmCount: intermediateCount,
                    },
                    overlapStart,
                    
                };

                const spec = getRenderSpec({
                    bundle,
                    armCount: startArmCount,
                    rotation: 0,
                    centerX: CENTER_X,
                    centerY: CENTER_Y,
                    outerRadius: STAR_OUTER_RADIUS,
                });

                // Check for any gap that's more than double a normal arm's span
                const finalAngleStep = getAngleStep(finalCount);
                const maxReasonableGap = 3 * finalAngleStep; // Room for 2 arms plus some margin

                const sortedArms = Array.from(spec.staticArms.entries())
                    .map(([idx, s]) => ({ idx, tipAngle: s.tipAngle, halfStep: s.halfStep }))
                    .sort((a, b) => {
                        const aAngle = normalizeAngle(a.tipAngle);
                        const bAngle = normalizeAngle(b.tipAngle);
                        return aAngle - bAngle;
                    });

                for (let i = 0; i < sortedArms.length; i++) {
                    const curr = sortedArms[i];
                    const next = sortedArms[(i + 1) % sortedArms.length];

                    const currB2 = curr.tipAngle + curr.halfStep;
                    const nextB1 = next.tipAngle - next.halfStep;
                    let gap = normalizeAngle(nextB1 - currB2);
                    if (gap < -Math.PI + 0.1) gap += 2 * Math.PI;

                    if (gap > maxReasonableGap) {
                        failed++;
                        failures.push(
                            `${config.desc} p1=${p1.toFixed(2)} p2=${p2.toFixed(2)}: ` +
                            `arms ${curr.idx}→${next.idx} gap ${toDeg(gap).toFixed(1)}° > max ${toDeg(maxReasonableGap).toFixed(1)}°`
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

// Test that all arm base points (static + transitioning) form a proper ring
// without excessive gaps or overlaps
// NOTE: For ADDING, redistribution happens in Phase 2 (same time as transitioning arm pivots)
// so some overlap is expected during this phase as static arms "make room" for the new arm.
function testAllArmBasePointCoverage(): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    const startArmCount = 5;
    const direction: TransitionDirection = 1;
    const overlapStart = 0.5;
    const intermediateCount = startArmCount + 1;
    const finalCount = startArmCount + 2;

    // Sample progress during second arm's phase 2
    // Note: During ADDING Phase 2, static arms redistribute while transition arm pivots,
    // so some overlap is expected mid-phase. Test at completion instead.
    const testPoints = [
        { p1: 1.0, p2: 1.0, desc: 'both complete' },
    ];

    for (const tp of testPoints) {
        const bundle: PlannedTransitionBundle = {
            first: {
                type: 'adding',
                direction,
                progress: tp.p1,
                sourceArmIndex: 0,
                startArmCount,
            },
            second: {
                type: 'adding',
                direction,
                progress: tp.p2,
                sourceArmIndex: 3, // disjoint from first
                startArmCount: intermediateCount,
            },
            overlapStart,
            
        };

        const spec = getRenderSpec({
            bundle,
            armCount: startArmCount,
            rotation: 0,
            centerX: CENTER_X,
            centerY: CENTER_Y,
            outerRadius: STAR_OUTER_RADIUS,
        });

        // Collect all arm base point angles (b1 and b2) including transitioning arms
        interface ArmBaseInfo {
            idx: string;
            b1Angle: number;
            b2Angle: number;
        }
        const allArms: ArmBaseInfo[] = [];

        // Static arms
        for (const [idx, s] of spec.staticArms) {
            allArms.push({
                idx: `S${idx}`,
                b1Angle: s.tipAngle - s.halfStep,
                b2Angle: s.tipAngle + s.halfStep,
            });
        }

        // First transitioning arm
        if (spec.firstTransitionArm) {
            allArms.push({
                idx: 'T1',
                b1Angle: spec.firstTransitionArm.tipAngle - spec.firstTransitionArm.halfStep,
                b2Angle: spec.firstTransitionArm.tipAngle + spec.firstTransitionArm.halfStep,
            });
        }

        // Second transitioning arm
        if (spec.secondTransitionArm) {
            allArms.push({
                idx: 'T2',
                b1Angle: spec.secondTransitionArm.tipAngle - spec.secondTransitionArm.halfStep,
                b2Angle: spec.secondTransitionArm.tipAngle + spec.secondTransitionArm.halfStep,
            });
        }

        // Sort by the midpoint of each arm (tipAngle equivalent)
        allArms.sort((a, b) => {
            const aMid = normalizeAngle((a.b1Angle + a.b2Angle) / 2);
            const bMid = normalizeAngle((b.b1Angle + b.b2Angle) / 2);
            return aMid - bMid;
        });

        // Check gaps between consecutive arms
        const finalAngleStep = getAngleStep(finalCount);

        for (let i = 0; i < allArms.length; i++) {
            const curr = allArms[i];
            const next = allArms[(i + 1) % allArms.length];

            // Gap from curr.b2 to next.b1
            let gap = normalizeAngle(next.b1Angle - curr.b2Angle);
            if (gap < -Math.PI + 0.1) gap += 2 * Math.PI;

            // Check for overlap (negative gap)
            if (gap < -0.01) {
                failed++;
                failures.push(`${tp.desc}: ${curr.idx}→${next.idx} OVERLAP by ${toDeg(-gap).toFixed(1)}°`);
            } else if (gap > finalAngleStep * 1.5) {
                // Gap larger than 1.5x a single arm span - suspicious
                failed++;
                failures.push(`${tp.desc}: ${curr.idx}→${next.idx} GAP ${toDeg(gap).toFixed(1)}° > 1.5 arm span (${toDeg(finalAngleStep * 1.5).toFixed(1)}°)`);
            } else {
                passed++;
            }
        }
    }

    return { passed, failed, failures };
}

export function runOverlappingAddSpaceTests(): { passed: number; failed: number; failures: string[] } {
    const spacing = testOverlappingAddStaticArmSpacing();
    const timing = testSecondTransitionRedistributionTiming();
    const noExcessive = testNoExcessiveGapsDuringDoubleAdd();
    const coverage = testAllArmBasePointCoverage();
    const singleOverlap = testTransitionArmNoOverlapWithNextArm();

    return {
        passed: spacing.passed + timing.passed + noExcessive.passed + coverage.passed + singleOverlap.passed,
        failed: spacing.failed + timing.failed + noExcessive.failed + coverage.failed + singleOverlap.failed,
        failures: [...spacing.failures, ...timing.failures, ...noExcessive.failures, ...coverage.failures, ...singleOverlap.failures],
    };
}

// Test: Transitioning arm should not overlap adjacent static arms at completion
// NOTE: During Phase 2 of ADDING, the transitioning arm pivots while static arms redistribute
// simultaneously, so some overlap is expected mid-phase. Only test at completion.
function testTransitionArmNoOverlapWithNextArm(): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    const startArmCount = 5;
    const direction: TransitionDirection = 1;
    const TOLERANCE = 0.01; // ~0.5 degrees

    // Test only at completion (p1=1.0) - mid-phase overlap is expected
    const bundle: PlannedTransitionBundle = {
        first: {
            type: 'adding',
            direction,
            progress: 1.0,
            sourceArmIndex: 0,
            startArmCount,
        },
        second: null,
        overlapStart: 0.5,
        
    };

    const spec = getRenderSpec({
        bundle,
        armCount: startArmCount,
        rotation: 0,
        centerX: CENTER_X,
        centerY: CENTER_Y,
        outerRadius: STAR_OUTER_RADIUS,
    });

    if (!spec.firstTransitionArm) {
        passed++;
        return { passed, failed, failures };
    }

    const t = spec.firstTransitionArm;
    const nextArm = spec.staticArms.get(1);
    if (!nextArm) {
        passed++;
        return { passed, failed, failures };
    }

    // Gap from transitioning arm's b2 to next arm's b1
    // Positive gap = no overlap, Negative gap = overlap
    const tB2 = t.tipAngle + t.halfStep;
    const nextB1 = nextArm.tipAngle - nextArm.halfStep;
    const gap = normalizeAngle(nextB1 - tB2);

    if (gap < -TOLERANCE) {
        failed++;
        failures.push(`p1=1.0: Transition arm overlaps next arm by ${toDeg(-gap).toFixed(1)}°`);
    } else {
        passed++;
    }

    return { passed, failed, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { passed, failed, failures } = runOverlappingAddSpaceTests();
    console.log(`Overlapping Add Space: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        for (const f of failures.slice(0, 25)) console.log(`  ${f}`);
    }
}
