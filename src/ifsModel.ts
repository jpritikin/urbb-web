import { PartState, PartBiography, PartDialogues, createPartState } from './partState.js';

export interface StateAction {
    type: string;
    cloudId?: string;
    targetId?: string;
    data?: Record<string, unknown>;
}

export interface HistoryEntry {
    timestamp: number;
    action: StateAction;
}

export class SimulatorModel {
    private targetCloudIds: Set<string> = new Set();
    private supportingParts: Map<string, Set<string>> = new Map();
    private blendedParts: Map<string, number> = new Map(); // cloudId -> blending degree (0-1)
    private selectedCloudId: string | null = null;
    private history: HistoryEntry[] = [];
    private partStates: Map<string, PartState> = new Map();

    getTargetCloudIds(): Set<string> {
        return new Set(this.targetCloudIds);
    }

    isTarget(cloudId: string): boolean {
        return this.targetCloudIds.has(cloudId);
    }

    setTargetCloud(cloudId: string): void {
        this.targetCloudIds.clear();
        this.targetCloudIds.add(cloudId);
        this.record({ type: 'setTarget', cloudId });
    }

    addTargetCloud(cloudId: string): void {
        this.targetCloudIds.add(cloudId);
        for (const [targetId, supportingIds] of this.supportingParts) {
            supportingIds.delete(cloudId);
        }
        this.record({ type: 'addTarget', cloudId });
    }

    removeTargetCloud(cloudId: string): void {
        this.targetCloudIds.delete(cloudId);
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

    addBlendedPart(cloudId: string, degree: number = 1): void {
        if (!this.blendedParts.has(cloudId)) {
            this.blendedParts.set(cloudId, Math.max(0.01, Math.min(1, degree)));
            this.record({ type: 'addBlended', cloudId, data: { degree } });
        }
    }

    removeBlendedPart(cloudId: string): void {
        if (this.blendedParts.has(cloudId)) {
            this.blendedParts.delete(cloudId);
            this.record({ type: 'removeBlended', cloudId });
        }
    }

    setBlendingDegree(cloudId: string, degree: number): void {
        if (this.blendedParts.has(cloudId)) {
            const clampedDegree = Math.max(0, Math.min(1, degree));
            this.blendedParts.set(cloudId, clampedDegree);
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
        return this.blendedParts.get(cloudId) ?? 0;
    }

    getBlendedParts(): string[] {
        return Array.from(this.blendedParts.keys());
    }

    getBlendedPartsWithDegrees(): Map<string, number> {
        return new Map(this.blendedParts);
    }

    isBlended(cloudId: string): boolean {
        return this.blendedParts.has(cloudId);
    }

    clearBlendedParts(): void {
        this.blendedParts.clear();
        this.record({ type: 'clearBlendedParts' });
    }

    selectCloud(cloudId: string | null): void {
        if (this.selectedCloudId === cloudId) {
            return;
        }
        const oldId = this.selectedCloudId;
        this.selectedCloudId = cloudId;
        this.record({ type: 'selectCloud', cloudId: cloudId ?? undefined, data: { previousId: oldId } });
    }

    deselectCloud(): void {
        if (this.selectedCloudId !== null) {
            const oldId = this.selectedCloudId;
            this.selectedCloudId = null;
            this.record({ type: 'deselectCloud', data: { previousId: oldId } });
        }
    }

    getSelectedCloudId(): string | null {
        return this.selectedCloudId;
    }

    isSelected(cloudId: string): boolean {
        return this.selectedCloudId === cloudId;
    }

    stepBackPart(cloudId: string): void {
        const wasTarget = this.targetCloudIds.has(cloudId);
        const wasBlended = this.blendedParts.has(cloudId);

        this.targetCloudIds.delete(cloudId);

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
        if (this.selectedCloudId === cloudId) {
            this.selectedCloudId = null;
        }

        this.record({ type: 'stepBack', cloudId, data: { wasTarget, wasBlended } });
    }

    private record(action: StateAction): void {
        this.history.push({ timestamp: Date.now(), action });
    }

    // PartState management

    registerPart(id: string, name: string, options?: {
        trust?: number;
        needAttention?: number;
        agreedWaitUntil?: number;
        partAge?: number | string;
        dialogues?: PartDialogues;
    }): PartState {
        const state = createPartState(id, name, options);
        this.partStates.set(id, state);
        return state;
    }

    getPartState(cloudId: string): PartState | undefined {
        return this.partStates.get(cloudId);
    }

    getAllPartStates(): Map<string, PartState> {
        return new Map(this.partStates);
    }

    getTrust(cloudId: string): number {
        return this.partStates.get(cloudId)?.trust ?? 0.5;
    }

    setTrust(cloudId: string, trust: number, reason?: string): void {
        const state = this.partStates.get(cloudId);
        if (!state) return;
        const oldTrust = state.trust;
        state.trust = Math.max(0, Math.min(1, trust));
        this.record({ type: 'setTrust', cloudId, data: { oldTrust, newTrust: state.trust, reason } });
    }

    adjustTrust(cloudId: string, multiplier: number, reason?: string): void {
        const state = this.partStates.get(cloudId);
        if (!state) return;
        const oldTrust = state.trust;
        state.trust = Math.max(0, Math.min(1, state.trust * multiplier));
        this.record({ type: 'adjustTrust', cloudId, data: { oldTrust, newTrust: state.trust, multiplier, reason } });
    }

    getNeedAttention(cloudId: string): number {
        return this.partStates.get(cloudId)?.needAttention ?? 0.1;
    }

    setNeedAttention(cloudId: string, needAttention: number): void {
        const state = this.partStates.get(cloudId);
        if (state) {
            state.needAttention = needAttention;
        }
    }

    adjustNeedAttention(cloudId: string, multiplier: number): void {
        const state = this.partStates.get(cloudId);
        if (state) {
            state.needAttention *= multiplier;
        }
    }

    getDialogues(cloudId: string): PartDialogues {
        return this.partStates.get(cloudId)?.dialogues ?? {};
    }

    getBiography(cloudId: string): PartBiography | undefined {
        return this.partStates.get(cloudId)?.biography;
    }

    revealIdentity(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state && !state.biography.identityRevealed) {
            state.biography.identityRevealed = true;
            this.record({ type: 'revealIdentity', cloudId });
        }
    }

    isIdentityRevealed(cloudId: string): boolean {
        return this.partStates.get(cloudId)?.biography.identityRevealed ?? false;
    }

    revealAge(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state && !state.biography.ageRevealed) {
            state.biography.ageRevealed = true;
            this.record({ type: 'revealAge', cloudId });
        }
    }

