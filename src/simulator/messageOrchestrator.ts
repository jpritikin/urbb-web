import { SimulatorModel, PartMessage } from './ifsModel.js';
import { PartStateManager } from '../cloud/partStateManager.js';
import { RNG, pickRandom } from '../playback/testability/rng.js';

export interface MessageOrchestratorView {
    hasActiveSpiralExits(): boolean;
    isAwaitingArrival(cloudId: string): boolean;
    getCloudState(cloudId: string): unknown | null;
    startMessage(message: PartMessage, senderId: string, targetId: string): void;
}

export interface MessageOrchestratorCallbacks {
    act: (label: string, fn: () => void) => void;
    showThoughtBubble: (text: string, cloudId: string) => void;
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
    private pendingGrievanceTargets: Map<string, string> = new Map();
    private genericDialogueCooldowns: Map<string, number> = new Map();

    private readonly BLEND_MESSAGE_DELAY = 2;
    private readonly GENERIC_DIALOGUE_INTERVAL = 8;

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

        const arrivedMessages = this.model.advanceMessages(deltaTime);
        for (const message of arrivedMessages) {
            this.onMessageReceived(message);
        }
    }

    onMessageReceived(message: PartMessage): void {
        if (message.type === 'grievance') {
            this.model.parts.adjustTrust(message.targetId, 0.99);
            this.model.changeNeedAttention(message.senderId, -0.25);
            if (message.senderId !== message.targetId) {
                this.model.parts.setAttackedBy(message.targetId, message.senderId);
            }
        }
        this.model.removeMessage(message.id);
    }

    checkAndSendGrievanceMessages(): void {
        const blendedParts = this.model.getBlendedParts();
        const targetIds = this.model.getTargetCloudIds();

        for (const blendedId of blendedParts) {
            const blendedCloud = this.callbacks.getCloudById(blendedId);
            if (!blendedCloud) continue;

            if (this.model.parts.isFormerProtector(blendedId)) continue;

            const blendTime = this.blendStartTimers.get(blendedId) ?? 0;
            if (blendTime < this.BLEND_MESSAGE_DELAY) continue;

            const hostileTargets = this.relationships.getHostileRelationTargets(blendedId);
            if (hostileTargets.size === 0) continue;

            const timeSinceSent = this.messageCooldownTimers.get(blendedId) ?? 10;
            if (timeSinceSent < 3) continue;

            let hostileTargetId = this.pendingGrievanceTargets.get(blendedId);

            if (!hostileTargetId) {
                if (timeSinceSent < 10) continue;
                const hostileTargetArray = Array.from(hostileTargets);
                hostileTargetId = this.rng.pickRandom(hostileTargetArray, 'grievance_target');
            }

            const stanceSign = this.relationships.getPhaseStance(blendedId, hostileTargetId, () => this.rng.random('stance_flip')) > 0 ? 1 : -1;
            const dialogue = this.relationships.getInterPartDialogue(blendedId, hostileTargetId, 'speak', stanceSign as 1 | -1);
            const genericDialogues = this.model.parts.getDialogues(blendedId)?.genericBlendedDialogues;
            const text = dialogue ?? (genericDialogues ? pickRandom(genericDialogues) : null);
            if (!text) continue;

            if (!targetIds.has(hostileTargetId) && hostileTargetId !== blendedId) {
                const blenderName = this.model.parts.getPartName(blendedId);
                const targetName = this.model.parts.getPartName(hostileTargetId);
                this.callbacks.act(`${blenderName} summons ${targetName}`, () => {
                    this.model.addTargetCloud(hostileTargetId);
                });
                this.pendingGrievanceTargets.set(blendedId, hostileTargetId);
                this.messageCooldownTimers.set(blendedId, 0);
                continue;
            }

            if (this.view.isAwaitingArrival(hostileTargetId)) continue;

            this.sendMessage(blendedId, hostileTargetId, text, 'grievance');
            this.messageCooldownTimers.set(blendedId, 0);
            this.pendingGrievanceTargets.delete(blendedId);
        }
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

            const hasHostileRelations = this.relationships.getHostileRelationTargets(blendedId).size > 0;
            if (hasHostileRelations) continue;

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

    getDebugState(): { blendTimers: Record<string, number>; cooldowns: Record<string, number>; pending: Record<string, string> } {
        return {
            blendTimers: Object.fromEntries(this.blendStartTimers),
            cooldowns: Object.fromEntries(this.messageCooldownTimers),
            pending: Object.fromEntries(this.pendingGrievanceTargets),
        };
    }

    private sendMessage(senderId: string, targetId: string, text: string, type: 'grievance'): void {
        const senderState = this.view.getCloudState(senderId);
        const targetState = this.view.getCloudState(targetId);
        if (!senderState || !targetState) return;

        const senderName = this.model.parts.getPartName(senderId);
        const targetName = this.model.parts.getPartName(targetId);
        const actionLabel = senderId === targetId
            ? `${senderName} spirals in self-grievance`
            : `${senderName} sends grievance to ${targetName}`;
        let message: PartMessage | null = null;
        this.callbacks.act(actionLabel, () => {
            message = this.model.sendMessage(senderId, targetId, text, type);
        });
        if (message) {
            this.view.startMessage(message, senderId, targetId);
            this.model.parts.setUtterance(senderId, text, this.callbacks.getTime());
        }
    }
}
