import { SimulatorModel, PartMessage } from './ifsModel.js';
import { PartStateManager, type IfioPhase } from '../cloud/partStateManager.js';
import { RNG, pickRandom } from '../playback/testability/rng.js';

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
    private sustainedRegulationTimer: number = 0;
    private regulationScore: number = 0;
    private respondTimer: number = 0;
    private newCycleTimer: number = 0;
    private listenerViolationTimer: number = 0;
    private dysregulatedStreaks: Map<string, number> = new Map();
    private currentCycleLength: 4 | 6 = 4;
    private currentTupleIndex: number = 0;

    private readonly BLEND_MESSAGE_DELAY = 2;
    private readonly GENERIC_DIALOGUE_INTERVAL = 8;
    private readonly SELF_LOATHING_INTERVAL = 10;
    private readonly SPEAK_BASE_RATE = 0.5;
    private readonly RESPOND_DELAY = 3;
    private readonly NEW_CYCLE_DELAY = 4;
    private readonly SUSTAINED_TRUST_INTERVAL = 10;
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

    checkAndShowConversationDialogues(deltaTime: number): void {
        const participantIds = this.model.getConversationParticipantIds();
        if (!participantIds) {
            this.sustainedRegulationTimer = 0;
            this.regulationScore = 0;
            this.respondTimer = 0;
            this.newCycleTimer = 0;
            return;
        }
        const [partA, partB] = participantIds;

        this.checkListenerViolation(deltaTime, partA, partB);
        this.advanceConversationPhases(deltaTime, partA, partB);

        const regulated = this.regulationScore > 0.5;

        const speakerId = this.model.getConversationSpeakerId();

        for (const partId of [partA, partB]) {
            const otherId = partId === partA ? partB : partA;
            const effectiveStance = this.model.getConversationEffectiveStance(partId);
            const phase = this.model.getConversationPhase(partId);
            if (!phase || phase === 'listen') continue;

            let shouldSpeak = false;
            let advanceAfter = false;
            if (phase === 'speak') {
                if (regulated) {
                    // Regulated: send one message then advance phase
                    this.respondTimer += deltaTime;
                    if (this.respondTimer >= this.RESPOND_DELAY) {
                        shouldSpeak = true;
                        advanceAfter = true;
                        this.respondTimer = 0;
                    }
                } else if (effectiveStance >= REGULATION_STANCE_LIMIT) {
                    // Dysregulated flooding: probabilistic speaking, no phase advance
                    const s = effectiveStance + 0.3;
                    const speakProb = Math.max(0, s) ** 2 * this.SPEAK_BASE_RATE * deltaTime;
                    shouldSpeak = this.rng.random('conv_speak') < speakProb;
                }
            } else {
                // Non-speak phases (mirror/clarify/validate/empathize): only when regulated
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

            // All lines come from the speaker's tuple (speaker→listener relation)
            const [tupleFromId, tupleToId] = speakerId === partId
                ? [partId, otherId]
                : [otherId, partId];
            const text = this.relationships.getTupleDialogue(tupleFromId, tupleToId, this.currentTupleIndex, phase);
            if (text) {
                const DYSREGULATED_LABELS = ['Nag', 'Jab', 'Snap'];
                const PHASE_LABEL_MAP: Record<string, string> = {
                    speak: 'Speak', mirror: 'Mirror', clarify: 'Clarify',
                    mirror_again: 'Mirror again', validate: 'Validate', empathize: 'Empathize',
                };
                const phaseLabel = phase === 'speak' && !advanceAfter
                    ? DYSREGULATED_LABELS[Math.floor(this.rng.random('dysreg_label') * DYSREGULATED_LABELS.length)]
                    : (PHASE_LABEL_MAP[phase] ?? phase);
                this.sendConversationMessage(partId, otherId, text, phaseLabel);
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
                    this.resetConversation(aboveZero, partA, partB);
                }
                return;
            }
            this.newCycleTimer += deltaTime;
            if (this.newCycleTimer >= this.NEW_CYCLE_DELAY) {
                const newSpeaker = stanceA >= stanceB ? partA : partB;
                this.resetConversation(newSpeaker, partA, partB);
            }
            return;
        }
        this.newCycleTimer = 0;

        if (!speakerId) return;
        const listenerId = speakerId === partA ? partB : partA;
        const phaseS = this.model.getConversationPhase(speakerId);
        const phaseL = this.model.getConversationPhase(listenerId);

        // Determine who should be passively listening right now
        let currentListeningPart: string | null = null;
        if (phaseS === 'speak' && phaseL === 'listen') currentListeningPart = listenerId;
        else if (phaseS === 'listen' && phaseL === 'mirror') currentListeningPart = speakerId;
        else if (phaseS === 'listen' && phaseL === 'mirror_again') currentListeningPart = speakerId;
        else if (phaseS === 'clarify' && phaseL === 'listen') currentListeningPart = listenerId;
        else if (phaseS === 'validate' && phaseL === 'listen') currentListeningPart = listenerId;
        else if (phaseS === 'listen' && phaseL === 'empathize') currentListeningPart = speakerId;

        if (!currentListeningPart) {
            this.listenerViolationTimer = 0;
            return;
        }

        const stance = this.model.getConversationEffectiveStance(currentListeningPart);
        if (stance > REGULATION_STANCE_LIMIT) {
            this.listenerViolationTimer += deltaTime;
            if (this.listenerViolationTimer >= this.LISTENER_VIOLATION_GRACE) {
                this.listenerViolationTimer = 0;
                this.resetConversation(currentListeningPart, partA, partB);
            }
        } else {
            this.listenerViolationTimer = 0;
        }
    }

    private resetConversation(newSpeakerId: string, partA: string, partB: string): void {
        const newListenerId = newSpeakerId === partA ? partB : partA;
        const speakerRel = this.relationships.getRelation(newSpeakerId, newListenerId);
        if (speakerRel) {
            const oldStance = speakerRel.stance;
            const selfTrust = this.model.getSelfTrust(newSpeakerId);
            const fresh = PartStateManager.drawInitialStance(Math.abs(oldStance), selfTrust, () => this.rng.random('resample_stance'));
            const flipped = this.rng.random('resample_flip') < speakerRel.stanceFlipOdds;
            const newStance = 0.75 * (flipped ? -fresh : fresh) + 0.25 * oldStance;
            this.callbacks.act(`reset conversation → ${newSpeakerId}`, () => {
                speakerRel.stance = Math.max(-1, Math.min(1, newStance));
                this.model.setConversationSpeakerId(newSpeakerId);
                this.model.setConversationPhase(newSpeakerId, 'speak');
                this.model.setConversationPhase(newListenerId, 'listen');
            });
        } else {
            this.callbacks.act(`reset conversation → ${newSpeakerId}`, () => {
                this.model.setConversationSpeakerId(newSpeakerId);
                this.model.setConversationPhase(newSpeakerId, 'speak');
                this.model.setConversationPhase(newListenerId, 'listen');
            });
        }
        this.currentTupleIndex = this.relationships.pickTupleIndex(newSpeakerId, newListenerId, () => this.rng.random('cycle_length'));
        this.currentCycleLength = this.relationships.getTupleLength(newSpeakerId, newListenerId, this.currentTupleIndex);
        this.respondTimer = 0;
        this.newCycleTimer = 0;
        this.dysregulatedStreaks.clear();
    }

    private sendConversationMessage(senderId: string, targetId: string, text: string, phaseLabel?: string): void {
        const senderName = this.model.parts.getPartName(senderId);
        const targetName = this.model.parts.getPartName(targetId);
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

        const currentShock = this.model.getConversationShockDelta(receiverId);
        const receiverEffective = this.model.getConversationEffectiveStance(receiverId);
        const newEffective = receiverEffective + direction * shockMagnitude;

        if (newEffective < -1) {
            const overflow = -1 - newEffective;
            this.callbacks.act(`stance shock ${speakerId}→${receiverId}`, () => {
                this.model.addConversationShockDelta(receiverId, direction * shockMagnitude);
                this.relationships.addInterPartTrust(receiverId, speakerId, -this.OVERFLOW_TRUST_PENALTY * overflow, () => this.rng.random('shock_trust'));
            });
        } else {
            this.callbacks.act(`stance shock ${speakerId}→${receiverId}`, () => {
                this.model.addConversationShockDelta(receiverId, direction * shockMagnitude);
                this.relationships.addInterPartTrust(receiverId, speakerId, -shockMagnitude, () => this.rng.random('shock_trust'));
            });
        }

        // Polarity flip: withdrawn receiver erupts when shocked negative
        const receiverStanceAfter = this.model.getConversationEffectiveStance(receiverId);
        if (receiverStanceAfter < -REGULATION_STANCE_LIMIT && this.rng.random('polarity_flip') < rel.stanceFlipOdds) {
            this.triggerPolarityFlip(receiverId, speakerId, receiverStanceAfter);
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
            const listenerId = partId === a ? b : a;
            this.model.setConversationPhase(partId, 'speak');
            this.model.setConversationPhase(listenerId, 'listen');
        });
        this.respondTimer = 0;
        this.newCycleTimer = 0;
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

        if (this.regulationScore > 0.5) {
            this.sustainedRegulationTimer += deltaTime;
            if (this.sustainedRegulationTimer >= this.SUSTAINED_TRUST_INTERVAL) {
                this.sustainedRegulationTimer -= this.SUSTAINED_TRUST_INTERVAL;
                this.addProportionalTrust(partA, partB, 0.01);
                this.addProportionalTrust(partB, partA, 0.01);
            }
        } else {
            this.sustainedRegulationTimer = 0;
        }
    }

    private addProportionalTrust(fromId: string, toId: string, baseDelta: number): void {
        const rel = this.relationships.getRelation(fromId, toId);
        const currentTrust = rel?.trust ?? 0;
        const scaled = baseDelta * (1 - currentTrust);
        this.relationships.addInterPartTrust(fromId, toId, scaled, () => this.rng.random('prop_trust'));
    }

    private tryAdvancePhase(partA: string, partB: string): void {
        const speakerId = this.model.getConversationSpeakerId();
        if (!speakerId) return;
        const listenerId = speakerId === partA ? partB : partA;

        const phaseS = this.model.getConversationPhase(speakerId);
        const phaseL = this.model.getConversationPhase(listenerId);
        if (!phaseS || !phaseL) return;

        this.respondTimer = 0;

        if (this.currentCycleLength === 6) {
            // 6-step repair loop:
            // S:speak/L:listen → S:listen/L:mirror → S:clarify/L:listen → S:listen/L:mirror_again → S:validate/L:listen → S:listen/L:empathize
            if (phaseS === 'speak' && phaseL === 'listen') {
                this.model.setConversationPhase(speakerId, 'listen');
                this.model.setConversationPhase(listenerId, 'mirror');
            } else if (phaseS === 'listen' && phaseL === 'mirror') {
                this.model.setConversationPhase(speakerId, 'clarify');
                this.model.setConversationPhase(listenerId, 'listen');
            } else if (phaseS === 'clarify' && phaseL === 'listen') {
                this.model.setConversationPhase(speakerId, 'listen');
                this.model.setConversationPhase(listenerId, 'mirror_again');
            } else if (phaseS === 'listen' && phaseL === 'mirror_again') {
                this.model.setConversationPhase(speakerId, 'validate');
                this.model.setConversationPhase(listenerId, 'listen');
                this.addProportionalTrust(speakerId, listenerId, 0.05);
            } else if (phaseS === 'validate' && phaseL === 'listen') {
                this.model.setConversationPhase(speakerId, 'listen');
                this.model.setConversationPhase(listenerId, 'empathize');
                this.addProportionalTrust(listenerId, speakerId, 0.05);
            } else if (phaseS === 'listen' && phaseL === 'empathize') {
                this.completeEmpathize(listenerId, speakerId);
            }
        } else {
            // 4-step standard: S:speak/L:listen → S:listen/L:mirror → S:validate/L:listen → S:listen/L:empathize
            if (phaseS === 'speak' && phaseL === 'listen') {
                this.model.setConversationPhase(speakerId, 'listen');
                this.model.setConversationPhase(listenerId, 'mirror');
                this.addProportionalTrust(listenerId, speakerId, 0.05);
            } else if (phaseS === 'listen' && phaseL === 'mirror') {
                this.model.setConversationPhase(speakerId, 'validate');
                this.model.setConversationPhase(listenerId, 'listen');
                this.addProportionalTrust(speakerId, listenerId, 0.05);
            } else if (phaseS === 'validate' && phaseL === 'listen') {
                this.model.setConversationPhase(speakerId, 'listen');
                this.model.setConversationPhase(listenerId, 'empathize');
                this.addProportionalTrust(listenerId, speakerId, 0.05);
            } else if (phaseS === 'listen' && phaseL === 'empathize') {
                this.completeEmpathize(listenerId, speakerId);
            }
        }
    }

    private completeEmpathize(empathizerId: string, speakerId: string): void {
        // Large diminishing-returns trust gain
        const trustBoost = (id: string, otherId: string) => {
            const rel = this.relationships.getRelation(id, otherId);
            const trust = rel?.trust ?? 0;
            const delta = this.CYCLE_TRUST_BOOST_FACTOR * (1 - trust);
            this.relationships.addInterPartTrust(id, otherId, delta, () => this.rng.random('empathize_trust'));
        };
        trustBoost(empathizerId, speakerId);
        trustBoost(speakerId, empathizerId);

        // Soften former speaker's raw stance
        const speakerRel = this.relationships.getRelation(speakerId, empathizerId);
        if (speakerRel) {
            this.callbacks.act(`soften stance ${speakerId}`, () => {
                speakerRel.stance *= this.CYCLE_STANCE_SOFTEN;
            });
        }

        this.model.setConversationPhase(empathizerId, 'listen');
        this.model.setConversationPhase(speakerId, 'listen');
        this.dysregulatedStreaks.clear();
    }

    getDebugState(): { blendTimers: Record<string, number>; cooldowns: Record<string, number>; pending: Record<string, string>; respondTimer: number; regulationScore: number; sustainedRegulationTimer: number; newCycleTimer: number; listenerViolationTimer: number; selfLoathingCooldowns: Record<string, number>; genericDialogueCooldowns: Record<string, number>; summonArrivalTimers: Record<string, number>; dysregulatedStreaks: Record<string, number>; currentCycleLength: number; currentTupleIndex: number } {
        return {
            blendTimers: Object.fromEntries(this.blendStartTimers),
            cooldowns: Object.fromEntries(this.messageCooldownTimers),
            pending: Object.fromEntries(this.pendingSummonTargets),
            respondTimer: this.respondTimer,
            regulationScore: this.regulationScore,
            sustainedRegulationTimer: this.sustainedRegulationTimer,
            newCycleTimer: this.newCycleTimer,
            listenerViolationTimer: this.listenerViolationTimer,
            selfLoathingCooldowns: Object.fromEntries(this.selfLoathingCooldowns),
            genericDialogueCooldowns: Object.fromEntries(this.genericDialogueCooldowns),
            summonArrivalTimers: Object.fromEntries(this.summonArrivalTimers),
            dysregulatedStreaks: Object.fromEntries(this.dysregulatedStreaks),
            currentCycleLength: this.currentCycleLength,
            currentTupleIndex: this.currentTupleIndex,
        };
    }

    restoreState(snapshot: { blendTimers?: Record<string, number>; cooldowns?: Record<string, number>; pending?: Record<string, string>; respondTimer?: number; regulationScore?: number; sustainedRegulationTimer?: number; newCycleTimer?: number; listenerViolationTimer?: number; selfLoathingCooldowns?: Record<string, number>; genericDialogueCooldowns?: Record<string, number>; summonArrivalTimers?: Record<string, number>; dysregulatedStreaks?: Record<string, number>; currentCycleLength?: number; currentTupleIndex?: number }): void {
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
        if (snapshot.sustainedRegulationTimer !== undefined) this.sustainedRegulationTimer = snapshot.sustainedRegulationTimer;
        if (snapshot.newCycleTimer !== undefined) this.newCycleTimer = snapshot.newCycleTimer;
        if (snapshot.listenerViolationTimer !== undefined) this.listenerViolationTimer = snapshot.listenerViolationTimer;
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
