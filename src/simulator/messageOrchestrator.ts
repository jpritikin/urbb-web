import { SimulatorModel, PartMessage } from './ifsModel.js';
import { PartStateManager, type IfioPhase } from '../cloud/partStateManager.js';
import { RNG, pickRandom } from '../playback/testability/rng.js';
import type { ConvEvent } from '../playback/testability/types.js';

export const REGULATION_STANCE_LIMIT = 0.3;

export interface MessageOrchestratorCallbacks {
    act: (label: string, fn: () => void) => void;
    showThoughtBubble: (text: string, cloudId: string, partInitiated?: boolean) => void;
    getCloudById: (id: string) => { id: string } | null;
}

export class MessageOrchestrator {
    private getModel: () => SimulatorModel;
    private getRelationships: () => PartStateManager;
    private rng: RNG;
    private callbacks: MessageOrchestratorCallbacks;

    private messageCooldownTimers: Map<string, number> = new Map();
    private blendStartTimers: Map<string, number> = new Map();
    private pendingSummonTargets: Map<string, string> = new Map();
    private summonArrivalTimers: Map<string, number> = new Map();
    private genericDialogueCooldowns: Map<string, number> = new Map();
    private selfLoathingCooldowns: Map<string, number> = new Map();
    private regulationScore: number = 0;
    private respondTimer: number = 0;
    private newCycleTimer: number = 0;
    private listenRoleViolationTimer: number = 0;
    private speakRoleViolationTimer: number = 0;
    private dysregulatedStreaks: Map<string, number> = new Map();
    private dysregulatedSpokePending: boolean = false;
    private currentCycleLength: 4 | 6 = 4;
    private currentTupleIndex: number = 0;

    private setCurrentTuple(speakerId: string, listenerId: string, rng: () => number): void {
        this.currentTupleIndex = this.relationships.pickTupleIndex(speakerId, listenerId, rng);
        this.currentCycleLength = this.relationships.getTupleLength(speakerId, listenerId, this.currentTupleIndex);
    }
    private convLog: ConvEvent[] = [];

    private readonly BLEND_MESSAGE_DELAY = 2;
    private readonly GENERIC_DIALOGUE_INTERVAL = 8;
    private readonly SELF_LOATHING_INTERVAL = 10;
    private readonly SPEAK_BASE_RATE = 0.5;
    private readonly RESPOND_DELAY = 3;
    private readonly NEW_CYCLE_DELAY = 4;
    private readonly REGULATION_RECOVER_RATE = 0.5;
    private readonly REGULATION_DECAY_RATE = 0.3;
    private readonly SUMMON_ARRIVAL_DELAY = 2;
    private readonly LISTENER_VIOLATION_GRACE = 1.0;
    private readonly STREAK_K = Math.log(1.2) / 5;
    private readonly CYCLE_TRUST_BOOST_FACTOR = 0.3;
    private readonly CYCLE_STANCE_SOFTEN = 0.7;
    private readonly OVERFLOW_TRUST_PENALTY = 0.2;

    constructor(
        getModel: () => SimulatorModel,
        getRelationships: () => PartStateManager,
        rng: RNG,
        callbacks: MessageOrchestratorCallbacks
    ) {
        this.getModel = getModel;
        this.getRelationships = getRelationships;
        this.rng = rng;
        this.callbacks = callbacks;
        const savedState = getModel().getOrchestratorState();
        if (savedState) {
            this.restoreState(savedState);
        }
    }

    private get model(): SimulatorModel {
        return this.getModel();
    }

    private get relationships(): PartStateManager {
        return this.getRelationships();
    }

    setRNG(rng: RNG): void {
        this.rng = rng;
    }

    updateTimers(deltaTime: number): void {
        for (const [key, time] of this.messageCooldownTimers) {
            this.messageCooldownTimers.set(key, time + deltaTime);
        }
        const blendedParts = this.model.getBlendedParts();
        for (const blendedId of blendedParts) {
            const currentTime = this.blendStartTimers.get(blendedId) ?? 0;
            const newTime = currentTime + deltaTime;
            this.blendStartTimers.set(blendedId, newTime);
        }
        for (const blendedId of this.blendStartTimers.keys()) {
            if (!blendedParts.includes(blendedId)) {
                this.blendStartTimers.delete(blendedId);
            }
        }

        for (const [key, time] of this.summonArrivalTimers) {
            const remaining = time - deltaTime;
            if (remaining <= 0) {
                this.summonArrivalTimers.delete(key);
            } else {
                this.summonArrivalTimers.set(key, remaining);
            }
        }

        const arrivedMessages = this.model.advanceMessages(deltaTime);
        for (const message of arrivedMessages) {
            this.callbacks.act(`message arrived ${message.id}`, () => {
                this.model.removeMessage(message.id);
            });
        }
        this.model.setOrchestratorState(this.getDebugState());
    }

