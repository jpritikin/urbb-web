#!/usr/bin/env npx tsx

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { RandomWalkRunner } from '../src/testability/index.js';
import { HeadlessSimulator } from '../src/testability/headlessSimulator.js';
import { ACTION_OUTCOMES, parseOutcome } from '../src/outcomes.js';
import type { Scenario, RandomWalkConfig, RecordedSession, RecordedAction, WalkPath } from '../src/testability/types.js';

const easyScenario: Scenario = {
    name: 'Easy - Inner Critic',
    parts: [
        {
            id: 'inner-critic',
            name: 'Inner Critic',
            trust: 0.3,
            partAge: 8,
            dialogues: {
                burdenedJobAppraisal: ["I'm exhausted with my job.", "I don't want to criticize, but I have to."],
                burdenedJobImpact: ["I am harsh, but I help avoid critiques from outside."],
                unburdenedJob: "I help you foresee risks.",
            },
        },
        {
            id: 'criticized',
            name: 'criticized one',
            trust: 0.2,
            partAge: 'child',
            dialogues: {
                genericBlendedDialogues: ["Please don't look at me.", "I'm trying to hide.", "Is it safe?"],
            },
        },
    ],
    relationships: {
        protections: [{ protectorId: 'inner-critic', protectedId: 'criticized' }],
        grievances: [{ cloudId: 'inner-critic', targetIds: 'inner-critic', dialogues: ["I'm a terrible person.", "I hate myself."] }],
    },
    initialTargets: ['inner-critic'],
    actions: [],
};

const mediumScenario: Scenario = {
    name: 'Medium - Self Proxies',
    parts: [
        {
            id: 'inner-critic',
            name: 'Inner Critic',
            trust: 0.3,
            partAge: 8,
            dialogues: {
                burdenedJobAppraisal: ["I'm exhausted with my job."],
                burdenedJobImpact: ["I am harsh, but I help avoid critiques from outside."],
                unburdenedJob: "I help you foresee risks.",
            },
        },
        {
            id: 'criticized',
            name: 'criticized one',
            trust: 0.2,
            partAge: 'child',
            dialogues: {
                genericBlendedDialogues: ["Please don't look at me.", "I'm trying to hide."],
            },
        },
        {
            id: 'toddler',
            name: 'toddler',
            trust: 0.5,
            partAge: 3,
            dialogues: {
                genericBlendedDialogues: ["Play with me!", "I want attention!", "Why?"],
            },
        },
        {
            id: 'self-image',
            name: 'self-image',
            trust: 0.5,
            partAge: 'adult',
            dialogues: {
                genericBlendedDialogues: ["I need to maintain appearances.", "What will people think?"],
            },
        },
    ],
    relationships: {
        protections: [{ protectorId: 'inner-critic', protectedId: 'criticized' }],
        grievances: [
            { cloudId: 'inner-critic', targetIds: 'inner-critic', dialogues: ["I'm a terrible person."] },
            { cloudId: 'inner-critic', targetIds: 'toddler', dialogues: ["You got us criticized.", "Don't do anything risky."] },
        ],
        proxies: [
            { cloudId: 'inner-critic', proxyId: 'self-image' },
            { cloudId: 'criticized', proxyId: 'self-image' },
            { cloudId: 'toddler', proxyId: 'self-image' },
        ],
    },
    initialTargets: ['inner-critic'],
    actions: [],
};

type Mode = 'generate' | 'coverage' | 'report' | 'debug';

interface Args {
    mode: Mode;
    scenario: 'easy' | 'medium';
    iterations: number;
    maxActions: number;
    verbose: boolean;
    heuristic: boolean;
    seed?: number;
}

