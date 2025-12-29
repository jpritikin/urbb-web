import { HeadlessSimulator } from './headlessSimulator.js';
import { SimulatorController, ValidAction, ALL_RAY_FIELDS } from '../simulatorController.js';
import { ALL_ACTION_IDS } from '../therapistActions.js';
import { createDualRNG } from './rng.js';
import type { RNG } from './rng.js';
import type {
    Scenario, MonteCarloConfig, MonteCarloResults,
    IterationResult, Distribution, MetricDefinition, SerializedModel,
    RandomWalkConfig, RandomWalkResult, RandomWalkResults,
    CoverageData, CoverageEntry, VictoryPath, CoverageGap
} from './types.js';

const WAIT_ACTION: ValidAction = { action: 'wait', cloudId: '' };
const WAIT_DURATION = 2.0;  // Seconds to advance per wait action

export class MonteCarloRunner {
    run(config: MonteCarloConfig): MonteCarloResults {
        const results: IterationResult[] = [];
        const startTime = performance.now();

        for (let i = 0; i < config.iterations; i++) {
            const seed = Date.now() + i * 1000 + Math.floor(Math.random() * 1000);
            const result = this.runIteration(config.scenario, seed, config.metrics);
            results.push(result);

            if (config.stopOnError && result.error) {
                break;
            }
        }

        const totalMs = performance.now() - startTime;

        return {
            iterations: results.length,
            distributions: this.computeDistributions(results, config.metrics),
            edgeCases: this.findEdgeCases(results),
            timing: {
                totalMs,
                avgPerIteration: totalMs / results.length,
            },
        };
    }

    private runIteration(
        scenario: Scenario,
        seed: number,
        metrics: MetricDefinition[]
    ): IterationResult {
        const sim = new HeadlessSimulator({ seed });

        try {
            sim.setupFromScenario(scenario);

            for (const action of scenario.actions) {
                sim.executeAction(action.action, action.cloudId, action.targetCloudId);
            }

            const finalModel = sim.getModelJSON();
            const extractedMetrics: Record<string, number | string | boolean> = {};

            for (const metric of metrics) {
                extractedMetrics[metric.name] = metric.extract(finalModel);
            }

            return {
                seed,
                metrics: extractedMetrics,
                finalModel,
            };
        } catch (e) {
            return {
                seed,
                metrics: {},
                finalModel: sim.getModelJSON(),
                error: String(e),
            };
        }
    }

    private computeDistributions(
        results: IterationResult[],
        metrics: MetricDefinition[]
    ): Record<string, Distribution> {
        const distributions: Record<string, Distribution> = {};

        for (const metric of metrics) {
            const values = results
                .map(r => r.metrics[metric.name])
                .filter((v): v is number => typeof v === 'number');

            if (values.length === 0) {
                // Handle boolean metrics
                const boolValues = results
                    .map(r => r.metrics[metric.name])
                    .filter((v): v is boolean => typeof v === 'boolean');

                if (boolValues.length > 0) {
                    const trueCount = boolValues.filter(v => v).length;
                    const rate = trueCount / boolValues.length;
                    distributions[metric.name] = {
                        min: 0,
                        max: 1,
                        mean: rate,
                        median: rate > 0.5 ? 1 : 0,
                        stdDev: Math.sqrt(rate * (1 - rate)),
                        histogram: [
                            { bucket: 'false', count: boolValues.length - trueCount },
                            { bucket: 'true', count: trueCount },
                        ],
                    };
                }
                continue;
            }

            values.sort((a, b) => a - b);

            const sum = values.reduce((a, b) => a + b, 0);
            const mean = sum / values.length;
            const median = values[Math.floor(values.length / 2)];
            const min = values[0];
            const max = values[values.length - 1];

            const squaredDiffs = values.map(v => (v - mean) ** 2);
            const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
            const stdDev = Math.sqrt(variance);

            const histogram = this.computeHistogram(values, 10);

            distributions[metric.name] = { min, max, mean, median, stdDev, histogram };
        }

        return distributions;
    }

