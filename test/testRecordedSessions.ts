import { readFileSync } from 'fs';
import { replaySession } from '../src/testability/scenarios.js';
import type { RecordedSession } from '../src/testability/types.js';

interface TestResult {
    name: string;
    passed: boolean;
    details: string;
}

let results: TestResult[] = [];

function test(name: string, passed: boolean, details: string = '') {
    results.push({ name, passed, details });
}

function loadSession(path: string): RecordedSession {
    const json = readFileSync(path, 'utf-8');
    return JSON.parse(json);
}

function runAllRecordedSessionTests(): void {
    results = [];

    // Inner Critic session
    {
        const session = loadSession('test/scenarios/innerCriticSession.json');

        test('Session loads', session.version === 1);
        test('Session has parts', Object.keys(session.initialModel.partStates).length === 6);
        test('Session has actions', session.actions.length === 25);

        const result = replaySession(session);

        test('All actions executed', result.actionResults.length === 25);
        test('No failed actions', result.actionResults.every(r => r.success),
             result.actionResults.filter(r => !r.success).map(r => r.message).join(', '));

        if (session.finalModel) {
            test('Replay matches recorded state', result.differences.length === 0,
                 result.differences.slice(0, 5).join('; '));
        } else {
            // No finalModel recorded - check key outcomes manually
            const finalModel = result.finalModel;
            const innerCritic = finalModel.partStates['cloud_1'];
            const criticized = finalModel.partStates['cloud_2'];

            test('Inner Critic identity revealed', innerCritic?.biography?.identityRevealed === true);
            test('Inner Critic consented to help', innerCritic?.biography?.consentedToHelp === true);
            test('Criticized age revealed', criticized?.biography?.ageRevealed === true);
        }
    }
}

export function runRecordedSessionTests(): { passed: number; failed: number; failures: string[] } {
    runAllRecordedSessionTests();
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const failures = results.filter(r => !r.passed).map(r => r.details ? `${r.name}: ${r.details}` : r.name);
    return { passed, failed, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { passed, failed, failures } = runRecordedSessionTests();
    console.log(`Recorded Sessions: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        for (const f of failures) console.log(`  ${f}`);
    }
    process.exit(failed > 0 ? 1 : 0);
}
