#!/usr/bin/env npx tsx

import { runAddingInvariantsTests } from './testAddingInvariants.js';
import { runRemovingInvariantsTests } from './testRemovingInvariants.js';
import { runGeometryProviderTests } from './testGeometryProvider.js';
import { runGeometryProviderOrderTests } from './testGeometryProviderOrder.js';
import { runNewArmBaseLengthTests } from './testNewArmBaseLength.js';
import { runOverlappingGeometryTests } from './testOverlappingGeometry.js';
import { runOverlappingSmoothTests } from './testOverlappingSmooth.js';
import { runRedistributionTests } from './testRedistribution.js';
import { runRenderSpecTestSuite } from './testRenderSpec.js';
import { runSortingSymmetryTests } from './testSortingSymmetry.js';
import { runIfsScenarioTests } from './testIfsScenarios.js';
import { runRecordedSessionTests } from './testRecordedSessions.js';

interface TestResult {
    name: string;
    passed: number;
    failed: number;
    failures: string[];
}

const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');

function runAllTests(): void {
    const results: TestResult[] = [];

    // Run each test suite
    const suites = [
        { name: 'Adding Invariants', fn: runAddingInvariantsTests },
        { name: 'Removing Invariants', fn: runRemovingInvariantsTests },
        { name: 'Geometry Provider', fn: runGeometryProviderTests },
        { name: 'Geometry Provider Order', fn: runGeometryProviderOrderTests },
        { name: 'New Arm Base Length', fn: runNewArmBaseLengthTests },
        { name: 'Overlapping Geometry', fn: runOverlappingGeometryTests },
        { name: 'Overlapping Smooth', fn: runOverlappingSmoothTests },
        { name: 'Redistribution', fn: runRedistributionTests },
        { name: 'Render Spec', fn: runRenderSpecTestSuite },
        { name: 'Sorting Symmetry', fn: runSortingSymmetryTests },
        { name: 'IFS Scenarios', fn: runIfsScenarioTests },
        { name: 'Recorded Sessions', fn: runRecordedSessionTests },
    ];

    for (const suite of suites) {
        const result = suite.fn();
        results.push({ name: suite.name, ...result });
    }

    let totalPassed = 0;
    let totalFailed = 0;

    for (const result of results) {
        totalPassed += result.passed;
        totalFailed += result.failed;
        const status = result.failed === 0 ? '✓' : '✗';
        console.log(`${status} ${result.name}: ${result.passed} passed, ${result.failed} failed`);
    }

    console.log('-'.repeat(60));
    console.log(`TOTAL: ${totalPassed} passed, ${totalFailed} failed`);

    if (totalFailed > 0) {
        console.log('\nFAILURES:');
        for (const result of results) {
            if (result.failures.length > 0) {
                console.log(`\n[${result.name}]`);
                const limit = verbose ? result.failures.length : 3;
                for (const f of result.failures.slice(0, limit)) {
                    console.log(`  ${f}`);
                }
                if (!verbose && result.failures.length > limit) {
                    console.log(`  ... and ${result.failures.length - limit} more (use -v for all)`);
                }
            }
        }
        process.exit(1);
    }
}

runAllTests();
