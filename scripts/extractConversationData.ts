#!/usr/bin/env npx tsx

import { readFileSync } from 'fs';

const sessionFile = process.argv[2];
if (!sessionFile) {
    console.error('Usage: extractConversationData <session.json>');
    process.exit(1);
}

const data = JSON.parse(readFileSync(sessionFile, 'utf8'));
const actions: any[] = data.actions;
const fm = data.finalModel;
const im = data.initialModel;

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null, decimals = 3) {
    if (n == null) return 'null';
    return n.toFixed(decimals);
}

function relKey(rel: any) {
    return `${rel.fromId}→${rel.toId}`;
}

function getRelations(model: any): Map<string, any> {
    const m = new Map<string, any>();
    for (const rel of model.interPartRelations ?? []) {
        m.set(relKey(rel), rel);
    }
    return m;
}

const CONV_RNG_LABELS = new Set([
    'conv_speak', 'stance_shock', 'shock_trust', 'polarity_flip',
    'flip_draw', 'outburst', 'resample_stance', 'resample_flip',
    'cycle_length', 'dysreg_label', 'listener_violation',
]);

// ── Section 1: Participants ───────────────────────────────────────────────────

console.log('═══ CONVERSATION PARTICIPANTS ══════════════════════════════════════');
const participants = fm.conversationParticipantIds ?? [];
console.log(`Participants : ${participants.join(', ')}`);
console.log(`Final speaker: ${fm.conversationSpeakerId}`);
console.log(`Final phases : ${JSON.stringify(fm.conversationPhases)}`);
console.log(`Effective stances: ${JSON.stringify(
    Object.fromEntries(Object.entries(fm.conversationEffectiveStances ?? {})
        .map(([k, v]) => [k, fmt(v as number)]))
)}`);

// ── Section 2: Trust arc ──────────────────────────────────────────────────────

console.log('\n═══ TRUST ARC ══════════════════════════════════════════════════════');
const initRels = getRelations(im);
const finalRels = getRelations(fm);

for (const [key, frel] of finalRels) {
    if (frel.fromId === frel.toId) continue; // skip self-relations
    const irel = initRels.get(key);
    const trustI = irel?.trust ?? '?';
    const trustF = frel.trust;
    const stanceI = irel?.stance ?? '?';
    const stanceF = frel.stance;
    const trustBand = (t: number) =>
        t < 0.3 ? 'hostile' : t < 0.5 ? 'guarded' : t < 0.7 ? 'opening' : 'collaborative';
    console.log(`${key}:`);
    console.log(`  trust : ${fmt(trustI as number)} → ${fmt(trustF)}  (${trustBand(trustI as number)} → ${trustBand(trustF)})`);
    console.log(`  stance: ${fmt(stanceI as number)} → ${fmt(stanceF)}  flipOdds=${fmt(frel.stanceFlipOdds)}  trustFloor=${frel.trustFloor}`);
}

// ── Section 3: Cycle log ──────────────────────────────────────────────────────

console.log('\n═══ CYCLE BOUNDARIES ═══════════════════════════════════════════════');
console.log('(actions where resample_stance appears = empathize just completed)\n');
console.log(`${'#'.padStart(4)}  ${'cycleLen'.padStart(8)}  ${'tupleIdx'.padStart(8)}  ${'regScore'.padStart(8)}  ${'sustReg'.padStart(7)}  ${'newCycleTmr'.padStart(11)}  rng`);

for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const rng: any[] = a.rngLog ?? [];
    const labels = rng.map((r: any) => r.label);
    if (!labels.includes('resample_stance')) continue;
    const o = a.orchState ?? {};
    const convLabels = labels.filter((l: string) => CONV_RNG_LABELS.has(l));
    console.log(
        `${String(i).padStart(4)}  ${String(o.currentCycleLength ?? '').padStart(8)}  ` +
        `${String(o.currentTupleIndex ?? '').padStart(8)}  ` +
        `${fmt(o.regulationScore, 2).padStart(8)}  ` +
        `${fmt(o.sustainedRegulationTimer, 1).padStart(7)}  ` +
        `${fmt(o.newCycleTimer, 1).padStart(11)}  ` +
        convLabels.join(' ')
    );
    for (const r of rng) {
        if (CONV_RNG_LABELS.has(r.label)) {
            console.log(`       ${r.label} = ${r.value}`);
        }
    }
}

