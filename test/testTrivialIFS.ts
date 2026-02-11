import { HeadlessSimulator } from '../src/playback/testability/headlessSimulator.js';
import { runScenario } from '../src/playback/testability/scenarios.js';
import type { Scenario, SerializedModel } from '../src/playback/testability/types.js';

interface TestResult {
    name: string;
    passed: boolean;
    details: string;
}

let results: TestResult[] = [];

function test(name: string, passed: boolean, details: string = '') {
    results.push({ name, passed, details });
}

function runAllTrivialIFSTests(): void {
    results = [];

    // Scenario runner
    {
        const scenario: Scenario = {
            name: 'Basic scenario',
            seed: 12345,
            parts: [
                { id: 'part1', name: 'Part One', trust: 0.5 },
            ],
            relationships: {},
            actions: [
                { action: 'join_conference', cloudId: 'part1' },
                { action: 'blend', cloudId: 'part1' },
            ],
            assertions: [
                { type: 'target', cloudId: 'part1', expected: false },
                { type: 'blended', cloudId: 'part1', expected: true },
            ],
        };

        const result = runScenario(scenario);
        test('Scenario runner - passed', result.passed === true,
             result.failedAssertions.map(f => `${f.assertion.type}: expected ${f.assertion.expected}, got ${f.actual}`).join('; '));
    }

    // Time advancement increases needAttention for hostile inter-part relations
    {
        const sim = new HeadlessSimulator({ seed: 12345 });
        sim.setupParts([
            { id: 'aggrieved', name: 'Aggrieved', needAttention: 0.1 },
            { id: 'target', name: 'Target' },
        ]);
        sim.setupRelationships({
            interPartRelations: [{
                fromId: 'aggrieved', toId: 'target',
                trust: 0.2, stance: 0.6, stanceFlipOdds: 0.05,
            }],
        });

        const initialNeed = sim.getModel().parts.getNeedAttention('aggrieved');
        sim.advanceTime(10);
        const afterNeed = sim.getModel().parts.getNeedAttention('aggrieved');

        test('Time advance - needAttention increases', afterNeed > initialNeed,
             `expected ${afterNeed} > ${initialNeed}`);

        // rate = 0.05 * (0.3 - 0.2) / 0.3 = 0.0167
        const expectedRate = 0.05 * (0.3 - 0.2) / 0.3;
        const expectedIncrease = 10 * expectedRate;
        const actualIncrease = afterNeed - initialNeed;
        test('Time advance - correct rate', Math.abs(actualIncrease - expectedIncrease) < 0.01,
             `expected ~${expectedIncrease.toFixed(4)} increase, got ${actualIncrease.toFixed(4)}`);
    }

    // Deterministic replay with same seed
    {
        const scenario: Scenario = {
            name: 'Deterministic test',
            seed: 99999,
            parts: [
                { id: 'protector', name: 'Protector', trust: 0.6 },
                { id: 'exile', name: 'Exile' },
            ],
            relationships: {
                protections: [{ protectorId: 'protector', protectedId: 'exile' }],
            },
            actions: [
                { action: 'join_conference', cloudId: 'protector' },
                { action: 'help_protected', cloudId: 'protector' },
            ],
        };

        const result1 = runScenario(scenario);
        const result2 = runScenario(scenario);

        const same = JSON.stringify(result1.finalModel) ===
                     JSON.stringify(result2.finalModel);
        test('Deterministic replay - same results', same,
             'models differ between runs');
    }
}

export function runTrivialIFSTests(): { passed: number; failed: number; failures: string[] } {
    runAllTrivialIFSTests();
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const failures = results.filter(r => !r.passed).map(r => r.details ? `${r.name}: ${r.details}` : r.name);
    return { passed, failed, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { passed, failed, failures } = runTrivialIFSTests();
    console.log(`Trivial IFS: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        for (const f of failures) console.log(`  ${f}`);
    }
    process.exit(failed > 0 ? 1 : 0);
}