    onMessageReceived(message: PartMessage): void {
        this.callbacks.act(`message arrived ${message.id}`, () => {
            this.model.removeMessage(message.id);
        });
    }

    checkAndSendBlendedUtterances(deltaTime: number): void {
        const blendedParts = this.model.getBlendedParts();
        const targetIds = this.model.getTargetCloudIds();

        for (const blendedId of blendedParts) {
            const blendedCloud = this.callbacks.getCloudById(blendedId);
            if (!blendedCloud) continue;

            if (this.model.parts.isFormerProtector(blendedId)) continue;

            const blendTime = this.blendStartTimers.get(blendedId) ?? 0;
            if (blendTime < this.BLEND_MESSAGE_DELAY) continue;

            const conversationPeers = this.getConversationPeers(blendedId);
            if (conversationPeers.length === 0) continue;

            const timeSinceSent = this.messageCooldownTimers.get(blendedId) ?? 10;
            if (timeSinceSent < 3) continue;

            let targetId = this.pendingSummonTargets.get(blendedId);

            if (!targetId) {
                targetId = this.rng.pickRandom(conversationPeers, 'blended_utterance_target');
                const phaseStance = this.relationships.getPhaseStance(blendedId, targetId, () => this.rng.random('stance_flip'));
                const s = phaseStance + 0.3;
                const speakProb = Math.max(0, s) ** 2 * this.SPEAK_BASE_RATE * deltaTime;
                if (this.rng.random('blended_speak') >= speakProb) continue;
            }

            const tupleIdx = this.relationships.pickTupleIndex(blendedId, targetId, () => this.rng.random('dialogue_pick'));
            const text = this.relationships.getTupleDialogue(blendedId, targetId, tupleIdx, 'speak');
            if (!text) continue;

            if (!targetIds.has(targetId) && targetId !== blendedId) {
                const blenderName = this.model.parts.getPartName(blendedId);
                const targetName = this.model.parts.getPartName(targetId);
                this.callbacks.act(`${blenderName} summons ${targetName}`, () => {
                    this.model.addTargetCloud(targetId);
                });
                this.pendingSummonTargets.set(blendedId, targetId);
                this.summonArrivalTimers.set(targetId, this.SUMMON_ARRIVAL_DELAY);
                this.messageCooldownTimers.set(blendedId, 0);
                continue;
            }

            if (this.summonArrivalTimers.has(targetId)) continue;

            this.sendBlendedUtterance(blendedId, targetId, text);
            this.messageCooldownTimers.set(blendedId, 0);
            this.pendingSummonTargets.delete(blendedId);
        }
    }

    private getConversationPeers(blendedId: string): string[] {
        const targets = this.relationships.getInterPartRelationTargets(blendedId);
        const peers: string[] = [];
        for (const targetId of targets) {
            if (targetId === blendedId) continue;
            if (this.relationships.hasInterPartDialogue(blendedId, targetId)) {
                peers.push(targetId);
            }
        }
        return peers;
    }

    private sendBlendedUtterance(senderId: string, targetId: string, text: string): void {
        const damage = 0.3;
        this.model.parts.addInterPartTrust(senderId, targetId, -damage, () => this.rng.random('blended_trust_damage'));
        this.model.parts.adjustTrust(targetId, 0.99);
        this.model.changeNeedAttention(senderId, -0.25);
        this.sendMessage(senderId, targetId, text);
    }

    checkAndShowGenericDialogues(deltaTime: number): void {
        const blendedParts = this.model.getBlendedParts();

        for (const blendedId of this.genericDialogueCooldowns.keys()) {
            if (!blendedParts.includes(blendedId)) {
                this.genericDialogueCooldowns.delete(blendedId);
            }
        }

        for (const blendedId of blendedParts) {

            const blendTime = this.blendStartTimers.get(blendedId) ?? 0;
            if (blendTime < this.BLEND_MESSAGE_DELAY) continue;

            if (this.getConversationPeers(blendedId).length > 0) continue;

            const dialogues = this.model.parts.getDialogues(blendedId)?.genericBlendedDialogues;
            if (!dialogues || dialogues.length === 0) continue;

            let cooldown = this.genericDialogueCooldowns.get(blendedId) ?? this.GENERIC_DIALOGUE_INTERVAL;
            cooldown += deltaTime;

            while (cooldown >= this.GENERIC_DIALOGUE_INTERVAL) {
                const text = pickRandom(dialogues);
                this.callbacks.showThoughtBubble(text, blendedId);
                this.model.changeNeedAttention(blendedId, -0.25);
                cooldown -= this.GENERIC_DIALOGUE_INTERVAL;
            }
            this.genericDialogueCooldowns.set(blendedId, cooldown);
        }
    }

