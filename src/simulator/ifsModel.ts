import { PartStateManager, PartState, PartBiography, PartDialogues, type IfioPhase } from '../cloud/partStateManager.js';
import type { SerializedModel, OrchestratorSnapshot } from '../playback/testability/types.js';
import type { RNG } from '../playback/testability/rng.js';
import { CARPET_FLY_DURATION } from '../star/carpetRenderer.js';

export type BlendReason = 'spontaneous' | 'therapist';
export type MessageType = 'conversation';

export interface BlendedPartState {
    degree: number;
    reason: BlendReason;
}

export interface SelfRayState {
    targetCloudId: string;
}

export interface PartMessage {
    id: number;
    type: MessageType;
    senderId: string;
    targetId: string;
    text: string;
    travelTimeRemaining: number;
    conversationPhaseLabel?: string;
}

export interface ThoughtBubble {
    id: number;
    text: string;
    cloudId: string;
    expiresAt: number;
    validated?: boolean;
    partInitiated?: boolean;
}

export type SimulatorMode = 'panorama' | 'foreground';

export interface PendingAction {
    actionId: string;
    sourceCloudId: string;
}

export class SimulatorModel {
    private targetCloudIds: Set<string> = new Set();
    private supportingParts: Map<string, Set<string>> = new Map();
    private selfRay: SelfRayState | null = null;
    private blendedParts: Map<string, BlendedPartState> = new Map();
    private pendingBlends: { cloudId: string; reason: BlendReason; timer: number }[] = [];
    readonly parts: PartStateManager = new PartStateManager();
    private displacedParts: Set<string> = new Set();
    private messages: PartMessage[] = [];
    private messageIdCounter: number = 0;
    private thoughtBubbles: ThoughtBubble[] = [];
    private victoryAchieved: boolean = false;
    private selfAmplification: number = 1;
    private mode: SimulatorMode = 'panorama';
    private pendingAction: PendingAction | null = null;
    private conversationTherapistDelta: Map<string, number> = new Map();
    private conversationShockDelta: Map<string, number> = new Map();
    private conversationParticipantIds: [string, string] | null = null;
    private activeConversationKey: string | null = null;
    private _frozen: boolean = false;

    freeze(): void { this._frozen = true; }
    unfreeze(): void { this._frozen = false; }

    private assertNotFrozen(method: string): void {
        if (this._frozen) {
            throw new Error(`[ModelFreeze] Model mutation '${method}' called while model is frozen (view-only context)`);
        }
    }
    private conversationPhases: Map<string, IfioPhase> = new Map();
    private conversationSpeakerId: string | null = null;
    private simulationTime: number = 0;
    private orchestratorState: OrchestratorSnapshot | null = null;
    private onModeChange?: (mode: SimulatorMode) => void;

    getSimulationTime(): number {
        return this.simulationTime;
    }

    advanceSimulationTime(dt: number): void {
        this.assertNotFrozen('advanceSimulationTime');
        this.simulationTime += dt;
    }

    getOrchestratorState(): OrchestratorSnapshot | null {
        return this.orchestratorState;
    }

    setOrchestratorState(state: OrchestratorSnapshot): void {
        this.assertNotFrozen('setOrchestratorState');
        this.orchestratorState = state;
    }

    getSelfAmplification(): number {
        return this.selfAmplification;
    }

    setSelfAmplification(value: number): void {
        this.assertNotFrozen('setSelfAmplification');
        this.selfAmplification = value;
    }

    getMode(): SimulatorMode {
        return this.mode;
    }

    setOnModeChange(callback: (mode: SimulatorMode) => void): void {
        this.onModeChange = callback;
    }

    setMode(mode: SimulatorMode): void {
        this.assertNotFrozen('setMode');
        if (mode !== this.mode) {
            this.mode = mode;
            if (mode === 'panorama') {
                this.clearSelfRay();
            } else {
                this.pendingAction = null;
            }
            this.onModeChange?.(mode);
        }
    }

    getPendingAction(): PendingAction | null {
        return this.pendingAction;
    }

    setPendingAction(action: PendingAction | null): void {
        this.assertNotFrozen('setPendingAction');
        this.pendingAction = action;
    }

    changeNeedAttention(cloudId: string, delta: number): void {
        this.assertNotFrozen('changeNeedAttention');
        const current = this.parts.getNeedAttention(cloudId);
        const amplifiedDelta = delta * this.selfAmplification;
        this.parts.setNeedAttention(cloudId, Math.max(0, current + amplifiedDelta));
    }