function parseArgs(): Args | null {
    const args = process.argv.slice(2);
    let mode: Mode | undefined;
    let scenario: 'easy' | 'medium' = 'easy';
    let iterations = 100;
    let maxActions = 50;
    let verbose = false;
    let heuristic = true;
    let seed: number | undefined;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === 'generate' || arg === 'coverage' || arg === 'report' || arg === 'debug') {
            mode = arg;
        } else if (arg === '--scenario' || arg === '-s') {
            const val = args[++i];
            if (val === 'easy' || val === 'medium') scenario = val;
        } else if (arg === '--iterations' || arg === '-n') {
            iterations = parseInt(args[++i], 10);
        } else if (arg === '--max-actions' || arg === '-m') {
            maxActions = parseInt(args[++i], 10);
        } else if (arg === '--seed') {
            seed = parseInt(args[++i], 10);
        } else if (arg === '--verbose' || arg === '-v') {
            verbose = true;
        } else if (arg === '--heuristic' || arg === '-H') {
            heuristic = true;
        } else if (arg === '--no-heuristic') {
            heuristic = false;
        } else if (arg === '--help' || arg === '-h') {
            return null;
        }
    }

    if (!mode) return null;
    return { mode, scenario, iterations, maxActions, verbose, heuristic, seed };
}

function showHelp(): void {
    console.log(`Usage: npx tsx scripts/generate-scenarios.ts <mode> [options]

Modes:
  generate  Generate a scenario that increases coverage, add to test/scenarios
  coverage  Show detailed coverage analysis (Monte Carlo)
  report    Show coverage report for existing test/scenarios/*.json

Options:
  -s, --scenario <easy|medium>  Scenario to run (default: easy)
  -n, --iterations <number>     Number of iterations (default: 100)
  -m, --max-actions <number>    Max actions per iteration (default: 50)
  -H, --heuristic               Use heuristic scoring (default: on)
      --no-heuristic            Disable heuristic scoring
  -v, --verbose                 Show detailed info
  -h, --help                    Show this help

Examples:
  npx tsx scripts/generate-scenarios.ts generate -s easy
  npx tsx scripts/generate-scenarios.ts coverage -s medium -n 500
  npx tsx scripts/generate-scenarios.ts report
`);
}

const WAIT_DURATION = 2.0;

function pathToRecordedSession(baseScenario: Scenario, path: WalkPath): RecordedSession {
    const sim = new HeadlessSimulator({ seed: path.seed });
    sim.setupFromScenario(baseScenario);
    const initialModel = sim.getModelJSON();
    const initialRelationships = sim.getRelationshipsJSON();

    const recordedActions: RecordedAction[] = [];
    let pendingElapsedTime = 0;
    let lastRngCount = 0;

    for (const action of path.actions) {
        if (action.action === 'wait') {
            sim.advanceTime(WAIT_DURATION);
            pendingElapsedTime += WAIT_DURATION;
        } else {
            // Execute action (time already advanced during wait actions above)
            sim.executeAction(action.action, action.cloudId, action.targetCloudId, action.field);

            // Capture state AFTER action (matching live recording format)
            const rngCount = sim.getRngCount();
            const fullLog = sim.getModelRngLog();
            const rngLog = fullLog.slice(lastRngCount);
            const orchState = sim.getOrchestratorDebugState();
            const modelState = sim.getModelStateSnapshot();

            // Store the number of wait actions that preceded this action
            // This allows replay to advance time in the same increments
            const waitCount = Math.round(pendingElapsedTime / WAIT_DURATION);

            recordedActions.push({
                action: action.action,
                cloudId: action.cloudId,
                targetCloudId: action.targetCloudId,
                field: action.field,
                elapsedTime: pendingElapsedTime,
                waitCount,
                rngCounts: { model: rngCount },
                rngLog,
                orchState,
                modelState,
            } as RecordedAction);

            lastRngCount = rngCount;
            pendingElapsedTime = 0;
        }
    }

    return {
        version: 1,
        codeVersion: 'generated',
        platform: 'desktop',
        modelSeed: path.seed,
        timestamp: Date.now(),
        initialModel,
        initialRelationships,
        actions: recordedActions,
        finalModel: sim.getModelJSON(),
        finalRelationships: sim.getRelationshipsJSON(),
    };
}

function toCanonicalKey(action: string, outcome: string): string | null {
    // Strip field suffix for canonical comparison (e.g., "ray_field_select:age" -> "ray_field_select")
    const baseAction = action.split(':')[0];
    // Only count outcomes that are in ACTION_OUTCOMES
    const expectedOutcomes = ACTION_OUTCOMES[baseAction];
    if (!expectedOutcomes || !expectedOutcomes.includes(outcome as any)) {
        return null;
    }
    return `${baseAction}:${outcome}`;
}