    checkAndShowSelfLoathing(deltaTime: number): void {
        const blendedParts = this.model.getBlendedParts();

        for (const id of this.selfLoathingCooldowns.keys()) {
            if (!blendedParts.includes(id)) {
                this.selfLoathingCooldowns.delete(id);
            }
        }

        for (const blendedId of blendedParts) {
            const blendTime = this.blendStartTimers.get(blendedId) ?? 0;
            if (blendTime < this.BLEND_MESSAGE_DELAY) continue;

            if (!this.relationships.hasHostileRelation(blendedId, blendedId)) continue;

            let cooldown = this.selfLoathingCooldowns.get(blendedId) ?? this.SELF_LOATHING_INTERVAL;
            cooldown += deltaTime;

            while (cooldown >= this.SELF_LOATHING_INTERVAL) {
                const dialogue = this.relationships.getRumination(blendedId, () => this.rng.random('dialogue_pick'));
                if (!dialogue) break;
                this.callbacks.showThoughtBubble(dialogue, blendedId);
                this.model.changeNeedAttention(blendedId, -0.25);
                cooldown -= this.SELF_LOATHING_INTERVAL;
            }
            this.selfLoathingCooldowns.set(blendedId, cooldown);
        }
    }

    checkJealousy(deltaTime: number): void {
        const relations = this.relationships.getRelationSummaries();

        for (const rel of relations) {
            if (rel.fromId === rel.toId) continue;
            const jealousId = rel.fromId;
            const favoredId = rel.toId;
            if (this.model.isBlended(jealousId)) continue;
            const jealousTrust = this.relationships.getTrust(jealousId);
            if (jealousTrust >= 0.75) continue;
            const favoredTrust = this.relationships.getTrust(favoredId);
            if (jealousTrust >= favoredTrust) continue;
            const diff = favoredTrust - jealousTrust;
            const interPartRel = this.relationships.getInterPartRelation(jealousId, favoredId);
            if (interPartRel && interPartRel.trustFloor > 0) continue;
            const interTrust = this.relationships.getInterPartTrust(jealousId, favoredId);
            const triggerProb = diff - (interTrust + 0.15);
            if (triggerProb <= 0) continue;
            if (this.rng.random('jealousy') >= Math.sqrt(triggerProb) * 0.09) continue;

            if (!this.model.getConferenceCloudIds().has(jealousId)) {
                this.model.changeNeedAttention(jealousId, diff);
                continue;
            }

            this.applyJealousy(jealousId, favoredId);
        }
    }

    private applyJealousy(jealousId: string, favoredId: string): void {
        this.relationships.setTrust(jealousId, 0);
        this.model.changeNeedAttention(jealousId, 1.0);
        const favoredName = this.model.parts.getPartName(favoredId);
        this.callbacks.showThoughtBubble(`You like ${favoredName} more than me`, jealousId, false);
    }

    private static readonly DYSREGULATED_LABELS: [number, string][] = [
        [0.50, 'Nag'],
        [0.65, 'Jab'],
        [0.75, 'Snap'],
        [0.85, 'Accuse'],
        [0.95, 'Shout'],
        [1.01, 'Explode'],
    ];

    private static readonly PHASE_LABEL_MAP: Record<string, string> = {
        speak: 'Speak', mirror: 'Mirror', clarify: 'Clarify',
        mirror_again: 'Mirror again', validate: 'Validate', empathize: 'Empathize',
    };

    private dysregulatedLabel(stance: number): string {
        const entry = MessageOrchestrator.DYSREGULATED_LABELS.find(([threshold]) => stance < threshold);
        return entry ? entry[1] : 'Explode';
    }

