import { SimulatorModel, PartMessage } from './ifsModel.js';
import { PartStateManager } from '../cloud/partStateManager.js';
import { RNG, pickRandom } from '../playback/testability/rng.js';

export const REGULATION_STANCE_LIMIT = 0.3;

export interface MessageOrchestratorView {
    getCloudState(cloudId: string): unknown | null;
    startMessage(message: PartMessage, senderId: string, targetId: string): void;
}

export interface MessageOrchestratorCallbacks {
    act: (label: string, fn: () => void) => void;
    showThoughtBubble: (text: string, cloudId: string, partInitiated?: boolean) => void;
    getCloudById: (id: string) => { id: string } | null;
    getTime: () => number;
}

export class MessageOrchestrator {
    private getModel: () => SimulatorModel;
    private view: MessageOrchestratorView;
    private getRelationships: () => PartStateManager;
    private rng: RNG;
    private callbacks: MessageOrchestratorCallbacks;

    private messageCooldownTimers: Map<string, number> = new Map();
    private blendStartTimers: Map<string, number> = new Map();
    private pendingSummonTargets: Map<string, string> = new Map();
    private summonArrivalTimers: Map<string, number> = new Map();
    private genericDialogueCooldowns: Map<string, number> = new Map();
    private selfLoathingCooldowns: Map<string, number> = new Map();
    private jealousyCooldowns: Map<string, number> = new Map();
    private pendingJealousy: Map<string, { favoredId: string; diff: number }> = new Map();
    private sustainedRegulationTimer: number = 0;
    private regulationScore: number = 0;
    private respondTimer: number = 0;
    private newCycleTimer: number = 0;

    private readonly BLEND_MESSAGE_DELAY = 2;
    private readonly GENERIC_DIALOGUE_INTERVAL = 8;
    private readonly SELF_LOATHING_INTERVAL = 10;
    private readonly JEALOUSY_INTERVAL = 10;
    private readonly SPEAK_BASE_RATE = 0.5;
    private readonly RESPOND_DELAY = 3;
    private readonly NEW_CYCLE_DELAY = 4;
    private readonly SUSTAINED_TRUST_INTERVAL = 10;
    private readonly REGULATION_RECOVER_RATE = 0.5;
    private readonly REGULATION_DECAY_RATE = 0.3;
    private readonly SUMMON_ARRIVAL_DELAY = 2;

