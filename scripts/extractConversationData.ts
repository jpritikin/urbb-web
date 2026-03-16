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

function fmt(n: number | undefined | null, decimals = 3): string {
    if (n == null) return 'null';
    return n.toFixed(decimals);
}

function relKey(rel: any): string {
    return `${rel.fromId}→${rel.toId}`;
}

function getRelations(model: any): Map<string, any> {
    const m = new Map<string, any>();
    for (const rel of model.interPartRelations ?? []) {
        m.set(relKey(rel), rel);
    }
    return m;
}

// Stance label per spec: < 0.50 Nag, < 0.65 Jab, < 0.75 Snap, < 0.85 Accuse, < 0.95 Shout, else Explode
function dysregLabel(stance: number): string {
    if (stance < 0.50) return 'Nag';
    if (stance < 0.65) return 'Jab';
    if (stance < 0.75) return 'Snap';
    if (stance < 0.85) return 'Accuse';
    if (stance < 0.95) return 'Shout';
    return 'Explode';
}

function stanceDesc(s: number): string {
    const LIMIT = 0.3;
    const FLOOD = 0.7;
    if (s > FLOOD) return 'flooding';
    if (s > LIMIT) return 'dysreg+';
    if (s < -FLOOD) return 'shutdown';
    if (s < -LIMIT) return 'withdraw';
    return 'regulated';
}

// RNG labels relevant to conversation
const CONV_RNG_LABELS = new Set([
    'conv_speak', 'stance_shock', 'shock_trust', 'polarity_flip',
    'flip_draw', 'outburst', 'resample_stance', 'resample_flip',
    'cycle_length', 'listener_violation',
]);

// ── Session timing ────────────────────────────────────────────────────────────

const startMs: number = data.timestamp;
const lastCumulativeTime: number = actions.reduceRight((acc: number, a: any) =>
    acc === 0 && a.cumulativeTime != null ? a.cumulativeTime : acc, 0);
const startDate = new Date(startMs).toLocaleString();
console.log(`Session started : ${startDate}`);
console.log(`Session duration: ${lastCumulativeTime.toFixed(1)}s  (${actions.length} actions)`);

// ── Section 1: Participants ───────────────────────────────────────────────────

console.log('═══ CONVERSATION PARTICIPANTS ══════════════════════════════════════');
const participants: string[] = fm.conversationParticipantIds ?? [];
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
    if (frel.fromId === frel.toId) continue;
    const irel = initRels.get(key);
    const trustI = irel?.trust as number;
    const trustF = frel.trust as number;
    const stanceI = irel?.stance as number;
    const stanceF = frel.stance as number;
    const trustBand = (t: number) =>
        t < 0.3 ? 'hostile' : t < 0.5 ? 'guarded' : t < 0.7 ? 'opening' : 'collaborative';
    console.log(`${key}:`);
    console.log(`  trust : ${fmt(trustI)} → ${fmt(trustF)}  (${trustBand(trustI)} → ${trustBand(trustF)})`);
    console.log(`  stance: ${fmt(stanceI)} → ${fmt(stanceF)}  flipOdds=${fmt(frel.stanceFlipOdds)}  trustFloor=${frel.trustFloor}`);
}

// ── Section 3: Cycle boundaries ───────────────────────────────────────────────

console.log('\n═══ CYCLE BOUNDARIES ═══════════════════════════════════════════════');
console.log('(actions where resample_stance appears = empathize just completed)\n');
console.log(`${'#'.padStart(4)}  ${'cycLen'.padStart(6)}  ${'tIdx'.padStart(4)}  ${'reg'.padStart(5)}  ${'ncTmr'.padStart(5)}  rng`);

for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const rng: any[] = a.rngLog ?? [];
    const labels = rng.map((r: any) => r.label);
    if (!labels.includes('resample_stance')) continue;
    const o = a.orchState ?? {};
    const convLabels = labels.filter((l: string) => CONV_RNG_LABELS.has(l));
    console.log(
        `${String(i).padStart(4)}  ${String(o.currentCycleLength ?? '').padStart(6)}  ` +
        `${String(o.currentTupleIndex ?? '').padStart(4)}  ` +
        `${fmt(o.regulationScore, 2).padStart(5)}  ` +
        `${fmt(o.newCycleTimer, 1).padStart(5)}  ` +
        convLabels.join(' ')
    );
    for (const r of rng) {
        if (CONV_RNG_LABELS.has(r.label)) {
            console.log(`       ${r.label} = ${r.value}`);
        }
    }
}

// ── Section 4: Orchestrator timeline ─────────────────────────────────────────
//
// Columns:
//   reg    - regulation score (both parts regulated when > 0.5)
//   resp   - respond timer (fires utterance when >= RESPOND_DELAY=3s)
//   lrTmr  - ListenRole violation timer (role-swap when >= 1s)
//   srTmr  - SpeakRole violation timer (outburst from `listen` phase when >= 1s)
//   ncTmr  - new cycle timer (next speaker nominated when >= 4s)
//   cLen   - current cycle length (4 or 6 steps)
//   tIdx   - active dialogue tuple index
//   streaks - dysregulated utterance streak per receiver (amplifies shock)