    checkAndShowConversationDialogues(deltaTime: number): void {
        const participantIds = this.model.getConversationParticipantIds();
        if (!participantIds) {
            this.regulationScore = 0;
            this.respondTimer = 0;
            this.newCycleTimer = 0;
            this.speakRoleViolationTimer = 0;
            return;
        }
        const [partA, partB] = participantIds;

        this.checkListenerViolation(deltaTime, partA, partB);
        this.advanceConversationPhases(deltaTime, partA, partB);

        const regulated = this.regulationScore > 0.5;
        const speakRoleId = this.model.getConversationSpeakerId();

        // When regulation recovers after a dysregulated outburst, advance phase immediately.
        if (regulated && this.dysregulatedSpokePending) {
            this.dysregulatedSpokePending = false;
            this.speakRoleViolationTimer = 0;
            this.respondTimer = 0;
            if (speakRoleId) {
                const speakRolePhase = this.model.getConversationPhase(speakRoleId);
                if (speakRolePhase !== 'listen') {
                    this.tryAdvancePhase(partA, partB);
                }
            }
            return;
        }

        // SpeakRole dysregulated utterance — fires regardless of which active phase SpeakRole holds.
        // When in `listen` (waiting for ListenRole): timer-gated.
        // When in an active phase (speak/validate/clarify/mirror_again): probabilistic each tick.
        // Either way: doesn't advance phase; sets dysregulatedSpokePending so phase advances on regulation recovery.
        if (!regulated && speakRoleId) {
            const speakRoleStance = this.model.getConversationEffectiveStance(speakRoleId);
            const speakRolePhase = this.model.getConversationPhase(speakRoleId);
            const listenRoleId = speakRoleId === partA ? partB : partA;
            const isSpeakRoleActive = speakRolePhase === 'speak' || speakRolePhase === 'validate' || speakRolePhase === 'clarify' || speakRolePhase === 'mirror_again';

            if (speakRoleStance >= REGULATION_STANCE_LIMIT) {
                if (speakRolePhase === 'listen') {
                    this.speakRoleViolationTimer += deltaTime;
                    if (this.speakRoleViolationTimer >= this.LISTENER_VIOLATION_GRACE) {
                        this.speakRoleViolationTimer = 0;
                        const listenRolePhase = this.model.getConversationPhase(listenRoleId);
                        const activePhase = listenRolePhase === 'empathize' ? 'validate'
                            : listenRolePhase === 'mirror_again' ? 'clarify'
                            : 'speak';
                        const text = this.relationships.getTupleDialogue(speakRoleId, listenRoleId, this.currentTupleIndex, activePhase);
                        if (text) {
                            this.sendConversationMessage(speakRoleId, listenRoleId, text, this.dysregulatedLabel(speakRoleStance), speakRoleStance, true);
                            this.applyStanceShock(speakRoleId, listenRoleId, speakRoleStance);
                            this.dysregulatedSpokePending = true;
                        }
                    }
                } else if (isSpeakRoleActive) {
                    this.speakRoleViolationTimer = 0;
                    const s = Math.max(0, speakRoleStance + 0.3);
                    if (this.rng.random('conv_speak') < s * this.SPEAK_BASE_RATE * deltaTime) {
                        if (speakRolePhase === 'speak') {
                            this.setCurrentTuple(speakRoleId, listenRoleId, () => this.rng.random('cycle_length'));
                        }
                        const text = this.relationships.getTupleDialogue(speakRoleId, listenRoleId, this.currentTupleIndex, speakRolePhase);
                        if (text) {
                            this.sendConversationMessage(speakRoleId, listenRoleId, text, this.dysregulatedLabel(speakRoleStance), speakRoleStance, true);
                            this.applyStanceShock(speakRoleId, listenRoleId, speakRoleStance);
                            this.dysregulatedSpokePending = true;
                        }
                    }
                } else {
                    this.speakRoleViolationTimer = 0;
                }
            } else {
                this.speakRoleViolationTimer = 0;
            }
        } else if (regulated) {
            this.speakRoleViolationTimer = 0;
        }

        if (this.dysregulatedSpokePending) return;

        for (const partId of [partA, partB]) {
            const otherId = partId === partA ? partB : partA;
            const effectiveStance = this.model.getConversationEffectiveStance(partId);
            const phase = this.model.getConversationPhase(partId);
            if (!phase || phase === 'listen') continue;

            let shouldSpeak = false;
            let advanceAfter = false;
            if (phase === 'speak') {
                if (regulated) {
                    this.respondTimer += deltaTime;
                    if (this.respondTimer >= this.RESPOND_DELAY) {
                        shouldSpeak = true;
                        advanceAfter = true;
                        this.respondTimer = 0;
                    }
                } else if (effectiveStance >= REGULATION_STANCE_LIMIT) {
                    // Handled above via dysreg path; skip here to avoid double-fire on speak phase
                }
            } else {
                // Non-speak active phases: only fire when regulated (dysreg handled above)
                if (regulated) {
                    this.respondTimer += deltaTime;
                    if (this.respondTimer >= this.RESPOND_DELAY) {
                        shouldSpeak = true;
                        advanceAfter = true;
                        this.respondTimer = 0;
                    }
                }
            }
            if (!shouldSpeak) continue;

            const [tupleFromId, tupleToId] = speakRoleId === partId
                ? [partId, otherId]
                : [otherId, partId];
            const text = this.relationships.getTupleDialogue(tupleFromId, tupleToId, this.currentTupleIndex, phase);
            if (text) {
                const label = MessageOrchestrator.PHASE_LABEL_MAP[phase] ?? phase;
                this.sendConversationMessage(partId, otherId, text, label, effectiveStance, false);
                this.applyStanceShock(partId, otherId, effectiveStance);
                if (advanceAfter) {
                    this.tryAdvancePhase(partA, partB);
                }
            }
        }
    }

