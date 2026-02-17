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
        session.modelSeed
    );

    const actionResults: ActionResult[] = [];
    const differences: string[] = [];
    let firstRngDivergence: string | undefined;
    const stateTrace: string[] = [];

    const model = sim.getModel();
    const relationships = sim.getRelationships();

    for (let i = 0; i < session.actions.length; i++) {
        const action = session.actions[i];
        const rngBefore = sim.getRngCount();

        // Handle process_intervals action
        if (action.action === 'process_intervals') {
            const count = action.count ?? 0;
            if (count > 0) {
                sim.advanceIntervals(count);
            }
            if (action.rngCounts) {
                const actual = sim.getRngCount();
                if (actual !== action.rngCounts.model) {
                    stateTrace.push(`#${i} process_intervals RNG mismatch: ${actual} vs ${action.rngCounts.model}`);
                }
            }
            actionResults.push({ success: true, stateChanges: [`processed ${count} intervals`] });
            continue;
        }

        // Use previous non-interval action's modelState to set view state for orchestrator
        let prevModelState: typeof action.modelState;
        for (let j = i - 1; j >= 0; j--) {
            if (session.actions[j].action !== 'process_intervals' && session.actions[j].modelState) {
                prevModelState = session.actions[j].modelState;
                break;
            }
        }
        if (prevModelState) {
            const cloudStates: Record<string, unknown> = {};
            for (const id of [...prevModelState.targets, ...prevModelState.blended]) {
                cloudStates[id] = {};
            }
            sim.setViewState({ cloudStates });
        }

        // Apply mode change
        if (action.action === 'mode_change' && action.newMode) {
            sim.setMode(action.newMode);
        }

        const preState = {
            targets: [...model.getTargetCloudIds()],
            blended: model.getBlendedParts(),
        };

        const result = sim.executeAction(action.action, action.cloudId, action.targetCloudId, action.field, action.newMode, action.stanceDelta);
        actionResults.push(result);

        const postState = {
            targets: [...model.getTargetCloudIds()],
            blended: model.getBlendedParts(),
        };

        // Check recorded model state matches headless model state (recorded after action)
        if (action.modelState) {
            const actualTargets = postState.targets;
            const actualBlended = postState.blended;
            const expectedTargets = action.modelState.targets;
            const expectedBlended = action.modelState.blended;
            if (JSON.stringify(actualTargets.sort()) !== JSON.stringify(expectedTargets.sort())) {
                differences.push(`#${i} targets: ${JSON.stringify(actualTargets)} vs ${JSON.stringify(expectedTargets)}`);
            }
            if (JSON.stringify(actualBlended.sort()) !== JSON.stringify(expectedBlended.sort())) {
                differences.push(`#${i} blended: ${JSON.stringify(actualBlended)} vs ${JSON.stringify(expectedBlended)}`);
            }
            if (action.modelState.needAttention) {
                for (const [cloudId, expected] of Object.entries(action.modelState.needAttention)) {
                    const actual = model.parts.getNeedAttention(cloudId);
                    if (Math.abs(actual - expected) > 0.01) {
                        differences.push(`#${i} ${cloudId}.needAttention: ${actual.toFixed(3)} vs ${expected.toFixed(3)}`);
                    }
                }
            }
            if (action.modelState.trust) {
                for (const [cloudId, expected] of Object.entries(action.modelState.trust)) {
                    const actual = model.parts.getTrust(cloudId);
                    if (Math.abs(actual - expected) > 0.001) {
                        differences.push(`#${i} ${cloudId}.trust: ${actual.toFixed(3)} vs ${expected.toFixed(3)}`);
                    }
                }
            }
        }

        // Trace significant state changes for debugging
        if (JSON.stringify(preState.targets) !== JSON.stringify(postState.targets) || JSON.stringify(preState.blended) !== JSON.stringify(postState.blended)) {
            stateTrace.push(`#${i}: targets ${JSON.stringify(preState.targets)}->${JSON.stringify(postState.targets)}, blended ${JSON.stringify(preState.blended)}->${JSON.stringify(postState.blended)}`);
        }
        if (action.action === 'who_do_you_see') {
            const selfRay = model.getSelfRay();
            stateTrace.push(`#${i} who_do_you_see: selfRay=${selfRay?.targetCloudId ?? 'none'}, success=${result.success}`);
        }

        if (!firstRngDivergence && action.rngCounts) {
            const actual = sim.getRngCount();
            if (actual !== action.rngCounts.model) {
                firstRngDivergence = `#${i} ${action.action}(${action.cloudId}): model RNG ${actual} vs ${action.rngCounts.model}; trace: ${stateTrace.join(' | ')}`;
            }
        }
    }

    const actualModel = sim.getModelJSON();
    if (session.finalModel) {
        differences.push(...compareModels(actualModel, session.finalModel));
    }

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
        if (Math.abs(actualState.needAttention - expectedState.needAttention) > 0.01) {
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

    if ((actual.victoryAchieved ?? false) !== (expected.victoryAchieved ?? false)) {
        diffs.push(`victoryAchieved: ${actual.victoryAchieved} vs ${expected.victoryAchieved}`);
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
    switch (assertion.type) {
        case 'victory':
            return model.victoryAchieved ?? false;

        case 'trust': {
            if (!assertion.cloudId) return undefined;
            const partState = model.partStates[assertion.cloudId];
            return partState?.trust ?? 0;
        }

        case 'blended':
            return assertion.cloudId ? assertion.cloudId in model.blendedParts : undefined;

        case 'target':
            return assertion.cloudId ? model.targetCloudIds.includes(assertion.cloudId) : undefined;

        case 'message':
            return assertion.cloudId ? model.messages.some(m =>
                m.senderId === assertion.cloudId || m.targetId === assertion.cloudId
            ) : undefined;

        case 'biography': {
            if (!assertion.cloudId || !assertion.field) return undefined;
            const partState = model.partStates[assertion.cloudId];
            if (!partState) return undefined;
            return (partState.biography as unknown as Record<string, unknown>)[assertion.field];
        }

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
