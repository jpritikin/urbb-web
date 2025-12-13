import { PartState, PartBiography, PartDialogues, createPartState } from './partState.js';

export interface PartStateChange {
    type: string;
    cloudId: string;
    data?: Record<string, unknown>;
}

export class PartStateManager {
    private partStates: Map<string, PartState> = new Map();
    private onChange: ((change: PartStateChange) => void) | null = null;

    setChangeListener(listener: (change: PartStateChange) => void): void {
        this.onChange = listener;
    }

    private notifyChange(change: PartStateChange): void {
        this.onChange?.(change);
    }

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
        this.notifyChange({ type: 'setTrust', cloudId, data: { oldTrust, newTrust: state.trust, reason } });
    }

    adjustTrust(cloudId: string, multiplier: number, reason?: string): void {
        const state = this.partStates.get(cloudId);
        if (!state) return;
        const oldTrust = state.trust;
        state.trust = Math.max(0, Math.min(1, state.trust * multiplier));
        this.notifyChange({ type: 'adjustTrust', cloudId, data: { oldTrust, newTrust: state.trust, multiplier, reason } });
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

    markAsProxy(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state) {
            state.wasProxy = true;
        }
    }

    wasProxy(cloudId: string): boolean {
        return this.partStates.get(cloudId)?.wasProxy ?? false;
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
            this.notifyChange({ type: 'revealIdentity', cloudId });
        }
    }

    isIdentityRevealed(cloudId: string): boolean {
        return this.partStates.get(cloudId)?.biography.identityRevealed ?? false;
    }

    revealAge(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state && !state.biography.ageRevealed) {
            state.biography.ageRevealed = true;
            this.notifyChange({ type: 'revealAge', cloudId });
        }
    }

    revealRelationships(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state && !state.biography.relationshipsRevealed) {
            state.biography.relationshipsRevealed = true;
            this.notifyChange({ type: 'revealRelationships', cloudId });
        }
    }

    revealProtects(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state && !state.biography.protectsRevealed) {
            state.biography.protectsRevealed = true;
            this.notifyChange({ type: 'revealProtects', cloudId });
        }
    }

    revealJob(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state && !state.biography.jobRevealed) {
            state.biography.jobRevealed = true;
            this.notifyChange({ type: 'revealJob', cloudId });
        }
    }

    isJobRevealed(cloudId: string): boolean {
        return this.partStates.get(cloudId)?.biography.jobRevealed ?? false;
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
        if (!state.biography.jobRevealed && state.dialogues.unburdenedJob) {
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
