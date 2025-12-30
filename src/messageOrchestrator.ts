import { SimulatorModel, PartMessage } from './ifsModel.js';
import { CloudRelationshipManager } from './cloudRelationshipManager.js';
import { DualRNG } from './testability/rng.js';

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
}

export class MessageOrchestrator {
    private model: SimulatorModel;
    private view: MessageOrchestratorView;
    private relationships: CloudRelationshipManager;
    private rng: DualRNG;
    private callbacks: MessageOrchestratorCallbacks;

    private messageCooldownTimers: Map<string, number> = new Map();
    private blendStartTimers: Map<string, number> = new Map();
    private pendingGrievanceTargets: Map<string, string> = new Map();
    private genericDialogueCooldowns: Map<string, number> = new Map();

    private readonly BLEND_MESSAGE_DELAY = 2;
    private readonly GENERIC_DIALOGUE_INTERVAL = 8;

    constructor(
        model: SimulatorModel,
        view: MessageOrchestratorView,
        relationships: CloudRelationshipManager,
        rng: DualRNG,
        callbacks: MessageOrchestratorCallbacks
    ) {
        this.model = model;
        this.view = view;
        this.relationships = relationships;
        this.rng = rng;
        this.callbacks = callbacks;
    }

    setRNG(rng: DualRNG): void {
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
    }

    onMessageReceived(message: PartMessage): void {
        if (message.type === 'grievance') {
            this.model.parts.adjustTrust(message.targetId, 0.99);
            this.model.changeNeedAttention(message.senderId, -0.25);
            if (message.senderId !== message.targetId) {
                this.model.parts.setAttacked(message.targetId);
            }
        }
        this.model.removeMessage(message.id);
    }

    checkAndSendGrievanceMessages(): void {
        if (this.view.hasActiveSpiralExits()) return;

        const blendedParts = this.model.getBlendedParts();
        const targetIds = this.model.getTargetCloudIds();

        for (const blendedId of blendedParts) {
            const blendedCloud = this.callbacks.getCloudById(blendedId);
            if (!blendedCloud) continue;

            if (this.model.parts.isUnburdened(blendedId)) continue;
            if (this.view.isAwaitingArrival(blendedId)) continue;

            const blendTime = this.blendStartTimers.get(blendedId) ?? 0;
            if (blendTime < this.BLEND_MESSAGE_DELAY) continue;

            const grievanceTargets = this.relationships.getGrievanceTargets(blendedId);
            if (grievanceTargets.size === 0) continue;

            const timeSinceSent = this.messageCooldownTimers.get(blendedId) ?? 10;
            if (timeSinceSent < 3) continue;

            let grievanceTargetId = this.pendingGrievanceTargets.get(blendedId);

            if (!grievanceTargetId) {
                if (timeSinceSent < 10) continue;
                const grievanceTargetArray = Array.from(grievanceTargets);
                grievanceTargetId = this.rng.model.pickRandom(grievanceTargetArray, 'grievance_target');
            }

            const dialogues = this.relationships.getGrievanceDialogues(blendedId, grievanceTargetId);
            if (dialogues.length === 0) continue;

            if (!targetIds.has(grievanceTargetId) && grievanceTargetId !== blendedId) {
                const blenderName = this.model.parts.getPartName(blendedId);
                const targetName = this.model.parts.getPartName(grievanceTargetId);
                this.callbacks.act(`${blenderName} summons ${targetName}`, () => {
                    this.model.addTargetCloud(grievanceTargetId);
                });
                this.pendingGrievanceTargets.set(blendedId, grievanceTargetId);
                this.messageCooldownTimers.set(blendedId, 0);
                continue;
            }

            if (this.view.isAwaitingArrival(grievanceTargetId)) continue;

            const text = this.rng.cosmetic.pickRandom(dialogues);
            this.sendMessage(blendedId, grievanceTargetId, text, 'grievance');
            this.messageCooldownTimers.set(blendedId, 0);
            this.pendingGrievanceTargets.delete(blendedId);
        }
    }

    checkAndShowGenericDialogues(deltaTime: number): void {
        if (this.view.hasActiveSpiralExits()) return;

        const blendedParts = this.model.getBlendedParts();

        for (const blendedId of this.genericDialogueCooldowns.keys()) {
            if (!blendedParts.includes(blendedId)) {
                this.genericDialogueCooldowns.delete(blendedId);
            }
        }

        for (const blendedId of blendedParts) {
            if (this.view.isAwaitingArrival(blendedId)) continue;

            const blendTime = this.blendStartTimers.get(blendedId) ?? 0;
            if (blendTime < this.BLEND_MESSAGE_DELAY) continue;

            const hasGrievances = this.relationships.getGrievanceTargets(blendedId).size > 0;
            if (hasGrievances) continue;

            const dialogues = this.model.parts.getDialogues(blendedId)?.genericBlendedDialogues;
            if (!dialogues || dialogues.length === 0) continue;

            let cooldown = this.genericDialogueCooldowns.get(blendedId) ?? this.GENERIC_DIALOGUE_INTERVAL;
            cooldown += deltaTime;

            while (cooldown >= this.GENERIC_DIALOGUE_INTERVAL) {
                const text = this.rng.cosmetic.pickRandom(dialogues);
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
        }
    }
}