    private checkListenerViolation(deltaTime: number, partA: string, partB: string): void {
        const speakerId = this.model.getConversationSpeakerId();
        const phaseA = this.model.getConversationPhase(partA);
        const phaseB = this.model.getConversationPhase(partB);

        // After empathize completion both are 'listen' — after NEW_CYCLE_DELAY, part with highest stance becomes speaker
        if (phaseA === 'listen' && phaseB === 'listen') {
            const stanceA = this.model.getConversationEffectiveStance(partA);
            const stanceB = this.model.getConversationEffectiveStance(partB);
            const bothNegative = stanceA < 0 && stanceB < 0;
            if (bothNegative) {
                // Waiting state: therapist Activate (addTherapistStanceDelta) can push one above 0
                const aboveZero = stanceA >= 0 ? partA : stanceB >= 0 ? partB : null;
                if (aboveZero) {
                    this.resetConversation(aboveZero, partA, partB, 'activate');
                }
                return;
            }
            this.newCycleTimer += deltaTime;
            if (this.newCycleTimer >= this.NEW_CYCLE_DELAY) {
                const newSpeaker = stanceA >= stanceB ? partA : partB;
                this.resetConversation(newSpeaker, partA, partB, 'new-cycle');
            }
            return;
        }
        this.newCycleTimer = 0;

        const speakRoleId = this.model.getConversationSpeakerId();
        if (!speakRoleId) return;
        const listenRoleId = speakRoleId === partA ? partB : partA;
        const phaseS = this.model.getConversationPhase(speakRoleId);
        const phaseL = this.model.getConversationPhase(listenRoleId);

        // Check whether the ListenRole part is dysregulated — if so, it interrupts and becomes the new SpeakRole part.
        // The SpeakRole part in the `listen` phase (waiting for ListenRole to act) is handled separately by
        // speakRoleViolationTimer and is excluded here.
        let listenRoleViolating = false;
        if (phaseS === 'speak' && phaseL === 'listen') listenRoleViolating = true;
        else if (phaseS === 'listen' && phaseL === 'mirror') listenRoleViolating = true;
        else if (phaseS === 'listen' && phaseL === 'mirror_again') listenRoleViolating = true;
        else if (phaseS === 'clarify' && phaseL === 'listen') listenRoleViolating = true;
        else if (phaseS === 'validate' && phaseL === 'listen') listenRoleViolating = true;
        else if (phaseS === 'listen' && phaseL === 'empathize') listenRoleViolating = true;

        if (!listenRoleViolating) {
            this.listenRoleViolationTimer = 0;
            return;
        }

        const stance = this.model.getConversationEffectiveStance(listenRoleId);
        if (stance > REGULATION_STANCE_LIMIT) {
            this.listenRoleViolationTimer += deltaTime;
            if (this.listenRoleViolationTimer >= this.LISTENER_VIOLATION_GRACE) {
                this.listenRoleViolationTimer = 0;
                this.resetConversation(listenRoleId, partA, partB, 'listen-violation');
                // Immediately fire a dysregulated utterance from the new SpeakRole (the violator).
                // The shock will push the new ListenRole toward negative stance, breaking the
                // oscillation loop where both parts remain dysregulated indefinitely.
                const newListenRoleId = listenRoleId === partA ? partB : partA;
                const newStance = this.model.getConversationEffectiveStance(listenRoleId);
                const text = this.relationships.getTupleDialogue(listenRoleId, newListenRoleId, this.currentTupleIndex, 'speak');
                if (text) {
                    this.sendConversationMessage(listenRoleId, newListenRoleId, text, this.dysregulatedLabel(newStance), newStance, true);
                    this.applyStanceShock(listenRoleId, newListenRoleId, newStance);
                    this.dysregulatedSpokePending = true;
                }
            }
        } else {
            this.listenRoleViolationTimer = 0;
        }
    }

    private resetConversation(newSpeakRoleId: string, partA: string, partB: string, reason: 'new-cycle' | 'listen-violation' | 'activate' | 'flip'): void {
        const newListenRoleId = newSpeakRoleId === partA ? partB : partA;
        const speakRoleRel = this.relationships.getRelation(newSpeakRoleId, newListenRoleId);
        if (speakRoleRel) {
            const oldStance = speakRoleRel.stance;
            const selfTrust = this.model.getSelfTrust(newSpeakRoleId);
            const fresh = PartStateManager.drawInitialStance(Math.abs(oldStance), selfTrust, () => this.rng.random('resample_stance'));
            const flipped = this.rng.random('resample_flip') < speakRoleRel.stanceFlipOdds;
            const newStance = 0.75 * (flipped ? -fresh : fresh) + 0.25 * oldStance;
            this.callbacks.act(`reset conversation → ${newSpeakRoleId}`, () => {
                speakRoleRel.stance = Math.max(-1, Math.min(1, newStance));
                this.model.setConversationSpeakerId(newSpeakRoleId);
                this.model.setConversationPhase(newSpeakRoleId, 'speak');
                this.model.setConversationPhase(newListenRoleId, 'listen');
            });
        } else {
            this.callbacks.act(`reset conversation → ${newSpeakRoleId}`, () => {
                this.model.setConversationSpeakerId(newSpeakRoleId);
                this.model.setConversationPhase(newSpeakRoleId, 'speak');
                this.model.setConversationPhase(newListenRoleId, 'listen');
            });
        }
        this.setCurrentTuple(newSpeakRoleId, newListenRoleId, () => this.rng.random('cycle_length'));
        this.convLog.push({ kind: 'nominate', newSpeakerId: newSpeakRoleId, nominateReason: reason });
        this.respondTimer = 0;
        this.newCycleTimer = 0;
        this.speakRoleViolationTimer = 0;
        this.dysregulatedSpokePending = false;
        this.dysregulatedStreaks.clear();
    }

