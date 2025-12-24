import { PartStateManager, PartState, PartBiography, PartDialogues, PartStateChange } from './partStateManager.js';
import { CloudRelationshipManager } from './cloudRelationshipManager.js';

export interface StateAction {
    type: string;
    cloudId?: string;
    targetId?: string;
    data?: Record<string, unknown>;
}

export interface HistoryEntry {
    action: StateAction;
}

export type BlendReason = 'spontaneous' | 'therapist';

export interface BlendedPartState {
    degree: number;
    reason: BlendReason;
}

export interface SelfRayState {
    targetCloudId: string;
}

export class SimulatorModel {
    private targetCloudIds: Set<string> = new Set();
    private supportingParts: Map<string, Set<string>> = new Map();
    private selfRay: SelfRayState | null = null;
    private blendedParts: Map<string, BlendedPartState> = new Map();
    private pendingBlends: { cloudId: string; reason: BlendReason }[] = [];
    private history: HistoryEntry[] = [];
    private parts: PartStateManager = new PartStateManager();
    private displacedParts: Set<string> = new Set();
    private pendingAttentionDemand: string | null = null;

    constructor() {
        this.parts.setChangeListener((change: PartStateChange) => {
            this.record({ type: change.type, cloudId: change.cloudId, data: change.data });
        });
    }

    getTargetCloudIds(): Set<string> {
        return new Set(this.targetCloudIds);
    }

    isTarget(cloudId: string): boolean {
        return this.targetCloudIds.has(cloudId);
    }

    setTargetCloud(cloudId: string): void {
        this.blendedParts.delete(cloudId);
        this.targetCloudIds.clear();
        this.targetCloudIds.add(cloudId);
        this.record({ type: 'setTarget', cloudId });
    }

    addTargetCloud(cloudId: string): void {
        this.blendedParts.delete(cloudId);
        this.targetCloudIds.add(cloudId);
        for (const [targetId, supportingIds] of this.supportingParts) {
            supportingIds.delete(cloudId);
        }
        this.record({ type: 'addTarget', cloudId });
    }

    removeTargetCloud(cloudId: string): void {
        this.targetCloudIds.delete(cloudId);
        if (this.selfRay?.targetCloudId === cloudId) {
            this.clearSelfRay();
        }
        this.record({ type: 'removeTarget', cloudId });
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
        this.record({ type: 'clearTargets' });
    }

    setSupportingParts(targetId: string, supportingIds: Set<string>): void {
        this.supportingParts.set(targetId, new Set(supportingIds));
        this.record({ type: 'setSupportingParts', targetId, data: { supportingIds: Array.from(supportingIds) } });
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
        this.record({ type: 'clearSupportingParts' });
    }

    addBlendedPart(cloudId: string, reason: BlendReason = 'spontaneous', degree: number = 1): void {
        if (this.targetCloudIds.has(cloudId)) return;
        if (!this.blendedParts.has(cloudId)) {
            this.blendedParts.set(cloudId, { degree: Math.max(0.01, Math.min(1, degree)), reason });
            this.clearSelfRay();
            this.record({ type: 'addBlended', cloudId, data: { degree, reason } });
        }
    }

    removeBlendedPart(cloudId: string): void {
        if (this.blendedParts.has(cloudId)) {
            this.blendedParts.delete(cloudId);
            this.record({ type: 'removeBlended', cloudId });
        }
    }

    setBlendingDegree(cloudId: string, degree: number): void {
        const existing = this.blendedParts.get(cloudId);
        if (existing) {
            const clampedDegree = Math.max(0, Math.min(1, degree));
            this.blendedParts.set(cloudId, { ...existing, degree: clampedDegree });
            this.record({ type: 'setBlendingDegree', cloudId, data: { degree: clampedDegree } });
        }
    }

    promoteBlendedToTarget(cloudId: string): void {
        if (!this.blendedParts.has(cloudId)) return;
        this.blendedParts.delete(cloudId);
        this.targetCloudIds.add(cloudId);
        this.record({ type: 'promoteToTarget', cloudId });
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
            this.record({ type: 'setBlendReason', cloudId, data: { reason } });
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
        this.record({ type: 'clearBlendedParts' });
    }

    enqueuePendingBlend(cloudId: string, reason: BlendReason): void {
        if (!this.pendingBlends.some(p => p.cloudId === cloudId)) {
            this.pendingBlends.push({ cloudId, reason });
            this.record({ type: 'enqueuePendingBlend', cloudId, data: { reason } });
        }
    }

    dequeuePendingBlend(): { cloudId: string; reason: BlendReason } | null {
        const item = this.pendingBlends.shift() ?? null;
        if (item) {
            this.record({ type: 'dequeuePendingBlend', cloudId: item.cloudId });
        }
        return item;
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
        this.record({ type: 'clearPendingBlends' });
    }

    setSelfRay(targetCloudId: string): void {
        this.selfRay = { targetCloudId };
        this.record({ type: 'setSelfRay', cloudId: targetCloudId });
    }