    getTargetCloudIds(): Set<string> {
        return new Set(this.targetCloudIds);
    }

    isTarget(cloudId: string): boolean {
        return this.targetCloudIds.has(cloudId);
    }

    setTargetCloud(cloudId: string): void {
        this.assertNotFrozen('setTargetCloud');
        this.blendedParts.clear();
        this.targetCloudIds.clear();
        this.targetCloudIds.add(cloudId);
        this.supportingParts.clear();
        this.clearSelfRay();
        this.setMode('foreground');
    }

    addTargetCloud(cloudId: string): void {
        this.assertNotFrozen('addTargetCloud');
        this.blendedParts.delete(cloudId);
        this.targetCloudIds.add(cloudId);
        for (const [, supportingIds] of this.supportingParts) {
            supportingIds.delete(cloudId);
        }
    }

    removeTargetCloud(cloudId: string): void {
        this.assertNotFrozen('removeTargetCloud');
        this.targetCloudIds.delete(cloudId);
        if (this.selfRay?.targetCloudId === cloudId) {
            this.clearSelfRay();
        }
        this.supportingParts.delete(cloudId);
    }

    toggleTargetCloud(cloudId: string): void {
        if (this.targetCloudIds.has(cloudId)) {
            this.removeTargetCloud(cloudId);
        } else {
            this.addTargetCloud(cloudId);
        }
    }

    clearTargets(): void {
        this.assertNotFrozen('clearTargets');
        this.targetCloudIds.clear();
        this.clearSelfRay();
    }

    setSupportingParts(targetId: string, supportingIds: Set<string>): void {
        this.assertNotFrozen('setSupportingParts');
        this.supportingParts.set(targetId, new Set(supportingIds));
    }

    summonSupportingPart(targetId: string, supportingId: string): boolean {
        this.assertNotFrozen('summonSupportingPart');
        if (this.isTarget(supportingId) || this.isBlended(supportingId) || this.getAllSupportingParts().has(supportingId)) {
            return false;
        }
        const existing = this.supportingParts.get(targetId) ?? new Set();
        existing.add(supportingId);
        this.supportingParts.set(targetId, existing);
        return true;
    }

    getSupportingParts(targetId: string): Set<string> {
        return new Set(this.supportingParts.get(targetId) || []);
    }

    getAllSupportingParts(): Set<string> {
        const allSupporting = new Set<string>();
        for (const targetId of this.targetCloudIds) {
            const supporting = this.supportingParts.get(targetId);
            if (supporting) {
                for (const id of supporting) {
                    allSupporting.add(id);
                }
            }
        }
        return allSupporting;
    }

    getConferenceCloudIds(): Set<string> {
        const ids = new Set<string>();
        for (const id of this.targetCloudIds) {
            ids.add(id);
        }
        for (const id of this.blendedParts.keys()) {
            ids.add(id);
        }
        for (const { cloudId } of this.pendingBlends) {
            ids.add(cloudId);
        }
        for (const id of this.getAllSupportingParts()) {
            ids.add(id);
        }
        return ids;
    }

    clearSupportingParts(): void {
        this.assertNotFrozen('clearSupportingParts');
        this.supportingParts.clear();
    }

    clearConferenceTable(): void {
        this.assertNotFrozen('clearConferenceTable');
        this.targetCloudIds.clear();
        this.clearSelfRay();
        this.blendedParts.clear();
        this.supportingParts.clear();
    }

    addBlendedPart(cloudId: string, reason: BlendReason = 'spontaneous', degree: number = 1): void {
        this.assertNotFrozen('addBlendedPart');
        if (this.targetCloudIds.has(cloudId)) {
            this.removeTargetCloud(cloudId);
        }
        if (!this.blendedParts.has(cloudId)) {
            this.blendedParts.set(cloudId, { degree: Math.max(0.01, Math.min(1, degree)), reason });
            this.clearSelfRay();
        }
    }


    removeBlendedPart(cloudId: string): void {
        this.assertNotFrozen('removeBlendedPart');
        if (this.blendedParts.has(cloudId)) {
            this.blendedParts.delete(cloudId);
            this.parts.clearBeWithUsed(cloudId);
            this.changeNeedAttention(cloudId, -0.5);
        }
    }