function loadExistingCoverage(): Set<string> {
    const scenariosDir = 'test/scenarios';
    const covered = new Set<string>();

    if (!existsSync(scenariosDir)) return covered;

    const files = readdirSync(scenariosDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
        const path = `${scenariosDir}/${file}`;
        const session: RecordedSession = JSON.parse(readFileSync(path, 'utf-8'));
        const outcomes = replayAndCollectOutcomes(session);
        for (const { action, outcome } of outcomes) {
            const key = toCanonicalKey(action, outcome);
            if (key) covered.add(key);
        }
    }

    return covered;
}

function computePathCoverage(session: RecordedSession): Set<string> {
    const outcomes = replayAndCollectOutcomes(session);
    const keys = new Set<string>();
    for (const { action, outcome } of outcomes) {
        const key = toCanonicalKey(action, outcome);
        if (key) keys.add(key);
    }
    return keys;
}

function runGenerate(scenario: Scenario, args: Args): void {
    const outputDir = 'test/scenarios';

    console.log(`Generating scenario from "${scenario.name}" to maximize coverage`);

    const existingCoverage = loadExistingCoverage();
    console.log(`Existing coverage: ${existingCoverage.size} action:outcome pairs`);
    if (args.verbose) {
        for (const k of [...existingCoverage].sort()) console.log(`  ${k}`);
    }
    console.log();

    const runner = new RandomWalkRunner();
    const config: RandomWalkConfig = {
        iterations: args.iterations,
        maxActionsPerIteration: args.maxActions,
        coverageTracking: true,
        heuristicScoring: args.heuristic,
        extractPaths: true,
        stopOnError: false,
    };

    const results = runner.run(scenario, config);

    if (!results.paths || results.paths.length === 0) {
        console.log('No paths found. Try increasing iterations.');
        process.exit(1);
    }

    // Score each path by (new coverage) / length - prefer short paths with high new coverage
    let bestPath: WalkPath | null = null;
    let bestScore = -Infinity;
    let bestNewOutcomes: string[] = [];

    for (const path of results.paths) {
        const session = pathToRecordedSession(scenario, path);
        const pathCoverage = computePathCoverage(session);

        const newOutcomes: string[] = [];
        for (const item of pathCoverage) {
            if (!existingCoverage.has(item)) newOutcomes.push(item);
        }

        if (newOutcomes.length === 0) continue;

        // Score: new coverage / length^0.25 - mild preference for shorter paths
        const score = newOutcomes.length / Math.pow(path.length, 0.25);

        if (score > bestScore) {
            bestScore = score;
            bestPath = path;
            bestNewOutcomes = newOutcomes;
        }
    }

    if (!bestPath) {
        const totalCanonical = Object.values(ACTION_OUTCOMES).flat().length;
        console.log(`No new coverage found. ${existingCoverage.size}/${totalCanonical} canonical outcomes covered.`);
        console.log('Try a different scenario or check missing outcomes with: report');
        process.exit(0);
    }

    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
    }

    const session = pathToRecordedSession(scenario, bestPath);
    const timestamp = Date.now();
    const filename = `${outputDir}/${args.scenario}_${timestamp}.json`;
    writeFileSync(filename, JSON.stringify(session, null, 2));

    const victoryLabel = bestPath.victory ? ' (victory)' : '';
    console.log(`Selected path: seed=${bestPath.seed}, ${bestPath.length} actions, ${bestNewOutcomes.length} new outcomes${victoryLabel}`);
    console.log(`Path: ${bestPath.actions.map(a => a.field ? `${a.action}:${a.field}` : a.action).join(' -> ')}`);
    console.log(`\nNew coverage:`);
    for (const outcome of bestNewOutcomes.sort()) {
        console.log(`  + ${outcome}`);
    }
    console.log(`\nWritten to: ${filename}`);
}

