export type IfioPhase = 'speak' | 'listen' | 'mirror' | 'clarify' | 'mirror_again' | 'validate' | 'empathize' | 'waiting';
export type TrustBand = 'hostile' | 'guarded' | 'opening' | 'collaborative';

// 4-step tuple indices: [speak, mirror, validate, empathize]
// 6-step tuple indices: [speak, mirror, clarify, mirror_again, validate, empathize]
const PHASE_INDEX_4: Record<string, number> = { speak: 0, mirror: 1, validate: 2, empathize: 3 };
const PHASE_INDEX_6: Record<string, number> = { speak: 0, mirror: 1, clarify: 2, mirror_again: 3, validate: 4, empathize: 5 };

export const PHASE_INDEX = PHASE_INDEX_6;

export const REGULATION_STANCE_LIMIT = 0.3;
export const RESPOND_DELAY = 3;
export const NEW_CYCLE_DELAY = 4;
const LISTEN_ROLE_VIOLATION_GRACE = 1.0;
const REGULATION_RECOVER_RATE = 0.5;
const REGULATION_DECAY_RATE = 0.3;
const SPEAK_BASE_RATE = 0.5;
export const DELTA_DECAY_RATE = 0.08;
export const THERAPIST_NUDGE = 0.2;
export const CYCLE_TRUST_BOOST_FACTOR = 0.5;
export const CYCLE_STANCE_SOFTEN = 0.5;
export const OVERFLOW_TRUST_PENALTY = 0.2;

// Stance label thresholds (strict >): flooding > STANCE_FLOODING, etc.
export const STANCE_FLOODING    =  0.6;
export const STANCE_SHUTDOWN    = -0.6;

// Trust band thresholds (strict <): hostile < TRUST_GUARDED, etc.
export const TRUST_GUARDED      = 0.3;
export const TRUST_OPENING      = 0.5;
export const TRUST_COLLABORATIVE = 0.7;

export interface ConversationDialogues {
    hostile?: string[][];
    guarded?: string[][];
    opening?: string[][];
    collaborative?: string[][];
}

export interface InterPartRelation {
    trust: number;
    trustFloor: number;
    stance: number;
    stanceMagnitude: number; // original setup magnitude, immutable
    stanceFlipOdds: number;
    dialogues?: ConversationDialogues;
    flipUtterances?: string[];
}

const GENERIC_FLIP_UTTERANCES = [
    "I can't take it anymore.",
    "You want to push me? Fine. See what happens.",
    "I've been swallowing this for too long.",
    "No more. I'm not holding back.",
    "You have no idea what's been building in here.",
    "I'm not disappearing anymore.",
];

export interface Part {
    id: string;
    name: string;
    selfTrust: number;
}

export interface ConversationState {
    speakRoleId: string;
    phases: Map<string, IfioPhase>;
    effectiveStances: Map<string, number>;
    therapistDeltas: Map<string, number>;
    shockDeltas: Map<string, number>;
    // Active dialogue tuple index, rolled once per cycle for the SpeakRole part
    activeTupleIndex: number;
    regulationScore: number;
    respondTimer: number;
    newCycleTimer: number;
    listenRoleViolationTimer: number;
    speakRoleViolationTimer: number;
    // Ball: position 0=partA side, 1=partB side
    ballPos: number;
    ballVel: number;
    ballUttererIsA: boolean;
    ballBias: number; // 0=all-A, 0.5=balanced, 1=all-B
    dysregulatedSpokePending: boolean;
    // Consecutive dysregulated utterances received without a regulated break, per receiver
    dysregStreak: Map<string, number>;
}

export interface Message {
    id: number;
    senderId: string;
    text: string;
    phase: IfioPhase;
    type: 'dialogue' | 'trust';
    subtype?: 'cycle-complete' | 'overflow' | 'counter-shock' | 'dysregulated';
    senderStance?: number;
}

export interface ShockEvent {
    receiverId: string;
    shockDelta: number;      // delta added to shockDeltas map
    effectiveStanceBefore: number;
    effectiveStanceAfter: number;
    accumulatedShockDelta: number;  // total shockDelta for receiver after this shock
    simTime: number;
}

export interface RawStanceEvent {
    partId: string;
    rawStanceBefore: number;
    rawStanceAfter: number;
    reason: 'flip' | 'counter-shock';
    simTime: number;
}

export interface PhaseTransitionEvent {
    speakRoleId: string;
    listenRoleId: string;
    oldPhaseSR: IfioPhase;
    oldPhaseLR: IfioPhase;
    newPhaseSR: IfioPhase;
    newPhaseLR: IfioPhase;
    rawStanceA: number;
    rawStanceB: number;
    simTime: number;
}

export interface NominateEvent {
    speakRoleId: string;
    sampledStance: number;
}

export type SimEvent =
    | { kind: 'shock'; data: ShockEvent }
    | { kind: 'rawStance'; data: RawStanceEvent }
    | { kind: 'phase'; data: PhaseTransitionEvent }
    | { kind: 'message'; data: Message }
    | { kind: 'nominate'; data: NominateEvent };