    setBlendingDegree(cloudId: string, degree: number): void {
        this.assertNotFrozen('setBlendingDegree');
        const existing = this.blendedParts.get(cloudId);
        if (existing) {
            const clampedDegree = Math.max(0, Math.min(1, degree));
            if (clampedDegree <= 0) {
                this.promoteBlendedToTarget(cloudId);
            } else {
                this.blendedParts.set(cloudId, { ...existing, degree: clampedDegree });
            }
        }
    }

    promoteBlendedToTarget(cloudId: string): void {
        this.assertNotFrozen('promoteBlendedToTarget');
        if (!this.blendedParts.has(cloudId)) return;
        this.blendedParts.delete(cloudId);
        this.targetCloudIds.add(cloudId);
        this.parts.clearBeWithUsed(cloudId);
    }

    getBlendingDegree(cloudId: string): number {
        return this.blendedParts.get(cloudId)?.degree ?? 0;
    }

    calculateSeparationAmount(cloudId: string, baseAmount: number): number {
        const needAttention = this.parts.getNeedAttention(cloudId);
        const multiplier = 1 + 2 * (1 - Math.min(1, needAttention));
        return baseAmount * multiplier;
    }

    willUnblendAfterSeparation(cloudId: string, baseAmount: number): boolean {
        const currentDegree = this.getBlendingDegree(cloudId);
        const amount = this.calculateSeparationAmount(cloudId, baseAmount);
        return currentDegree - amount <= 0;
    }

    getBlendReason(cloudId: string): BlendReason | null {
        return this.blendedParts.get(cloudId)?.reason ?? null;
    }

    setBlendReason(cloudId: string, reason: BlendReason): void {
        this.assertNotFrozen('setBlendReason');
        const existing = this.blendedParts.get(cloudId);
        if (existing && existing.reason !== reason) {
            existing.reason = reason;
        }
    }

    getBlendedParts(): string[] {
        return Array.from(this.blendedParts.keys());
    }

    getBlendedPartsWithDegrees(): Map<string, number> {
        const result = new Map<string, number>();
        for (const [id, state] of this.blendedParts) {
            result.set(id, state.degree);
        }
        return result;
    }

    isBlended(cloudId: string): boolean {
        return this.blendedParts.has(cloudId);
    }

    clearBlendedParts(): void {
        this.assertNotFrozen('clearBlendedParts');
        this.blendedParts.clear();
    }

    enqueuePendingBlend(cloudId: string, reason: BlendReason): void {
        this.assertNotFrozen('enqueuePendingBlend');
        if (!this.pendingBlends.some(p => p.cloudId === cloudId)) {
            this.pendingBlends.push({ cloudId, reason, timer: CARPET_FLY_DURATION });
        }
    }

    canDisplaceBlended(cloudId: string): boolean {
        const demandingNeed = this.parts.getNeedAttention(cloudId);
        for (const blendedId of this.blendedParts.keys()) {
            if (demandingNeed <= this.parts.getNeedAttention(blendedId) + 1) return false;
        }
        return true;
    }

    tickPendingBlendTimers(dt: number): string[] {
        this.assertNotFrozen('tickPendingBlendTimers');
        if (this.pendingBlends.length === 0) return [];
        const front = this.pendingBlends[0];
        if (this.blendedParts.size > 0 && !this.canDisplaceBlended(front.cloudId)) return [];
        // If already in conference, no exit animation to wait for
        if (this.getConferenceCloudIds().has(front.cloudId)) return [front.cloudId];
        front.timer -= dt;
        if (front.timer <= 0) return [front.cloudId];
        return [];
    }

    dequeuePendingBlend(): { cloudId: string; reason: BlendReason } | null {
        return this.pendingBlends.shift() ?? null;
    }

    peekPendingBlend(): { cloudId: string; reason: BlendReason } | null {
        return this.pendingBlends[0] ?? null;
    }

    getPendingBlends(): { cloudId: string; reason: BlendReason }[] {
        return [...this.pendingBlends];
    }

    isPendingBlend(cloudId: string): boolean {
        return this.pendingBlends.some(p => p.cloudId === cloudId);
    }

    removePendingBlend(cloudId: string): void {
        this.assertNotFrozen('removePendingBlend');
        this.pendingBlends = this.pendingBlends.filter(p => p.cloudId !== cloudId);
    }

