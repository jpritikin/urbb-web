import { PartStateManager, PartState, PartBiography, PartDialogues } from './partStateManager.js';
import { CloudRelationshipManager } from './cloudRelationshipManager.js';
import type { SerializedModel } from './testability/types.js';
import type { RNG } from './testability/rng.js';

export type BlendReason = 'spontaneous' | 'therapist';
export type MessageType = 'grievance';

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
}

export interface ThoughtBubble {
    text: string;
    cloudId: string;
    expiresAt: number;  // timestamp when this bubble should disappear
}

export class SimulatorModel {
    private targetCloudIds: Set<string> = new Set();
    private supportingParts: Map<string, Set<string>> = new Map();
    private selfRay: SelfRayState | null = null;
    private blendedParts: Map<string, BlendedPartState> = new Map();
    private pendingBlends: { cloudId: string; reason: BlendReason }[] = [];
    readonly parts: PartStateManager = new PartStateManager();
    private displacedParts: Set<string> = new Set();
    private messages: PartMessage[] = [];
    private messageIdCounter: number = 0;
    private thoughtBubbles: ThoughtBubble[] = [];
    private victoryAchieved: boolean = false;
    private selfAmplification: number = 1;

    getSelfAmplification(): number {
        return this.selfAmplification;
    }

    setSelfAmplification(value: number): void {
        this.selfAmplification = value;
    }

    changeNeedAttention(cloudId: string, delta: number): void {
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
        this.blendedParts.clear();
        this.targetCloudIds.clear();
        this.targetCloudIds.add(cloudId);
        this.supportingParts.clear();
        this.clearSelfRay();
    }

    addTargetCloud(cloudId: string): void {
        this.blendedParts.delete(cloudId);
        this.targetCloudIds.add(cloudId);
        for (const [, supportingIds] of this.supportingParts) {
            supportingIds.delete(cloudId);
        }
    }

    removeTargetCloud(cloudId: string): void {
        this.targetCloudIds.delete(cloudId);
        if (this.selfRay?.targetCloudId === cloudId) {
            this.clearSelfRay();
        }
    }

    toggleTargetCloud(cloudId: string): void {
        if (this.targetCloudIds.has(cloudId)) {
            this.removeTargetCloud(cloudId);
        } else {
            this.addTargetCloud(cloudId);
        }
    }

    clearTargets(): void {
        this.targetCloudIds.clear();
        this.clearSelfRay();
    }

    setSupportingParts(targetId: string, supportingIds: Set<string>): void {
        this.supportingParts.set(targetId, new Set(supportingIds));
    }

    summonSupportingPart(targetId: string, supportingId: string): boolean {
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
        this.supportingParts.clear();
    }

    clearConferenceTable(): void {
        this.targetCloudIds.clear();
        this.clearSelfRay();
        this.blendedParts.clear();
        this.supportingParts.clear();
    }

    addBlendedPart(cloudId: string, reason: BlendReason = 'spontaneous', degree: number = 1): void {
        if (this.targetCloudIds.has(cloudId)) {
            this.removeTargetCloud(cloudId);
        }
        if (!this.blendedParts.has(cloudId)) {
            this.blendedParts.set(cloudId, { degree: Math.max(0.01, Math.min(1, degree)), reason });
            this.clearSelfRay();
        }
    }

    removeBlendedPart(cloudId: string): void {
        if (this.blendedParts.has(cloudId)) {
            this.blendedParts.delete(cloudId);
        }
    }

    setBlendingDegree(cloudId: string, degree: number): void {
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
        if (!this.blendedParts.has(cloudId)) return;
        this.blendedParts.delete(cloudId);
        this.targetCloudIds.add(cloudId);
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
        this.blendedParts.clear();
    }