console.log('\n═══ ORCHESTRATOR TIMELINE ═══════════════════════════════════════════');
console.log(`${'#'.padStart(4)}  ${'action'.padStart(22)}  ${'reg'.padStart(5)}  ${'resp'.padStart(5)}  ${'lrTmr'.padStart(5)}  ${'srTmr'.padStart(5)}  ${'ncTmr'.padStart(5)}  ${'cLen'.padStart(4)}  ${'tIdx'.padStart(4)}  pend  streaks`);

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
        o.listenRoleViolationTimer !== prevOrch.listenRoleViolationTimer ||
        o.speakRoleViolationTimer !== prevOrch.speakRoleViolationTimer ||
        o.newCycleTimer !== prevOrch.newCycleTimer ||
        o.dysregulatedSpokePending !== prevOrch.dysregulatedSpokePending ||
        JSON.stringify(o.dysregulatedStreaks) !== JSON.stringify(prevOrch.dysregulatedStreaks);

    if (changed) {
        const streaks = JSON.stringify(o.dysregulatedStreaks ?? {});
        const pend = o.dysregulatedSpokePending ? 'Y' : 'N';
        console.log(
            `${String(i).padStart(4)}  ${a.action.padStart(22)}  ` +
            `${fmt(o.regulationScore, 2).padStart(5)}  ` +
            `${fmt(o.respondTimer, 1).padStart(5)}  ` +
            `${fmt(o.listenRoleViolationTimer, 1).padStart(5)}  ` +
            `${fmt(o.speakRoleViolationTimer, 1).padStart(5)}  ` +
            `${fmt(o.newCycleTimer, 1).padStart(5)}  ` +
            `${String(o.currentCycleLength ?? '').padStart(4)}  ` +
            `${String(o.currentTupleIndex ?? '').padStart(4)}  ` +
            `${pend.padStart(4)}  ` +
            streaks
        );
    }
    prevOrch = o;
}

// ── Section 5: Utterance log ──────────────────────────────────────────────────
//
// Per-utterance events from convLog (process_intervals only).
// For each action that had conversation events:
//   utterance: sender phase senderStance [Dysreg]
//   shock:     sender→receiver shockDelta  effBefore→effAfter  [OVERFLOW if <-1]
//   nominate:  → newSpeaker
//
// This directly verifies:
//   - Graduated label thresholds applied to senderStance at moment of utterance
//   - Shock direction and magnitude (spec: streakMult × 0.3 × |speakerStance| × 2 / ((1+selfTrust)(1+interTrust)))
//   - Polarity: opposite by default, same with flipOdds probability

console.log('\n═══ UTTERANCE LOG ═══════════════════════════════════════════════════');

for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const convLog: any[] = a.convLog ?? [];
    if (convLog.length === 0) continue;
    const o = a.orchState ?? {};
    console.log(`\n[${i}] reg=${fmt(o.regulationScore, 2)} cLen=${o.currentCycleLength} tIdx=${o.currentTupleIndex} streaks=${JSON.stringify(o.dysregulatedStreaks ?? {})}`);
    for (const ev of convLog) {
        if (ev.kind === 'utterance') {
            const stance = ev.senderStance ?? 0;
            const label = ev.phase ?? '?';
            const dysreg = ev.dysregulated ? ' [Dysreg]' : '';
            console.log(`  UTT  ${(ev.senderId ?? '?').slice(-1)}→${(ev.receiverId ?? '?').slice(-1)}  phase=${label.padEnd(12)} stance=${fmt(stance, 3)}${dysreg}`);
        } else if (ev.kind === 'shock') {
            const overflow = (ev.receiverEffAfter ?? 0) < -1 ? ' [OVERFLOW]' : '';
            console.log(`  SHOCK ${(ev.senderId ?? '?').slice(-1)}→${(ev.receiverId ?? '?').slice(-1)}  Δ=${fmt(ev.shockDelta, 3)}  rcvr: ${fmt(ev.receiverEffBefore, 3)}→${fmt(ev.receiverEffAfter, 3)}${overflow}`);
        } else if (ev.kind === 'nominate') {
            const reason = ev.nominateReason ? ` (${ev.nominateReason})` : '';
            console.log(`  NOM  → ${(ev.newSpeakerId ?? '?').slice(-1)}${reason}`);
        }
    }
}

// ── Section 6: Stance breakdown per conversation action ──────────────────────
//
// For each action where a conversation is active, show the stance components:
//   raw    - part's raw stance from the relation (set at nomination / polarity flip)
//   thDlt  - therapist delta (Calm/Activate nudge, decays over time)
//   shDlt  - shock delta (accumulated from incoming utterances, decays over time)
//   eff    - effective stance = raw + thDlt + shDlt (clamped to [-1,1])
//   label  - stance description; if dysregulated (+), shows graduated dysreg label
//
// This lets you verify:
//   1. Effective stance formula matches spec
//   2. Graduated label thresholds (Nag<0.5, Jab<0.65, Snap<0.75, Accuse<0.85, Shout<0.95, Explode)
//   3. Shock magnitude and direction after each utterance
//   4. Therapist delta decay between actions