    private computeHistogram(
        values: number[],
        bucketCount: number
    ): { bucket: string; count: number }[] {
        if (values.length === 0) return [];

        const min = values[0];
        const max = values[values.length - 1];
        const range = max - min || 1;
        const bucketSize = range / bucketCount;

        const buckets: number[] = new Array(bucketCount).fill(0);

        for (const value of values) {
            const idx = Math.min(
                Math.floor((value - min) / bucketSize),
                bucketCount - 1
            );
            buckets[idx]++;
        }

        return buckets.map((count, i) => ({
            bucket: `${(min + i * bucketSize).toFixed(2)}-${(min + (i + 1) * bucketSize).toFixed(2)}`,
            count,
        }));
    }

    private findEdgeCases(results: IterationResult[]): IterationResult[] {
        const edgeCases: IterationResult[] = [];

        // Include all errors
        for (const result of results) {
            if (result.error) {
                edgeCases.push(result);
            }
        }

        // Include extreme values for each numeric metric
        const numericMetrics = new Set<string>();
        for (const result of results) {
            for (const [key, value] of Object.entries(result.metrics)) {
                if (typeof value === 'number') {
                    numericMetrics.add(key);
                }
            }
        }

        for (const metricName of numericMetrics) {
            const sorted = [...results]
                .filter(r => typeof r.metrics[metricName] === 'number')
                .sort((a, b) =>
                    (a.metrics[metricName] as number) - (b.metrics[metricName] as number)
                );

            if (sorted.length >= 2) {
                // Add min and max if not already included
                if (!edgeCases.includes(sorted[0])) {
                    edgeCases.push(sorted[0]);
                }
                if (!edgeCases.includes(sorted[sorted.length - 1])) {
                    edgeCases.push(sorted[sorted.length - 1]);
                }
            }
        }

        return edgeCases.slice(0, 20); // Limit to 20 edge cases
    }
}

