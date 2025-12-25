import { HeadlessSimulator } from './headlessSimulator.js';
import type {
    Scenario, ScenarioResult, Assertion, ActionResult,
    RecordedSession, SerializedModel
} from './types.js';

export function runScenario(scenario: Scenario): ScenarioResult {
    const sim = new HeadlessSimulator({ seed: scenario.seed });
    sim.setupFromScenario(scenario);

    const actionResults: ActionResult[] = [];

    for (const action of scenario.actions) {
        const result = sim.executeAction(action.action, action.cloudId, action.targetCloudId, action.field);
        actionResults.push(result);
    }

    const finalModel = sim.getModelJSON();
    const failedAssertions = checkAssertions(scenario.assertions ?? [], finalModel, sim);

    return {
        passed: failedAssertions.length === 0,
        failedAssertions,
        finalModel,
        actionResults,
    };
}

export interface ReplayResult extends ScenarioResult {
    expectedModel?: SerializedModel;
    differences: string[];
}

export function replaySession(session: RecordedSession): ReplayResult {
    const sim = HeadlessSimulator.fromSession(
        session.initialModel,
        session.initialRelationships,
        session.modelSeed
    );

    const actionResults: ActionResult[] = [];
    let firstRngDivergence: string | undefined;
    let prevModelRngCount = 0;
    const stateTrace: string[] = [];

    const model = sim.getModel();
    const relationships = sim.getRelationships();

    for (let i = 0; i < session.actions.length; i++) {
        const action = session.actions[i];
        if (action.elapsedTime && action.elapsedTime > 0) {
            sim.advanceTime(action.elapsedTime);
        }

        const preState = {
            targets: [...model.getTargetCloudIds()],
            blended: model.getBlendedParts(),
            proxies: Object.fromEntries(
                [...model.getTargetCloudIds(), ...model.getBlendedParts()].map(
                    id => [id, [...relationships.getProxies(id)]]
                )
            )
        };

        const result = sim.executeAction(action.action, action.cloudId, action.targetCloudId, action.field);
        actionResults.push(result);

        const postState = {
            targets: [...model.getTargetCloudIds()],
            blended: model.getBlendedParts(),
            proxies: Object.fromEntries(
                [...model.getTargetCloudIds(), ...model.getBlendedParts()].map(
                    id => [id, [...relationships.getProxies(id)]]
                )
            )
        };

        // Trace significant state changes for debugging
        if (JSON.stringify(preState.proxies) !== JSON.stringify(postState.proxies)) {
            stateTrace.push(`#${i} ${action.action}(${action.cloudId}): proxies ${JSON.stringify(preState.proxies)} -> ${JSON.stringify(postState.proxies)}`);
        }
        if (JSON.stringify(preState.targets) !== JSON.stringify(postState.targets) || JSON.stringify(preState.blended) !== JSON.stringify(postState.blended)) {
            stateTrace.push(`#${i}: targets ${JSON.stringify(preState.targets)}->${JSON.stringify(postState.targets)}, blended ${JSON.stringify(preState.blended)}->${JSON.stringify(postState.blended)}`);
        }
        if (action.action === 'who_do_you_see') {
            const selfRay = model.getSelfRay();
            stateTrace.push(`#${i} who_do_you_see: selfRay=${selfRay?.targetCloudId ?? 'none'}, success=${result.success}`);
        }

        if (!firstRngDivergence && action.rngCounts) {
            const actual = sim.getRngCounts();
            if (actual.model !== action.rngCounts.model) {
                const fullLog = sim.getModelRngLog();
                const actionLog = fullLog.slice(prevModelRngCount);
                const expectedLog = action.rngLog ?? [];
                firstRngDivergence = `#${i} ${action.action}(${action.cloudId}): model RNG ${actual.model} vs ${action.rngCounts.model}; log [${actionLog.join(', ')}] vs [${expectedLog.join(', ')}]; state before: targets=${JSON.stringify(preState.targets)}, blended=${JSON.stringify(preState.blended)}, proxies=${JSON.stringify(preState.proxies)}; trace: ${stateTrace.join(' | ')}`;
            }
            prevModelRngCount = actual.model;
        }
    }

    const actualModel = sim.getModelJSON();
    const differences = session.finalModel
        ? compareModels(actualModel, session.finalModel)
        : [];

    if (firstRngDivergence) {
        differences.unshift(firstRngDivergence);
    }

    return {
        passed: differences.length === 0,
        failedAssertions: [],
        finalModel: actualModel,
        expectedModel: session.finalModel,
        actionResults,
        differences,
    };
}

