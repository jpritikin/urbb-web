import { isValidSecondSourceIndex, type TransitionDirection } from '../src/star/starAnimationCore.js';

interface TestCase {
    firstType: 'adding' | 'removing';
    firstSourceIndex: number;
    firstDirection: TransitionDirection;
    firstStartArmCount: number;
    secondType: 'adding' | 'removing';
    secondSourceIndex: number;
    secondDirection: TransitionDirection;
    expectedValid: boolean;
    description: string;
}

const testCases: TestCase[] = [
    // Double-ADD same gap rejection (the bug that was fixed)
    {
        firstType: 'adding',
        firstSourceIndex: 1,
        firstDirection: -1,
        firstStartArmCount: 5,
        secondType: 'adding',
        secondSourceIndex: 2,
        secondDirection: -1,
        expectedValid: false,
        description: 'ADD CCW from 1, then ADD CCW from 2 - same gap (gap 1)',
    },
    {
        firstType: 'adding',
        firstSourceIndex: 0,
        firstDirection: 1,
        firstStartArmCount: 5,
        secondType: 'adding',
        secondSourceIndex: 1,
        secondDirection: 1,
        expectedValid: false,
        description: 'ADD CW from 0, then ADD CW from 1 - same gap (gap 1)',
    },
    {
        firstType: 'adding',
        firstSourceIndex: 3,
        firstDirection: -1,
        firstStartArmCount: 5,
        secondType: 'adding',
        secondSourceIndex: 4,
        secondDirection: -1,
        expectedValid: false,
        description: 'ADD CCW from 3, then ADD CCW from 4 - same gap (gap 3)',
    },

    // Second ADD targets position where first arm was inserted (same gap)
    {
        firstType: 'adding',
        firstSourceIndex: 2,
        firstDirection: 1,
        firstStartArmCount: 3,
        secondType: 'adding',
        secondSourceIndex: 2,
        secondDirection: 1,
        expectedValid: false,
        description: 'ADD CW from 2 (3 arms), then ADD CW from 2 - second inserts at first insert position',
    },

    // Valid double-ADD cases (different gaps)
    {
        firstType: 'adding',
        firstSourceIndex: 0,
        firstDirection: 1,
        firstStartArmCount: 5,
        secondType: 'adding',
        secondSourceIndex: 3,
        secondDirection: 1,
        expectedValid: true,
        description: 'ADD CW from 0, then ADD CW from 3 - different gaps',
    },
    {
        firstType: 'adding',
        firstSourceIndex: 1,
        firstDirection: -1,
        firstStartArmCount: 5,
        secondType: 'adding',
        secondSourceIndex: 4,
        secondDirection: -1,
        expectedValid: true,
        description: 'ADD CCW from 1, then ADD CCW from 4 - different gaps',
    },

    // Cannot use newly inserted arm as adjacent
    {
        firstType: 'adding',
        firstSourceIndex: 0,
        firstDirection: 1,
        firstStartArmCount: 5,
        secondType: 'adding',
        secondSourceIndex: 1,
        secondDirection: -1,
        expectedValid: false,
        description: 'Second ADD uses first insert as source (CCW neighbor is new arm)',
    },

    // Mixed ADD+REMOVE cases
    {
        firstType: 'adding',
        firstSourceIndex: 0,
        firstDirection: 1,
        firstStartArmCount: 5,
        secondType: 'removing',
        secondSourceIndex: 3,
        secondDirection: 1,
        expectedValid: true,
        description: 'ADD then REMOVE from disjoint positions',
    },

    // Double-REMOVE: second source cannot be first's adjacent arm
    {
        firstType: 'removing',
        firstSourceIndex: 0,
        firstDirection: -1,
        firstStartArmCount: 5,
        secondType: 'removing',
        secondSourceIndex: 3,
        secondDirection: -1,
        expectedValid: false,
        description: 'REMOVE CCW from 0 (adj=4), then REMOVE arm 3 (=orig 4) - second source is first adj',
    },
    {
        firstType: 'removing',
        firstSourceIndex: 2,
        firstDirection: 1,
        firstStartArmCount: 5,
        secondType: 'removing',
        secondSourceIndex: 2,
        secondDirection: 1,
        expectedValid: false,
        description: 'REMOVE CW from 2 (adj=3), then REMOVE arm 2 (=orig 3) - second source is first adj',
    },

    // Valid double-REMOVE cases
    {
        firstType: 'removing',
        firstSourceIndex: 0,
        firstDirection: -1,
        firstStartArmCount: 7,
        secondType: 'removing',
        secondSourceIndex: 2,
        secondDirection: -1,
        expectedValid: true,
        description: 'REMOVE CCW from 0 (7 arms), then REMOVE arm 2 - disjoint',
    },
];

function runTests(): { passed: number; failed: number; failures: string[] } {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    for (const tc of testCases) {
        const result = isValidSecondSourceIndex(
            tc.firstType,
            tc.firstSourceIndex,
            tc.firstDirection,
            tc.firstStartArmCount,
            tc.secondType,
            tc.secondSourceIndex,
            tc.secondDirection
        );

        if (result === tc.expectedValid) {
            passed++;
        } else {
            failed++;
            failures.push(
                `${tc.description}: expected ${tc.expectedValid}, got ${result}`
            );
        }
    }

    return { passed, failed, failures };
}

export function runIsValidSecondSourceIndexTests() {
    return runTests();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { passed, failed, failures } = runTests();
    console.log(`isValidSecondSourceIndex: ${passed} passed, ${failed} failed`);
    for (const f of failures) {
        console.log(`  ${f}`);
    }
}