export function formatMonteCarloResults(results: MonteCarloResults): string {
    const lines: string[] = [];

    lines.push(`Monte Carlo Results (${results.iterations} iterations)`);
    lines.push(`Total time: ${results.timing.totalMs.toFixed(0)}ms (${results.timing.avgPerIteration.toFixed(2)}ms/iter)`);
    lines.push('');

    lines.push('Distributions:');
    for (const [name, dist] of Object.entries(results.distributions)) {
        lines.push(`  ${name}:`);
        lines.push(`    mean=${dist.mean.toFixed(3)}, median=${dist.median.toFixed(3)}, stdDev=${dist.stdDev.toFixed(3)}`);
        lines.push(`    range=[${dist.min.toFixed(3)}, ${dist.max.toFixed(3)}]`);
    }
    lines.push('');

    if (results.edgeCases.length > 0) {
        lines.push(`Edge cases (${results.edgeCases.length}):`);
        for (const edge of results.edgeCases.slice(0, 5)) {
            if (edge.error) {
                lines.push(`  [ERROR] seed=${edge.seed}: ${edge.error}`);
            } else {
                const metricStr = Object.entries(edge.metrics)
                    .map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(3) : v}`)
                    .join(', ');
                lines.push(`  seed=${edge.seed}: ${metricStr}`);
            }
        }
    }

    return lines.join('\n');
}

interface ActionHistory {
    actionCounts: Map<string, number>;  // action:cloudId -> count this iteration
    stateVisits: Map<string, number>;   // stateKey -> count this iteration
    lastAction?: ValidAction;
    consecutiveSameState: number;
}

export class RandomWalkRunner {
    private coverage: CoverageData = this.createEmptyCoverage();
    private actionsEverValid: Set<string> = new Set();
    private maxSeedsPerEntry = 3;

    run(scenario: Scenario, config: RandomWalkConfig): RandomWalkResults {
        const errors: RandomWalkResult[] = [];
        const victoryPaths: VictoryPath[] = [];
        let victories = 0;
        let bestScore = -Infinity;
        const startTime = performance.now();

        if (config.coverageTracking) {
            this.coverage = this.createEmptyCoverage();
            this.actionsEverValid.clear();
        }

        for (let i = 0; i < config.iterations; i++) {
            const seed = Date.now() + i * 1000 + Math.floor(Math.random() * 1000);
            const result = this.runIteration(scenario, seed, config);

            if (result.victory) {
                victories++;
                if (config.extractVictoryPaths) {
                    victoryPaths.push({
                        seed: result.seed,
                        actions: result.actions,
                        length: result.actions.length,
                        finalScore: this.computeScore(result.finalModel),
                    });
                }
            }
            if (result.error) {
                errors.push(result);
                if (config.stopOnError) break;
            }
            if (result.victory && config.stopOnVictory) break;

            const score = this.computeScore(result.finalModel);
            if (score > bestScore) bestScore = score;
        }

        const totalMs = performance.now() - startTime;

        victoryPaths.sort((a, b) => a.length - b.length);

        const coverageGaps = config.coverageTracking ? this.computeCoverageGaps() : undefined;

        return {
            iterations: config.iterations,
            completedIterations: config.iterations,
            victories,
            errors,
            coverage: config.coverageTracking ? this.coverage : undefined,
            coverageGaps,
            victoryPaths: config.extractVictoryPaths ? victoryPaths.slice(0, 10) : undefined,
            bestScore: bestScore > -Infinity ? bestScore : undefined,
            timing: {
                totalMs,
                avgPerIteration: totalMs / config.iterations,
            },
        };
    }

    private runIteration(
        scenario: Scenario,
        seed: number,
        config: RandomWalkConfig
    ): RandomWalkResult {
        const sim = new HeadlessSimulator({ seed });
        const actions: ValidAction[] = [];

        try {
            sim.setupFromScenario(scenario);

            const rng = createDualRNG(seed);
            const controller = new SimulatorController({
                model: sim.getModel(),
                relationships: sim.getRelationships(),
                rng,
                getPartName: (id) => sim.getModel().parts.getPartName(id),
            });

            let prevStateKey = this.getStateKey(sim);
            const history: ActionHistory = {
                actionCounts: new Map(),
                stateVisits: new Map(),
                consecutiveSameState: 0,
            };
            history.stateVisits.set(prevStateKey, 1);

            for (let step = 0; step < config.maxActionsPerIteration; step++) {
                const validActions = controller.getValidActions();

                if (config.coverageTracking) {
                    for (const a of validActions) this.actionsEverValid.add(a.action);
                }

                // Always include wait as an option (for time-based mechanics)
                const actionsWithWait = [...validActions, WAIT_ACTION];

                const filtered = config.allowedActions
                    ? actionsWithWait.filter(a => config.allowedActions!.includes(a.action) || a.action === 'wait')
                    : actionsWithWait;
                if (filtered.length === 0) break;

                const action = config.heuristicScoring
                    ? this.pickActionWithHeuristic(sim, controller, filtered, rng.model, history)
                    : rng.model.pickRandom(filtered, 'random_walk');
                actions.push(action);

                const actionKey = `${action.action}:${action.cloudId}`;
                history.actionCounts.set(actionKey, (history.actionCounts.get(actionKey) ?? 0) + 1);
                history.lastAction = action;

                if (action.action === 'wait') {
                    sim.advanceTime(WAIT_DURATION);
                } else {
                    sim.executeAction(action.action, action.cloudId, action.targetCloudId, action.field);
                }

                if (config.coverageTracking) {
                    this.recordCoverage(action, prevStateKey, sim, seed);
                }

                const newStateKey = this.getStateKey(sim);
                if (newStateKey === prevStateKey) {
                    history.consecutiveSameState++;
                } else {
                    history.consecutiveSameState = 0;
                }
                history.stateVisits.set(newStateKey, (history.stateVisits.get(newStateKey) ?? 0) + 1);
                prevStateKey = newStateKey;

                if (sim.getModel().isVictoryAchieved()) {
                    return { seed, actions, finalModel: sim.getModelJSON(), victory: true };
                }
            }

            return { seed, actions, finalModel: sim.getModelJSON(), victory: sim.getModel().isVictoryAchieved() };
        } catch (e) {
            return { seed, actions, finalModel: sim.getModelJSON(), victory: false, error: String(e) };
        }
    }

    private pickActionWithHeuristic(
        sim: HeadlessSimulator,
        _controller: SimulatorController,
        actions: ValidAction[],
        rng: RNG,
        history: ActionHistory
    ): ValidAction {
        const scored: { action: ValidAction; score: number }[] = [];
        const model = sim.getModel();
        const relationships = sim.getRelationships();

        // Analyze the current state to determine what we should work toward
        const targets = model.getTargetCloudIds();
        const blendedParts = model.getBlendedParts();
        const selfRay = model.getSelfRay();
        const allPartIds = model.getAllPartIds();

        // Find protectors and their protectees for goal-directed planning
        const protectorInfo: { protectorId: string; protectedId: string; protectorTrust: number; protectedTrust: number }[] = [];
        for (const partId of allPartIds) {
            const protecting = relationships.getProtecting(partId);
            for (const protectedId of protecting) {
                protectorInfo.push({
                    protectorId: partId,
                    protectedId,
                    protectorTrust: model.parts.getTrust(partId),
                    protectedTrust: model.parts.getTrust(protectedId),
                });
            }
        }

        // Determine current goal priority:
        // 1. If we have a protector in targets with identity revealed, build protectee trust
        // 2. If protector needs identity revealed, use job action
        // 3. If protectee not in conference, need to reveal protector job first
        // 4. Explore new states if stuck

        for (const action of actions) {
            let score = 0;
            const actionKey = `${action.action}:${action.cloudId}`;
            const timesUsed = history.actionCounts.get(actionKey) ?? 0;

            // Heavy penalty for repeating the same action too many times
            if (timesUsed > 0) score -= timesUsed * 2;
            if (timesUsed > 5) score -= 10;

            // Penalty for stuck states - encourage any state change
            if (history.consecutiveSameState > 3) score += 2;

            // Recovery when we have no targets - heavily prioritize getting back into conference
            if (targets.size === 0 && blendedParts.length === 0) {
                if (action.action === 'join_conference') score += 10;
                else if (action.action === 'wait') score -= 5;  // Waiting does nothing here
            }

            if (action.action === 'wait') {
                // Wait is strategic: good after blend when grievances can deliver
                const hasPendingBlend = model.peekPendingBlend() !== null;
                const waitCount = history.actionCounts.get('wait:') ?? 0;
                if (hasPendingBlend) {
                    score += 3;  // Wait for pending blend
                } else if (blendedParts.length > 0 && waitCount < 3) {
                    score += 1;  // Wait a bit for grievance messages, but not too much
                } else {
                    score -= 3;  // No point waiting
                }
            } else if (action.action === 'job') {
                // Job reveals identity and summons protectees - high priority early
                const isJobRevealed = model.parts.isJobRevealed(action.cloudId);
                if (!isJobRevealed) {
                    score += 4;  // Major progression action
                } else {
                    score -= 2;  // Already done
                }
            } else if (action.action === 'join_conference') {
                // Bringing supporting parts into conference enables more interactions
                score += 5;  // High priority - expands our options
            } else if (action.action === 'feel_toward') {
                // Creates self-ray - needed to build trust via ray fields
                const trust = model.parts.getTrust(action.cloudId);
                if (trust < 1) {
                    score += 3;  // Good for building trust
                }
                // Extra bonus for targeting protectees (low-trust parts that need work)
                const isProtectee = protectorInfo.some(p => p.protectedId === action.cloudId);
                if (isProtectee && trust < 0.8) {
                    score += 3;
                }
            } else if (action.action === 'ray_field_select') {
                // Build trust via ray fields - essential for progress
                const trust = model.parts.getTrust(action.cloudId);
                if (trust < 1) {
                    score += 2;
                    // Prefer fields we haven't used on this part
                    const fieldKey = `ray_field_select:${action.cloudId}:${action.field}`;
                    if (!history.actionCounts.has(fieldKey)) score += 2;
                } else {
                    score -= 1;  // Trust already high
                }
            } else if (action.action === 'help_protected') {
                // Only valuable if the protector has high trust (likely to consent)
                const trust = model.parts.getTrust(action.cloudId);
                if (trust >= 0.7) {
                    score += 3;
                } else {
                    score -= 2;  // Will likely refuse
                }
            } else if (action.action === 'notice_part') {
                // Victory condition! But only works if protectee has trust >= 1
                const protectedTrust = action.targetCloudId ? model.parts.getTrust(action.targetCloudId) : 0;
                if (protectedTrust >= 1) {
                    score += 10;  // This is the goal!
                } else {
                    score -= 3;  // Won't work yet
                }
            } else if (action.action === 'who_do_you_see') {
                // Can reveal blended parts or clear proxies - useful for exploration
                if (blendedParts.length > 0) score += 2;
                else score += 1;
            } else if (action.action === 'blend') {
                // Blending can trigger grievances when used strategically
                score += 0;  // Neutral - can be useful but risky
            } else if (action.action === 'separate') {
                // Useful to unblend and try different approaches
                score += 1;
            } else if (action.action === 'step_back') {
                // Stepping back removes parts from conference - only useful strategically
                if (targets.size > 1) {
                    score -= 1;  // Might be useful to focus
                } else {
                    score -= 5;  // Don't lose our only target!
                }
            } else if (action.action === 'select_a_target') {
                // Selecting a target from panorama - essential for recovery and exploration
                if (targets.size === 0 && blendedParts.length === 0) {
                    score += 8;  // Critical when we have nothing going on
                } else {
                    // Prefer targeting parts we need to work on
                    const isProtectee = protectorInfo.some(p => p.protectedId === action.cloudId);
                    const trust = model.parts.getTrust(action.cloudId);
                    if (isProtectee && trust < 1) {
                        score += 3;  // This is a part we need to build trust with
                    } else {
                        score += 1;
                    }
                }
            }

            // Bonus for targeting parts with lower trust (more room for growth)
            if (action.cloudId) {
                const trust = model.parts.getTrust(action.cloudId);
                score += (1 - trust);
            }

            scored.push({ action, score });
        }

        // Softmax selection with temperature (higher = more random exploration)
        const temperature = 1.0;
        const maxScore = Math.max(...scored.map(s => s.score));
        const expScores = scored.map(s => ({ action: s.action, exp: Math.exp((s.score - maxScore) / temperature) }));
        const sumExp = expScores.reduce((sum, s) => sum + s.exp, 0);

        const r = rng.random('heuristic_pick') * sumExp;
        let cumulative = 0;
        for (const s of expScores) {
            cumulative += s.exp;
            if (r <= cumulative) return s.action;
        }
        return expScores[expScores.length - 1].action;
    }

    private computeScore(model: SerializedModel): number {
        let score = 0;
        for (const [, part] of Object.entries(model.partStates)) {
            score += part.trust * 10;
            if (part.biography.unburdened) score += 20;
            score -= part.needAttention;
        }
        if (model.victoryAchieved) score += 100;
        return score;
    }

    private computeCoverageGaps(): CoverageGap[] {
        const gaps: CoverageGap[] = [];

        // Check actions never executed
        const allActions = [...ALL_ACTION_IDS, 'ray_field_select'];
        for (const actionId of allActions) {
            if (!this.coverage.actions[actionId]) {
                if (this.actionsEverValid.has(actionId)) {
                    gaps.push({
                        type: 'action_never_picked',
                        action: actionId,
                        reason: 'Action was valid but never randomly selected',
                        suggestion: 'Increase iterations or use heuristic scoring',
                    });
                } else {
                    gaps.push({
                        type: 'action_never_valid',
                        action: actionId,
                        reason: 'Action preconditions were never satisfied',
                        suggestion: this.getSuggestionForAction(actionId),
                    });
                }
            }
        }

        // Check ray fields never accessed
        for (const field of ALL_RAY_FIELDS) {
            if (!this.coverage.rayFields[field]) {
                gaps.push({
                    type: 'precondition_never_met',
                    action: `ray_field_select:${field}`,
                    reason: this.getReasonForMissingField(field),
                    suggestion: 'Use feel_toward to create self-ray, then access fields',
                });
            }
        }

        return gaps;
    }

    private getSuggestionForAction(actionId: string): string {
        switch (actionId) {
            case 'notice_part':
                return 'Requires protector with identity revealed AND protectee with trust >= 1';
            case 'help_protected':
                return 'Requires target to be a protector with identity revealed';
            case 'join_conference':
                return 'Requires supporting part (summoned via job action)';
            default:
                return 'Check action preconditions in getValidActions()';
        }
    }

    private getReasonForMissingField(field: string): string {
        switch (field) {
            case 'apologize':
                return 'Part must be attacked (requires blended part with grievance + wait for message delivery)';
            case 'whatNeedToKnow':
                return 'Part must have identity revealed and not be a protector';
            default:
                return 'Self-ray never pointed at appropriate target';
        }
    }

    private createEmptyCoverage(): CoverageData {
        return { actions: {}, actionCloudPairs: {}, transitions: {}, rayFields: {}, stateVisits: {} };
    }

    private recordCoverage(action: ValidAction, prevStateKey: string, sim: HeadlessSimulator, seed: number): void {
        this.recordEntry(this.coverage.actions, action.action, seed);
        this.recordEntry(this.coverage.actionCloudPairs, `${action.action}:${action.cloudId}`, seed);
        if (action.field) this.recordEntry(this.coverage.rayFields, action.field, seed);
        const newStateKey = this.getStateKey(sim);
        this.recordEntry(this.coverage.transitions, `${prevStateKey}->${newStateKey}`, seed);
        this.recordEntry(this.coverage.stateVisits, newStateKey, seed);
    }

    private recordEntry(record: Record<string, CoverageEntry>, key: string, seed: number): void {
        if (!record[key]) record[key] = { count: 0, seeds: [] };
        record[key].count++;
        if (record[key].seeds.length < this.maxSeedsPerEntry) record[key].seeds.push(seed);
    }

    private getStateKey(sim: HeadlessSimulator): string {
        const model = sim.getModel();
        const targets = [...model.getTargetCloudIds()].sort();
        const blended = model.getBlendedParts().sort();
        const selfRay = model.getSelfRay()?.targetCloudId ?? 'none';
        return `t:[${targets.join(',')}]|b:[${blended.join(',')}]|r:${selfRay}`;
    }
}

export function formatRandomWalkResults(results: RandomWalkResults): string {
    const lines: string[] = [];

    lines.push(`Random Walk Results (${results.completedIterations}/${results.iterations} iterations)`);
    lines.push(`Time: ${results.timing.totalMs.toFixed(0)}ms (${results.timing.avgPerIteration.toFixed(2)}ms/iter)`);
    lines.push(`Victories: ${results.victories} (${(100 * results.victories / results.completedIterations).toFixed(1)}%)`);
    if (results.bestScore !== undefined) {
        lines.push(`Best score: ${results.bestScore.toFixed(1)}`);
    }
    lines.push(`Errors: ${results.errors.length}`);
    lines.push('');

    if (results.victoryPaths && results.victoryPaths.length > 0) {
        lines.push(`Victory Paths (${results.victoryPaths.length} found, showing shortest):`);
        for (const path of results.victoryPaths.slice(0, 3)) {
            lines.push(`  [${path.length} actions] seed=${path.seed}`);
            lines.push(`    ${path.actions.map(a => a.field ? `${a.action}:${a.field}` : a.action).join(' -> ')}`);
        }
        lines.push('');
    }

    if (results.coverage) {
        lines.push('Coverage:');
        lines.push(`  Actions: ${Object.keys(results.coverage.actions).length}/${ALL_ACTION_IDS.length + 1} types`);
        lines.push(`  Action+Cloud pairs: ${Object.keys(results.coverage.actionCloudPairs).length} unique`);
        lines.push(`  Ray fields: ${Object.keys(results.coverage.rayFields).length}/${ALL_RAY_FIELDS.length} types`);
        lines.push(`  State transitions: ${Object.keys(results.coverage.transitions).length} unique`);
        lines.push(`  States visited: ${Object.keys(results.coverage.stateVisits).length} unique`);
        lines.push('');

        lines.push('  Action counts:');
        const actionCounts = Object.entries(results.coverage.actions)
            .sort((a, b) => b[1].count - a[1].count);
        for (const [action, entry] of actionCounts) {
            lines.push(`    ${action}: ${entry.count}`);
        }
        lines.push('');

        if (Object.keys(results.coverage.rayFields).length > 0) {
            lines.push('  Ray field counts:');
            const fieldCounts = Object.entries(results.coverage.rayFields)
                .sort((a, b) => b[1].count - a[1].count);
            for (const [field, entry] of fieldCounts) {
                lines.push(`    ${field}: ${entry.count}`);
            }
            lines.push('');
        }
    }

    if (results.coverageGaps && results.coverageGaps.length > 0) {
        lines.push(`Coverage Gaps (${results.coverageGaps.length}):`);
        for (const gap of results.coverageGaps) {
            lines.push(`  [${gap.type}] ${gap.action}`);
            lines.push(`    Reason: ${gap.reason}`);
            if (gap.suggestion) lines.push(`    Suggestion: ${gap.suggestion}`);
        }
        lines.push('');
    }

    if (results.errors.length > 0) {
        lines.push('Errors:');
        for (const err of results.errors.slice(0, 5)) {
            lines.push(`  seed=${err.seed}: ${err.error}`);
            lines.push(`    actions: ${err.actions.map(a => a.action).join(' -> ')}`);
        }
    }

    return lines.join('\n');
}