    clearPendingBlends(): void {
        this.assertNotFrozen('clearPendingBlends');
        this.pendingBlends = [];
    }

    setSelfRay(targetCloudId: string): void {
        this.assertNotFrozen('setSelfRay');
        this.selfRay = { targetCloudId };
    }

    clearSelfRay(): void {
        this.assertNotFrozen('clearSelfRay');
        this.selfRay = null;
    }

    getSelfRay(): SelfRayState | null {
        return this.selfRay;
    }

    hasSelfRay(): boolean {
        return this.selfRay !== null;
    }

    removeFromConference(cloudId: string): void {
        this.assertNotFrozen('removeFromConference');
        this.targetCloudIds.delete(cloudId);
        if (this.selfRay?.targetCloudId === cloudId) {
            this.clearSelfRay();
        }

        for (const targetId of this.targetCloudIds) {
            const supportingIds = this.supportingParts.get(targetId);
            if (supportingIds?.has(cloudId)) {
                supportingIds.delete(cloudId);
                if (supportingIds.size === 0) {
                    this.supportingParts.delete(targetId);
                }
            }
        }

        this.blendedParts.delete(cloudId);
        this.removeThoughtBubblesForCloud(cloudId);
    }

    partDemandsAttention(demandingCloudId: string): void {
        this.assertNotFrozen('partDemandsAttention');
        if (this.isBlended(demandingCloudId)) {
            return;
        }
        this.removePendingBlend(demandingCloudId);

        if (this.isTarget(demandingCloudId)) {
            if (this.canDisplaceBlended(demandingCloudId)) {
                for (const blendedId of this.getBlendedParts()) {
                    this.promoteBlendedToTarget(blendedId);
                }
                this.removeTargetCloud(demandingCloudId);
                this.addBlendedPart(demandingCloudId, 'spontaneous');
            } else {
                this.enqueuePendingBlend(demandingCloudId, 'spontaneous');
            }
            return;
        }

        if (this.mode === 'panorama') {
            this.setMode('foreground');
        }

        const currentTargets = Array.from(this.targetCloudIds);
        const currentBlended = this.getBlendedParts();

        for (const targetId of currentTargets) {
            this.displacedParts.add(targetId);
            this.removeFromConference(targetId);
        }
        for (const blendedId of currentBlended) {
            if (!currentTargets.includes(blendedId)) {
                this.displacedParts.add(blendedId);
                this.removeFromConference(blendedId);
            }
        }

        this.clearConferenceTable();
        this.pendingAction = null;
        this.addBlendedPart(demandingCloudId, 'spontaneous');
    }

    getDisplacedParts(): Set<string> {
        return new Set(this.displacedParts);
    }

    clearDisplacedPart(cloudId: string): void {
        this.assertNotFrozen('clearDisplacedPart');
        this.displacedParts.delete(cloudId);
    }

    // PartState management (delegated to PartStateManager)

    registerPart(id: string, name: string, options?: {
        trust?: number;
        needAttention?: number;
        partAge?: number | string;
        dialogues?: PartDialogues;
    }): PartState {
        return this.parts.registerPart(id, name, options);
    }

    getPartState(cloudId: string): PartState | undefined {
        return this.parts.getPartState(cloudId);
    }

    getAllPartStates(): Map<string, PartState> {
        return this.parts.getAllPartStates();
    }

    getAllPartIds(): string[] {
        return Array.from(this.parts.getAllPartStates().keys());
    }

    clone(): SimulatorModel {
        const cloned = new SimulatorModel();
        cloned.targetCloudIds = new Set(this.targetCloudIds);
        cloned.supportingParts = new Map();
        for (const [k, v] of this.supportingParts) {
            cloned.supportingParts.set(k, new Set(v));
        }
        cloned.blendedParts = new Map();
        for (const [id, state] of this.blendedParts) {
            cloned.blendedParts.set(id, { ...state });
        }
        cloned.pendingBlends = this.pendingBlends.map(p => ({ ...p }));
        (cloned as { parts: PartStateManager }).parts = this.parts.clone();
        cloned.messages = this.messages.map(m => ({ ...m }));
        cloned.messageIdCounter = this.messageIdCounter;
        cloned.thoughtBubbles = this.thoughtBubbles.map(b => ({ ...b }));
        cloned.selfAmplification = this.selfAmplification;
        cloned.mode = this.mode;
        cloned.pendingAction = this.pendingAction ? { ...this.pendingAction } : null;
        cloned.conversationTherapistDelta = new Map(this.conversationTherapistDelta);
        cloned.conversationShockDelta = new Map(this.conversationShockDelta);
        cloned.conversationParticipantIds = this.conversationParticipantIds ? [...this.conversationParticipantIds] as [string, string] : null;
        cloned.conversationPhases = new Map(this.conversationPhases);
        cloned.conversationSpeakerId = this.conversationSpeakerId;
        cloned.activeConversationKey = this.activeConversationKey;
        cloned.simulationTime = this.simulationTime;
        cloned.orchestratorState = this.orchestratorState ? { ...this.orchestratorState } : null;
        return cloned;
    }