export interface SimState {
    partA: Part;
    partB: Part;
    relAB: InterPartRelation;
    relBA: InterPartRelation;
    conversation: ConversationState;
    messages: Message[];
    messageCounter: number;
    simTime: number;
    cyclesCompleted: number;
}

// k such that e^(5k) = 1.2 — streak multiplier reaches ~20% at n=5 dysregulated utterances in a row
const STREAK_K = Math.log(1.2) / 5;

// Returns [deltaIfDefault, deltaIfFlip, probFlip].
// Default: push away from source stance. Flip (prob=receiver flipOdds): pull toward source stance.
function shockParams(sourceStance: number, selfTrust: number, receiverRel: InterPartRelation, streak = 0): [number, number, number] {
    const streakMult = Math.exp(STREAK_K * streak);
    const shockMag = streakMult * 0.3 * Math.abs(sourceStance) * 2 / ((1 + selfTrust) * (1 + receiverRel.trust));
    return [-Math.sign(sourceStance) * shockMag, Math.sign(sourceStance) * shockMag, receiverRel.stanceFlipOdds];
}

export function nextShockDist(state: SimState, receiverId: string): [number, number, number] {
    const { partA, partB } = state;
    const isReceiverA = receiverId === partA.id;
    const sourceId = isReceiverA ? partB.id : partA.id;
    const receiverRel = isReceiverA ? state.relAB : state.relBA;
    const selfTrust = isReceiverA ? partA.selfTrust : partB.selfTrust;
    const sourceStance = state.conversation.effectiveStances.get(sourceId) ?? 0;
    const streak = state.conversation.dysregStreak.get(receiverId) ?? 0;
    return shockParams(sourceStance, selfTrust, receiverRel, streak);
}

export function getTrustBand(trust: number): TrustBand {
    if (trust < TRUST_GUARDED) return 'hostile';
    if (trust < TRUST_OPENING) return 'guarded';
    if (trust < TRUST_COLLABORATIVE) return 'opening';
    return 'collaborative';
}

export function rollTupleIndex(rel: InterPartRelation, conv: ConversationState): void {
    const band = getTrustBand(rel.trust);
    const pool = rel.dialogues?.[band];
    conv.activeTupleIndex = pool && pool.length > 0 ? Math.floor(Math.random() * pool.length) : 0;
}

export function getDialogue(rel: InterPartRelation, phase: IfioPhase, conv: ConversationState): string | null {
    if (phase === 'listen') return null;
    const band = getTrustBand(rel.trust);
    const pool = rel.dialogues?.[band];
    if (!pool || pool.length === 0) return null;
    const tuple = pool[conv.activeTupleIndex % pool.length];
    const indexMap = tuple.length === 6 ? PHASE_INDEX_6 : PHASE_INDEX_4;
    return tuple[indexMap[phase]] ?? null;
}

export function clamp(v: number, lo = -1, hi = 1): number {
    return Math.max(lo, Math.min(hi, v));
}

function resampleStance(rel: InterPartRelation, selfTrust: number): void {
    const sample = drawInitialStance(rel.stanceMagnitude, rel.stanceFlipOdds, selfTrust);
    rel.stance = clamp(0.25 * rel.stance + 0.75 * sample);
}

function nominateSpeakRole(speakRoleId: string, state: SimState, out: SimEvent[]): void {
    const { partA, partB, relAB, relBA, conversation } = state;
    const listenRoleId = speakRoleId === partA.id ? partB.id : partA.id;
    conversation.speakRoleId = speakRoleId;
    conversation.phases.set(speakRoleId, 'speak');
    conversation.phases.set(listenRoleId, 'listen');
    conversation.respondTimer = 0;
    const rel = speakRoleId === partA.id ? relAB : relBA;
    const selfTrust = speakRoleId === partA.id ? partA.selfTrust : partB.selfTrust;
    resampleStance(rel, selfTrust);
    conversation.therapistDeltas.delete(speakRoleId);
    conversation.shockDeltas.delete(speakRoleId);
    out.push({ kind: 'nominate', data: { speakRoleId, sampledStance: rel.stance } });
    rollTupleIndex(rel, conversation);
}

export function addInterPartTrust(rel: InterPartRelation, delta: number): void {
    if (rel.trustFloor > 0 && delta < 0) delta *= 0.5;
    const newTrust = rel.trust + delta;
    if (newTrust < rel.trustFloor) {
        const overflow = rel.trustFloor - newTrust;
        const extremeDir = Math.sign(rel.stance) || 1;
        rel.stance = clamp(rel.stance + extremeDir * overflow * 0.4);
    }
    rel.trust = clamp(newTrust, rel.trustFloor, 1);
}

export function getEffectiveStance(stance: number, therapistDelta: number): number {
    return clamp(stance + therapistDelta);
}

export function stanceDescription(stance: number): string {
    if (stance > STANCE_FLOODING) return 'flooding';
    if (stance > REGULATION_STANCE_LIMIT) return 'dysregulated';
    if (stance > -REGULATION_STANCE_LIMIT) return 'regulated';
    if (stance > STANCE_SHUTDOWN) return 'withdrawing';
    return 'shut down';
}