    enqueuePendingBlend(cloudId: string, reason: BlendReason): void {
        if (!this.pendingBlends.some(p => p.cloudId === cloudId)) {
            this.pendingBlends.push({ cloudId, reason });
        }
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

    clearPendingBlends(): void {
        this.pendingBlends = [];
    }

    setSelfRay(targetCloudId: string): void {
        this.selfRay = { targetCloudId };
    }

    clearSelfRay(): void {
        this.selfRay = null;
    }

    getSelfRay(): SelfRayState | null {
        return this.selfRay;
    }

    hasSelfRay(): boolean {
        return this.selfRay !== null;
    }

    stepBackPart(cloudId: string): void {
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
        const currentTargets = Array.from(this.targetCloudIds);
        const currentBlended = this.getBlendedParts();

        for (const targetId of currentTargets) {
            this.displacedParts.add(targetId);
            this.stepBackPart(targetId);
        }
        for (const blendedId of currentBlended) {
            if (!currentTargets.includes(blendedId)) {
                this.displacedParts.add(blendedId);
                this.stepBackPart(blendedId);
            }
        }

        this.clearConferenceTable();
        this.addBlendedPart(demandingCloudId, 'spontaneous');
    }

    getDisplacedParts(): Set<string> {
        return new Set(this.displacedParts);
    }

    clearDisplacedPart(cloudId: string): void {
        this.displacedParts.delete(cloudId);
    }

    // PartState management (delegated to PartStateManager)

    registerPart(id: string, name: string, options?: {
        trust?: number;
        needAttention?: number;
        agreedWaitUntil?: number;
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
        return cloned;
    }

    checkAttentionDemands(relationships: CloudRelationshipManager, rng: RNG, inConference: boolean): { cloudId: string; urgent: boolean; needAttention: number } | null {
        const allParts = this.parts.getAllPartStates();
        const sorted = [...allParts.entries()].sort(
            (a, b) => b[1].needAttention - a[1].needAttention
        );

        for (const [cloudId, state] of sorted) {
            if (state.needAttention <= 1) break;

            if (inConference) {
                if (this.blendedParts.has(cloudId)) continue;
                if (this.pendingBlends.some(p => p.cloudId === cloudId)) continue;
                if (this.targetCloudIds.has(cloudId)) continue;
            }

            const protectors = relationships.getProtectedBy(cloudId);
            if (protectors.size > 0) continue;

            const urgent = state.needAttention > 2 && (state.needAttention - 2) > rng.random('urgent_attention');
            if (!urgent && inConference) continue;

            return { cloudId, urgent, needAttention: state.needAttention };
        }
        return null;
    }

    increaseNeedAttention(relationships: CloudRelationshipManager, deltaTime: number, inConference: boolean): void {
        const allParts = this.parts.getAllPartStates();
        for (const [cloudId] of allParts) {
            if (this.parts.isUnburdened(cloudId)) continue;
            if (inConference && (this.isBlended(cloudId) || this.isTarget(cloudId) || this.isPendingBlend(cloudId))) continue;

            const hasGrievances = relationships.getGrievanceTargets(cloudId).size > 0;
            const isProtectee = relationships.getProtectedBy(cloudId).size > 0;
            const trust = this.parts.getTrust(cloudId);

            let rate = 0;
            if (hasGrievances) {
                rate = 0.05;
            } else if (!isProtectee) {
                rate = 0.01 * (1 - trust);
            }

            if (rate > 0) {
                this.changeNeedAttention(cloudId, deltaTime * rate);
            }
        }
    }

    static readonly MESSAGE_TRAVEL_TIME = 3.0;

    sendMessage(senderId: string, targetId: string, text: string, type: MessageType): PartMessage {
        const message: PartMessage = {
            id: this.messageIdCounter++,
            type,
            senderId,
            targetId,
            text,
            travelTimeRemaining: SimulatorModel.MESSAGE_TRAVEL_TIME,
        };
        this.messages.push(message);
        return message;
    }

    advanceMessages(deltaTime: number): PartMessage[] {
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
        const idx = this.messages.findIndex(m => m.id === id);
        if (idx !== -1) {
            this.messages.splice(idx, 1);
        }
    }

    clearMessages(): void {
        this.messages = [];
    }

    static readonly THOUGHT_BUBBLE_DURATION_MS = 10000;

    addThoughtBubble(text: string, cloudId: string, now: number = Date.now()): void {
        const expiresAt = now + SimulatorModel.THOUGHT_BUBBLE_DURATION_MS;
        this.thoughtBubbles.unshift({ text, cloudId, expiresAt });
    }

    getThoughtBubbles(): ThoughtBubble[] {
        return [...this.thoughtBubbles];
    }

    getCurrentThoughtBubble(): ThoughtBubble | null {
        return this.thoughtBubbles[0] ?? null;
    }

    expireThoughtBubbles(now: number = Date.now()): void {
        this.thoughtBubbles = this.thoughtBubbles.filter(b => b.expiresAt > now);
    }

    clearThoughtBubbles(): void {
        this.thoughtBubbles = [];
    }

    removeThoughtBubblesForCloud(cloudId: string): void {
        this.thoughtBubbles = this.thoughtBubbles.filter(b => b.cloudId !== cloudId);
    }

    checkAndSetVictory(relationships: { getProtecting: (id: string) => Set<string> }): boolean {
        if (this.victoryAchieved) return false;

        const allParts = this.getAllPartStates();
        if (allParts.size === 0) return false;

        for (const [cloudId, state] of allParts) {
            if (state.trust <= 0.9 || state.needAttention >= 1) return false;
            const isProtector = relationships.getProtecting(cloudId).size > 0;
            if (isProtector && !state.biography.unburdened) return false;
        }

        this.victoryAchieved = true;
        return true;
    }

    isVictoryAchieved(): boolean {
        return this.victoryAchieved;
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
        return {
            targetCloudIds: Array.from(this.targetCloudIds),
            supportingParts,
            blendedParts,
            pendingBlends: this.pendingBlends.map(p => ({ ...p })),
            selfRay: this.selfRay ? { ...this.selfRay } : null,
            displacedParts: Array.from(this.displacedParts),
            messages: this.messages.map(m => ({ ...m })),
            messageIdCounter: this.messageIdCounter,
            partStates: this.parts.toJSON(),
            thoughtBubbles: this.thoughtBubbles.map(b => ({ ...b })),
            victoryAchieved: this.victoryAchieved,
            selfAmplification: this.selfAmplification,
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
        model.pendingBlends = json.pendingBlends.map(p => ({ ...p }));
        model.selfRay = json.selfRay ? { ...json.selfRay } : null;
        model.displacedParts = new Set(json.displacedParts);
        model.messages = json.messages.map(m => ({ ...m }));
        model.messageIdCounter = json.messageIdCounter;
        (model as { parts: PartStateManager }).parts = PartStateManager.fromJSON(json.partStates);
        model.thoughtBubbles = (json.thoughtBubbles ?? []).map(b => ({ ...b }));
        model.victoryAchieved = json.victoryAchieved ?? false;
        model.selfAmplification = json.selfAmplification ?? 1;
        return model;
    }
}

export { PartState, PartBiography, PartDialogues } from './partStateManager.js';