function runCoverage(scenario: Scenario, args: Args): void {
    console.log(`Coverage analysis for "${scenario.name}"`);
    console.log(`Iterations: ${args.iterations}, Max actions: ${args.maxActions}\n`);

    const runner = new RandomWalkRunner();
    const config: RandomWalkConfig = {
        iterations: args.iterations,
        maxActionsPerIteration: args.maxActions,
        coverageTracking: true,
        heuristicScoring: args.heuristic,
        extractPaths: false,
        stopOnError: false,
    };

    const results = runner.run(scenario, config);

    console.log(`Victories: ${results.victories}/${results.iterations} (${(100 * results.victories / results.iterations).toFixed(1)}%)`);
    console.log(`Errors: ${results.errors.length}`);
    console.log(`Time: ${results.timing.totalMs.toFixed(0)}ms\n`);

    if (results.coverage) {
        console.log('=== Action Coverage ===');
        const actionCounts = Object.entries(results.coverage.actions)
            .sort((a, b) => b[1].count - a[1].count);
        for (const [action, entry] of actionCounts) {
            const pct = (100 * entry.count / results.iterations).toFixed(1);
            console.log(`  ${action}: ${entry.count} (${pct}% of iterations)`);
        }

        console.log('\n=== Ray Field Coverage ===');
        const fieldCounts = Object.entries(results.coverage.rayFields)
            .sort((a, b) => b[1].count - a[1].count);
        if (fieldCounts.length === 0) {
            console.log('  (none)');
        } else {
            for (const [field, entry] of fieldCounts) {
                console.log(`  ${field}: ${entry.count}`);
            }
        }

        console.log('\n=== State Space ===');
        console.log(`  Unique states visited: ${Object.keys(results.coverage.stateVisits).length}`);
        console.log(`  Unique transitions: ${Object.keys(results.coverage.transitions).length}`);
        console.log(`  Unique action+cloud pairs: ${Object.keys(results.coverage.actionCloudPairs).length}`);
    }

    if (results.coverageGaps && results.coverageGaps.length > 0) {
        console.log('\n=== Coverage Gaps ===');
        for (const gap of results.coverageGaps) {
            console.log(`  [${gap.type}] ${gap.action}`);
            console.log(`    ${gap.reason}`);
            if (gap.suggestion) console.log(`    Suggestion: ${gap.suggestion}`);
        }
    }

    if (results.errors.length > 0) {
        console.log('\n=== Errors ===');
        for (const err of results.errors.slice(0, 5)) {
            console.log(`  seed=${err.seed}: ${err.error}`);
        }
    }
}

interface OutcomeSignature {
    action: string;
    field?: string;
    outcome: string;  // Normalized outcome key derived from stateChanges/message
}

function extractOutcome(stateChanges: string[], message?: string): string {
    if (stateChanges.length === 0) {
        if (message) {
            return message.toLowerCase().replace(/\s+/g, '_');
        }
        return 'no_change';
    }

    // Parse using the canonical format from outcomes.ts
    const parsed = parseOutcome(stateChanges[0]);
    if (parsed) {
        return parsed.outcome;
    }

    // Fallback for legacy format (before migration to outcome())
    const first = stateChanges[0];
    const normalized = first
        .replace(/^[\w-]+\s+/, '')
        .replace(/\s+/g, '_')
        .toLowerCase();

    return normalized || 'unknown';
}

function replayAndCollectOutcomes(session: RecordedSession): OutcomeSignature[] {
    const sim = HeadlessSimulator.fromSession(
        session.initialModel,
        session.initialRelationships,
        session.modelSeed
    );

    const outcomes: OutcomeSignature[] = [];

    for (const action of session.actions) {
        // Advance time to allow message delivery (e.g., grievances)
        if (action.elapsedTime && action.elapsedTime > 0) {
            sim.advanceTime(action.elapsedTime);
        }

        const result = sim.executeAction(
            action.action,
            action.cloudId,
            action.targetCloudId,
            action.field
        );

        const outcome = extractOutcome(
            result.stateChanges ?? [],
            result.message
        );

        outcomes.push({
            action: action.field ? `${action.action}:${action.field}` : action.action,
            field: action.field,
            outcome,
        });
    }

    return outcomes;
}

