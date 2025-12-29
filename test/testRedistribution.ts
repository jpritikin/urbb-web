import {
    computeArmRedistribution,
    computeOverlappingArmRedistribution,
    TransitionDirection,
    OverlappingRedistributionParams,
} from '../src/starAnimationCore.js';

const TOLERANCE = 0.001;
const PI = Math.PI;

function toDeg(rad: number): number {
    return (rad * 180) / PI;
}

function anglesEqual(a: number, b: number, tol = TOLERANCE): boolean {
    let diff = Math.abs(a - b);
    if (diff > PI) diff = 2 * PI - diff;
    return diff < tol;
}

interface TestResult {
    name: string;
    passed: boolean;
    details: string;
}

let results: TestResult[] = [];

function test(name: string, passed: boolean, details: string = '') {
    results.push({ name, passed, details });
}

function runAllRedistributionTests(): void {
    results = [];

// Test: REMOVING from 5-arm star (source=2), check arm positions at key progress values
// Initial: 5 arms at indices 0,1,2,3,4 (72° apart, -90° base)
// Final: 4 arms at indices 0,1,2,3 (90° apart, -90° base)
// Arms 0,1 stay at same index, arms 3,4 shift down to 2,3
{
    const armCount = 5;
    const sourceIndex = 2;
    const rotation = 0;
    const startAngleStep = (2 * PI) / 5; // 72°
    const endAngleStep = (2 * PI) / 4;   // 90°

    // Test arm 0 (before source, keeps index 0)
    {
        const startAngle = rotation - PI / 2 + 0 * startAngleStep; // -90°
        const endAngle = rotation - PI / 2 + 0 * endAngleStep;     // -90°

        // At progress=0: should be at start position
        const r0 = computeArmRedistribution(0, startAngle, startAngleStep / 2, 'removing', 0, sourceIndex, 1, armCount, rotation);
        test('REMOVE 5→4 arm0 p=0 tipAngle', anglesEqual(r0.tipAngle, startAngle),
             `expected ${toDeg(startAngle).toFixed(1)}° got ${toDeg(r0.tipAngle).toFixed(1)}°`);

        // At progress=0.5: should be at END position (redistribution complete in Phase 1)
        const r05 = computeArmRedistribution(0, startAngle, startAngleStep / 2, 'removing', 0.5, sourceIndex, 1, armCount, rotation);
        test('REMOVE 5→4 arm0 p=0.5 tipAngle', anglesEqual(r05.tipAngle, endAngle),
             `expected ${toDeg(endAngle).toFixed(1)}° got ${toDeg(r05.tipAngle).toFixed(1)}°`);

        // At progress=1.0: should still be at end position
        const r1 = computeArmRedistribution(0, startAngle, startAngleStep / 2, 'removing', 1.0, sourceIndex, 1, armCount, rotation);
        test('REMOVE 5→4 arm0 p=1.0 tipAngle', anglesEqual(r1.tipAngle, endAngle),
             `expected ${toDeg(endAngle).toFixed(1)}° got ${toDeg(r1.tipAngle).toFixed(1)}°`);
    }

    // Test arm 3 (after source, shifts from index 3 to index 2)
    {
        const startAngle = rotation - PI / 2 + 3 * startAngleStep; // -90° + 216° = 126°
        const endAngle = rotation - PI / 2 + 2 * endAngleStep;     // -90° + 180° = 90°

        const r0 = computeArmRedistribution(3, startAngle, startAngleStep / 2, 'removing', 0, sourceIndex, 1, armCount, rotation);
        test('REMOVE 5→4 arm3 p=0 tipAngle', anglesEqual(r0.tipAngle, startAngle),
             `expected ${toDeg(startAngle).toFixed(1)}° got ${toDeg(r0.tipAngle).toFixed(1)}°`);

        // At p=0.5: at END position (redistribution complete in Phase 1)
        const r05 = computeArmRedistribution(3, startAngle, startAngleStep / 2, 'removing', 0.5, sourceIndex, 1, armCount, rotation);
        test('REMOVE 5→4 arm3 p=0.5 tipAngle', anglesEqual(r05.tipAngle, endAngle),
             `expected ${toDeg(endAngle).toFixed(1)}° got ${toDeg(r05.tipAngle).toFixed(1)}°`);

        // At p=1.0: still at end position
        const r1 = computeArmRedistribution(3, startAngle, startAngleStep / 2, 'removing', 1.0, sourceIndex, 1, armCount, rotation);
        test('REMOVE 5→4 arm3 p=1.0 tipAngle', anglesEqual(r1.tipAngle, endAngle),
             `expected ${toDeg(endAngle).toFixed(1)}° got ${toDeg(r1.tipAngle).toFixed(1)}°`);
    }

    // Test halfStep changes (removing: redistribution in Phase 1)
    {
        const startHalfStep = startAngleStep / 2; // 36°
        const endHalfStep = endAngleStep / 2;     // 45°

        const r0 = computeArmRedistribution(0, -PI/2, startHalfStep, 'removing', 0, sourceIndex, 1, armCount, rotation);
        test('REMOVE 5→4 halfStep p=0', Math.abs(r0.halfStep - startHalfStep) < TOLERANCE,
             `expected ${toDeg(startHalfStep).toFixed(1)}° got ${toDeg(r0.halfStep).toFixed(1)}°`);

        // At p=0.5: at END halfStep (redistribution complete in Phase 1)
        const r05 = computeArmRedistribution(0, -PI/2, startHalfStep, 'removing', 0.5, sourceIndex, 1, armCount, rotation);
        test('REMOVE 5→4 halfStep p=0.5', Math.abs(r05.halfStep - endHalfStep) < TOLERANCE,
             `expected ${toDeg(endHalfStep).toFixed(1)}° got ${toDeg(r05.halfStep).toFixed(1)}°`);

        // At p=1.0: still at end halfStep
        const r1 = computeArmRedistribution(0, -PI/2, startHalfStep, 'removing', 1.0, sourceIndex, 1, armCount, rotation);
        test('REMOVE 5→4 halfStep p=1.0', Math.abs(r1.halfStep - endHalfStep) < TOLERANCE,
             `expected ${toDeg(endHalfStep).toFixed(1)}° got ${toDeg(r1.halfStep).toFixed(1)}°`);
    }
}

// Test: ADDING to 5-arm star (source=0, CW), check arm positions
// Initial: 5 arms at indices 0,1,2,3,4 (72° apart)
// Final: 6 arms at indices 0,1,2,3,4,5 (60° apart)
// For CW: new arm appears at index 1, so arms 1,2,3,4 shift to 2,3,4,5
// Arm 0 stays at index 0
{
    const armCount = 5;
    const sourceIndex = 0;
    const direction: TransitionDirection = 1; // CW
    const rotation = 0;
    const startAngleStep = (2 * PI) / 5; // 72°
    const endAngleStep = (2 * PI) / 6;   // 60°

    // Test arm 0 (source arm, stays at index 0 - doesn't shift for CW)
    // For ADDING, redistribution happens in Phase 2 (starts at p=0.5)
    {
        const startAngle = rotation - PI / 2 + 0 * startAngleStep; // -90°
        const endAngle = rotation - PI / 2 + 0 * endAngleStep;     // -90°

        const r0 = computeArmRedistribution(0, startAngle, startAngleStep / 2, 'adding', 0, sourceIndex, direction, armCount, rotation);
        test('ADD 5→6 CW arm0 p=0 tipAngle', anglesEqual(r0.tipAngle, startAngle),
             `expected ${toDeg(startAngle).toFixed(1)}° got ${toDeg(r0.tipAngle).toFixed(1)}°`);

        // At p=0.5: still at START position (redistribution starts in Phase 2)
        const r05 = computeArmRedistribution(0, startAngle, startAngleStep / 2, 'adding', 0.5, sourceIndex, direction, armCount, rotation);
        test('ADD 5→6 CW arm0 p=0.5 tipAngle', anglesEqual(r05.tipAngle, startAngle),
             `expected ${toDeg(startAngle).toFixed(1)}° got ${toDeg(r05.tipAngle).toFixed(1)}°`);

        // At p=1.0: at end position
        const r1 = computeArmRedistribution(0, startAngle, startAngleStep / 2, 'adding', 1.0, sourceIndex, direction, armCount, rotation);
        test('ADD 5→6 CW arm0 p=1.0 tipAngle', anglesEqual(r1.tipAngle, endAngle),
             `expected ${toDeg(endAngle).toFixed(1)}° got ${toDeg(r1.tipAngle).toFixed(1)}°`);
    }

    // Test arm 1 (shifts from index 1 to index 2 for CW)
    {
        const startAngle = rotation - PI / 2 + 1 * startAngleStep; // -90° + 72° = -18°
        const endAngle = rotation - PI / 2 + 2 * endAngleStep;     // -90° + 120° = 30°

        // At p=0.5: still at START position (redistribution starts in Phase 2)
        const r05 = computeArmRedistribution(1, startAngle, startAngleStep / 2, 'adding', 0.5, sourceIndex, direction, armCount, rotation);
        test('ADD 5→6 CW arm1 p=0.5 tipAngle', anglesEqual(r05.tipAngle, startAngle),
             `expected ${toDeg(startAngle).toFixed(1)}° got ${toDeg(r05.tipAngle).toFixed(1)}°`);

        const r1 = computeArmRedistribution(1, startAngle, startAngleStep / 2, 'adding', 1.0, sourceIndex, direction, armCount, rotation);
        test('ADD 5→6 CW arm1 p=1.0 tipAngle', anglesEqual(r1.tipAngle, endAngle),
             `expected ${toDeg(endAngle).toFixed(1)}° got ${toDeg(r1.tipAngle).toFixed(1)}°`);
    }
}

// Test: ADDING CCW - arm 0 should shift
{
    const armCount = 5;
    const sourceIndex = 0;
    const direction: TransitionDirection = -1; // CCW
    const rotation = 0;
    const startAngleStep = (2 * PI) / 5;
    const endAngleStep = (2 * PI) / 6;

    // For CCW: new arm appears at index 0, so arm 0 shifts to index 1
    const startAngle = rotation - PI / 2 + 0 * startAngleStep; // -90°
    const endAngle = rotation - PI / 2 + 1 * endAngleStep;     // -90° + 60° = -30°

    const r1 = computeArmRedistribution(0, startAngle, startAngleStep / 2, 'adding', 1.0, sourceIndex, direction, armCount, rotation);
    test('ADD 5→6 CCW arm0 p=1.0 tipAngle (should shift)', anglesEqual(r1.tipAngle, endAngle),
         `expected ${toDeg(endAngle).toFixed(1)}° got ${toDeg(r1.tipAngle).toFixed(1)}°`);
}

// ==================== computeOverlappingArmRedistribution Tests ====================


// Test: Two ADDs (5→6→7), both CW
// First: source=0 CW (new arm at index 1)
// Second: source=1 CW in 6-arm star (new arm at index 2 in final)
{
    const params: OverlappingRedistributionParams = {
        originalArmIndex: 2,  // Test arm 2 (shifts from 2→3→4)
        startArmCount: 5,
        firstSourceIndex: 0,
        secondSourceIndex: 1,  // in 6-arm star
        firstType: 'adding',
        secondType: 'adding',
        firstDirection: 1,
        secondDirection: 1,
        p1: 0,
        p2: 0,
        rotation: 0,
    };

    const startAngleStep = (2 * PI) / 5;
    const intermediateAngleStep = (2 * PI) / 6;
    const finalAngleStep = (2 * PI) / 7;

    // At p1=0, p2=0: should be at original position
    const r00 = computeOverlappingArmRedistribution({ ...params, p1: 0, p2: 0 });
    const expectedStart = params.rotation - PI / 2 + 2 * startAngleStep;
    test('OVERLAP ADD+ADD arm2 p1=0 p2=0', r00 !== null && anglesEqual(r00.tipAngle, expectedStart),
         r00 ? `expected ${toDeg(expectedStart).toFixed(1)}° got ${toDeg(r00.tipAngle).toFixed(1)}°` : 'null result');

    // At p1=1, p2=0: first transition complete, arm2 shifted to index 3 in 6-arm star
    const r10 = computeOverlappingArmRedistribution({ ...params, p1: 1, p2: 0 });
    const expectedIntermediate = params.rotation - PI / 2 + 3 * intermediateAngleStep;
    test('OVERLAP ADD+ADD arm2 p1=1 p2=0', r10 !== null && anglesEqual(r10.tipAngle, expectedIntermediate),
         r10 ? `expected ${toDeg(expectedIntermediate).toFixed(1)}° got ${toDeg(r10.tipAngle).toFixed(1)}°` : 'null result');

    // At p1=1, p2=1: both complete, arm2 at index 4 in 7-arm star
    const r11 = computeOverlappingArmRedistribution({ ...params, p1: 1, p2: 1 });
    const expectedFinal = params.rotation - PI / 2 + 4 * finalAngleStep;
    test('OVERLAP ADD+ADD arm2 p1=1 p2=1', r11 !== null && anglesEqual(r11.tipAngle, expectedFinal),
         r11 ? `expected ${toDeg(expectedFinal).toFixed(1)}° got ${toDeg(r11.tipAngle).toFixed(1)}°` : 'null result');
}

// Test: REMOVE then ADD (5→4→5)
{
    const params: OverlappingRedistributionParams = {
        originalArmIndex: 3,  // Test arm 3
        startArmCount: 5,
        firstSourceIndex: 1,  // Remove arm 1
        secondSourceIndex: 1, // Add at source 1 in 4-arm star
        firstType: 'removing',
        secondType: 'adding',
        firstDirection: 1,
        secondDirection: 1,
        p1: 0,
        p2: 0,
        rotation: 0,
    };

    const startAngleStep = (2 * PI) / 5;  // 72°
    const intermediateAngleStep = (2 * PI) / 4;  // 90°
    const finalAngleStep = (2 * PI) / 5;  // 72°

    // Arm 3 in 5-arm → shifts to index 2 in 4-arm → shifts to index 3 in 5-arm
    const expectedStart = params.rotation - PI / 2 + 3 * startAngleStep;
    const expectedIntermediate = params.rotation - PI / 2 + 2 * intermediateAngleStep;  // arm3 becomes index 2
    const expectedFinal = params.rotation - PI / 2 + 3 * finalAngleStep;  // back to index 3

    const r00 = computeOverlappingArmRedistribution({ ...params, p1: 0, p2: 0 });
    test('OVERLAP REM+ADD arm3 p1=0 p2=0', r00 !== null && anglesEqual(r00.tipAngle, expectedStart),
         r00 ? `expected ${toDeg(expectedStart).toFixed(1)}° got ${toDeg(r00.tipAngle).toFixed(1)}°` : 'null result');

    const r10 = computeOverlappingArmRedistribution({ ...params, p1: 1, p2: 0 });
    test('OVERLAP REM+ADD arm3 p1=1 p2=0', r10 !== null && anglesEqual(r10.tipAngle, expectedIntermediate),
         r10 ? `expected ${toDeg(expectedIntermediate).toFixed(1)}° got ${toDeg(r10.tipAngle).toFixed(1)}°` : 'null result');

    const r11 = computeOverlappingArmRedistribution({ ...params, p1: 1, p2: 1 });
    test('OVERLAP REM+ADD arm3 p1=1 p2=1', r11 !== null && anglesEqual(r11.tipAngle, expectedFinal),
         r11 ? `expected ${toDeg(expectedFinal).toFixed(1)}° got ${toDeg(r11.tipAngle).toFixed(1)}°` : 'null result');
}

// Test: Source arm returns null for removing
{
    const params: OverlappingRedistributionParams = {
        originalArmIndex: 2,  // This is the source being removed
        startArmCount: 5,
        firstSourceIndex: 2,
        secondSourceIndex: 0,
        firstType: 'removing',
        secondType: 'adding',
        firstDirection: 1,
        secondDirection: 1,
        p1: 0.5,
        p2: 0,
        rotation: 0,
    };

    const result = computeOverlappingArmRedistribution(params);
    test('OVERLAP first source (removing) returns null', result === null, result ? 'got non-null' : '');
}

// ==================== Test intermediate progress values ====================


// Test linear interpolation at p=0.25 for REMOVING (redistribution in Phase 1)
{
    const armCount = 5;
    const sourceIndex = 2;
    const rotation = 0;
    const startAngleStep = (2 * PI) / 5;
    const endAngleStep = (2 * PI) / 4;

    // Arm 0: from -90° to -90° (no change in angle, but halfStep changes)
    const startAngle = rotation - PI / 2 + 0 * startAngleStep;
    const endAngle = rotation - PI / 2 + 0 * endAngleStep;
    const startHalfStep = startAngleStep / 2;
    const endHalfStep = endAngleStep / 2;

    // At p=0.25, t=0.5 (halfway through Phase 1)
    const r025 = computeArmRedistribution(0, startAngle, startHalfStep, 'removing', 0.25, sourceIndex, 1, armCount, rotation);
    const expectedAngle025 = startAngle + (endAngle - startAngle) * 0.5;
    const expectedHalfStep025 = startHalfStep + (endHalfStep - startHalfStep) * 0.5;
    test('REMOVE 5→4 arm0 p=0.25 tipAngle (t=0.5)', anglesEqual(r025.tipAngle, expectedAngle025),
         `expected ${toDeg(expectedAngle025).toFixed(1)}° got ${toDeg(r025.tipAngle).toFixed(1)}°`);
    test('REMOVE 5→4 arm0 p=0.25 halfStep (t=0.5)', Math.abs(r025.halfStep - expectedHalfStep025) < TOLERANCE,
         `expected ${toDeg(expectedHalfStep025).toFixed(1)}° got ${toDeg(r025.halfStep).toFixed(1)}°`);

    // At p=0.75, t=1 (redistribution complete in Phase 1, stays at end)
    const r075 = computeArmRedistribution(0, startAngle, startHalfStep, 'removing', 0.75, sourceIndex, 1, armCount, rotation);
    test('REMOVE 5→4 arm0 p=0.75 tipAngle (t=1)', anglesEqual(r075.tipAngle, endAngle),
         `expected ${toDeg(endAngle).toFixed(1)}° got ${toDeg(r075.tipAngle).toFixed(1)}°`);
    test('REMOVE 5→4 arm0 p=0.75 halfStep (t=1)', Math.abs(r075.halfStep - endHalfStep) < TOLERANCE,
         `expected ${toDeg(endHalfStep).toFixed(1)}° got ${toDeg(r075.halfStep).toFixed(1)}°`);
}

// Test linear interpolation at p=0.75 for ADDING (redistribution in Phase 2)
{
    const armCount = 5;
    const sourceIndex = 0;
    const direction: TransitionDirection = 1;
    const rotation = 0;
    const startAngleStep = (2 * PI) / 5;
    const endAngleStep = (2 * PI) / 6;

    // Arm 1: shifts from index 1 to index 2
    const startAngle = rotation - PI / 2 + 1 * startAngleStep;
    const endAngle = rotation - PI / 2 + 2 * endAngleStep;
    const startHalfStep = startAngleStep / 2;
    const endHalfStep = endAngleStep / 2;

    // At p=0.25, t=0 (redistribution hasn't started - it's in Phase 2)
    const r025 = computeArmRedistribution(1, startAngle, startHalfStep, 'adding', 0.25, sourceIndex, direction, armCount, rotation);
    test('ADD 5→6 CW arm1 p=0.25 tipAngle (t=0)', anglesEqual(r025.tipAngle, startAngle),
         `expected ${toDeg(startAngle).toFixed(1)}° got ${toDeg(r025.tipAngle).toFixed(1)}°`);
    test('ADD 5→6 CW arm1 p=0.25 halfStep (t=0)', Math.abs(r025.halfStep - startHalfStep) < TOLERANCE,
         `expected ${toDeg(startHalfStep).toFixed(1)}° got ${toDeg(r025.halfStep).toFixed(1)}°`);

    // At p=0.75, t=0.5 (halfway through Phase 2)
    const r075 = computeArmRedistribution(1, startAngle, startHalfStep, 'adding', 0.75, sourceIndex, direction, armCount, rotation);
    const expectedAngle075 = startAngle + (endAngle - startAngle) * 0.5;
    const expectedHalfStep075 = startHalfStep + (endHalfStep - startHalfStep) * 0.5;
    test('ADD 5→6 CW arm1 p=0.75 tipAngle (t=0.5)', anglesEqual(r075.tipAngle, expectedAngle075),
         `expected ${toDeg(expectedAngle075).toFixed(1)}° got ${toDeg(r075.tipAngle).toFixed(1)}°`);
    test('ADD 5→6 CW arm1 p=0.75 halfStep (t=0.5)', Math.abs(r075.halfStep - expectedHalfStep075) < TOLERANCE,
         `expected ${toDeg(expectedHalfStep075).toFixed(1)}° got ${toDeg(r075.halfStep).toFixed(1)}°`);
}


// ==================== Test edge cases ====================


// Test: source arm for adding should NOT return null (it still exists and redistributes)
{
    const params: OverlappingRedistributionParams = {
        originalArmIndex: 0,  // This is the first source for adding
        startArmCount: 5,
        firstSourceIndex: 0,
        secondSourceIndex: 1,
        firstType: 'adding',
        secondType: 'adding',
        firstDirection: 1,
        secondDirection: 1,
        p1: 1,
        p2: 1,
        rotation: 0,
    };

    const result = computeOverlappingArmRedistribution(params);
    test('OVERLAP adding source arm should NOT be null', result !== null, result ? '' : 'got null');

    // For CW add from source 0, arm 0 stays at index 0 through both transitions
    if (result) {
        const finalAngleStep = (2 * PI) / 7;
        const expectedAngle = params.rotation - PI / 2 + 0 * finalAngleStep;
        test('OVERLAP adding source arm0 final position', anglesEqual(result.tipAngle, expectedAngle),
             `expected ${toDeg(expectedAngle).toFixed(1)}° got ${toDeg(result.tipAngle).toFixed(1)}°`);
    }
}

// Test: Different rotations
{
    const rotation = PI / 4;  // 45° rotation
    const armCount = 5;
    const sourceIndex = 2;
    const startAngleStep = (2 * PI) / 5;
    const endAngleStep = (2 * PI) / 4;

    const startAngle = rotation - PI / 2 + 0 * startAngleStep;
    const endAngle = rotation - PI / 2 + 0 * endAngleStep;

    const r1 = computeArmRedistribution(0, startAngle, startAngleStep / 2, 'removing', 1.0, sourceIndex, 1, armCount, rotation);
    test('REMOVE with rotation=45° arm0 p=1.0', anglesEqual(r1.tipAngle, endAngle),
         `expected ${toDeg(endAngle).toFixed(1)}° got ${toDeg(r1.tipAngle).toFixed(1)}°`);
}

// Test: 4-arm star special case (different inner radius factor)
{
    const armCount = 4;
    const sourceIndex = 0;
    const direction: TransitionDirection = 1;
    const rotation = 0;
    const startAngleStep = (2 * PI) / 4;  // 90°
    const endAngleStep = (2 * PI) / 5;    // 72°

    // Arm 1 shifts from index 1 to index 2 for CW add
    const startAngle = rotation - PI / 2 + 1 * startAngleStep;  // 0°
    const endAngle = rotation - PI / 2 + 2 * endAngleStep;      // -90° + 144° = 54°

    const r1 = computeArmRedistribution(1, startAngle, startAngleStep / 2, 'adding', 1.0, sourceIndex, direction, armCount, rotation);
    test('ADD 4→5 CW arm1 p=1.0 tipAngle', anglesEqual(r1.tipAngle, endAngle),
         `expected ${toDeg(endAngle).toFixed(1)}° got ${toDeg(r1.tipAngle).toFixed(1)}°`);
}

// Test: Two REMOVES (5→4→3)
{
    const params: OverlappingRedistributionParams = {
        originalArmIndex: 4,  // Test arm 4
        startArmCount: 5,
        firstSourceIndex: 1,   // Remove arm 1
        secondSourceIndex: 2,  // Remove arm 2 in 4-arm star (was arm 3 originally)
        firstType: 'removing',
        secondType: 'removing',
        firstDirection: 1,
        secondDirection: 1,
        p1: 1,
        p2: 1,
        rotation: 0,
    };

    // Arm 4 in 5-arm → index 3 in 4-arm → index 2 in 3-arm
    const finalAngleStep = (2 * PI) / 3;  // 120°
    const expectedFinal = params.rotation - PI / 2 + 2 * finalAngleStep;  // -90° + 240° = 150°

    const result = computeOverlappingArmRedistribution(params);
    test('OVERLAP REM+REM arm4 p1=1 p2=1', result !== null && anglesEqual(result.tipAngle, expectedFinal),
         result ? `expected ${toDeg(expectedFinal).toFixed(1)}° got ${toDeg(result.tipAngle).toFixed(1)}°` : 'null result');
}

// Test: CCW direction for overlapping
{
    const params: OverlappingRedistributionParams = {
        originalArmIndex: 2,
        startArmCount: 5,
        firstSourceIndex: 0,
        secondSourceIndex: 0,  // For CCW, new arm appears at source position
        firstType: 'adding',
        secondType: 'adding',
        firstDirection: -1,  // CCW
        secondDirection: -1,  // CCW
        p1: 1,
        p2: 1,
        rotation: 0,
    };

    // For CCW add from source 0, new arm at index 0, so arm 2 shifts to 3 in 6-arm
    // Then second CCW add at source 0, new arm at index 0, so arm 3 shifts to 4 in 7-arm
    const finalAngleStep = (2 * PI) / 7;
    const expectedFinal = params.rotation - PI / 2 + 4 * finalAngleStep;

    const result = computeOverlappingArmRedistribution(params);
    test('OVERLAP ADD+ADD CCW arm2 p1=1 p2=1', result !== null && anglesEqual(result.tipAngle, expectedFinal),
         result ? `expected ${toDeg(expectedFinal).toFixed(1)}° got ${toDeg(result.tipAngle).toFixed(1)}°` : 'null result');
}

// Test: Second source arm for removing should return null
{
    const params: OverlappingRedistributionParams = {
        originalArmIndex: 3,  // In original star, this becomes secondSource after first transition
        startArmCount: 5,
        firstSourceIndex: 1,
        secondSourceIndex: 2,  // Index 2 in 4-arm star = index 3 in original
        firstType: 'removing',
        secondType: 'removing',
        firstDirection: 1,
        secondDirection: 1,
        p1: 1,
        p2: 0.5,
        rotation: 0,
    };

    const result = computeOverlappingArmRedistribution(params);
    test('OVERLAP second source (removing) returns null', result === null, result ? 'got non-null' : '');
}

// Test: All arms in a 5-arm star adding CW from source 0
// Verify each arm ends up at the correct position
{
    const startArmCount = 5;
    const sourceIndex = 0;
    const direction: TransitionDirection = 1;
    const rotation = 0;
    const startAngleStep = (2 * PI) / 5;
    const endAngleStep = (2 * PI) / 6;

    // Expected final indices for CW add from source 0:
    // Arm 0 stays at 0, Arms 1,2,3,4 shift to 2,3,4,5
    const expectedFinalIndices = [0, 2, 3, 4, 5];

    for (let i = 0; i < 5; i++) {
        const startAngle = rotation - PI / 2 + i * startAngleStep;
        const expectedEndAngle = rotation - PI / 2 + expectedFinalIndices[i] * endAngleStep;

        const r = computeArmRedistribution(i, startAngle, startAngleStep / 2, 'adding', 1.0, sourceIndex, direction, startArmCount, rotation);
        test(`ADD 5→6 CW all arms: arm${i} final index`, anglesEqual(r.tipAngle, expectedEndAngle),
             `expected idx ${expectedFinalIndices[i]} (${toDeg(expectedEndAngle).toFixed(1)}°) got ${toDeg(r.tipAngle).toFixed(1)}°`);
    }
}

// Test: All arms in a 5-arm star adding CCW from source 0
// For CCW: new arm at index 0, arms 0,1,2,3,4 shift to 1,2,3,4,5
{
    const startArmCount = 5;
    const sourceIndex = 0;
    const direction: TransitionDirection = -1;
    const rotation = 0;
    const startAngleStep = (2 * PI) / 5;
    const endAngleStep = (2 * PI) / 6;

    // Expected final indices for CCW add from source 0:
    // All arms shift up by 1
    const expectedFinalIndices = [1, 2, 3, 4, 5];

    for (let i = 0; i < 5; i++) {
        const startAngle = rotation - PI / 2 + i * startAngleStep;
        const expectedEndAngle = rotation - PI / 2 + expectedFinalIndices[i] * endAngleStep;

        const r = computeArmRedistribution(i, startAngle, startAngleStep / 2, 'adding', 1.0, sourceIndex, direction, startArmCount, rotation);
        test(`ADD 5→6 CCW all arms: arm${i} final index`, anglesEqual(r.tipAngle, expectedEndAngle),
             `expected idx ${expectedFinalIndices[i]} (${toDeg(expectedEndAngle).toFixed(1)}°) got ${toDeg(r.tipAngle).toFixed(1)}°`);
    }
}

}

export function runRedistributionTests(): { passed: number; failed: number; failures: string[] } {
    runAllRedistributionTests();
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const failures = results.filter(r => !r.passed).map(r => r.details ? `${r.name}: ${r.details}` : r.name);
    return { passed, failed, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { passed, failed, failures } = runRedistributionTests();
    console.log(`Redistribution: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
    }
}
