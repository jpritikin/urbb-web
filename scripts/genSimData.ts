import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    REGULATION_STANCE_LIMIT,
    RESPOND_DELAY,
    THERAPIST_NUDGE,
    DELTA_DECAY_RATE,
    CYCLE_TRUST_BOOST_FACTOR,
    CYCLE_STANCE_SOFTEN,
    OVERFLOW_TRUST_PENALTY,
    STANCE_FLOODING,
    STANCE_SHUTDOWN,
    TRUST_GUARDED,
    TRUST_OPENING,
    TRUST_COLLABORATIVE,
} from '../src/conversation/ifsConversationSim.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const data = {
    regulation_stance_limit: REGULATION_STANCE_LIMIT,
    respond_delay: RESPOND_DELAY,
    therapist_nudge: THERAPIST_NUDGE,
    delta_decay_rate: DELTA_DECAY_RATE,
    delta_half_life: +( Math.log(2) / DELTA_DECAY_RATE ).toFixed(1),
    cycle_trust_boost_factor: CYCLE_TRUST_BOOST_FACTOR,
    cycle_stance_soften: CYCLE_STANCE_SOFTEN,
    overflow_trust_penalty: OVERFLOW_TRUST_PENALTY,
    trust_bands: {
        hostile_max: TRUST_GUARDED,
        guarded_min: TRUST_GUARDED,
        guarded_max: TRUST_OPENING,
        opening_min: TRUST_OPENING,
        opening_max: TRUST_COLLABORATIVE,
        collaborative_min: TRUST_COLLABORATIVE,
    },
    stance_labels: {
        flooding_min: STANCE_FLOODING,
        dysregulated_min: REGULATION_STANCE_LIMIT,
        withdrawing_max: -REGULATION_STANCE_LIMIT,
        shutdown_max: STANCE_SHUTDOWN,
    },
};

const outPath = join(root, 'data', 'ifsConversation.json');
mkdirSync(join(root, 'data'), { recursive: true });
writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
console.log(`wrote ${outPath}`);
