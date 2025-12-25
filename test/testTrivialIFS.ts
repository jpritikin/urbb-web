import { HeadlessSimulator } from '../src/testability/headlessSimulator.js';
import { runScenario, replaySession } from '../src/testability/scenarios.js';
import type { Scenario, RecordedSession, SerializedModel } from '../src/testability/types.js';

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

    // Basic part registration
    {
        const sim = new HeadlessSimulator({ seed: 12345 });
        sim.setupParts([
            { id: 'protector', name: 'Protector', trust: 0.8 },
            { id: 'exile', name: 'Exile', trust: 0.3 },
        ]);

        const model = sim.getModel();
        test('Part registration - protector trust', model.getTrust('protector') === 0.8,
             `expected 0.8 got ${model.getTrust('protector')}`);
        test('Part registration - exile trust', model.getTrust('exile') === 0.3,
             `expected 0.3 got ${model.getTrust('exile')}`);
    }

    // Relationship setup
    {
        const sim = new HeadlessSimulator({ seed: 12345 });
        sim.setupParts([
            { id: 'protector', name: 'Protector' },
            { id: 'exile', name: 'Exile' },
        ]);
        sim.setupRelationships({
            protections: [{ protectorId: 'protector', protectedId: 'exile' }],
        });

        const rel = sim.getRelationships();
        const protecting = rel.getProtecting('protector');
        test('Relationship - protector protects exile', protecting.has('exile'),
             `expected exile in protecting set`);
    }

    // Join conference action
    {
        const sim = new HeadlessSimulator({ seed: 12345 });
        sim.setupParts([{ id: 'part1', name: 'Part One' }]);

        const result = sim.executeAction('join_conference', 'part1');
        test('Join conference - success', result.success === true);

        const targetIds = sim.getModel().getTargetCloudIds();
        test('Join conference - part is target', targetIds.has('part1'),
             `expected part1 in targets`);
    }

    // Blend action
    {
        const sim = new HeadlessSimulator({ seed: 12345 });
        sim.setupParts([{ id: 'part1', name: 'Part One' }]);

        sim.executeAction('blend', 'part1');
        const blendedAfterBlend = sim.getModel().getBlendedParts();
        test('Blend - part is blended', blendedAfterBlend.includes('part1'));
    }

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

    // Time advancement increases grievance needAttention
    {
        const sim = new HeadlessSimulator({ seed: 12345 });
        sim.setupParts([
            { id: 'aggrieved', name: 'Aggrieved', needAttention: 0.1 },
            { id: 'target', name: 'Target' },
        ]);
        sim.setupRelationships({
            grievances: [{ cloudId: 'aggrieved', targetIds: 'target', dialogues: 'I hate target' }],
        });

        const initialNeed = sim.getModel().getNeedAttention('aggrieved');
        sim.advanceTime(10); // 10 seconds
        const afterNeed = sim.getModel().getNeedAttention('aggrieved');

        test('Time advance - needAttention increases', afterNeed > initialNeed,
             `expected ${afterNeed} > ${initialNeed}`);

        const expectedIncrease = 10 * 0.05;
        const actualIncrease = afterNeed - initialNeed;
        test('Time advance - correct rate', Math.abs(actualIncrease - expectedIncrease) < 0.001,
             `expected ~${expectedIncrease} increase, got ${actualIncrease}`);
    }

    // Session replay with elapsed time
    {
        const session: RecordedSession = {
            version: 1,
            modelSeed: 12345,
            timestamp: Date.now(),
            initialModel: {
                targetCloudIds: [],
                supportingParts: {},
                blendedParts: {},
                pendingBlends: [],
                selfRay: null,
                displacedParts: [],
                pendingAttentionDemand: null,
                messages: [],
                messageIdCounter: 0,
                partStates: {
                    'part1': {
                        trust: 0.5,
                        needAttention: 0,
                        partAge: 'unknown',
                        biography: { name: { revealed: true, value: 'Part One' } },
                        dialogues: { job: [], unburdened: [], blended: [], generic: [] },
                    },
                },
            },
            initialRelationships: {
                protections: [],
                grievances: [],
                proxies: [],
            },
            actions: [
                { action: 'join_conference', cloudId: 'part1', elapsedTime: 0 },
                { action: 'blend', cloudId: 'part1', elapsedTime: 2.5 },
            ],
        };

        const result = replaySession(session);
        test('Replay - success', result.passed === true);
        test('Replay - action count', result.actionResults.length === 2,
             `expected 2 actions, got ${result.actionResults.length}`);
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

        const stripTimestamps = (m: SerializedModel) => {
            const copy = JSON.parse(JSON.stringify(m));
            for (const ps of Object.values(copy.partStates)) {
                delete (ps as Record<string, unknown>).agreedWaitUntil;
            }
            return copy;
        };

        const same = JSON.stringify(stripTimestamps(result1.finalModel)) ===
                     JSON.stringify(stripTimestamps(result2.finalModel));
        test('Deterministic replay - same results', same,
             'models differ between runs');
    }

    // Serialization round-trip
    {
        const sim = new HeadlessSimulator({ seed: 12345 });
        sim.setupParts([
            { id: 'part1', name: 'Part One', trust: 0.7 },
            { id: 'part2', name: 'Part Two', trust: 0.5 },
        ]);
        sim.executeAction('join_conference', 'part1');
        sim.executeAction('join_conference', 'part2');
        sim.executeAction('blend', 'part1');

        const json = sim.getModelJSON();
        test('Serialization - targetCloudIds', json.targetCloudIds.includes('part2'),
             `targets: ${json.targetCloudIds.join(', ')}`);
        test('Serialization - blendedParts', 'part1' in json.blendedParts);
        test('Serialization - partStates', 'part1' in json.partStates && 'part2' in json.partStates);
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
