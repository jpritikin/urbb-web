import { HeadlessSimulator } from './headlessSimulator.js';
import { SimulatorController, ValidAction, ALL_RAY_FIELDS } from '../../simulator/simulatorController.js';
import { ALL_ACTION_IDS } from '../../simulator/therapistActions.js';
import { createModelRNG } from './rng.js';
import type { RNG } from './rng.js';
import {
    WAIT_DURATION,
    type Scenario, type MonteCarloConfig, type MonteCarloResults,
    type IterationResult, type Distribution, type MetricDefinition, type SerializedModel,
    type RandomWalkConfig, type RandomWalkResult, type RandomWalkResults,
    type CoverageData, type CoverageEntry, type WalkPath, type CoverageGap,
    type HeuristicState, type RecordedWalkAction
} from './types.js';

const WAIT_ACTION: ValidAction = { action: 'wait', cloudId: '' };

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
        const paths: WalkPath[] = [];
        let victories = 0;
        let bestScore = -Infinity;
        const startTime = performance.now();

        if (config.coverageTracking) {
            this.coverage = this.createEmptyCoverage();
            this.actionsEverValid.clear();
        }

        for (let i = 0; i < config.iterations; i++) {
            const seed = config.seed ?? (Date.now() + i * 1000 + Math.floor(Math.random() * 1000));
            const result = this.runIteration(scenario, seed, config);

            if (result.victory) victories++;

            if (config.extractPaths) {
                paths.push({
                    seed: result.seed,
                    actions: result.actions,
                    length: result.actions.length,
                    finalScore: this.computeScore(result.finalModel),
                    victory: result.victory,
                });
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

        paths.sort((a, b) => a.length - b.length);

        const coverageGaps = config.coverageTracking ? this.computeCoverageGaps() : undefined;

        return {
            iterations: config.iterations,
            completedIterations: config.iterations,
            victories,
            errors,
            coverage: config.coverageTracking ? this.coverage : undefined,
            coverageGaps,
            paths: config.extractPaths ? paths : undefined,
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
        const actions: RecordedWalkAction[] = [];

        try {
            sim.setupFromScenario(scenario);

            const rng = createModelRNG(seed);
            const controller = new SimulatorController({
                getModel: () => sim.getModel(),
                getRelationships: () => sim.getRelationships(),
                rng,
                getPartName: (id) => sim.getModel().parts.getPartName(id),
                getTime: () => sim.getTime(),
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

                // Assign random stanceDelta for nudge_stance actions
                for (const a of validActions) {
                    if (a.action === 'nudge_stance') {
                        const sign = rng.random('nudge_sign') < 0.5 ? -1 : 1;
                        a.stanceDelta = sign * (0.2 + rng.random('nudge_magnitude') * 0.3);
                    }
                }

                if (config.coverageTracking) {
                    for (const a of validActions) this.actionsEverValid.add(a.action);
                }

                // Always include wait as an option (for time-based mechanics)
                const actionsWithWait = [...validActions, WAIT_ACTION];

                const filtered = config.allowedActions
                    ? actionsWithWait.filter(a => config.allowedActions!.includes(a.action) || a.action === 'wait')
                    : actionsWithWait;
                if (filtered.length === 0) break;

                let pickedAction: ValidAction;
                let recordedAction: RecordedWalkAction;

                if (config.heuristicScoring) {
                    const result = this.pickActionWithHeuristic(sim, controller, filtered, rng, history);
                    pickedAction = result.action;
                    recordedAction = {
                        action: result.action.action,
                        cloudId: result.action.cloudId,
                        targetCloudId: result.action.targetCloudId,
                        field: result.action.field,
                        stanceDelta: result.action.stanceDelta,
                        ...(config.recordHeuristicState ? { heuristic: result.heuristic, score: result.score } : {}),
                    };
                } else {
                    pickedAction = rng.pickRandom(filtered, 'random_walk');
                    recordedAction = {
                        action: pickedAction.action,
                        cloudId: pickedAction.cloudId,
                        targetCloudId: pickedAction.targetCloudId,
                        field: pickedAction.field,
                        stanceDelta: pickedAction.stanceDelta,
                    };
                }
                actions.push(recordedAction);

                const actionKey = `${pickedAction.action}:${pickedAction.cloudId}`;
                history.actionCounts.set(actionKey, (history.actionCounts.get(actionKey) ?? 0) + 1);
                history.lastAction = pickedAction;

                if (pickedAction.action === 'wait') {
                    sim.advanceTime(WAIT_DURATION);
                } else {
                    sim.executeAction(pickedAction.action, pickedAction.cloudId, pickedAction.targetCloudId, pickedAction.field, undefined, pickedAction.stanceDelta);
                }

                if (config.coverageTracking) {
                    this.recordCoverage(pickedAction, prevStateKey, sim, seed);
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

    private determinePhase(
        model: ReturnType<HeadlessSimulator['getModel']>,
        relationships: ReturnType<HeadlessSimulator['getRelationships']>,
    ): { phase: 'summon' | 'clear_proxies' | 'clear_blended' | 'get_consent' | 'build_trust' | 'victory' | 'unburden' | 'all_trust'; protectorId: string | null; protecteeId: string | null; targetPartId?: string } {
        const allPartIds = model.getAllPartIds();
        const blendedParts = model.getBlendedParts();
        const targets = model.getTargetCloudIds();

        // Find protector/protectee pairs that still need work
        for (const partId of allPartIds) {
            const protectedIds = relationships.getProtecting(partId);
            for (const protectedId of protectedIds) {
                const protectorId = partId;
                const protecteeTrust = model.parts.getTrust(protectedId);
                // Phase: Unburden - protectee trust >= 1, protector should notice
                if (protecteeTrust >= 1) {
                    return { phase: 'unburden', protectorId, protecteeId: protectedId };
                }

                // Check if protectee is accessible (in conference)
                const supporting = model.getAllSupportingParts();
                const protecteeAccessible = targets.has(protectedId) || supporting.has(protectedId);

                // Phase: Summon - need to get protectee into conference
                if (!protecteeAccessible) {
                    return { phase: 'summon', protectorId, protecteeId: protectedId };
                }

                // Check if protectee has proxies blocking trust building
                const proxies = relationships.getProxies(protectedId);
                if (proxies.size > 0) {
                    return { phase: 'clear_proxies', protectorId, protecteeId: protectedId };
                }

                // Phase: Clear blended - need to unblend parts so feel_toward creates self-ray
                if (blendedParts.length > 0) {
                    return { phase: 'clear_blended', protectorId, protecteeId: protectedId };
                }

                // Phase: Get consent - need protector consent to avoid backlash
                if (!model.parts.hasConsentedToHelp(protectorId)) {
                    return { phase: 'get_consent', protectorId, protecteeId: protectedId };
                }

                // Phase: Build trust on protectee
                return { phase: 'build_trust', protectorId, protecteeId: protectedId };
            }
        }

        // All protector/protectee pairs done, check if any part needs more trust for victory
        for (const partId of allPartIds) {
            const trust = model.parts.getTrust(partId);
            if (trust <= 0.9) {
                return { phase: 'all_trust', protectorId: null, protecteeId: null, targetPartId: partId };
            }
        }

        // Victory should be achieved - all parts have high trust
        return { phase: 'victory', protectorId: null, protecteeId: null };
    }

    private pickActionWithHeuristic(
        sim: HeadlessSimulator,
        _controller: SimulatorController,
        actions: ValidAction[],
        rng: RNG,
        history: ActionHistory,
    ): { action: ValidAction; heuristic: HeuristicState; score: number } {
        const model = sim.getModel();
        const relationships = sim.getRelationships();
        const phaseInfo = this.determinePhase(model, relationships);
        const { phase, protectorId, protecteeId, targetPartId } = phaseInfo;
        const blendedParts = model.getBlendedParts();

        const heuristic: HeuristicState = {
            phase,
            protectorId,
            protecteeId,
        };

        // 10% chance to pick randomly for exploration
        if (rng.random('explore_random') < 0.1) {
            const action = rng.pickRandom(actions, 'random_action');
            return { action, heuristic, score: 0 };
        }

        const targets = model.getTargetCloudIds();
        const selfRay = model.getSelfRay();

        const scored: { action: ValidAction; score: number }[] = [];

        for (const action of actions) {
            let score = 0;
            const actionKey = `${action.action}:${action.cloudId}`;
            const timesUsed = history.actionCounts.get(actionKey) ?? 0;

            // Light repetition penalty
            if (timesUsed > 3) score -= timesUsed;

            // Exploration bonus for uncovered ray fields
            if (action.action === 'ray_field_select' && action.field && !this.coverage.rayFields[action.field]) {
                score += 10;
            }

            // Recovery: no targets
            if (targets.size === 0 && blendedParts.length === 0) {
                if (action.action === 'select_a_target' || action.action === 'join_conference') score += 20;
            }

            // Penalize blending protector
            if ((action.action === 'blend' || action.action === 'step_back') && action.cloudId === protectorId) {
                score -= 100;
            }

            // Phase-specific scoring
            if (phase === 'victory') {
                // Take victory immediately
                if (action.action === 'notice_part' && action.targetCloudId === protecteeId) {
                    score += 100;
                }
            }

            else if (phase === 'summon') {
                // Need to summon protectee via job on protector
                if (action.action === 'job' && action.cloudId === protectorId) {
                    score += 30;
                }
                // Get protector targeted if not already
                if (action.action === 'select_a_target' && action.cloudId === protectorId) {
                    score += 25;
                }
                if (action.action === 'join_conference' && action.cloudId === protectorId) {
                    score += 25;
                }
            }

            else if (phase === 'clear_proxies') {
                // Strategy: get proxy into targets, unblend everything, create ray, clear proxy
                const proxies = relationships.getProxies(protecteeId!);
                const proxyInTargets = Array.from(proxies).some(p => targets.has(p) || blendedParts.includes(p));
                const hasSelfRayOnProtectee = selfRay?.targetCloudId === protecteeId;

                if (!proxyInTargets) {
                    // Step 1: Get proxy blended via who_do_you_see on protectee
                    if (action.action === 'who_do_you_see' && action.cloudId === protecteeId) {
                        score += 25;
                    }
                    if (action.action === 'join_conference' && action.cloudId === protecteeId) {
                        score += 20;
                    }
                    if (action.action === 'select_a_target' && action.cloudId === protecteeId) {
                        score += 20;
                    }
                } else if (blendedParts.length > 0) {
                    // Step 2: Unblend everything first (feel_toward won't create ray while things are blended)
                    if (action.action === 'separate') {
                        score += 35;  // Highest priority - must unblend
                    }
                    if (action.action === 'step_back' && blendedParts.includes(action.cloudId)) {
                        score += 30;
                    }
                } else if (!hasSelfRayOnProtectee) {
                    // Step 3: Create self-ray on protectee (now that nothing is blended)
                    if (action.action === 'feel_toward' && action.cloudId === protecteeId) {
                        score += 30;
                    }
                    if (!targets.has(protecteeId!)) {
                        if (action.action === 'join_conference' && action.cloudId === protecteeId) {
                            score += 25;
                        }
                    }
                } else {
                    // Step 4: Use who_do_you_see to clear proxies (95% chance with ray)
                    if (action.action === 'who_do_you_see' && action.cloudId === protecteeId) {
                        score += 35;
                    }
                }
            }

            else if (phase === 'clear_blended') {
                // Need to unblend all parts before feel_toward will create self-ray
                if (action.action === 'separate') {
                    score += 30;
                }
                // step_back on blended parts also removes them
                if (action.action === 'step_back' && blendedParts.includes(action.cloudId)) {
                    score += 25;
                }
            }

            else if (phase === 'get_consent') {
                // Need protector consent before building protectee trust to avoid backlash
                // help_protected requires protector to be targeted with identity revealed
                const protectorTargeted = targets.has(protectorId!);
                const protectorIdentityRevealed = model.parts.isIdentityRevealed(protectorId!);

                if (!protectorTargeted) {
                    if (action.action === 'join_conference' && action.cloudId === protectorId) {
                        score += 30;
                    }
                    if (action.action === 'select_a_target' && action.cloudId === protectorId) {
                        score += 30;
                    }
                } else if (!protectorIdentityRevealed) {
                    // Need to reveal identity first via job
                    if (action.action === 'job' && action.cloudId === protectorId) {
                        score += 35;
                    }
                } else {
                    // Ask for consent
                    if (action.action === 'help_protected' && action.cloudId === protectorId) {
                        score += 40;
                    }
                    // Also build protector trust to increase consent chance
                    if (action.action === 'feel_toward' && action.cloudId === protectorId && !selfRay) {
                        score += 25;
                    }
                    if (action.action === 'ray_field_select' && action.cloudId === protectorId) {
                        if (action.field === 'gratitude') score += 30;  // Protectors respond to gratitude
                        else score += 20;
                    }
                }
            }

            else if (phase === 'build_trust') {
                // Build trust via ray fields on protectee
                const hasSelfRayOnProtectee = selfRay?.targetCloudId === protecteeId;
                const protecteeTargeted = targets.has(protecteeId!);

                // Prevent losing focus - don't blend/step_back protectee
                if ((action.action === 'blend' || action.action === 'step_back') && action.cloudId === protecteeId) {
                    score -= 50;
                }

                if (!protecteeTargeted) {
                    // Need protectee as target
                    if (action.action === 'join_conference' && action.cloudId === protecteeId) {
                        score += 30;
                    }
                    if (action.action === 'select_a_target' && action.cloudId === protecteeId) {
                        score += 30;
                    }
                } else if (!hasSelfRayOnProtectee) {
                    // Need self-ray on protectee
                    if (action.action === 'feel_toward' && action.cloudId === protecteeId) {
                        score += 35;
                    }
                } else {
                    // Have ray, use trust-building fields
                    if (action.action === 'ray_field_select' && action.cloudId === protecteeId) {
                        const openness = model.parts.getOpenness(protecteeId!);

                        // Prioritize building openness first
                        if (action.field === 'age' && !model.parts.isFieldRevealed(protecteeId!, 'age')) {
                            score += 40;  // +0.5 openness
                        } else if (action.field === 'identity' && !model.parts.isIdentityRevealed(protecteeId!)) {
                            score += 35;  // +0.2 openness
                        }
                        // Then trust-building fields (scale with openness)
                        else if (action.field === 'compassion') {
                            score += 25 + openness * 10;
                        } else if (action.field === 'gratitude') {
                            score += 20 + openness * 10;
                        } else {
                            score += 15;
                        }
                    }
                }

                // Reduce targets to maximize trust gain (trustGain = openness / targetCount)
                if (action.action === 'step_back' && targets.size > 1 && action.cloudId !== protecteeId && action.cloudId !== protectorId) {
                    score += 15;
                }
            }

            else if (phase === 'unburden') {
                // Need to use notice_part on the protector to unburden it
                if (action.action === 'notice_part' && action.cloudId === protectorId && action.targetCloudId === protecteeId) {
                    score += 50;
                }
                // Ensure protector is targeted
                if (!targets.has(protectorId!)) {
                    if (action.action === 'join_conference' && action.cloudId === protectorId) {
                        score += 35;
                    }
                    if (action.action === 'select_a_target' && action.cloudId === protectorId) {
                        score += 35;
                    }
                }
            }

            else if (phase === 'all_trust') {
                // Build trust on remaining parts for victory
                const partId = targetPartId!;
                const partTargeted = targets.has(partId);
                const hasSelfRayOnPart = selfRay?.targetCloudId === partId;
                const proxies = relationships.getProxies(partId);
                const proxyInTargets = Array.from(proxies).some(p => targets.has(p) || blendedParts.includes(p));

                // Don't blend or step_back the target part
                if ((action.action === 'blend' || action.action === 'step_back') && action.cloudId === partId) {
                    score -= 100;
                }

                // First: ensure part is targeted
                if (!partTargeted) {
                    if (action.action === 'join_conference' && action.cloudId === partId) {
                        score += 40;
                    }
                    if (action.action === 'select_a_target' && action.cloudId === partId) {
                        score += 40;
                    }
                }
                // Then: handle proxies (similar to clear_proxies phase)
                else if (proxies.size > 0) {
                    if (!proxyInTargets) {
                        // Get proxy blended via who_do_you_see
                        if (action.action === 'who_do_you_see' && action.cloudId === partId) {
                            score += 35;
                        }
                    } else if (blendedParts.length > 0) {
                        // Unblend before creating ray
                        if (action.action === 'separate') score += 35;
                    } else if (!hasSelfRayOnPart) {
                        // Create ray on part
                        if (action.action === 'feel_toward' && action.cloudId === partId) {
                            score += 40;
                        }
                    } else {
                        // Clear proxies with ray
                        if (action.action === 'who_do_you_see' && action.cloudId === partId) {
                            score += 45;
                        }
                    }
                }
                // Then: clear any blended parts
                else if (blendedParts.length > 0) {
                    if (action.action === 'separate') score += 35;
                }
                // Then: create ray if needed
                else if (!hasSelfRayOnPart) {
                    if (action.action === 'feel_toward' && action.cloudId === partId) {
                        score += 40;
                    }
                }
                // Finally: use ray fields to build trust
                else {
                    if (action.action === 'ray_field_select' && action.cloudId === partId) {
                        const isProtector = relationships.getProtecting(partId).size > 0;
                        const ageRevealed = model.parts.isFieldRevealed(partId, 'age');
                        const identityRevealed = model.parts.isIdentityRevealed(partId);

                        // Build openness first (age, identity)
                        if (action.field === 'age' && !ageRevealed) {
                            score += 45;  // +0.5 openness, +0.05 trust
                        } else if (action.field === 'identity' && !identityRevealed) {
                            score += 40;  // +0.2 openness, +0.05 trust
                        }
                        // Use appropriate trust builder based on protector status
                        else if (isProtector) {
                            if (action.field === 'gratitude') score += 40;  // Works for protectors
                        } else {
                            // Non-protectors: compassion works, gratitude hurts
                            if (action.field === 'compassion') score += 45;
                            else if (action.field === 'gratitude') score -= 30;  // Avoid - hurts trust
                        }
                    }
                }
            }

            // Conversation awareness: boost actions that reach or use conversation state
            if (model.isConversationInitialized()) {
                if (action.action === 'nudge_stance' && action.stanceDelta !== undefined) {
                    const currentStance = model.getConversationEffectiveStance(action.cloudId);
                    // Prefer delta that brings stance toward 0
                    const movesTowardZero = Math.abs(currentStance + action.stanceDelta) < Math.abs(currentStance);
                    score += movesTowardZero ? 20 : 5;
                }
            } else {
                // Boost clearing blended parts when 2 related targets exist (enables conversation)
                const relatedTargetPairs = this.countRelatedTargetPairs(model, relationships);
                if (relatedTargetPairs > 0 && blendedParts.length > 0) {
                    if (action.action === 'separate') score += 10;
                    if (action.action === 'step_back') score += 8;
                }
                // Boost stepping back extra targets when we have 2+ related ones (conversation needs exactly 2)
                if (relatedTargetPairs > 0 && targets.size > 2) {
                    if (action.action === 'step_back') score += 10;
                }
            }

            // Wait for pending blends
            if (action.action === 'wait' && model.peekPendingBlend() !== null) {
                score += 15;
            }

            scored.push({ action, score });
        }

        // Higher temperature = more exploration, lower = more exploitation
        const temperature = 8.0;
        const maxScore = Math.max(...scored.map(s => s.score));
        const expScores = scored.map(s => ({ action: s.action, exp: Math.exp((s.score - maxScore) / temperature) }));
        const sumExp = expScores.reduce((sum, s) => sum + s.exp, 0);

        const r = rng.random('heuristic_pick') * sumExp;
        let cumulative = 0;
        for (const s of expScores) {
            cumulative += s.exp;
            if (r <= cumulative) {
                const pickedScore = scored.find(x => x.action === s.action)?.score ?? 0;
                return { action: s.action, heuristic, score: pickedScore };
            }
        }
        const lastAction = expScores[expScores.length - 1].action;
        const lastScore = scored.find(x => x.action === lastAction)?.score ?? 0;
        return { action: lastAction, heuristic, score: lastScore };
    }

    private countRelatedTargetPairs(
        model: ReturnType<HeadlessSimulator['getModel']>,
        relationships: ReturnType<HeadlessSimulator['getRelationships']>,
    ): number {
        const targets = [...model.getTargetCloudIds()];
        let count = 0;
        for (let i = 0; i < targets.length; i++) {
            for (let j = i + 1; j < targets.length; j++) {
                if (relationships.hasInterPartRelation(targets[i], targets[j])) count++;
            }
        }
        return count;
    }

    private computeScore(model: SerializedModel): number {
        let score = 0;
        for (const [, part] of Object.entries(model.partStates)) {
            score += part.trust * 10;
            // No longer tracking unburdened flag; protection removal + self-relation trust replace it
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
                    reason: 'Self-ray never pointed at appropriate target',
                    suggestion: 'Use feel_toward to create self-ray, then access fields',
                });
            }
        }

        return gaps;
    }

    private getSuggestionForAction(actionId: string): string {
        switch (actionId) {
            case 'notice_part':
                return 'Any conference part can notice another conference part';
            case 'help_protected':
                return 'Requires target to be a protector with identity revealed';
            case 'join_conference':
                return 'Requires supporting part (summoned via job action)';
            default:
                return 'Check action preconditions in getValidActions()';
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

    if (results.paths && results.paths.length > 0) {
        const victoryPaths = results.paths.filter(p => p.victory);
        if (victoryPaths.length > 0) {
            lines.push(`Victory Paths (${victoryPaths.length} found, showing shortest):`);
            for (const path of victoryPaths.slice(0, 3)) {
                lines.push(`  [${path.length} actions] seed=${path.seed}`);
                lines.push(`    ${path.actions.map(a => a.field ? `${a.action}:${a.field}` : a.action).join(' -> ')}`);
            }
            lines.push('');
        }
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