    getAndResetConvLog(): ConvEvent[] {
        const log = this.convLog;
        this.convLog = [];
        return log;
    }

    private sendConversationMessage(senderId: string, targetId: string, text: string, phaseLabel?: string, senderStance?: number, dysregulated?: boolean): void {
        const senderName = this.model.parts.getPartName(senderId);
        const targetName = this.model.parts.getPartName(targetId);
        this.convLog.push({ kind: 'utterance', senderId, receiverId: targetId, phase: phaseLabel, senderStance, dysregulated });
        this.callbacks.act(`${senderName} speaks to ${targetName}`, () => {
            this.model.sendMessage(senderId, targetId, text, 'conversation', phaseLabel);
        });
    }

    private applyStanceShock(speakerId: string, receiverId: string, speakerStance: number): void {
        const rel = this.relationships.getRelation(receiverId, speakerId);
        if (!rel) return;
        const selfTrust = this.model.getSelfTrust(receiverId);
        const interTrust = rel.trust;

        const streak = this.dysregulatedStreaks.get(receiverId) ?? 0;
        const regulated = Math.abs(speakerStance) < REGULATION_STANCE_LIMIT;
        if (regulated) {
            this.dysregulatedStreaks.set(receiverId, 0);
        } else {
            this.dysregulatedStreaks.set(receiverId, streak + 1);
        }

        const streakMult = Math.exp(this.STREAK_K * streak);
        const shockMagnitude = streakMult * 0.3 * Math.abs(speakerStance) * 2 / ((1 + selfTrust) * (1 + interTrust));

        // Default: positive speaker pushes receiver negative (opposite polarity); with flipOdds: pulls toward speaker
        const pullToward = this.rng.random('stance_shock') < rel.stanceFlipOdds;
        const direction = pullToward ? Math.sign(speakerStance) : -Math.sign(speakerStance);
        if (direction === 0) return;

        const receiverEffBefore = this.model.getConversationEffectiveStance(receiverId);
        const newEffective = receiverEffBefore + direction * shockMagnitude;

        if (newEffective < -1) {
            const overflow = -1 - newEffective;
            this.callbacks.act(`stance shock ${speakerId}→${receiverId}`, () => {
                this.model.addConversationShockDelta(receiverId, direction * shockMagnitude);
                this.relationships.addInterPartTrust(receiverId, speakerId, -this.OVERFLOW_TRUST_PENALTY * overflow, () => this.rng.random('shock_trust'));
            });
        } else {
            this.callbacks.act(`stance shock ${speakerId}→${receiverId}`, () => {
                this.model.addConversationShockDelta(receiverId, direction * shockMagnitude);
            });
        }

        const receiverEffAfter = this.model.getConversationEffectiveStance(receiverId);
        this.convLog.push({ kind: 'shock', senderId: speakerId, receiverId, senderStance: speakerStance, shockDelta: direction * shockMagnitude, receiverEffBefore, receiverEffAfter });

        // Polarity flip: withdrawn receiver erupts when shocked negative
        if (receiverEffAfter < -REGULATION_STANCE_LIMIT && this.rng.random('polarity_flip') < rel.stanceFlipOdds) {
            this.triggerPolarityFlip(receiverId, speakerId, receiverEffAfter);
        }
    }

    private triggerPolarityFlip(partId: string, speakerId: string, effectiveStance: number): void {
        const selfTrust = this.model.getSelfTrust(partId);
        const flipMagnitude = PartStateManager.drawInitialStance(-effectiveStance, selfTrust, () => this.rng.random('flip_draw'));
        this.callbacks.act(`polarity flip ${partId}`, () => {
            const rel = this.relationships.getRelation(partId, speakerId);
            if (rel) rel.stance = flipMagnitude;
            // Zero out this part's shock and counter-shock the speaker
            const currentShock = this.model.getConversationShockDelta(partId);
            this.model.addConversationShockDelta(partId, -currentShock);
            this.model.addConversationShockDelta(speakerId, -flipMagnitude * 0.5);
            this.model.setConversationSpeakerId(partId);
            const participantIds = this.model.getConversationParticipantIds()!;
            const [a, b] = participantIds;
            const newListenRoleId = partId === a ? b : a;
            this.model.setConversationPhase(partId, 'speak');
            this.model.setConversationPhase(newListenRoleId, 'listen');
        });
        this.setCurrentTuple(partId, speakerId, () => this.rng.random('cycle_length'));
        this.convLog.push({ kind: 'nominate', newSpeakerId: partId, nominateReason: 'flip' });
        this.respondTimer = 0;
        this.newCycleTimer = 0;
        this.speakRoleViolationTimer = 0;
        const outbursts = ["I can't take it anymore!", "That's it, I'm done!", 'Stop!', 'You never listen!'];
        this.callbacks.showThoughtBubble(outbursts[Math.floor(this.rng.random('outburst') * outbursts.length)], partId);
    }