    clearSelfRay(): void {
        if (this.selfRay) {
            const oldTarget = this.selfRay.targetCloudId;
            this.selfRay = null;
            this.record({ type: 'clearSelfRay', cloudId: oldTarget });
        }
    }

    getSelfRay(): SelfRayState | null {
        return this.selfRay;
    }

    hasSelfRay(): boolean {
        return this.selfRay !== null;
    }

    stepBackPart(cloudId: string): void {
        const wasTarget = this.targetCloudIds.has(cloudId);
        const wasBlended = this.blendedParts.has(cloudId);

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

        this.record({ type: 'stepBack', cloudId, data: { wasTarget, wasBlended } });
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

        this.clearTargets();
        this.clearBlendedParts();
        this.clearSupportingParts();

        this.addBlendedPart(demandingCloudId, 'spontaneous');

        this.record({ type: 'partDemandsAttention', cloudId: demandingCloudId, data: {} });
    }

    getDisplacedParts(): Set<string> {
        return new Set(this.displacedParts);
    }

    clearDisplacedPart(cloudId: string): void {
        this.displacedParts.delete(cloudId);
    }

    private record(action: StateAction): void {
        this.history.push({ action });
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

    setTrust(cloudId: string, trust: number, reason?: string): void {
        this.parts.setTrust(cloudId, trust, reason);
    }

    adjustTrust(cloudId: string, multiplier: number, reason?: string): void {
        this.parts.adjustTrust(cloudId, multiplier, reason);
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

    recordQuestion(cloudId: string, question: string): void {
        this.record({ type: 'askQuestion', cloudId, data: { question } });
    }

    getHistory(): HistoryEntry[] {
        return [...this.history];
    }

    formatTrace(cloudNames: Map<string, string>): string {
        const lines: string[] = [];
        const getName = (id: string) => cloudNames.get(id) ?? id;

        for (let i = 0; i < this.history.length; i++) {
            const entry = this.history[i];
            const action = this.formatAction(entry.action, getName);
            lines.push(`[${i}] ${action}`);
        }

        return lines.join('\n');
    }

    private formatAction(action: StateAction, getName: (id: string) => string): string {
        const { type, cloudId, targetId, data } = action;

        switch (type) {
            case 'setTarget':
                return `Set target: ${getName(cloudId!)}`;
            case 'addTarget':
                return `Add to conference: ${getName(cloudId!)}`;
            case 'removeTarget':
                return `Remove from conference: ${getName(cloudId!)}`;
            case 'clearTargets':
                return 'Clear all targets';
            case 'addBlended':
                return `Blend: ${getName(cloudId!)} (${((data?.degree as number) * 100).toFixed(0)}%)`;
            case 'removeBlended':
                return `Unblend: ${getName(cloudId!)}`;
            case 'setBlendingDegree':
                return `Set blending: ${getName(cloudId!)} to ${((data?.degree as number) * 100).toFixed(0)}%`;
            case 'clearBlendedParts':
                return 'Clear all blended parts';
            case 'setSupportingParts':
                const ids = (data?.supportingIds as string[]) ?? [];
                return `Show supporters for ${getName(targetId!)}: ${ids.map(getName).join(', ')}`;
            case 'clearSupportingParts':
                return 'Clear supporting parts';
            case 'stepBack':
                return `Step back: ${getName(cloudId!)}`;
            case 'askQuestion':
                return `Ask "${data?.question}": ${getName(cloudId!)}`;
            case 'promoteToTarget':
                return `Separated and joined: ${getName(cloudId!)}`;
            case 'revealIdentity':
                return `Revealed identity: ${getName(cloudId!)}`;
            case 'revealAge':
                return `Revealed age: ${getName(cloudId!)}`;
            case 'revealRelationships':
                return `Revealed relationships: ${getName(cloudId!)}`;
            case 'revealProtects':
                return `Revealed protects: ${getName(cloudId!)}`;
            case 'revealJob':
                return `Revealed job: ${getName(cloudId!)}`;
            case 'setTrust':
                return `Set trust: ${getName(cloudId!)} ${((data?.oldTrust as number) * 100).toFixed(0)}% → ${((data?.newTrust as number) * 100).toFixed(0)}%${data?.reason ? ` (${data.reason})` : ''}`;
            case 'adjustTrust':
                return `Adjust trust: ${getName(cloudId!)} ×${data?.multiplier} (${((data?.oldTrust as number) * 100).toFixed(0)}% → ${((data?.newTrust as number) * 100).toFixed(0)}%)${data?.reason ? ` (${data.reason})` : ''}`;
            default:
                return type;
        }
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
        cloned.parts.setChangeListener((change: PartStateChange) => {
            cloned.record({ type: change.type, cloudId: change.cloudId, data: change.data });
        });
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
}

export { PartState, PartBiography, PartDialogues } from './partStateManager.js';
