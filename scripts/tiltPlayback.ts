#!/usr/bin/env npx tsx

import { updateTilt, initialTiltState, UNREGULATED_TILT, TiltState } from '../src/star/carpetTiltDynamics.js';
import { MAX_TILT } from '../src/star/carpetRenderer.js';
import { REGULATION_STANCE_LIMIT } from '../src/simulator/messageOrchestrator.js';

const DT = 1 / 60;
const TILT_SIGN = 1;

interface Event {
    time: number;
    stance: number;
    stanceRate?: number; // exponential approach rate (default: instant)
}

interface Scenario {
    name: string;
    duration: number;
    events: Event[];
}

const scenarios: Scenario[] = [
    {
        name: 'Start dysregulated negative, large positive therapist adjustment',
        duration: 3,
        events: [
            { time: 0,   stance: -1.0 },
            { time: 1.5, stance:  0.8, stanceRate: 3 },
        ],
    },
    {
        name: 'Regulated to dysregulated',
        duration: 2,
        events: [
            { time: 0,   stance: 0.1 },
            { time: 1.0, stance: 0.9 },
        ],
    },
    {
        name: 'Dysregulated positive to negative (passes through regulated)',
        duration: 4,
        events: [
            { time: 0,   stance:  0.9 },
            { time: 1.0, stance:  0.1 },
            { time: 1.5, stance: -0.9 },
        ],
    },
    {
        name: 'Dysregulated, recover to regulated',
        duration: 3,
        events: [
            { time: 0,   stance: -0.9 },
            { time: 1.5, stance: -0.1 },
        ],
    },
];

function bar(value: number, min: number, max: number, width: number = 40): string {
    const t = (value - min) / (max - min);
    const pos = Math.round(t * width);
    const clamped = Math.max(0, Math.min(width, pos));
    return '[' + ' '.repeat(clamped) + '|' + ' '.repeat(width - clamped) + ']';
}

function runScenario(scenario: Scenario): void {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Scenario: ${scenario.name}`);
    console.log(`  MAX_TILT=${MAX_TILT}  UNREGULATED_TILT=${UNREGULATED_TILT}  REGULATION_STANCE_LIMIT=${REGULATION_STANCE_LIMIT}`);
    console.log(`${'='.repeat(70)}`);
    console.log(`${'time'.padEnd(6)} ${'stance'.padEnd(8)} ${'tilt'.padEnd(8)} ${'unreg'.padEnd(6)} visual`);
    console.log(`${'-'.repeat(70)}`);

    let state: TiltState = initialTiltState();
    let stanceIdx = 0;
    let stance = scenario.events[0].stance;

    const PRINT_EVERY = Math.round(0.05 / DT);

    for (let frame = 0; frame * DT <= scenario.duration; frame++) {
        const t = frame * DT;

        while (stanceIdx + 1 < scenario.events.length && t >= scenario.events[stanceIdx + 1].time) {
            stanceIdx++;
        }

        const event = scenario.events[stanceIdx];
        if (event.stanceRate !== undefined) {
            stance += (event.stance - stance) * (1 - Math.exp(-event.stanceRate * DT));
        } else {
            stance = event.stance;
        }

        state = updateTilt(state, stance, TILT_SIGN, DT);

        if (frame % PRINT_EVERY === 0) {
            const unreg = state.unregulatedSign !== 0 ? (state.unregulatedSign > 0 ? '+' : '-') : ' ';
            const visual = bar(state.tiltAngle, -UNREGULATED_TILT, UNREGULATED_TILT);
            console.log(
                `${t.toFixed(2).padEnd(6)} ${stance.toFixed(2).padEnd(8)} ${state.tiltAngle.toFixed(2).padEnd(8)} ${unreg.padEnd(6)} ${visual}`
            );
        }
    }
}

const arg = process.argv[2];
if (arg === '--list') {
    scenarios.forEach((s, i) => console.log(`${i}: ${s.name}`));
} else if (arg !== undefined) {
    const idx = parseInt(arg, 10);
    if (isNaN(idx) || idx < 0 || idx >= scenarios.length) {
        console.error(`Invalid scenario index. Run with --list to see options.`);
        process.exit(1);
    }
    runScenario(scenarios[idx]);
} else {
    for (const scenario of scenarios) {
        runScenario(scenario);
    }
}
