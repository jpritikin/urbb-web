import { readFileSync } from 'fs';
import { replaySession } from '../src/testability/scenarios.js';
import type { RecordedSession } from '../src/testability/types.js';

interface TestResult {
    name: string;
    passed: boolean;
    details: string;
    sessionName?: string;
}

interface SessionResult {
    name: string;
    elapsedTime: number;
    passed: number;
    failed: number;
}

interface SessionSpec {
    path: string;
    name: string;
    parts: number;
    actions: number;
}

const SESSIONS: SessionSpec[] = [
    { path: 'test/scenarios/criticWithProxy.json', name: 'Critic with Proxy', parts: 4, actions: 46 },
    { path: 'test/scenarios/protectorBacklash.json', name: 'Protector Backlash', parts: 2, actions: 24 },
];

let results: TestResult[] = [];
let sessionResults: SessionResult[] = [];
let totalElapsedTime = 0;
let currentSessionName = '';

function test(name: string, passed: boolean, details: string = '') {
    results.push({ name, passed, details, sessionName: currentSessionName });
}

function loadSession(path: string): RecordedSession {
    const json = readFileSync(path, 'utf-8');
    return JSON.parse(json);
}

function testSession(spec: SessionSpec): void {
    currentSessionName = spec.name;
    const startCount = results.length;
    const session = loadSession(spec.path);

    test(`${spec.name}: loads`, session.version === 1);
    test(`${spec.name}: has ${spec.parts} parts`, Object.keys(session.initialModel.partStates).length === spec.parts);
    test(`${spec.name}: has ${spec.actions} actions`, session.actions.length === spec.actions);

    const result = replaySession(session);
    const sessionElapsed = session.actions.reduce((sum, a) => sum + (a.elapsedTime ?? 0), 0);
    totalElapsedTime += sessionElapsed;

    test(`${spec.name}: all actions executed`, result.actionResults.length === spec.actions);
    const failedActions = result.actionResults
        .map((r, i) => ({ ...r, index: i, action: session.actions[i] }))
        .filter(r => !r.success);
    test(`${spec.name}: no failed actions`, failedActions.length === 0,
        failedActions.map(r => `#${r.index} ${r.action.action}(${r.action.cloudId}): ${r.message}`).join(', '));

    test(`${spec.name}: has finalModel`, session.finalModel !== undefined);
    test(`${spec.name}: replay matches`, result.differences.length === 0,
        result.differences.slice(0, 5).join('; '));

    const sessionTests = results.slice(startCount);
    sessionResults.push({
        name: spec.name,
        elapsedTime: sessionElapsed,
        passed: sessionTests.filter(r => r.passed).length,
        failed: sessionTests.filter(r => !r.passed).length,
    });
}

function runAllRecordedSessionTests(): void {
    results = [];
    sessionResults = [];
    for (const spec of SESSIONS) {
        testSession(spec);
    }
}

export function runRecordedSessionTests(): { passed: number; failed: number; failures: string[]; elapsedTime: number } {
    totalElapsedTime = 0;
    runAllRecordedSessionTests();
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const failures = results.filter(r => !r.passed).map(r => r.details ? `${r.name}: ${r.details}` : r.name);
    return { passed, failed, failures, elapsedTime: totalElapsedTime };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');
    const { passed, failed, failures, elapsedTime } = runRecordedSessionTests();
    console.log(`Recorded Sessions: ${passed} passed, ${failed} failed (${elapsedTime.toFixed(1)}s recorded)`);
    if (verbose) {
        for (const sr of sessionResults) {
            const status = sr.failed === 0 ? '✓' : '✗';
            console.log(`\n${status} ${sr.name} (${sr.elapsedTime.toFixed(1)}s): ${sr.passed} passed, ${sr.failed} failed`);
            const sessionTests = results.filter(r => r.sessionName === sr.name);
            for (const r of sessionTests) {
                const testStatus = r.passed ? '  ✓' : '  ✗';
                console.log(`${testStatus} ${r.name}${r.details ? `: ${r.details}` : ''}`);
            }
        }
    } else if (failures.length > 0) {
        for (const f of failures) console.log(`  ${f}`);
    }
    process.exit(failed > 0 ? 1 : 0);
}