function randNormal(mean: number, stddev: number): number {
    // Box-Muller
    const u = 1 - Math.random();
    const v = Math.random();
    return mean + stddev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Draw an initial stance given base magnitude, flip odds, and self-trust.
// magnitude: signed default stance value [-1,1]; sign is the default direction
// flipOdds: probability of flipping to opposite sign [0,0.5]
// selfTrust: [0,1] — lower = more variable and more extreme
export function drawInitialStance(magnitude: number, flipOdds: number, selfTrust: number): number {
    const stddev = (1 - selfTrust) / 4;
    const shift = 0.5 * (1 - selfTrust);
    const sample = Math.max(0, Math.min(1, randNormal(0.5, stddev)));
    const drawn = Math.sign(magnitude) * Math.min(1, Math.abs(magnitude) * (sample + shift));
    return Math.random() < flipOdds ? -drawn : drawn;
}

function initConversation(state: SimState): void {
    const { partA, partB, relAB, relBA, conversation } = state;
    relAB.stance = drawInitialStance(relAB.stance, relAB.stanceFlipOdds, partA.selfTrust);
    relBA.stance = drawInitialStance(relBA.stance, relBA.stanceFlipOdds, partB.selfTrust);
    const stanceA = getEffectiveStance(relAB.stance, 0);
    const stanceB = getEffectiveStance(relBA.stance, 0);
    conversation.effectiveStances.set(partA.id, stanceA);
    conversation.effectiveStances.set(partB.id, stanceB);
    if (stanceA < 0 && stanceB < 0) {
        conversation.phases.set(partA.id, 'waiting');
        conversation.phases.set(partB.id, 'waiting');
    } else {
        const speakRoleId = stanceA >= stanceB ? partA.id : partB.id;
        const listenRoleId = speakRoleId === partA.id ? partB.id : partA.id;
        conversation.speakRoleId = speakRoleId;
        conversation.phases.set(speakRoleId, 'speak');
        conversation.phases.set(listenRoleId, 'listen');
        const initRel = speakRoleId === partA.id ? relAB : relBA;
        rollTupleIndex(initRel, conversation);
    }
}

function updateEffectiveStances(state: SimState): void {
    const { partA, partB, relAB, relBA, conversation } = state;
    const dA = (conversation.therapistDeltas.get(partA.id) ?? 0) + (conversation.shockDeltas.get(partA.id) ?? 0);
    const dB = (conversation.therapistDeltas.get(partB.id) ?? 0) + (conversation.shockDeltas.get(partB.id) ?? 0);
    conversation.effectiveStances.set(partA.id, getEffectiveStance(relAB.stance, dA));
    conversation.effectiveStances.set(partB.id, getEffectiveStance(relBA.stance, dB));
}

function applyStanceShock(shockSourceId: string, receiverId: string, sourceStance: number, state: SimState, out: SimEvent[], dysregulated = false): void {
    const receiverRel = receiverId === state.partA.id ? state.relAB : state.relBA;
    const selfTrust = receiverId === state.partA.id ? state.partA.selfTrust : state.partB.selfTrust;
    const streak = state.conversation.dysregStreak.get(receiverId) ?? 0;
    const [deltaDefault, deltaFlip, probFlip] = shockParams(sourceStance, selfTrust, receiverRel, streak);
    if (dysregulated) {
        state.conversation.dysregStreak.set(receiverId, streak + 1);
    } else {
        state.conversation.dysregStreak.delete(receiverId);
    }
    const shockDelta = Math.random() < probFlip ? deltaFlip : deltaDefault;
    const shockMag = Math.abs(shockDelta);
    if (shockMag === 0) return;
    const effectiveStanceBefore = state.conversation.effectiveStances.get(receiverId) ?? receiverRel.stance;
    const prevShockDelta = state.conversation.shockDeltas.get(receiverId) ?? 0;
    const rawNext = prevShockDelta + shockDelta;
    const floorDelta = -1 - receiverRel.stance;
    const newShockDelta = clamp(rawNext, floorDelta, 1 - receiverRel.stance);
    const negOverflow = Math.max(0, floorDelta - rawNext);
    state.conversation.shockDeltas.set(receiverId, newShockDelta);
    updateEffectiveStances(state);
    const effectiveStanceAfter = state.conversation.effectiveStances.get(receiverId) ?? receiverRel.stance;
    if (negOverflow > 0) {
        const trustBefore = receiverRel.trust;
        addInterPartTrust(receiverRel, -OVERFLOW_TRUST_PENALTY * negOverflow);
        logTrustChange(state, receiverRel, trustBefore, shockSourceId, receiverId, 'overflow', out);
    }
    out.push({ kind: 'shock', data: { receiverId, shockDelta, effectiveStanceBefore, effectiveStanceAfter, accumulatedShockDelta: newShockDelta, simTime: state.simTime } });

    // Polarity flip: if receiver effective stance is dysregulated negative, shock may trigger a reversal.
    if (effectiveStanceAfter < -REGULATION_STANCE_LIMIT && Math.random() < receiverRel.stanceFlipOdds) {
        const receiverSelfTrust = receiverId === state.partA.id ? state.partA.selfTrust : state.partB.selfTrust;
        const s0 = effectiveStanceAfter;
        const s1 = drawInitialStance(-s0, 0, receiverSelfTrust);
        const rawBefore = receiverRel.stance;
        receiverRel.stance = clamp(s1);
        state.conversation.shockDeltas.delete(receiverId);
        out.push({ kind: 'rawStance', data: { partId: receiverId, rawStanceBefore: rawBefore, rawStanceAfter: receiverRel.stance, reason: 'flip', simTime: state.simTime } });
        const sourceRel2 = shockSourceId === state.partA.id ? state.relAB : state.relBA;
        const sourceRawBefore = sourceRel2.stance;
        sourceRel2.stance = clamp(sourceRel2.stance - (s1 - s0));
        out.push({ kind: 'rawStance', data: { partId: shockSourceId, rawStanceBefore: sourceRawBefore, rawStanceAfter: sourceRel2.stance, reason: 'counter-shock', simTime: state.simTime } });
        updateEffectiveStances(state);
        const pool = [...GENERIC_FLIP_UTTERANCES, ...(receiverRel.flipUtterances ?? [])];
        const utterance = pool[Math.floor(Math.random() * pool.length)];
        const flipMsg: Message = {
            id: ++state.messageCounter,
            senderId: receiverId,
            text: utterance,
            phase: 'speak',
            type: 'dialogue',
        };
        state.messages.push(flipMsg);
        out.push({ kind: 'message', data: flipMsg });

        // Flipped part becomes the new SpeakRole
        const newListenRoleId = receiverId === state.partA.id ? state.partB.id : state.partA.id;
        state.conversation.speakRoleId = receiverId;
        state.conversation.phases.set(receiverId, 'speak');
        state.conversation.phases.set(newListenRoleId, 'listen');
        state.conversation.respondTimer = 0;
        const flipperRel = receiverId === state.partA.id ? state.relAB : state.relBA;
        rollTupleIndex(flipperRel, state.conversation);

        const receiverName = receiverId === state.partA.id ? state.partA.name : state.partB.name;
        const sourceName = shockSourceId === state.partA.id ? state.partA.name : state.partB.name;
        const msg2: Message = {
            id: ++state.messageCounter,
            senderId: receiverId,
            text: `${receiverName} flipped: ${s0.toFixed(2)} → ${s1.toFixed(2)}; ${sourceName} counter-shock ${(-(s0 - s1)).toFixed(2)}`,
            phase: 'listen',
            type: 'trust',
            subtype: 'counter-shock',
        };
        state.messages.push(msg2);
        out.push({ kind: 'message', data: msg2 });
    }
}

function logTrustChange(state: SimState, rel: InterPartRelation, before: number, fromId: string, toId: string, reason: string, out: SimEvent[]): void {
    const after = rel.trust;
    if (Math.abs(after - before) < 0.001) return;
    const fromName = fromId === state.partA.id ? state.partA.name : state.partB.name;
    const toName = toId === state.partA.id ? state.partA.name : state.partB.name;
    const msg: Message = {
        id: ++state.messageCounter,
        senderId: toId,
        text: `${fromName}→${toName} trust ${before.toFixed(2)} → ${after.toFixed(2)} (${reason})`,
        phase: 'listen',
        type: 'trust',
        subtype: reason === 'cycle complete' ? 'cycle-complete' : reason === 'overflow' ? 'overflow' : undefined,
    };
    state.messages.push(msg);
    out.push({ kind: 'message', data: msg });
}

// Returns [newSpeakRolePhase, newListenRolePhase] or null if no transition applies.
// sixStep: true when the active tuple has 6 entries (adds clarify + mirror_again between mirror and validate).
export function nextPhases(phaseS: IfioPhase, phaseL: IfioPhase, sixStep = false): [IfioPhase, IfioPhase] | null {
    if (phaseS === 'speak'    && phaseL === 'listen')    return ['listen', 'mirror'];
    if (phaseS === 'listen'   && phaseL === 'mirror')    return sixStep ? ['clarify', 'listen'] : ['validate', 'listen'];
    if (phaseS === 'clarify'  && phaseL === 'listen')    return ['listen', 'mirror_again'];
    if (phaseS === 'listen'   && phaseL === 'mirror_again')   return ['validate', 'listen'];
    if (phaseS === 'validate' && phaseL === 'listen')    return ['listen', 'empathize'];
    if (phaseS === 'listen'   && phaseL === 'empathize') return ['listen', 'listen'];
    return null;
}

function activeTupleLength(state: SimState): number {
    const speakRoleId = state.conversation.speakRoleId;
    const rel = speakRoleId === state.partA.id ? state.relAB : state.relBA;
    const band = getTrustBand(rel.trust);
    const pool = rel.dialogues?.[band];
    if (!pool || pool.length === 0) return 4;
    return pool[state.conversation.activeTupleIndex % pool.length].length;
}

function tryAdvancePhase(state: SimState, out: SimEvent[]): void {
    const { partA, partB, relAB, relBA, conversation } = state;
    const speakRoleId = conversation.speakRoleId;
    const listenRoleId = speakRoleId === partA.id ? partB.id : partA.id;
    const phaseS = conversation.phases.get(speakRoleId)!;
    const phaseL = conversation.phases.get(listenRoleId)!;
    const relSL = speakRoleId === partA.id ? relAB : relBA;

    const sixStep = activeTupleLength(state) === 6;
    const next = nextPhases(phaseS, phaseL, sixStep);
    if (!next) return;

    const [newPhaseSR, newPhaseLR] = next;
    conversation.respondTimer = 0;
    conversation.phases.set(speakRoleId, newPhaseSR);
    conversation.phases.set(listenRoleId, newPhaseLR);

    out.push({
        kind: 'phase', data: {
            speakRoleId, listenRoleId,
            oldPhaseSR: phaseS, oldPhaseLR: phaseL,
            newPhaseSR, newPhaseLR,
            rawStanceA: relAB.stance, rawStanceB: relBA.stance,
            simTime: state.simTime,
        }
    });

    if (phaseS === 'listen' && phaseL === 'empathize') {
        const before = relSL.trust;
        addInterPartTrust(relSL, CYCLE_TRUST_BOOST_FACTOR * (1 - relSL.trust));
        logTrustChange(state, relSL, before, speakRoleId, listenRoleId, 'cycle complete', out);
        relSL.stance = relSL.stance * CYCLE_STANCE_SOFTEN;
        state.cyclesCompleted++;
    }
}

// Minimal scalar state for lookahead simulation (no dialogues, no messages)
interface LookaheadState {
    speakRoleId: string;
    phaseA: IfioPhase;
    phaseB: IfioPhase;
    stanceA: number;
    stanceB: number;
    regulationScore: number;
    respondTimer: number;
    newCycleTimer: number;
    listenRoleViolationTimer: number;
    speakRoleViolationTimer: number;
    simTime: number;
}

// Run a lightweight forward sim until an utterance fires or time limit exceeded.
// Returns [uttererIsA, timeUntilUtterance].
export function lookaheadUtterance(state: SimState, maxLook = 8): [boolean, number] {
    const { partA, partB, conversation } = state;
    const SUB = 0.05; // substep size in sim-seconds

    let ls: LookaheadState = {
        speakRoleId: conversation.speakRoleId,
        phaseA: conversation.phases.get(partA.id) ?? 'listen',
        phaseB: conversation.phases.get(partB.id) ?? 'listen',
        stanceA: conversation.effectiveStances.get(partA.id) ?? 0,
        stanceB: conversation.effectiveStances.get(partB.id) ?? 0,
        regulationScore: conversation.regulationScore,
        respondTimer: conversation.respondTimer,
        newCycleTimer: conversation.newCycleTimer,
        listenRoleViolationTimer: conversation.listenRoleViolationTimer,
        speakRoleViolationTimer: conversation.speakRoleViolationTimer,
        simTime: 0,
    };

    const isA = (id: string) => id === partA.id;

    for (let t = 0; t < maxLook; t += SUB) {
        const dt = SUB;
        const { phaseA, phaseB } = ls;
        const bothListen = phaseA === 'listen' && phaseB === 'listen';

        // Update regulation score
        const bothInRange = Math.abs(ls.stanceA) < REGULATION_STANCE_LIMIT && Math.abs(ls.stanceB) < REGULATION_STANCE_LIMIT;
        ls.regulationScore = bothInRange
            ? Math.min(1, ls.regulationScore + REGULATION_RECOVER_RATE * dt)
            : Math.max(0, ls.regulationScore - REGULATION_DECAY_RATE * dt);
        const regulated = ls.regulationScore > 0.5;

        if (bothListen) {
            ls.newCycleTimer += dt;
            if (ls.newCycleTimer >= NEW_CYCLE_DELAY) {
                ls.newCycleTimer = 0;
                ls.speakRoleId = ls.stanceA >= ls.stanceB ? partA.id : partB.id;
                ls.phaseA = isA(ls.speakRoleId) ? 'speak' : 'listen';
                ls.phaseB = isA(ls.speakRoleId) ? 'listen' : 'speak';
                ls.respondTimer = 0;
            }
        } else {
            ls.newCycleTimer = 0;
            const phaseS = isA(ls.speakRoleId) ? ls.phaseA : ls.phaseB;
            const phaseL = isA(ls.speakRoleId) ? ls.phaseB : ls.phaseA;

            // ListenRole violation: ListenRole part floods → role swap
            const listenRoleIsA = !isA(ls.speakRoleId);
            const listenRoleStance = listenRoleIsA ? ls.stanceA : ls.stanceB;
            if (listenRoleStance > REGULATION_STANCE_LIMIT) {
                ls.listenRoleViolationTimer += dt;
                if (ls.listenRoleViolationTimer >= LISTEN_ROLE_VIOLATION_GRACE) {
                    ls.listenRoleViolationTimer = 0;
                    ls.speakRoleId = listenRoleIsA ? partA.id : partB.id;
                    ls.phaseA = isA(ls.speakRoleId) ? 'speak' : 'listen';
                    ls.phaseB = isA(ls.speakRoleId) ? 'listen' : 'speak';
                    ls.respondTimer = 0;
                }
            } else {
                ls.listenRoleViolationTimer = 0;
            }

            // SpeakRole dysregulated utterance — mirrors real tick logic
            const speakRoleIsA = isA(ls.speakRoleId);
            const speakRoleStance = speakRoleIsA ? ls.stanceA : ls.stanceB;
            if (!regulated && speakRoleStance >= REGULATION_STANCE_LIMIT) {
                if (phaseS === 'listen') {
                    ls.speakRoleViolationTimer += dt;
                    if (ls.speakRoleViolationTimer >= LISTEN_ROLE_VIOLATION_GRACE) {
                        ls.speakRoleViolationTimer = 0;
                        return [speakRoleIsA, t + dt];
                    }
                } else {
                    ls.speakRoleViolationTimer = 0;
                    const s = Math.min(1, Math.max(0, speakRoleStance + 0.3));
                    if (Math.random() < s * SPEAK_BASE_RATE * dt) return [speakRoleIsA, t + dt];
                }
            } else {
                ls.speakRoleViolationTimer = 0;
            }

            // Normal utterance: whoever holds a non-listen phase, when regulated
            const uttererIsA = ls.phaseA !== 'listen';
            const uttererPhase = uttererIsA ? ls.phaseA : ls.phaseB;
            if (uttererPhase !== 'listen' && regulated) {
                ls.respondTimer += dt;
                if (ls.respondTimer >= RESPOND_DELAY) return [uttererIsA, t + dt];
            }
        }
    }
    // No utterance found within lookahead window — return midpoint as fallback
    return [isA(state.conversation.speakRoleId), maxLook / 2];
}

function tickBall(state: SimState, dt: number): void {
    const { partA, conversation } = state;
    const phaseA = conversation.phases.get(partA.id) ?? 'listen';
    const phaseB = conversation.phases.get(state.partB.id) ?? 'listen';
    const bothListen = phaseA === 'listen' && phaseB === 'listen';

    // Lookahead: who will utter next and when?
    const [uttererIsA, ttu] = lookaheadUtterance(state);
    conversation.ballUttererIsA = uttererIsA;

    const imminentThreshold = 3.0;
    if (ttu > imminentThreshold) {
        // No imminent utterance — spring to center
        const force = 8 * (0.5 - conversation.ballPos) - 5 * conversation.ballVel;
        conversation.ballVel += force * dt;
    } else {
        // Drive ball to utterer's extreme, arriving in ttu seconds
        const uttererExtreme = uttererIsA ? 0.0 : 1.0;
        const timeLeft = Math.max(ttu, dt);
        const distLeft = uttererExtreme - conversation.ballPos;
        const targetVel = distLeft / timeLeft;
        conversation.ballVel += (targetVel - conversation.ballVel) * Math.min(1, dt / 0.1);
    }

    conversation.ballPos = Math.max(0, Math.min(1, conversation.ballPos + conversation.ballVel * dt));

    // Bias: slow EMA toward whichever side the ball spends time on
    const sideTarget = conversation.ballPos > 0.5 ? 1 : 0;
    const distFromCenter = Math.abs(conversation.ballPos - 0.5);
    const pullRate = 0.8 * distFromCenter * 2;
    const decayRate = 0.4 * (1 - distFromCenter * 2);
    conversation.ballBias += (sideTarget - conversation.ballBias) * pullRate * dt;
    conversation.ballBias += (0.5 - conversation.ballBias) * decayRate * dt;
    conversation.ballBias = Math.max(0, Math.min(1, conversation.ballBias));
}

export function tick(state: SimState, dt: number): SimEvent[] {
    const out: SimEvent[] = [];
    updateEffectiveStances(state);

    const { partA, partB, relAB, relBA, conversation } = state;
    const stanceA = conversation.effectiveStances.get(partA.id)!;
    const stanceB = conversation.effectiveStances.get(partB.id)!;
    const phaseA = conversation.phases.get(partA.id)!;
    const phaseB = conversation.phases.get(partB.id)!;

    if (phaseA === 'waiting' && phaseB === 'waiting') {
        // Decay therapist deltas so Activate nudges work normally
        for (const [id, delta] of conversation.therapistDeltas) {
            const newDelta = delta * Math.exp(-DELTA_DECAY_RATE * dt);
            if (Math.abs(newDelta) < 0.001) conversation.therapistDeltas.delete(id);
            else conversation.therapistDeltas.set(id, newDelta);
        }
        updateEffectiveStances(state);
        const effA = conversation.effectiveStances.get(partA.id)!;
        const effB = conversation.effectiveStances.get(partB.id)!;
        if (effA >= 0 || effB >= 0) {
            const speakRoleId = effA >= effB ? partA.id : partB.id;
            nominateSpeakRole(speakRoleId, state, out);
        }
        state.simTime += dt;
        return out;
    }

    if (phaseA === 'listen' && phaseB === 'listen') {
        conversation.newCycleTimer += dt;
        if (conversation.newCycleTimer >= NEW_CYCLE_DELAY) {
            conversation.newCycleTimer = 0;
            if (stanceA < 0 && stanceB < 0) {
                conversation.phases.set(partA.id, 'waiting');
                conversation.phases.set(partB.id, 'waiting');
                out.push({
                    kind: 'phase', data: {
                        speakRoleId: partA.id, listenRoleId: partB.id,
                        oldPhaseSR: 'listen', oldPhaseLR: 'listen',
                        newPhaseSR: 'waiting', newPhaseLR: 'waiting',
                        rawStanceA: relAB.stance, rawStanceB: relBA.stance,
                        simTime: state.simTime,
                    }
                });
            } else {
                const newSpeakRoleId = stanceA >= stanceB ? partA.id : partB.id;
                nominateSpeakRole(newSpeakRoleId, state, out);
            }
        }
        tickBall(state, dt);
        state.simTime += dt;
        return out;
    }
    conversation.newCycleTimer = 0;

    const speakRoleId = conversation.speakRoleId;
    const listenRoleId = speakRoleId === partA.id ? partB.id : partA.id;
    const phaseS = conversation.phases.get(speakRoleId)!;
    const phaseL = conversation.phases.get(listenRoleId)!;

    const listenRolePart: string | null = phaseS !== 'waiting' ? listenRoleId : null;

    if (listenRolePart) {
        const listenRoleStance = conversation.effectiveStances.get(listenRolePart)!;
        if (listenRoleStance > REGULATION_STANCE_LIMIT) {
            conversation.listenRoleViolationTimer += dt;
            if (conversation.listenRoleViolationTimer >= LISTEN_ROLE_VIOLATION_GRACE) {
                conversation.listenRoleViolationTimer = 0;
                const newListenRolePart = listenRolePart === partA.id ? partB.id : partA.id;
                const oldPhaseSR = phaseS;
                const oldPhaseLR = phaseL;
                conversation.speakRoleId = listenRolePart;
                conversation.phases.set(listenRolePart, 'speak');
                conversation.phases.set(newListenRolePart, 'listen');
                conversation.respondTimer = 0;
                const violatorRel = listenRolePart === partA.id ? relAB : relBA;
                rollTupleIndex(violatorRel, conversation);
                out.push({
                    kind: 'phase', data: {
                        speakRoleId: listenRolePart, listenRoleId: newListenRolePart,
                        oldPhaseSR, oldPhaseLR,
                        newPhaseSR: 'speak', newPhaseLR: 'listen',
                        rawStanceA: relAB.stance, rawStanceB: relBA.stance,
                        simTime: state.simTime,
                    }
                });
                const violatorName = listenRolePart === partA.id ? partA.name : partB.name;
                const swapMsg: Message = {
                    id: ++state.messageCounter,
                    senderId: listenRolePart,
                    text: `${violatorName} took over as SpeakRole (flooding while listening)`,
                    phase: 'listen',
                    type: 'trust',
                };
                state.messages.push(swapMsg);
                out.push({ kind: 'message', data: swapMsg });
                // Immediately fire a dysregulated utterance from the new SpeakRole (the violator).
                // The shock pushes the new ListenRole toward negative stance, breaking the
                // oscillation loop where both parts remain dysregulated indefinitely.
                updateEffectiveStances(state);
                const newSpeakerStance = conversation.effectiveStances.get(listenRolePart)!;
                const utteranceText = getDialogue(violatorRel, 'speak', conversation);
                if (utteranceText) {
                    const utterMsg: Message = {
                        id: ++state.messageCounter,
                        senderId: listenRolePart,
                        text: utteranceText,
                        phase: 'speak',
                        type: 'dialogue',
                        subtype: 'dysregulated',
                        senderStance: newSpeakerStance,
                    };
                    state.messages.push(utterMsg);
                    out.push({ kind: 'message', data: utterMsg });
                    applyStanceShock(listenRolePart, newListenRolePart, newSpeakerStance, state, out, true);
                    conversation.dysregulatedSpokePending = true;
                }
                tickBall(state, dt);
                state.simTime += dt;
                return out;
            }
        } else {
            conversation.listenRoleViolationTimer = 0;
        }
    }

    const bothInRange = Math.abs(stanceA) < REGULATION_STANCE_LIMIT && Math.abs(stanceB) < REGULATION_STANCE_LIMIT;
    if (bothInRange) {
        conversation.regulationScore = Math.min(1, conversation.regulationScore + REGULATION_RECOVER_RATE * dt);
    } else {
        conversation.regulationScore = Math.max(0, conversation.regulationScore - REGULATION_DECAY_RATE * dt);
    }

    for (const [id, delta] of conversation.therapistDeltas) {
        const newDelta = delta * Math.exp(-DELTA_DECAY_RATE * dt);
        if (Math.abs(newDelta) < 0.001) conversation.therapistDeltas.delete(id);
        else conversation.therapistDeltas.set(id, newDelta);
    }
    for (const [id, delta] of conversation.shockDeltas) {
        const newDelta = delta * Math.exp(-DELTA_DECAY_RATE * dt);
        if (Math.abs(newDelta) < 0.001) conversation.shockDeltas.delete(id);
        else conversation.shockDeltas.set(id, newDelta);
    }

    const regulated = conversation.regulationScore > 0.5;
    const speakRoleStance = conversation.effectiveStances.get(speakRoleId)!;
    const speakRoleRel = speakRoleId === partA.id ? relAB : relBA;

    // SpeakRole dysregulated utterance — fires regardless of which phase slot SpeakRole currently holds.
    // When holding an active phase (speak/validate/clarify/mirror_again): probabilistic each tick.
    // When holding listen (ListenRole's turn): timer-gated with grace period.
    // Either way: repeats the current or most recent SpeakRole-phase line, doesn't advance phase.
    function fireDysregulatedSpeak(): void {
        let activePhase: IfioPhase;
        if (phaseS === 'validate' || phaseS === 'clarify' || phaseS === 'mirror_again') {
            activePhase = phaseS;
        } else if (phaseS === 'listen') {
            activePhase = phaseL === 'empathize' ? 'validate' : phaseL === 'mirror_again' ? 'clarify' : 'speak';
        } else {
            activePhase = 'speak';
            rollTupleIndex(speakRoleRel, conversation);
        }
        const text = getDialogue(speakRoleRel, activePhase, conversation);
        if (text) {
            const msg: Message = { id: ++state.messageCounter, senderId: speakRoleId, text, phase: 'speak', type: 'dialogue', subtype: 'dysregulated', senderStance: speakRoleStance };
            state.messages.push(msg);
            out.push({ kind: 'message', data: msg });
            applyStanceShock(speakRoleId, listenRoleId, speakRoleStance, state, out, true);
            conversation.dysregulatedSpokePending = true;
        }
    }

    if (regulated && conversation.dysregulatedSpokePending) {
        conversation.dysregulatedSpokePending = false;
        conversation.speakRoleViolationTimer = 0;
        if (phaseS !== 'listen')
            tryAdvancePhase(state, out);
    } else if (!regulated && speakRoleStance >= REGULATION_STANCE_LIMIT) {
        if (phaseS === 'listen') {
            conversation.speakRoleViolationTimer += dt;
            if (conversation.speakRoleViolationTimer >= LISTEN_ROLE_VIOLATION_GRACE) {
                conversation.speakRoleViolationTimer = 0;
                fireDysregulatedSpeak();
            }
        } else {
            conversation.speakRoleViolationTimer = 0;
            const s = Math.min(1, Math.max(0, speakRoleStance + 0.3));
            if (Math.random() < s * SPEAK_BASE_RATE * dt) fireDysregulatedSpeak();
        }
    } else {
        conversation.speakRoleViolationTimer = 0;
    }

    // Normal utterance path — whoever holds a non-listen phase this tick.
    if (!conversation.dysregulatedSpokePending) {
        const utterer = phaseS !== 'listen' ? speakRoleId : listenRoleId;
        const uttererPhase = conversation.phases.get(utterer)!;
        const uttererReceiver = utterer === speakRoleId ? listenRoleId : speakRoleId;

        if (uttererPhase !== 'listen' && regulated) {
            const uttererStance = conversation.effectiveStances.get(utterer)!;
            conversation.respondTimer += dt;
            if (conversation.respondTimer >= RESPOND_DELAY) {
                const text = getDialogue(speakRoleRel, uttererPhase, conversation);
                if (text) {
                    const msg: Message = { id: ++state.messageCounter, senderId: utterer, text, phase: uttererPhase, type: 'dialogue' };
                    state.messages.push(msg);
                    out.push({ kind: 'message', data: msg });
                    applyStanceShock(utterer, uttererReceiver, uttererStance, state, out, false);
                    tryAdvancePhase(state, out);
                }
            }
        }
    }

    tickBall(state, dt);
    state.simTime += dt;
    return out;
}

export interface SetupValues {
    selfTrustA: number;
    selfTrustB: number;
    stanceA: number;
    stanceB: number;
    flipOddsA: number;
    flipOddsB: number;
}

export interface ScenarioConfig {
    partA: Omit<Part, 'selfTrust'>;
    partB: Omit<Part, 'selfTrust'>;
    relAB: { trust: number; trustFloor: number; dialogues: ConversationDialogues };
    relBA: { trust: number; trustFloor: number; dialogues: ConversationDialogues };
}

export function createState(setup: SetupValues, scenario: ScenarioConfig): SimState {
    const partA: Part = { ...scenario.partA, selfTrust: setup.selfTrustA };
    const partB: Part = { ...scenario.partB, selfTrust: setup.selfTrustB };

    const relAB: InterPartRelation = {
        ...scenario.relAB,
        stance: setup.stanceA,
        stanceMagnitude: setup.stanceA,
        stanceFlipOdds: setup.flipOddsA,
    };

    const relBA: InterPartRelation = {
        ...scenario.relBA,
        stance: setup.stanceB,
        stanceMagnitude: setup.stanceB,
        stanceFlipOdds: setup.flipOddsB,
    };

    const conversation: ConversationState = {
        speakRoleId: partA.id,
        phases: new Map(),
        effectiveStances: new Map(),
        therapistDeltas: new Map(),
        shockDeltas: new Map(),
        activeTupleIndex: 0,
        regulationScore: 0,
        respondTimer: 0,
        newCycleTimer: 0,
        listenRoleViolationTimer: 0,
        speakRoleViolationTimer: 0,
        ballPos: 0.5,
        ballVel: 0,
        ballUttererIsA: true,
        ballBias: 0.5,
        dysregulatedSpokePending: false,
        dysregStreak: new Map(),
    };

    const state: SimState = {
        partA, partB, relAB, relBA, conversation,
        messages: [], messageCounter: 0,
        simTime: 0, cyclesCompleted: 0,
    };
    initConversation(state);
    return state;
}
