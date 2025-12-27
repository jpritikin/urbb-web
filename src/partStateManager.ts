import { PartState, PartBiography, PartDialogues, createPartState } from './partState.js';

export class PartStateManager {
    toJSON(): Record<string, PartState> {
        const result: Record<string, PartState> = {};
        for (const [id, state] of this.partStates) {
            result[id] = {
                ...state,
                biography: { ...state.biography },
                dialogues: { ...state.dialogues },
            };
        }
        return result;
    }

    static fromJSON(json: Record<string, PartState>): PartStateManager {
        const manager = new PartStateManager();
        for (const [id, state] of Object.entries(json)) {
            manager.partStates.set(id, {
                ...state,
                biography: { ...state.biography },
                dialogues: { ...state.dialogues },
            });
        }
        return manager;
    }

    private partStates: Map<string, PartState> = new Map();

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

    getOpenness(cloudId: string): number {
        const bio = this.partStates.get(cloudId)?.biography;
        if (!bio) return 0;
        let openness = 0;
        if (bio.ageRevealed) openness += 0.5;
        if (bio.identityRevealed) openness += 0.2;
        if (bio.jobAppraisalRevealed) openness += 0.15;
        if (bio.jobImpactRevealed) openness += 0.15;
        return openness;
    }

    private clampTrust(state: PartState, trust: number): number {
        const maxTrust = state.attacked ? 0.8 : 1;
        return Math.max(0, Math.min(maxTrust, trust));
    }

    setTrust(cloudId: string, trust: number): void {
        const state = this.partStates.get(cloudId);
        if (!state) return;
        state.trust = this.clampTrust(state, trust);
    }

    adjustTrust(cloudId: string, multiplier: number): void {
        const state = this.partStates.get(cloudId);
        if (!state) return;
        state.trust = this.clampTrust(state, state.trust * multiplier);
    }

    addTrust(cloudId: string, amount: number): void {
        const state = this.partStates.get(cloudId);
        if (!state) return;
        state.trust = this.clampTrust(state, state.trust + amount);
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

    addNeedAttention(cloudId: string, amount: number): void {
        const state = this.partStates.get(cloudId);
        if (state) {
            state.needAttention = Math.max(0, state.needAttention + amount);
        }
    }

    markAsProxy(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state) {
            state.wasProxy = true;
        }
    }

    wasProxy(cloudId: string): boolean {
        return this.partStates.get(cloudId)?.wasProxy ?? false;
    }

    setAttacked(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state) {
            state.attacked = true;
        }
    }

    clearAttacked(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state) {
            state.attacked = false;
        }
    }

    isAttacked(cloudId: string): boolean {
        return this.partStates.get(cloudId)?.attacked ?? false;
    }

    isTrustAtCeiling(cloudId: string): boolean {
        const state = this.partStates.get(cloudId);
        if (!state) return false;
        const maxTrust = state.attacked ? 0.8 : 1;
        return state.trust >= maxTrust;
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
        }
    }

    isIdentityRevealed(cloudId: string): boolean {
        return this.partStates.get(cloudId)?.biography.identityRevealed ?? false;
    }

    revealAge(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state && !state.biography.ageRevealed) {
            state.biography.ageRevealed = true;
        }
    }

    revealRelationships(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state && !state.biography.relationshipsRevealed) {
            state.biography.relationshipsRevealed = true;
        }
    }

    revealProtects(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state && !state.biography.protectsRevealed) {
            state.biography.protectsRevealed = true;
        }
    }

    setUnburdened(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state && !state.biography.unburdened) {
            state.biography.unburdened = true;
        }
    }

    isUnburdened(cloudId: string): boolean {
        return this.partStates.get(cloudId)?.biography.unburdened ?? false;
    }

    revealJobAppraisal(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state && !state.biography.jobAppraisalRevealed) {
            state.biography.jobAppraisalRevealed = true;
        }
    }

    isJobAppraisalRevealed(cloudId: string): boolean {
        return this.partStates.get(cloudId)?.biography.jobAppraisalRevealed ?? false;
    }

    revealJobImpact(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state && !state.biography.jobImpactRevealed) {
            state.biography.jobImpactRevealed = true;
        }
    }

    isJobImpactRevealed(cloudId: string): boolean {
        return this.partStates.get(cloudId)?.biography.jobImpactRevealed ?? false;
    }

    isFieldRevealed(cloudId: string, field: string): boolean {
        const bio = this.partStates.get(cloudId)?.biography;
        if (!bio) return false;
        switch (field) {
            case 'age': return bio.ageRevealed;
            case 'identity': return bio.identityRevealed;
            case 'job': return bio.identityRevealed && !bio.unburdened;
            case 'jobAppraisal': return bio.jobAppraisalRevealed;
            case 'jobImpact': return bio.jobImpactRevealed;
            default: return false;
        }
    }

    setConsentedToHelp(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state && !state.biography.consentedToHelp) {
            state.biography.consentedToHelp = true;
        }
    }

    hasConsentedToHelp(cloudId: string): boolean {
        return this.partStates.get(cloudId)?.biography.consentedToHelp ?? false;
    }

    hasJob(cloudId: string): boolean {
        const dialogues = this.partStates.get(cloudId)?.dialogues;
        return !!dialogues?.unburdenedJob;
    }

    getUnrevealedBiographyFields(cloudId: string): ('age' | 'identity' | 'job')[] {
        const state = this.partStates.get(cloudId);
        if (!state) return [];
        const unrevealed: ('age' | 'identity' | 'job')[] = [];
        if (!state.biography.ageRevealed && state.biography.partAge !== null) {
            unrevealed.push('age');
        }
        if (!state.biography.identityRevealed) {
            unrevealed.push('identity');
        }
        if (!state.biography.unburdened && state.dialogues.unburdenedJob) {
            unrevealed.push('job');
        }
        return unrevealed;
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

    clone(): PartStateManager {
        const cloned = new PartStateManager();
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
