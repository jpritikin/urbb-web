import { PartState, PartBiography, PartDialogues, createPartState } from '../star/partState.js';
import type { SerializedModel } from '../playback/testability/types.js';

interface ProtectionRelation {
    protectorId: string;
    protectedId: string;
}

interface GrievanceRelation {
    cloudId: string;
    targetIds: Set<string>;
    dialogues: string[];
}

interface ProxyRelation {
    cloudId: string;
    proxyId: string;
}

export class PartStateManager {
    private partStates: Map<string, PartState> = new Map();
    private protections: ProtectionRelation[] = [];
    private grievances: GrievanceRelation[] = [];
    private proxies: ProxyRelation[] = [];
    private attackedBy: Map<string, Set<string>> = new Map();
    private lastUtterance: Map<string, { text: string; timestamp: number }> = new Map();
    private beWithUsed: Set<string> = new Set();

    // Part state methods

    registerPart(id: string, name: string, options?: {
        trust?: number;
        needAttention?: number;
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

    private getMaxTrust(cloudId: string): number {
        return this.isAttacked(cloudId) ? 0.8 : 1;
    }

    private clampTrust(cloudId: string, trust: number): number {
        return Math.max(0, Math.min(this.getMaxTrust(cloudId), trust));
    }

    setTrust(cloudId: string, trust: number): void {
        const state = this.partStates.get(cloudId);
        if (!state) return;
        state.trust = this.clampTrust(cloudId, trust);
    }

    adjustTrust(cloudId: string, multiplier: number): void {
        const state = this.partStates.get(cloudId);
        if (!state) return;
        state.trust = this.clampTrust(cloudId, state.trust * multiplier);
    }

    addTrust(cloudId: string, amount: number): void {
        const state = this.partStates.get(cloudId);
        if (!state) return;
        state.trust = this.clampTrust(cloudId, state.trust + amount);
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

    markAsProxy(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state) {
            state.wasProxy = true;
        }
    }

    wasProxy(cloudId: string): boolean {
        return this.partStates.get(cloudId)?.wasProxy ?? false;
    }

    isTrustAtCeiling(cloudId: string): boolean {
        const state = this.partStates.get(cloudId);
        if (!state) return false;
        return state.trust >= this.getMaxTrust(cloudId);
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

    isAgeRevealed(cloudId: string): boolean {
        return this.partStates.get(cloudId)?.biography.ageRevealed ?? false;
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

    revealJob(cloudId: string): void {
        const state = this.partStates.get(cloudId);
        if (state && !state.biography.jobRevealed) {
            state.biography.jobRevealed = true;
        }
    }

    isJobRevealed(cloudId: string): boolean {
        return this.partStates.get(cloudId)?.biography.jobRevealed ?? false;
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
            case 'job': return bio.jobRevealed;
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

    setUtterance(cloudId: string, text: string, timestamp: number): void {
        this.lastUtterance.set(cloudId, { text, timestamp });
    }

    getUtterance(cloudId: string, currentTime: number): string | null {
        const utterance = this.lastUtterance.get(cloudId);
        if (!utterance) return null;
        if (currentTime - utterance.timestamp > 10) return null;
        return utterance.text;
    }

    clearUtterance(cloudId: string): void {
        this.lastUtterance.delete(cloudId);
    }

    markBeWithUsed(cloudId: string): void {
        this.beWithUsed.add(cloudId);
    }

    isBeWithUsed(cloudId: string): boolean {
        return this.beWithUsed.has(cloudId);
    }

    clearBeWithUsed(cloudId: string): void {
        this.beWithUsed.delete(cloudId);
    }

    // Protection relationship methods

    addProtection(protectorId: string, protectedId: string | string[]): void {
        const protectedIds = Array.isArray(protectedId) ? protectedId : [protectedId];
        for (const id of protectedIds) {
            if (!this.hasProtection(protectorId, id)) {
                this.protections.push({ protectorId, protectedId: id });
            }
        }
    }

    removeProtection(protectorId: string, protectedId: string): void {
        this.protections = this.protections.filter(
            p => !(p.protectorId === protectorId && p.protectedId === protectedId)
        );
    }

    hasProtection(protectorId: string, protectedId: string): boolean {
        return this.protections.some(
            p => p.protectorId === protectorId && p.protectedId === protectedId
        );
    }

    getProtectedBy(cloudId: string): Set<string> {
        return new Set(
            this.protections
                .filter(p => p.protectedId === cloudId)
                .map(p => p.protectorId)
        );
    }

    getProtecting(protectorId: string): Set<string> {
        return new Set(
            this.protections
                .filter(p => p.protectorId === protectorId)
                .map(p => p.protectedId)
        );
    }

    // Grievance relationship methods

    setGrievance(cloudId: string, targetIds: string | string[], dialogues: string | string[]): void {
        const targets = new Set(Array.isArray(targetIds) ? targetIds : [targetIds]);
        const dialogueArray = Array.isArray(dialogues) ? dialogues : [dialogues];
        if (dialogueArray.length === 0) {
            throw new Error(`Grievance from ${cloudId} must have at least one dialogue`);
        }
        this.grievances.push({ cloudId, targetIds: targets, dialogues: dialogueArray });
    }

    hasGrievance(cloudId: string, targetId: string): boolean {
        return this.grievances.some(g => g.cloudId === cloudId && g.targetIds.has(targetId));
    }

    getGrievanceTargets(cloudId: string): Set<string> {
        const targets = new Set<string>();
        for (const g of this.grievances) {
            if (g.cloudId === cloudId) {
                for (const t of g.targetIds) targets.add(t);
            }
        }
        return targets;
    }

    getGrievanceSenders(targetId: string): Set<string> {
        const senders = new Set<string>();
        for (const g of this.grievances) {
            if (g.targetIds.has(targetId)) {
                senders.add(g.cloudId);
            }
        }
        return senders;
    }

    getGrievanceDialogues(cloudId: string, targetId?: string): string[] {
        if (targetId === undefined) {
            const all: string[] = [];
            for (const g of this.grievances) {
                if (g.cloudId === cloudId) all.push(...g.dialogues);
            }
            return all;
        }
        const relation = this.grievances.find(g => g.cloudId === cloudId && g.targetIds.has(targetId));
        return relation?.dialogues ?? [];
    }

    removeGrievance(cloudId: string, targetId?: string): void {
        if (targetId === undefined) {
            this.grievances = this.grievances.filter(g => g.cloudId !== cloudId);
        } else {
            for (const g of this.grievances) {
                if (g.cloudId === cloudId) g.targetIds.delete(targetId);
            }
            this.grievances = this.grievances.filter(g => g.targetIds.size > 0);
        }
    }

    // Proxy relationship methods

    addProxy(cloudId: string, proxyId: string | string[]): void {
        const proxyIds = Array.isArray(proxyId) ? proxyId : [proxyId];
        for (const id of proxyIds) {
            if (!this.hasProxy(cloudId, id)) {
                this.proxies.push({ cloudId, proxyId: id });
            }
        }
    }

    removeProxy(cloudId: string, proxyId: string): void {
        this.proxies = this.proxies.filter(
            r => !(r.cloudId === cloudId && r.proxyId === proxyId)
        );
    }

    clearProxies(cloudId: string): void {
        this.proxies = this.proxies.filter(r => r.cloudId !== cloudId);
    }

    hasProxy(cloudId: string, proxyId: string): boolean {
        return this.proxies.some(
            r => r.cloudId === cloudId && r.proxyId === proxyId
        );
    }

    getProxies(cloudId: string): Set<string> {
        return new Set(
            this.proxies
                .filter(r => r.cloudId === cloudId)
                .map(r => r.proxyId)
        );
    }

    getProxyFor(proxyId: string): Set<string> {
        return new Set(
            this.proxies
                .filter(r => r.proxyId === proxyId)
                .map(r => r.cloudId)
        );
    }

    // Attack tracking methods

    setAttackedBy(victimId: string, attackerId: string): void {
        let attackers = this.attackedBy.get(victimId);
        if (!attackers) {
            attackers = new Set();
            this.attackedBy.set(victimId, attackers);
        }
        attackers.add(attackerId);
    }

    clearAttackedBy(victimId: string): void {
        this.attackedBy.delete(victimId);
    }

    isAttacked(victimId: string): boolean {
        const attackers = this.attackedBy.get(victimId);
        return attackers !== undefined && attackers.size > 0;
    }

    getAttackers(victimId: string): Set<string> {
        return this.attackedBy.get(victimId) ?? new Set();
    }

    // Combined methods

    assessNeedAttention(cloudId: string): number {
        const isProtecting = this.getProtecting(cloudId).size > 0;
        const hasGrievances = this.getGrievanceTargets(cloudId).size > 0;
        const isProxy = this.getProxyFor(cloudId).size > 0;

        if (isProtecting || hasGrievances) {
            return 0.5;
        }
        if (isProxy) {
            return 0.1;
        }
        return 0.3;
    }

    removeCloud(cloudId: string): void {
        this.partStates.delete(cloudId);
        this.protections = this.protections.filter(
            p => p.protectorId !== cloudId && p.protectedId !== cloudId
        );
        this.grievances = this.grievances.filter(g => g.cloudId !== cloudId);
        for (const g of this.grievances) {
            g.targetIds.delete(cloudId);
        }
        this.grievances = this.grievances.filter(g => g.targetIds.size > 0);
        this.proxies = this.proxies.filter(
            r => r.cloudId !== cloudId && r.proxyId !== cloudId
        );
        this.attackedBy.delete(cloudId);
        for (const [victimId, attackerIds] of this.attackedBy) {
            attackerIds.delete(cloudId);
            if (attackerIds.size === 0) this.attackedBy.delete(victimId);
        }
    }

    // Serialization

    toJSON(): Pick<SerializedModel, 'partStates' | 'protections' | 'grievances' | 'proxies' | 'attackedBy'> {
        const partStates: Record<string, PartState> = {};
        for (const [id, state] of this.partStates) {
            partStates[id] = {
                ...state,
                biography: { ...state.biography },
                dialogues: { ...state.dialogues },
            };
        }
        return {
            partStates,
            protections: [...this.protections],
            grievances: this.grievances.map(g => ({
                cloudId: g.cloudId,
                targetIds: Array.from(g.targetIds),
                dialogues: [...g.dialogues],
            })),
            proxies: [...this.proxies],
            attackedBy: Array.from(this.attackedBy.entries()).map(
                ([victimId, attackerIds]) => ({ victimId, attackerIds: Array.from(attackerIds) })
            ),
        };
    }

    static fromJSON(json: Pick<SerializedModel, 'partStates' | 'protections' | 'grievances' | 'proxies' | 'attackedBy'>): PartStateManager {
        const manager = new PartStateManager();
        for (const [id, state] of Object.entries(json.partStates)) {
            manager.partStates.set(id, {
                ...state,
                biography: { ...state.biography },
                dialogues: { ...state.dialogues },
            });
        }
        for (const p of json.protections) {
            manager.addProtection(p.protectorId, p.protectedId);
        }
        for (const g of json.grievances) {
            manager.setGrievance(g.cloudId, g.targetIds, g.dialogues);
        }
        for (const p of json.proxies) {
            manager.addProxy(p.cloudId, p.proxyId);
        }
        for (const a of json.attackedBy) {
            for (const attackerId of a.attackerIds) {
                manager.setAttackedBy(a.victimId, attackerId);
            }
        }
        return manager;
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
        cloned.protections = this.protections.map(p => ({ ...p }));
        cloned.grievances = this.grievances.map(g => ({
            cloudId: g.cloudId,
            targetIds: new Set(g.targetIds),
            dialogues: [...g.dialogues],
        }));
        cloned.proxies = this.proxies.map(p => ({ ...p }));
        for (const [victimId, attackerIds] of this.attackedBy) {
            cloned.attackedBy.set(victimId, new Set(attackerIds));
        }
        for (const [cloudId, utterance] of this.lastUtterance) {
            cloned.lastUtterance.set(cloudId, { ...utterance });
        }
        cloned.beWithUsed = new Set(this.beWithUsed);
        return cloned;
    }
}

export { PartState, PartBiography, PartDialogues } from '../star/partState.js';