    getMaxConferenceNeedAttention(excludeId?: string): number {
        let max = 0;
        for (const cloudId of this.targetCloudIds) {
            if (cloudId !== excludeId) max = Math.max(max, this.parts.getNeedAttention(cloudId));
        }
        for (const cloudId of this.blendedParts.keys()) {
            if (cloudId !== excludeId) max = Math.max(max, this.parts.getNeedAttention(cloudId));
        }
        return max;
    }

    checkAttentionDemands(rng: RNG, inConference: boolean): { cloudId: string; urgent: boolean; needAttention: number } | null {
        const allParts = this.parts.getAllPartStates();
        const sorted = [...allParts.entries()].sort(
            (a, b) => b[1].needAttention - a[1].needAttention
        );

        for (const [cloudId, state] of sorted) {
            const maxConferenceAttention = this.getMaxConferenceNeedAttention(cloudId);
            const excess = state.needAttention - maxConferenceAttention;
            if (excess <= 1) break;

            if (inConference) {
                if (this.blendedParts.has(cloudId)) continue;
                if (this.pendingBlends.some(p => p.cloudId === cloudId)) continue;
            }

            const protectors = this.parts.getProtectedBy(cloudId);
            if (protectors.size > 0) continue;

            const isTarget = this.targetCloudIds.has(cloudId);
            const urgent = !isTarget && excess > 2 && (excess - 2) > rng.random('urgent_attention');
            if (!urgent && inConference && !isTarget) continue;

            return { cloudId, urgent, needAttention: state.needAttention };
        }
        return null;
    }

    increaseNeedAttention(deltaTime: number, inConference: boolean): void {
        this.assertNotFrozen('increaseNeedAttention');
        const allParts = this.parts.getAllPartStates();
        for (const [cloudId] of allParts) {
            if (this.isBlended(cloudId)) {
                const current = this.parts.getNeedAttention(cloudId);
                if (current > 0) {
                    this.parts.setNeedAttention(cloudId, current * Math.pow(0.98, deltaTime));
                }
                continue;
            }

            if (inConference && (this.isTarget(cloudId) || this.isPendingBlend(cloudId))) continue;

            const isProtectee = this.parts.getProtectedBy(cloudId).size > 0;
            if (isProtectee) continue;

            const trust = this.parts.getTrust(cloudId);
            const rate = 0.01 * (1 - trust);
            if (rate > 0) {
                this.changeNeedAttention(cloudId, deltaTime * rate);
            }
        }
    }

    static readonly MESSAGE_TRAVEL_TIME = 3.0;

    sendMessage(senderId: string, targetId: string, text: string, type: MessageType, conversationPhaseLabel?: string): PartMessage {
        this.assertNotFrozen('sendMessage');
        const message: PartMessage = {
            id: this.messageIdCounter++,
            type,
            senderId,
            targetId,
            text,
            travelTimeRemaining: SimulatorModel.MESSAGE_TRAVEL_TIME,
            conversationPhaseLabel,
        };
        this.messages.push(message);
        return message;
    }

    advanceMessages(deltaTime: number): PartMessage[] {
        this.assertNotFrozen('advanceMessages');
        const arrived: PartMessage[] = [];
        for (const message of this.messages) {
            if (message.travelTimeRemaining > 0) {
                message.travelTimeRemaining -= deltaTime;
                if (message.travelTimeRemaining <= 0) {
                    message.travelTimeRemaining = 0;
                    arrived.push(message);
                }
            }
        }
        return arrived;
    }

    getMessages(): PartMessage[] {
        return [...this.messages];
    }