function runReport(): void {
    const scenariosDir = 'test/scenarios';

    if (!existsSync(scenariosDir)) {
        console.log(`No scenarios directory found at ${scenariosDir}`);
        process.exit(1);
    }

    const files = readdirSync(scenariosDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        console.log('No scenario files found in test/scenarios/');
        process.exit(1);
    }

    // Track incremental coverage contribution of each file
    const allCovered = new Set<string>();
    const fileContributions: { file: string; unique: number; total: number }[] = [];

    for (const file of files) {
        const path = `${scenariosDir}/${file}`;
        const session: RecordedSession = JSON.parse(readFileSync(path, 'utf-8'));
        const outcomes = replayAndCollectOutcomes(session);
        const fileOutcomes = new Set<string>();
        for (const o of outcomes) {
            const key = toCanonicalKey(o.action, o.outcome);
            if (key) fileOutcomes.add(key);
        }

        let unique = 0;
        for (const o of fileOutcomes) {
            if (!allCovered.has(o)) {
                unique++;
                allCovered.add(o);
            }
        }
        fileContributions.push({ file, unique, total: fileOutcomes.size });
    }

    console.log('=== Scenario Contributions ===');
    for (const { file, unique, total } of fileContributions) {
        console.log(`  ${file}: +${unique} unique (${total} total)`);
    }

    // Compare against canonical ACTION_OUTCOMES
    let totalExpected = 0;
    let totalCovered = 0;
    const missingOutcomes: string[] = [];

    for (const [action, expectedOutcomes] of Object.entries(ACTION_OUTCOMES)) {
        const actionCovered = expectedOutcomes.filter(o => allCovered.has(`${action}:${o}`));
        const actionMissing = expectedOutcomes.filter(o => !allCovered.has(`${action}:${o}`));

        totalExpected += expectedOutcomes.length;
        totalCovered += actionCovered.length;

        for (const missing of actionMissing) {
            missingOutcomes.push(`${action}:${missing}`);
        }
    }

    const coveragePct = totalExpected > 0 ? (100 * totalCovered / totalExpected).toFixed(0) : '0';
    console.log(`\nCoverage: ${totalCovered}/${totalExpected} (${coveragePct}%)`);

    if (missingOutcomes.length > 0) {
        console.log(`\nMissing (${missingOutcomes.length}):`);
        for (const m of missingOutcomes) {
            console.log(`  - ${m}`);
        }
    }
}

function runDebug(scenario: Scenario, args: Args): void {
    const seed = args.seed ?? Date.now();
    console.log(`Debug run for "${scenario.name}" with seed=${seed}\n`);

    const runner = new RandomWalkRunner();
    const config: RandomWalkConfig = {
        iterations: 1,
        maxActionsPerIteration: args.maxActions,
        coverageTracking: false,
        heuristicScoring: args.heuristic,
        extractPaths: true,
        recordHeuristicState: true,
        seed,
    };

    const results = runner.run(scenario, config);
    const walk = results.errors[0] ?? (results.paths?.[0] ? {
        seed: results.paths[0].seed,
        actions: results.paths[0].actions,
        victory: results.paths[0].victory,
    } : null);

    if (!walk) {
        console.log('No walk data available');
        return;
    }

    console.log(`Victory: ${walk.victory}, Actions: ${walk.actions.length}`);
    console.log(`Replay with: npx tsx scripts/generate-scenarios.ts debug -s ${args.scenario} --seed ${seed}\n`);

    for (let i = 0; i < walk.actions.length; i++) {
        const a = walk.actions[i];
        const heur = a.heuristic;
        const gp = heur?.grievancePath;
        const target = a.targetCloudId ? ':' + a.targetCloudId : '';
        const field = a.field ? ':' + a.field : '';
        console.log(`[${i}] ${a.action}:${a.cloudId}${target}${field} (score=${a.score ?? '?'})`);
        if (heur) {
            console.log(`     phase=${heur.phase} prot=${heur.protectorId} prot_ee=${heur.protecteeId}`);
            if (gp) {
                console.log(`     gp: atk=${gp.attackerId} vic=${gp.victimId} atkBlend=${gp.attackerBlended} vicAtk=${gp.victimAttacked} atkConf=${gp.attackerInConf} vicConf=${gp.victimInConf}`);
            }
        }
    }
}

function main() {
    const args = parseArgs();
    if (!args) {
        showHelp();
        process.exit(0);
    }

    const scenario = args.scenario === 'easy' ? easyScenario : mediumScenario;

    switch (args.mode) {
        case 'generate':
            runGenerate(scenario, args);
            break;
        case 'coverage':
            runCoverage(scenario, args);
            break;
        case 'report':
            runReport();
            break;
        case 'debug':
            runDebug(scenario, args);
            break;
    }
}

main();