console.log('\n═══ STANCE BREAKDOWN (conversation active) ══════════════════════════');
console.log('Format per participant: raw + thDlt + shDlt = eff (label)');
console.log(`${'#'.padStart(4)}  ${'action'.padStart(22)}  ${'phase'.padStart(10)}  participant breakdown`);

for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (!ORCH_ACTIONS.has(a.action)) continue;
    const ms = a.modelState ?? {};
    const parts: string[] = ms.conversationParticipantIds ?? [];
    if (parts.length === 0) continue;

    const phases: Record<string, string> = ms.conversationPhases ?? {};
    const speaker = ms.conversationSpeakerId ?? '';
    const rels: any[] = ms.interPartRelations ?? [];

    // Build raw stance lookup: fromId→toId gives fromId's raw stance
    // Raw stance is stored on the relation from the part TO its conversation partner
    const rawStance: Record<string, number> = {};
    for (const rel of rels) {
        if (parts.includes(rel.fromId) && parts.includes(rel.toId) && rel.fromId !== rel.toId) {
            rawStance[rel.fromId] = rel.stance;
        }
    }

    const thDeltas: Record<string, number> = ms.conversationTherapistDelta ?? {};
    const shDeltas: Record<string, number> = ms.conversationShockDelta ?? {};

    const phaseStr = parts.map(id => `${id.slice(-1)}:${phases[id] ?? '?'}`).join(' ');
    const speakerMarker = speaker ? `spkr=${speaker.slice(-1)}` : '';

    const breakdowns = parts.map(id => {
        const raw = rawStance[id] ?? 0;
        const th = thDeltas[id] ?? 0;
        const sh = shDeltas[id] ?? 0;
        const eff = Math.max(-1, Math.min(1, raw + th + sh));
        const label = eff >= 0.3 ? dysregLabel(eff) : stanceDesc(eff);
        return `${id.slice(-1)}: ${fmt(raw,2)}+${fmt(th,2)}+${fmt(sh,2)}=${fmt(eff,2)} (${label})`;
    });

    console.log(
        `${String(i).padStart(4)}  ${a.action.padStart(22)}  ${phaseStr.padEnd(10)}  ${speakerMarker}  ${breakdowns.join('  ')}`
    );
}

// ── Section 7: Conversation RNG events ────────────────────────────────────────

console.log('\n═══ CONVERSATION RNG EVENTS ════════════════════════════════════════');
console.log('(only process_intervals with conversation-relevant RNG)\n');

for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.action !== 'process_intervals') continue;
    const rng: any[] = a.rngLog ?? [];
    const convEntries = rng.filter((r: any) => CONV_RNG_LABELS.has(r.label));
    if (convEntries.length === 0) continue;
    const o = a.orchState ?? {};
    console.log(`[${i}] reg=${fmt(o.regulationScore, 2)} resp=${fmt(o.respondTimer, 1)} lrTmr=${fmt(o.listenRoleViolationTimer, 1)} srTmr=${fmt(o.speakRoleViolationTimer, 1)} ` +
        `cycLen=${o.currentCycleLength} tIdx=${o.currentTupleIndex} ` +
        `streaks=${JSON.stringify(o.dysregulatedStreaks ?? {})}`);
    for (const r of convEntries) {
        console.log(`  ${r.label.padEnd(20)} ${r.value}`);
    }
}

// ── Section 8: Nudge stance actions ──────────────────────────────────────────

console.log('\n═══ NUDGE_STANCE ACTIONS ════════════════════════════════════════════');
for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.action !== 'nudge_stance') continue;
    const o = a.orchState ?? {};
    const ms = a.modelState ?? {};
    const parts: string[] = ms.conversationParticipantIds ?? [];
    const thDeltas: Record<string, number> = ms.conversationTherapistDelta ?? {};
    const shDeltas: Record<string, number> = ms.conversationShockDelta ?? {};
    const rels: any[] = ms.interPartRelations ?? [];
    const rawStance: Record<string, number> = {};
    for (const rel of rels) {
        if (parts.includes(rel.fromId) && parts.includes(rel.toId) && rel.fromId !== rel.toId) {
            rawStance[rel.fromId] = rel.stance;
        }
    }
    const thStr = parts.map(id => {
        const raw = rawStance[id] ?? 0;
        const th = thDeltas[id] ?? 0;
        const sh = shDeltas[id] ?? 0;
        const eff = Math.max(-1, Math.min(1, raw + th + sh));
        return `${id.slice(-1)} th=${fmt(th, 2)} eff=${fmt(eff, 2)}`;
    }).join('  ');
    console.log(`[${i}] delta=${fmt(a.stanceDelta, 2)} cloud=${a.cloudId?.slice(-1) ?? '?'}  ${thStr}  reg=${fmt(o.regulationScore, 2)}`);
}