    private advanceConversationPhases(deltaTime: number, partA: string, partB: string): void {
        const stanceA = this.model.getConversationEffectiveStance(partA);
        const stanceB = this.model.getConversationEffectiveStance(partB);
        const bothInRange = Math.abs(stanceA) < REGULATION_STANCE_LIMIT && Math.abs(stanceB) < REGULATION_STANCE_LIMIT;

        if (bothInRange) {
            this.regulationScore = Math.min(1, this.regulationScore + this.REGULATION_RECOVER_RATE * deltaTime);
        } else {
            this.regulationScore = Math.max(0, this.regulationScore - this.REGULATION_DECAY_RATE * deltaTime);
        }

        if (this.regulationScore <= 0.5) {
        }
    }


    private tryAdvancePhase(partA: string, partB: string): void {
        const speakRoleId = this.model.getConversationSpeakerId();
        if (!speakRoleId) return;
        const listenRoleId = speakRoleId === partA ? partB : partA;

        const phaseS = this.model.getConversationPhase(speakRoleId);
        const phaseL = this.model.getConversationPhase(listenRoleId);
        if (!phaseS || !phaseL) return;

        this.respondTimer = 0;

        if (this.currentCycleLength === 6) {
            // 6-step repair loop:
            // SR:speak/LR:listen → SR:listen/LR:mirror → SR:clarify/LR:listen → SR:listen/LR:mirror_again → SR:validate/LR:listen → SR:listen/LR:empathize
            if (phaseS === 'speak' && phaseL === 'listen') {
                this.model.setConversationPhase(speakRoleId, 'listen');
                this.model.setConversationPhase(listenRoleId, 'mirror');
            } else if (phaseS === 'listen' && phaseL === 'mirror') {
                this.model.setConversationPhase(speakRoleId, 'clarify');
                this.model.setConversationPhase(listenRoleId, 'listen');
            } else if (phaseS === 'clarify' && phaseL === 'listen') {
                this.model.setConversationPhase(speakRoleId, 'listen');
                this.model.setConversationPhase(listenRoleId, 'mirror_again');
            } else if (phaseS === 'listen' && phaseL === 'mirror_again') {
                this.model.setConversationPhase(speakRoleId, 'validate');
                this.model.setConversationPhase(listenRoleId, 'listen');
            } else if (phaseS === 'validate' && phaseL === 'listen') {
                this.model.setConversationPhase(speakRoleId, 'listen');
                this.model.setConversationPhase(listenRoleId, 'empathize');
            } else if (phaseS === 'listen' && phaseL === 'empathize') {
                this.completeEmpathize(listenRoleId, speakRoleId);
            }
        } else {
            // 4-step standard: SR:speak/LR:listen → SR:listen/LR:mirror → SR:validate/LR:listen → SR:listen/LR:empathize
            if (phaseS === 'speak' && phaseL === 'listen') {
                this.model.setConversationPhase(speakRoleId, 'listen');
                this.model.setConversationPhase(listenRoleId, 'mirror');
            } else if (phaseS === 'listen' && phaseL === 'mirror') {
                this.model.setConversationPhase(speakRoleId, 'validate');
                this.model.setConversationPhase(listenRoleId, 'listen');
            } else if (phaseS === 'validate' && phaseL === 'listen') {
                this.model.setConversationPhase(speakRoleId, 'listen');
                this.model.setConversationPhase(listenRoleId, 'empathize');
            } else if (phaseS === 'listen' && phaseL === 'empathize') {
                this.completeEmpathize(listenRoleId, speakRoleId);
            }
        }
    }

    private completeEmpathize(listenRoleId: string, speakRoleId: string): void {
        const trustBoost = (id: string, otherId: string) => {
            const rel = this.relationships.getRelation(id, otherId);
            const trust = rel?.trust ?? 0;
            const delta = this.CYCLE_TRUST_BOOST_FACTOR * (1 - trust);
            this.relationships.addInterPartTrust(id, otherId, delta, () => this.rng.random('empathize_trust'));
        };
        trustBoost(speakRoleId, listenRoleId);

        // Soften SpeakRole part's raw stance
        const speakRoleRel = this.relationships.getRelation(speakRoleId, listenRoleId);
        if (speakRoleRel) {
            this.callbacks.act(`soften stance ${speakRoleId}`, () => {
                speakRoleRel.stance *= this.CYCLE_STANCE_SOFTEN;
            });
        }

        this.model.setConversationPhase(listenRoleId, 'listen');
        this.model.setConversationPhase(speakRoleId, 'listen');
        this.dysregulatedSpokePending = false;
        this.dysregulatedStreaks.clear();
    }