    revealRelationships(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state && !state.biography.relationshipsRevealed) {
            state.biography.relationshipsRevealed = true;
            this.record({ type: 'revealRelationships', cloudId });
        }
    }

    revealProtects(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state && !state.biography.protectsRevealed) {
            state.biography.protectsRevealed = true;
            this.record({ type: 'revealProtects', cloudId });
        }
    }

    getDisplayAge(cloudId: string): string | null {
        const state = this.partStates.get(cloudId);
        if (!state || !state.biography.ageRevealed) return null;
        if (state.biography.partAge === null) return null;
        if (typeof state.biography.partAge === 'string') return state.biography.partAge;
        return `${state.biography.partAge} years old`;
    }

    getPartName(cloudId: string): string {
        return this.partStates.get(cloudId)?.name ?? cloudId;
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
            const time = new Date(entry.timestamp).toLocaleTimeString();
            const action = this.formatAction(entry.action, getName);
            lines.push(`[${i}] ${time}: ${action}`);
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
            case 'selectCloud':
                return cloudId ? `Select: ${getName(cloudId)}` : 'Clear selection';
            case 'deselectCloud':
                return `Deselect: ${data?.previousId ? getName(data.previousId as string) : 'cloud'}`;
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
        cloned.blendedParts = new Map(this.blendedParts);
        cloned.selectedCloudId = this.selectedCloudId;
        for (const [id, state] of this.partStates) {
            cloned.partStates.set(id, {
                ...state,
                biography: { ...state.biography },
                dialogues: { ...state.dialogues },
            });
        }
        return cloned;
    }
}

export { PartState, PartBiography, PartDialogues } from './partState.js';