    removeMessage(id: number): void {
        this.assertNotFrozen('removeMessage');
        const idx = this.messages.findIndex(m => m.id === id);
        if (idx !== -1) {
            this.messages.splice(idx, 1);
        }
    }

    clearMessages(): void {
        this.assertNotFrozen('clearMessages');
        this.messages = [];
    }

    static readonly THOUGHT_BUBBLE_DURATION = 10;

    addThoughtBubble(text: string, cloudId: string, partInitiated: boolean = false): void {
        this.assertNotFrozen('addThoughtBubble');
        const expiresAt = this.simulationTime + SimulatorModel.THOUGHT_BUBBLE_DURATION;
        const id = ++this.messageIdCounter;
        this.thoughtBubbles.push({ id, text, cloudId, expiresAt, partInitiated });
    }

    removeThoughtBubble(id: number): void {
        this.assertNotFrozen('removeThoughtBubble');
        const idx = this.thoughtBubbles.findIndex(b => b.id === id);
        if (idx !== -1) {
            this.thoughtBubbles.splice(idx, 1);
        }
    }

    getThoughtBubbles(): ThoughtBubble[] {
        return [...this.thoughtBubbles];
    }

    expireThoughtBubbles(): void {
        this.assertNotFrozen('expireThoughtBubbles');
        this.thoughtBubbles = this.thoughtBubbles.filter(b => b.expiresAt > this.simulationTime);
    }

    clearThoughtBubbles(): void {
        this.assertNotFrozen('clearThoughtBubbles');
        this.thoughtBubbles = [];
    }

    validateThoughtBubble(bubbleId: number, extendSeconds: number): boolean {
        this.assertNotFrozen('validateThoughtBubble');
        const bubble = this.thoughtBubbles.find(b => b.id === bubbleId);
        if (!bubble) return false;
        bubble.validated = true;
        bubble.expiresAt = this.simulationTime + extendSeconds;
        return true;
    }

    removeThoughtBubblesForCloud(cloudId: string): void {
        this.assertNotFrozen('removeThoughtBubblesForCloud');
        this.thoughtBubbles = this.thoughtBubbles.filter(b => b.cloudId !== cloudId);
    }

    checkAndSetVictory(): boolean {
        this.assertNotFrozen('checkAndSetVictory');
        if (this.victoryAchieved) return false;

        const allParts = this.getAllPartStates();
        if (allParts.size === 0) return false;

        for (const [cloudId, state] of allParts) {
            if (state.trust <= 0.9 || state.needAttention >= 1) return false;
            if (this.parts.getMinInterPartTrust(cloudId) < 0.8) return false;
        }

        this.victoryAchieved = true;
        return true;
    }

    isVictoryAchieved(): boolean {
        return this.victoryAchieved;
    }

    initConversation(participantIds: [string, string], rng: RNG): void {
        this.assertNotFrozen('initConversation');
        const [a, b] = participantIds;
        this.conversationParticipantIds = participantIds;
        const key = [a, b].sort().join('|');
        if (this.activeConversationKey !== key) {
            this.activeConversationKey = key;
        }
        this.parts.applyStanceFlip(a, b, () => rng.random('conv_stance'));
        this.parts.applyStanceFlip(b, a, () => rng.random('conv_stance'));

        const stanceA = this.getConversationEffectiveStance(a);
        const stanceB = this.getConversationEffectiveStance(b);
        const speaker = stanceA >= stanceB ? a : b;
        const listener = speaker === a ? b : a;
        this.conversationSpeakerId = speaker;
        this.conversationPhases.set(speaker, 'speak');
        this.conversationPhases.set(listener, 'listen');
    }

    getConversationParticipantIds(): [string, string] | null {
        return this.conversationParticipantIds;
    }

    isConversationInitialized(): boolean {
        return this.conversationParticipantIds !== null;
    }

    getConversationPhase(cloudId: string): IfioPhase | undefined {
        return this.conversationPhases.get(cloudId);
    }

    setConversationPhase(cloudId: string, phase: IfioPhase): void {
        this.assertNotFrozen('setConversationPhase');
        this.conversationPhases.set(cloudId, phase);
    }

    getConversationPhases(): Map<string, IfioPhase> {
        return this.conversationPhases;
    }

    getConversationSpeakerId(): string | null {
        return this.conversationSpeakerId;
    }

    setConversationSpeakerId(id: string): void {
        this.assertNotFrozen('setConversationSpeakerId');
        this.conversationSpeakerId = id;
    }