    getDebugState(): { blendTimers: Record<string, number>; cooldowns: Record<string, number>; pending: Record<string, string>; respondTimer: number; regulationScore: number; newCycleTimer: number; listenRoleViolationTimer: number; speakRoleViolationTimer: number; selfLoathingCooldowns: Record<string, number>; genericDialogueCooldowns: Record<string, number>; summonArrivalTimers: Record<string, number>; dysregulatedStreaks: Record<string, number>; dysregulatedSpokePending: boolean; currentCycleLength: number; currentTupleIndex: number } {
        return {
            blendTimers: Object.fromEntries(this.blendStartTimers),
            cooldowns: Object.fromEntries(this.messageCooldownTimers),
            pending: Object.fromEntries(this.pendingSummonTargets),
            respondTimer: this.respondTimer,
            regulationScore: this.regulationScore,
            newCycleTimer: this.newCycleTimer,
            listenRoleViolationTimer: this.listenRoleViolationTimer,
            speakRoleViolationTimer: this.speakRoleViolationTimer,
            selfLoathingCooldowns: Object.fromEntries(this.selfLoathingCooldowns),
            genericDialogueCooldowns: Object.fromEntries(this.genericDialogueCooldowns),
            summonArrivalTimers: Object.fromEntries(this.summonArrivalTimers),
            dysregulatedStreaks: Object.fromEntries(this.dysregulatedStreaks),
            dysregulatedSpokePending: this.dysregulatedSpokePending,
            currentCycleLength: this.currentCycleLength,
            currentTupleIndex: this.currentTupleIndex,
        };
    }

    restoreState(snapshot: { blendTimers?: Record<string, number>; cooldowns?: Record<string, number>; pending?: Record<string, string>; respondTimer?: number; regulationScore?: number; newCycleTimer?: number; listenRoleViolationTimer?: number; speakRoleViolationTimer?: number; selfLoathingCooldowns?: Record<string, number>; genericDialogueCooldowns?: Record<string, number>; summonArrivalTimers?: Record<string, number>; dysregulatedStreaks?: Record<string, number>; dysregulatedSpokePending?: boolean; currentCycleLength?: number; currentTupleIndex?: number }): void {
        if (snapshot.blendTimers) {
            this.blendStartTimers = new Map(Object.entries(snapshot.blendTimers));
        }
        if (snapshot.cooldowns) {
            this.messageCooldownTimers = new Map(Object.entries(snapshot.cooldowns));
        }
        if (snapshot.pending) {
            this.pendingSummonTargets = new Map(Object.entries(snapshot.pending));
        }
        if (snapshot.respondTimer !== undefined) this.respondTimer = snapshot.respondTimer;
        if (snapshot.regulationScore !== undefined) this.regulationScore = snapshot.regulationScore;
        if (snapshot.newCycleTimer !== undefined) this.newCycleTimer = snapshot.newCycleTimer;
        if (snapshot.listenRoleViolationTimer !== undefined) this.listenRoleViolationTimer = snapshot.listenRoleViolationTimer;
        if (snapshot.speakRoleViolationTimer !== undefined) this.speakRoleViolationTimer = snapshot.speakRoleViolationTimer;
        if (snapshot.selfLoathingCooldowns) {
            this.selfLoathingCooldowns = new Map(Object.entries(snapshot.selfLoathingCooldowns));
        }
        if (snapshot.genericDialogueCooldowns) {
            this.genericDialogueCooldowns = new Map(Object.entries(snapshot.genericDialogueCooldowns));
        }
        if (snapshot.summonArrivalTimers) {
            this.summonArrivalTimers = new Map(Object.entries(snapshot.summonArrivalTimers));
        }
        if (snapshot.dysregulatedStreaks) {
            this.dysregulatedStreaks = new Map(Object.entries(snapshot.dysregulatedStreaks).map(([k, v]) => [k, Number(v)]));
        }
        if (snapshot.dysregulatedSpokePending !== undefined) this.dysregulatedSpokePending = snapshot.dysregulatedSpokePending;
        if (snapshot.currentCycleLength !== undefined) {
            this.currentCycleLength = snapshot.currentCycleLength === 6 ? 6 : 4;
        }
        if (snapshot.currentTupleIndex !== undefined) {
            this.currentTupleIndex = snapshot.currentTupleIndex;
        }
    }

    private sendMessage(senderId: string, targetId: string, text: string): void {
        const senderName = this.model.parts.getPartName(senderId);
        const targetName = this.model.parts.getPartName(targetId);
        this.callbacks.act(`${senderName} speaks to ${targetName}`, () => {
            this.model.sendMessage(senderId, targetId, text, 'conversation');
        });
    }
}
