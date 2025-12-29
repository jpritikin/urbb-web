#!/usr/bin/env npx tsx

import { RandomWalkRunner, formatRandomWalkResults } from '../src/testability/index.js';
import type { Scenario, RandomWalkConfig } from '../src/testability/types.js';

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

interface Args {
    scenario: 'easy' | 'medium';
    iterations: number;
    maxActions: number;
    verbose: boolean;
    heuristic: boolean;
}

function parseArgs(): Args {
    const args = process.argv.slice(2);
    let scenario: 'easy' | 'medium' = 'easy';
    let iterations = 100;
    let maxActions = 50;
    let verbose = false;
    let heuristic = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--scenario' || arg === '-s') {
            const val = args[++i];
            if (val === 'easy' || val === 'medium') scenario = val;
        } else if (arg === '--iterations' || arg === '-n') {
            iterations = parseInt(args[++i], 10);
        } else if (arg === '--max-actions' || arg === '-m') {
            maxActions = parseInt(args[++i], 10);
        } else if (arg === '--verbose' || arg === '-v') {
            verbose = true;
        } else if (arg === '--heuristic' || arg === '-H') {
            heuristic = true;
        } else if (arg === '--help' || arg === '-h') {
            console.log(`Usage: npx tsx scripts/random-walk.ts [options]

Options:
  -s, --scenario <easy|medium>  Scenario to run (default: easy)
  -n, --iterations <number>     Number of iterations (default: 100)
  -m, --max-actions <number>    Max actions per iteration (default: 50)
  -H, --heuristic               Use heuristic scoring to guide exploration
  -v, --verbose                 Show detailed coverage info
  -h, --help                    Show this help
`);
            process.exit(0);
        }
    }

    return { scenario, iterations, maxActions, verbose, heuristic };
}

function main() {
    const { scenario: scenarioName, iterations, maxActions, verbose, heuristic } = parseArgs();
    const scenario = scenarioName === 'easy' ? easyScenario : mediumScenario;

    console.log(`Running random walk on "${scenario.name}"`);
    console.log(`Iterations: ${iterations}, Max actions: ${maxActions}, Heuristic: ${heuristic}\n`);

    const runner = new RandomWalkRunner();
    const config: RandomWalkConfig = {
        iterations,
        maxActionsPerIteration: maxActions,
        coverageTracking: true,
        heuristicScoring: heuristic,
        extractVictoryPaths: true,
        stopOnError: false,
    };

    const results = runner.run(scenario, config);
    console.log(formatRandomWalkResults(results));

    if (verbose && results.coverage) {
        console.log('\nDetailed state visits:');
        const stateVisits = Object.entries(results.coverage.stateVisits)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 20);
        for (const [state, entry] of stateVisits) {
            console.log(`  ${entry.count}x: ${state}`);
        }

        console.log('\nSample transitions:');
        const transitions = Object.entries(results.coverage.transitions)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 10);
        for (const [transition, entry] of transitions) {
            console.log(`  ${entry.count}x: ${transition}`);
        }
    }

    process.exit(results.errors.length > 0 ? 1 : 0);
}

main();