    clearConversationStances(): void {
        this.assertNotFrozen('clearConversationStances');
        this.conversationTherapistDelta.clear();
        this.conversationShockDelta.clear();
        this.conversationParticipantIds = null;
        this.conversationPhases.clear();
        this.conversationSpeakerId = null;
        this.activeConversationKey = null;
    }

    getActiveConversationKey(): string | null {
        return this.activeConversationKey;
    }

    getTherapistStanceDelta(cloudId: string): number {
        return this.conversationTherapistDelta.get(cloudId) ?? 0;
    }

    addTherapistStanceDelta(cloudId: string, delta: number): void {
        this.assertNotFrozen('addTherapistStanceDelta');
        if (!this.conversationParticipantIds) return;
        const [a, b] = this.conversationParticipantIds;
        const otherId = cloudId === a ? b : a;
        const stance = this.parts.getRelationStance(cloudId, otherId);
        const current = this.conversationTherapistDelta.get(cloudId) ?? 0;
        const unclamped = current + delta;
        this.conversationTherapistDelta.set(cloudId, Math.max(-1 - stance, Math.min(1 - stance, unclamped)));
    }

    getConversationTherapistDeltas(): Map<string, number> {
        return this.conversationTherapistDelta;
    }

    decayTherapistStanceDeltas(dt: number): void {
        this.assertNotFrozen('decayTherapistStanceDeltas');
        const decay = Math.exp(-0.08 * dt);
        for (const [id, delta] of this.conversationTherapistDelta) {
            const newDelta = delta * decay;
            if (Math.abs(newDelta) < 0.001) {
                this.conversationTherapistDelta.delete(id);
            } else {
                this.conversationTherapistDelta.set(id, newDelta);
            }
        }
        for (const [id, delta] of this.conversationShockDelta) {
            const newDelta = delta * decay;
            if (Math.abs(newDelta) < 0.001) {
                this.conversationShockDelta.delete(id);
            } else {
                this.conversationShockDelta.set(id, newDelta);
            }
        }
    }

    getConversationShockDelta(cloudId: string): number {
        return this.conversationShockDelta.get(cloudId) ?? 0;
    }

    addConversationShockDelta(cloudId: string, delta: number): void {
        this.assertNotFrozen('addConversationShockDelta');
        const current = this.conversationShockDelta.get(cloudId) ?? 0;
        this.conversationShockDelta.set(cloudId, current + delta);
    }

    getSelfTrust(cloudId: string): number {
        return this.parts.getPartState(cloudId)?.trust ?? 0;
    }

    getConversationEffectiveStance(cloudId: string): number {
        if (!this.conversationParticipantIds) return 0;
        const [a, b] = this.conversationParticipantIds;
        const otherId = cloudId === a ? b : a;
        const stance = this.parts.getRelationStance(cloudId, otherId);
        const therapistDelta = this.conversationTherapistDelta.get(cloudId) ?? 0;
        const shockDelta = this.conversationShockDelta.get(cloudId) ?? 0;
        return Math.max(-1, Math.min(1, stance + therapistDelta + shockDelta));
    }

    getConversationEffectiveStances(): Map<string, number> {
        const result = new Map<string, number>();
        if (!this.conversationParticipantIds) return result;
        for (const id of this.conversationParticipantIds) {
            result.set(id, this.getConversationEffectiveStance(id));
        }
        return result;
    }

    getConversationShockDeltas(): Map<string, number> {
        const result = new Map<string, number>();
        if (!this.conversationParticipantIds) return result;
        for (const id of this.conversationParticipantIds) {
            result.set(id, this.conversationShockDelta.get(id) ?? 0);
        }
        return result;
    }

    isConversationPossible(): { possible: boolean; participantIds: [string, string] | null } {
        if (this.mode !== 'foreground') return { possible: false, participantIds: null };
        if (this.blendedParts.size > 0) return { possible: false, participantIds: null };
        const targets = Array.from(this.targetCloudIds);
        if (targets.length !== 2) return { possible: false, participantIds: null };
        const [a, b] = targets;
        const hasRelation = this.parts.hasInterPartRelation(a, b) || this.parts.hasInterPartRelation(b, a);
        if (!hasRelation) {
            return { possible: false, participantIds: null };
        }
        return { possible: true, participantIds: [a, b] };
    }