    constructor(
        getModel: () => SimulatorModel,
        view: MessageOrchestratorView,
        getRelationships: () => PartStateManager,
        rng: RNG,
        callbacks: MessageOrchestratorCallbacks
    ) {
        this.getModel = getModel;
        this.view = view;
        this.getRelationships = getRelationships;
        this.rng = rng;
        this.callbacks = callbacks;
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
            this.blendStartTimers.set(blendedId, currentTime + deltaTime);
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
            this.onMessageReceived(message);
        }
    }

    onMessageReceived(message: PartMessage): void {
        this.model.removeMessage(message.id);
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

            const text = this.relationships.getInterPartDialogue(blendedId, targetId, 'speak', () => this.rng.random('dialogue_pick'));
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
        const trustBefore = this.relationships.getRelation(targetId, senderId)?.trust ?? 0;
        this.model.parts.addInterPartTrust(senderId, targetId, -damage, () => this.rng.random('blended_trust_damage'));
        this.model.parts.adjustTrust(targetId, 0.99);
        this.model.changeNeedAttention(senderId, -0.25);
        const absorbed = trustBefore - Math.max(0, trustBefore - damage);
        const overflow = damage - absorbed;
        if (overflow > 0) {
            const selfTrust = this.model.getSelfTrust(targetId);
            this.model.changeNeedAttention(targetId, overflow / (1 + selfTrust));
        }
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

            const dialogue = this.relationships.getRumination(blendedId, () => this.rng.random('dialogue_pick'));
            if (!dialogue) continue;

            let cooldown = this.selfLoathingCooldowns.get(blendedId) ?? this.SELF_LOATHING_INTERVAL;
            cooldown += deltaTime;

            while (cooldown >= this.SELF_LOATHING_INTERVAL) {
                this.callbacks.showThoughtBubble(dialogue, blendedId);
                this.model.changeNeedAttention(blendedId, -0.25);
                cooldown -= this.SELF_LOATHING_INTERVAL;
            }
            this.selfLoathingCooldowns.set(blendedId, cooldown);
        }
    }

    checkJealousy(deltaTime: number): void {
        for (const [jealousId, { favoredId, diff }] of this.pendingJealousy) {
            if (this.model.getConferenceCloudIds().has(jealousId)) {
                this.applyJealousy(jealousId, favoredId, diff);
                this.pendingJealousy.delete(jealousId);
            }
        }

        const relations = this.relationships.getRelationSummaries();

        for (const rel of relations) {
            if (rel.fromId === rel.toId) continue;
            const jealousId = rel.fromId;
            const favoredId = rel.toId;
            const jealousTrust = this.relationships.getTrust(jealousId);
            if (jealousTrust >= 0.75) continue;
            const favoredTrust = this.relationships.getTrust(favoredId);
            if (jealousTrust >= favoredTrust) continue;
            const diff = favoredTrust - jealousTrust;
            if (this.relationships.isNoticed(jealousId, favoredId)) continue;
            const interTrust = this.relationships.getInterPartTrust(jealousId, favoredId);
            if (diff <= interTrust + 0.15) continue;

            let cooldown = this.jealousyCooldowns.get(jealousId) ?? this.JEALOUSY_INTERVAL;
            cooldown += deltaTime;
            if (cooldown < this.JEALOUSY_INTERVAL) {
                this.jealousyCooldowns.set(jealousId, cooldown);
                continue;
            }
            cooldown -= this.JEALOUSY_INTERVAL;
            this.jealousyCooldowns.set(jealousId, cooldown);

            if (!this.model.getConferenceCloudIds().has(jealousId)) {
                this.model.partDemandsAttention(jealousId);
                this.pendingJealousy.set(jealousId, { favoredId, diff });
                continue;
            }

            this.applyJealousy(jealousId, favoredId, diff);
        }
    }

    private applyJealousy(jealousId: string, favoredId: string, diff: number): void {
        const oldTrust = this.relationships.getTrust(jealousId);
        this.relationships.addTrust(jealousId, -diff);
        const overflow = Math.max(0, diff - oldTrust);
        if (overflow > 0) this.model.changeNeedAttention(jealousId, overflow);
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
                // Non-speak phases (mirror/validate/empathize): only when regulated
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

            const text = this.relationships.getInterPartDialogue(partId, otherId, phase, () => this.rng.random('dialogue_pick'));
            if (text) {
                this.sendConversationMessage(partId, otherId, text);
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
            this.newCycleTimer += deltaTime;
            if (this.newCycleTimer >= this.NEW_CYCLE_DELAY) {
                const stanceA = this.model.getConversationEffectiveStance(partA);
                const stanceB = this.model.getConversationEffectiveStance(partB);
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

        // Determine who should be listening right now based on cycle step
        // Cycle: S:speak/L:listen → S:listen/L:mirror → S:validate/L:listen → S:listen/L:empathize
        let currentListeningPart: string | null = null;
        if (phaseS === 'speak' && phaseL === 'listen') currentListeningPart = listenerId;
        else if (phaseS === 'listen' && phaseL === 'mirror') currentListeningPart = speakerId;
        else if (phaseS === 'validate' && phaseL === 'listen') currentListeningPart = listenerId;
        else if (phaseS === 'listen' && phaseL === 'empathize') currentListeningPart = speakerId;

        if (!currentListeningPart) return;

        const stance = this.model.getConversationEffectiveStance(currentListeningPart);
        if (stance > REGULATION_STANCE_LIMIT) {
            this.resetConversation(currentListeningPart, partA, partB);
        }
    }

    private resetConversation(newSpeakerId: string, partA: string, partB: string): void {
        const newListenerId = newSpeakerId === partA ? partB : partA;
        this.model.setConversationSpeakerId(newSpeakerId);
        this.model.setConversationPhase(newSpeakerId, 'speak');
        this.model.setConversationPhase(newListenerId, 'listen');
        this.respondTimer = 0;
        this.newCycleTimer = 0;
    }

    private sendConversationMessage(senderId: string, targetId: string, text: string): void {
        const senderName = this.model.parts.getPartName(senderId);
        const targetName = this.model.parts.getPartName(targetId);
        let message: PartMessage | null = null;
        this.callbacks.act(`${senderName} speaks to ${targetName}`, () => {
            message = this.model.sendMessage(senderId, targetId, text, 'conversation');
        });
        if (message) {
            const senderState = this.view.getCloudState(senderId);
            const targetState = this.view.getCloudState(targetId);
            if (senderState && targetState) {
                this.view.startMessage(message, senderId, targetId);
            }
            this.model.parts.setUtterance(senderId, text, this.callbacks.getTime());
        }
    }

    private applyStanceShock(speakerId: string, receiverId: string, speakerStance: number): void {
        const rel = this.relationships.getRelation(receiverId, speakerId);
        if (!rel) return;
        const selfTrust = this.model.getSelfTrust(receiverId);
        const interTrust = rel.trust;
        const shockMagnitude = 0.3 * Math.abs(speakerStance) * 2 / ((1 + selfTrust) * (1 + interTrust));
        const sameDirection = this.rng.random('stance_shock') < rel.stanceFlipOdds;
        const direction = sameDirection ? Math.sign(speakerStance) : -Math.sign(speakerStance);
        if (direction === 0) return;
        rel.stance = Math.max(-1, Math.min(1, rel.stance + direction * shockMagnitude));

        const damage = shockMagnitude;
        const trustBefore = rel.trust;
        this.relationships.addInterPartTrust(receiverId, speakerId, -damage, () => this.rng.random('shock_trust'));
        const absorbed = trustBefore - Math.max(0, rel.trust);
        const overflow = damage - absorbed;
        if (overflow > 0) {
            this.model.changeNeedAttention(receiverId, overflow / (1 + selfTrust));
        }
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

        // Fixed IFIO cycle:
        // Step 1: S:speak,    L:listen    → Step 2: S:listen,   L:mirror
        // Step 2: S:listen,   L:mirror    → Step 3: S:validate, L:listen
        // Step 3: S:validate, L:listen    → Step 4: S:listen,   L:empathize
        // Step 4: S:listen,   L:empathize → complete → S:listen, L:listen
        this.respondTimer = 0;
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

    private completeEmpathize(empathizerId: string, speakerId: string): void {
        this.addProportionalTrust(empathizerId, speakerId, 0.5);
        this.addProportionalTrust(speakerId, empathizerId, 0.5);
        this.model.setConversationPhase(empathizerId, 'listen');
        this.model.setConversationPhase(speakerId, 'listen');
    }

    getDebugState(): { blendTimers: Record<string, number>; cooldowns: Record<string, number>; pending: Record<string, string>; jealousyCooldowns: Record<string, number>; respondTimer: number; regulationScore: number; sustainedRegulationTimer: number; newCycleTimer: number } {
        return {
            blendTimers: Object.fromEntries(this.blendStartTimers),
            cooldowns: Object.fromEntries(this.messageCooldownTimers),
            pending: Object.fromEntries(this.pendingSummonTargets),
            jealousyCooldowns: Object.fromEntries(this.jealousyCooldowns),
            respondTimer: this.respondTimer,
            regulationScore: this.regulationScore,
            sustainedRegulationTimer: this.sustainedRegulationTimer,
            newCycleTimer: this.newCycleTimer,
        };
    }

    restoreState(snapshot: { blendTimers?: Record<string, number>; cooldowns?: Record<string, number>; pending?: Record<string, string>; jealousyCooldowns?: Record<string, number>; respondTimer?: number; regulationScore?: number; sustainedRegulationTimer?: number; newCycleTimer?: number }): void {
        if (snapshot.blendTimers) {
            this.blendStartTimers = new Map(Object.entries(snapshot.blendTimers));
        }
        if (snapshot.cooldowns) {
            this.messageCooldownTimers = new Map(Object.entries(snapshot.cooldowns));
        }
        if (snapshot.pending) {
            this.pendingSummonTargets = new Map(Object.entries(snapshot.pending));
        }
        if (snapshot.jealousyCooldowns) {
            this.jealousyCooldowns = new Map(Object.entries(snapshot.jealousyCooldowns));
        }
        if (snapshot.respondTimer !== undefined) this.respondTimer = snapshot.respondTimer;
        if (snapshot.regulationScore !== undefined) this.regulationScore = snapshot.regulationScore;
        if (snapshot.sustainedRegulationTimer !== undefined) this.sustainedRegulationTimer = snapshot.sustainedRegulationTimer;
        if (snapshot.newCycleTimer !== undefined) this.newCycleTimer = snapshot.newCycleTimer;
    }

    private sendMessage(senderId: string, targetId: string, text: string): void {
        const senderName = this.model.parts.getPartName(senderId);
        const targetName = this.model.parts.getPartName(targetId);
        const actionLabel = `${senderName} speaks to ${targetName}`;
        let message: PartMessage | null = null;
        this.callbacks.act(actionLabel, () => {
            message = this.model.sendMessage(senderId, targetId, text, 'conversation');
        });
        if (message) {
            const senderState = this.view.getCloudState(senderId);
            const targetState = this.view.getCloudState(targetId);
            if (senderState && targetState) {
                this.view.startMessage(message, senderId, targetId);
            }
            this.model.parts.setUtterance(senderId, text, this.callbacks.getTime());
        }
    }
}
