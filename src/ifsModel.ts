import { PartStateManager, PartState, PartBiography, PartDialogues } from './partStateManager.js';
import { CloudRelationshipManager } from './cloudRelationshipManager.js';

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
}

export class SimulatorModel {
    private targetCloudIds: Set<string> = new Set();
    private supportingParts: Map<string, Set<string>> = new Map();
    private selfRay: SelfRayState | null = null;
    private blendedParts: Map<string, BlendedPartState> = new Map();
    private pendingBlends: { cloudId: string; reason: BlendReason }[] = [];
    private parts: PartStateManager = new PartStateManager();
    private displacedParts: Set<string> = new Set();
    private pendingAttentionDemand: string | null = null;
    private messages: PartMessage[] = [];
    private messageIdCounter: number = 0;

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
            this.blendedParts.set(cloudId, { ...existing, degree: clampedDegree });
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

    getTrust(cloudId: string): number {
        return this.parts.getTrust(cloudId);
    }

    setTrust(cloudId: string, trust: number): void {
        this.parts.setTrust(cloudId, trust);
    }

    adjustTrust(cloudId: string, multiplier: number): void {
        this.parts.adjustTrust(cloudId, multiplier);
    }

    addTrust(cloudId: string, amount: number): void {
        this.parts.addTrust(cloudId, amount);
    }

    getNeedAttention(cloudId: string): number {
        return this.parts.getNeedAttention(cloudId);
    }

    setNeedAttention(cloudId: string, needAttention: number): void {
        this.parts.setNeedAttention(cloudId, needAttention);
    }

    adjustNeedAttention(cloudId: string, multiplier: number): void {
        this.parts.adjustNeedAttention(cloudId, multiplier);
    }

    markAsProxy(cloudId: string): void {
        this.parts.markAsProxy(cloudId);
    }

    wasProxy(cloudId: string): boolean {
        return this.parts.wasProxy(cloudId);
    }

    setAttacked(cloudId: string): void {
        this.parts.setAttacked(cloudId);
    }

    clearAttacked(cloudId: string): void {
        this.parts.clearAttacked(cloudId);
    }

    isAttacked(cloudId: string): boolean {
        return this.parts.isAttacked(cloudId);
    }

    isTrustAtCeiling(cloudId: string): boolean {
        return this.parts.isTrustAtCeiling(cloudId);
    }

    getDialogues(cloudId: string): PartDialogues {
        return this.parts.getDialogues(cloudId);
    }

    getBiography(cloudId: string): PartBiography | undefined {
        return this.parts.getBiography(cloudId);
    }

    revealIdentity(cloudId: string): void {
        this.parts.revealIdentity(cloudId);
    }

    isIdentityRevealed(cloudId: string): boolean {
        return this.parts.isIdentityRevealed(cloudId);
    }

    revealAge(cloudId: string): void {
        this.parts.revealAge(cloudId);
    }

    revealRelationships(cloudId: string): void {
        this.parts.revealRelationships(cloudId);
    }

    revealProtects(cloudId: string): void {
        this.parts.revealProtects(cloudId);
    }

    revealUnburdenedJob(cloudId: string): void {
        this.parts.revealUnburdenedJob(cloudId);
    }

    isUnburdenedJobRevealed(cloudId: string): boolean {
        return this.parts.isUnburdenedJobRevealed(cloudId);
    }

    revealJobAppraisal(cloudId: string): void {
        this.parts.revealJobAppraisal(cloudId);
    }

    isJobAppraisalRevealed(cloudId: string): boolean {
        return this.parts.isJobAppraisalRevealed(cloudId);
    }

    revealJobImpact(cloudId: string): void {
        this.parts.revealJobImpact(cloudId);
    }

    isJobImpactRevealed(cloudId: string): boolean {
        return this.parts.isJobImpactRevealed(cloudId);
    }

    setConsentedToHelp(cloudId: string): void {
        this.parts.setConsentedToHelp(cloudId);
    }

    hasConsentedToHelp(cloudId: string): boolean {
        return this.parts.hasConsentedToHelp(cloudId);
    }

    hasJob(cloudId: string): boolean {
        return this.parts.hasJob(cloudId);
    }

    getUnrevealedBiographyFields(cloudId: string): ('age' | 'identity' | 'job')[] {
        return this.parts.getUnrevealedBiographyFields(cloudId);
    }

    getDisplayAge(cloudId: string): string | null {
        return this.parts.getDisplayAge(cloudId);
    }

    getPartName(cloudId: string): string {
        return this.parts.getPartName(cloudId);
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
        cloned.parts = this.parts.clone();
        cloned.messages = this.messages.map(m => ({ ...m }));
        cloned.messageIdCounter = this.messageIdCounter;
        return cloned;
    }

    checkAttentionDemands(relationships: CloudRelationshipManager): void {
        if (this.pendingAttentionDemand) return;

        const allParts = this.parts.getAllPartStates();
        const sorted = [...allParts.entries()].sort(
            (a, b) => b[1].needAttention - a[1].needAttention
        );

        for (const [cloudId, state] of sorted) {
            if (state.needAttention <= 1) break;

            const protectors = relationships.getProtectedBy(cloudId);
            if (protectors.size > 0) continue;

            this.setNeedAttention(cloudId, 0.95);
            this.partDemandsAttention(cloudId);
            this.pendingAttentionDemand = cloudId;
            break;
        }
    }

    consumeAttentionDemand(): string | null {
        const cloudId = this.pendingAttentionDemand;
        this.pendingAttentionDemand = null;
        return cloudId;
    }

    hasPendingAttentionDemand(): boolean {
        return this.pendingAttentionDemand !== null;
    }

    sendMessage(senderId: string, targetId: string, text: string, type: MessageType): PartMessage {
        const message: PartMessage = {
            id: this.messageIdCounter++,
            type,
            senderId,
            targetId,
            text,
        };
        this.messages.push(message);
        return message;
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
}

export { PartState, PartBiography, PartDialogues } from './partStateManager.js';