    syncConversation(rng: RNG): void {
        this.assertNotFrozen('syncConversation');
        const convResult = this.isConversationPossible();
        if (convResult.participantIds) {
            if (!this.isConversationInitialized()) {
                this.initConversation(convResult.participantIds, rng);
            }
        } else if (this.isConversationInitialized()) {
            this.clearConversationStances();
        }
    }

    toJSON(): SerializedModel {
        const supportingParts: Record<string, string[]> = {};
        for (const [k, v] of this.supportingParts) {
            supportingParts[k] = Array.from(v);
        }
        const blendedParts: Record<string, { degree: number; reason: BlendReason }> = {};
        for (const [k, v] of this.blendedParts) {
            blendedParts[k] = { ...v };
        }
        const partsJSON = this.parts.toJSON();
        return {
            targetCloudIds: Array.from(this.targetCloudIds),
            supportingParts,
            blendedParts,
            pendingBlends: this.pendingBlends.map(p => ({ ...p })),
            selfRay: this.selfRay ? { ...this.selfRay } : null,
            displacedParts: Array.from(this.displacedParts),
            messages: this.messages.map(m => ({ ...m })),
            messageIdCounter: this.messageIdCounter,
            ...partsJSON,
            thoughtBubbles: this.thoughtBubbles.map(b => ({ ...b })),
            victoryAchieved: this.victoryAchieved,
            selfAmplification: this.selfAmplification,
            mode: this.mode,
            pendingAction: this.pendingAction ? { ...this.pendingAction } : null,
            conversationEffectiveStances: Object.fromEntries(this.getConversationEffectiveStances()),
            conversationTherapistDelta: Object.fromEntries(this.conversationTherapistDelta),
            conversationShockDelta: Object.fromEntries(this.conversationShockDelta),
            conversationParticipantIds: this.conversationParticipantIds,
            conversationPhases: Object.fromEntries(this.conversationPhases),
            conversationSpeakerId: this.conversationSpeakerId,
            simulationTime: this.simulationTime,
            orchestratorState: this.orchestratorState ?? undefined,
        };
    }

    static fromJSON(json: SerializedModel): SimulatorModel {
        const model = new SimulatorModel();
        model.targetCloudIds = new Set(json.targetCloudIds);
        for (const [k, v] of Object.entries(json.supportingParts)) {
            model.supportingParts.set(k, new Set(v));
        }
        for (const [k, v] of Object.entries(json.blendedParts)) {
            model.blendedParts.set(k, { ...v });
        }
        model.pendingBlends = json.pendingBlends.map(p => ({
            ...p,
            timer: (p as { timer?: number }).timer ?? CARPET_FLY_DURATION
        }));
        model.selfRay = json.selfRay ? { ...json.selfRay } : null;
        model.displacedParts = new Set(json.displacedParts);
        model.messages = json.messages.map(m => ({ ...m }));
        model.messageIdCounter = json.messageIdCounter;
        (model as { parts: PartStateManager }).parts = PartStateManager.fromJSON(json);
        model.thoughtBubbles = (json.thoughtBubbles ?? []).map(b => ({
            ...b,
            id: b.id ?? ++model.messageIdCounter,
        }));
        model.victoryAchieved = json.victoryAchieved ?? false;
        model.selfAmplification = json.selfAmplification ?? 1;
        model.mode = json.mode ?? 'panorama';
        model.pendingAction = json.pendingAction ?? null;
        if (json.conversationTherapistDelta) {
            for (const [k, v] of Object.entries(json.conversationTherapistDelta)) {
                model.conversationTherapistDelta.set(k, v);
            }
        }
        if (json.conversationShockDelta) {
            for (const [k, v] of Object.entries(json.conversationShockDelta)) {
                model.conversationShockDelta.set(k, v);
            }
        }
        model.conversationParticipantIds = json.conversationParticipantIds ?? null;
        if (json.conversationPhases) {
            for (const [k, v] of Object.entries(json.conversationPhases)) {
                model.conversationPhases.set(k, v as IfioPhase);
            }
        }
        model.conversationSpeakerId = json.conversationSpeakerId ?? null;
        model.simulationTime = json.simulationTime ?? 0;
        model.orchestratorState = json.orchestratorState ?? null;
        return model;
    }
}

export { PartState, PartBiography, PartDialogues } from '../cloud/partStateManager.js';