function compareModels(actual: SerializedModel, expected: SerializedModel): string[] {
    const diffs: string[] = [];

    for (const [id, expectedState] of Object.entries(expected.partStates)) {
        const actualState = actual.partStates[id];
        if (!actualState) {
            diffs.push(`partStates: missing ${id}`);
            continue;
        }

        if (Math.abs(actualState.trust - expectedState.trust) > 0.001) {
            diffs.push(`${id}.trust: ${actualState.trust} vs ${expectedState.trust}`);
        }
        if (Math.abs(actualState.needAttention - expectedState.needAttention) > 0.001) {
            diffs.push(`${id}.needAttention: ${actualState.needAttention} vs ${expectedState.needAttention}`);
        }

        const actualBio = actualState.biography as unknown as Record<string, unknown>;
        const expectedBio = expectedState.biography as unknown as Record<string, unknown>;
        for (const field of Object.keys(expectedBio)) {
            if (actualBio[field] !== expectedBio[field]) {
                diffs.push(`${id}.${field}: ${actualBio[field]} vs ${expectedBio[field]}`);
            }
        }
    }

    return diffs;
}

function checkAssertions(
    assertions: Assertion[],
    model: SerializedModel,
    sim: HeadlessSimulator
): { assertion: Assertion; actual: unknown }[] {
    const failures: { assertion: Assertion; actual: unknown }[] = [];

    for (const assertion of assertions) {
        const actual = getAssertionValue(assertion, model, sim);
        const passed = compareValues(actual, assertion.expected, assertion.operator ?? '==');

        if (!passed) {
            failures.push({ assertion, actual });
        }
    }

    return failures;
}

function getAssertionValue(
    assertion: Assertion,
    model: SerializedModel,
    sim: HeadlessSimulator
): unknown {
    const partState = model.partStates[assertion.cloudId];

    switch (assertion.type) {
        case 'trust':
            return partState?.trust ?? 0;

        case 'blended':
            return assertion.cloudId in model.blendedParts;

        case 'target':
            return model.targetCloudIds.includes(assertion.cloudId);

        case 'message':
            return model.messages.some(m =>
                m.senderId === assertion.cloudId || m.targetId === assertion.cloudId
            );

        case 'biography':
            if (!partState || !assertion.field) return undefined;
            return (partState.biography as unknown as Record<string, unknown>)[assertion.field];

        default:
            return undefined;
    }
}

function compareValues(actual: unknown, expected: unknown, operator: string): boolean {
    switch (operator) {
        case '==':
            return actual === expected;
        case '!=':
            return actual !== expected;
        case '>=':
            return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
        case '<=':
            return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
        case 'contains':
            if (Array.isArray(actual)) {
                return actual.includes(expected);
            }
            if (typeof actual === 'string' && typeof expected === 'string') {
                return actual.includes(expected);
            }
            return false;
        default:
            return actual === expected;
    }
}

export function formatScenarioResult(result: ScenarioResult): string {
    const lines: string[] = [];

    lines.push(result.passed ? 'PASSED' : 'FAILED');
    lines.push('');

    if (result.failedAssertions.length > 0) {
        lines.push('Failed assertions:');
        for (const { assertion, actual } of result.failedAssertions) {
            lines.push(`  ${assertion.type} ${assertion.cloudId}: expected ${JSON.stringify(assertion.expected)}, got ${JSON.stringify(actual)}`);
        }
        lines.push('');
    }

    lines.push('Actions:');
    for (const action of result.actionResults) {
        const status = action.success ? 'OK' : 'FAIL';
        lines.push(`  [${status}] ${action.message ?? action.stateChanges?.join(', ') ?? ''}`);
    }

    return lines.join('\n');
}