// ── Section 4: Full orchState timeline ───────────────────────────────────────

console.log('\n═══ ORCHESTRATOR TIMELINE ═══════════════════════════════════════════');
console.log(`${'#'.padStart(4)}  ${'action'.padStart(22)}  ${'reg'.padStart(5)}  ${'resp'.padStart(5)}  ${'sReg'.padStart(5)}  ${'lvTmr'.padStart(5)}  ${'ncTmr'.padStart(5)}  ${'cLen'.padStart(4)}  ${'tIdx'.padStart(4)}  streaks`);

const ORCH_ACTIONS = new Set(['process_intervals', 'nudge_stance']);
let prevOrch: any = null;
for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const o = a.orchState;
    if (!o || !ORCH_ACTIONS.has(a.action)) continue;

    const changed =
        !prevOrch ||
        o.regulationScore !== prevOrch.regulationScore ||
        o.respondTimer !== prevOrch.respondTimer ||
        o.currentCycleLength !== prevOrch.currentCycleLength ||
        o.currentTupleIndex !== prevOrch.currentTupleIndex ||
        o.listenerViolationTimer !== prevOrch.listenerViolationTimer ||
        o.newCycleTimer !== prevOrch.newCycleTimer ||
        JSON.stringify(o.dysregulatedStreaks) !== JSON.stringify(prevOrch.dysregulatedStreaks);

    if (changed) {
        const streaks = JSON.stringify(o.dysregulatedStreaks ?? {});
        console.log(
            `${String(i).padStart(4)}  ${a.action.padStart(22)}  ` +
            `${fmt(o.regulationScore, 2).padStart(5)}  ` +
            `${fmt(o.respondTimer, 1).padStart(5)}  ` +
            `${fmt(o.sustainedRegulationTimer, 1).padStart(5)}  ` +
            `${fmt(o.listenerViolationTimer, 1).padStart(5)}  ` +
            `${fmt(o.newCycleTimer, 1).padStart(5)}  ` +
            `${String(o.currentCycleLength ?? '').padStart(4)}  ` +
            `${String(o.currentTupleIndex ?? '').padStart(4)}  ` +
            streaks
        );
    }
    prevOrch = o;
}

// ── Section 5: All conversation RNG events ────────────────────────────────────

console.log('\n═══ CONVERSATION RNG EVENTS ════════════════════════════════════════');
console.log('(only process_intervals actions with conversation-relevant RNG)\n');

for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.action !== 'process_intervals') continue;
    const rng: any[] = a.rngLog ?? [];
    const convEntries = rng.filter((r: any) => CONV_RNG_LABELS.has(r.label));
    if (convEntries.length === 0) continue;
    const o = a.orchState ?? {};
    console.log(`[${i}] reg=${fmt(o.regulationScore, 2)} resp=${fmt(o.respondTimer, 1)} ` +
        `cycLen=${o.currentCycleLength} tIdx=${o.currentTupleIndex} ` +
        `streaks=${JSON.stringify(o.dysregulatedStreaks ?? {})}`);
    for (const r of convEntries) {
        console.log(`  ${r.label.padEnd(20)} ${r.value}`);
    }
}

// ── Section 6: nudge_stance actions ──────────────────────────────────────────

console.log('\n═══ NUDGE_STANCE ACTIONS ════════════════════════════════════════════');
for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.action !== 'nudge_stance') continue;
    const o = a.orchState ?? {};
    console.log(`[${i}] reg=${fmt(o.regulationScore, 2)} resp=${fmt(o.respondTimer, 1)} ` +
        `sReg=${fmt(o.sustainedRegulationTimer, 1)} ` +
        `cycLen=${o.currentCycleLength} tIdx=${o.currentTupleIndex} ` +
        `cloudId=${a.cloudId ?? '?'}`);
}
