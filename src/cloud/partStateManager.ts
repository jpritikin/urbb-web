import { PartState, PartBiography, PartDialogues, createPartState } from '../star/partState.js';
import type { SerializedModel } from '../playback/testability/types.js';

interface ProtectionRelation {
    protectorId: string;
    protectedId: string;
}

interface ProxyRelation {
    cloudId: string;
    proxyId: string;
}

export const PHASE_INDEX = { speak: 0, mirror: 1, validate: 2, empathize: 3 } as const;

export interface ConversationDialogues {
    hostile?: string[][];
    guarded?: string[][];
    opening?: string[][];
    collaborative?: string[][];
}

export type TrustBand = 'hostile' | 'guarded' | 'opening' | 'collaborative';
export type IfioPhase = 'speak' | 'listen' | 'mirror' | 'validate' | 'empathize';

export interface InterPartRelation {
    fromId: string;
    toId: string;
    trust: number;
    trustFloor: number;
    stance: number;
    stanceFlipOdds: number;
    stanceFlipOddsSetPoint: number;
    dialogues?: ConversationDialogues;
    rumination?: string[];
    impactRecognition?: string[];
    impactRejection?: string[];
}

export class PartStateManager {
    private partStates: Map<string, PartState> = new Map();
    private protections: ProtectionRelation[] = [];
    private interPartRelations: Map<string, Map<string, InterPartRelation>> = new Map();
    private proxies: ProxyRelation[] = [];
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
        return openness;
    }

    private clampTrust(trust: number): number {
        return Math.max(0, Math.min(1, trust));
    }

    private static readonly CONSENT_REVOCATION_THRESHOLD = 0.25;

    private revokeConsentIfNeeded(cloudId: string, state: PartState): void {
        if (state.biography.consentedToHelp &&
            state.trust < PartStateManager.CONSENT_REVOCATION_THRESHOLD &&
            this.getProtecting(cloudId).size > 0) {
            state.biography.consentedToHelp = false;
        }
    }

    setTrust(cloudId: string, trust: number): void {
        const state = this.partStates.get(cloudId);
        if (!state) return;
        state.trust = this.clampTrust(trust);
        this.revokeConsentIfNeeded(cloudId, state);
    }

    adjustTrust(cloudId: string, multiplier: number): void {
        const state = this.partStates.get(cloudId);
        if (!state) return;
        state.trust = this.clampTrust(state.trust * multiplier);
        this.revokeConsentIfNeeded(cloudId, state);
    }

    addTrust(cloudId: string, amount: number): void {
        const state = this.partStates.get(cloudId);
        if (!state) return;
        state.trust = this.clampTrust(state.trust + amount);
        this.revokeConsentIfNeeded(cloudId, state);
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

    isFormerProtector(cloudId: string): boolean {
        return this.wasProtector(cloudId) && !this.getProtecting(cloudId).size;
    }

    wasProtector(cloudId: string): boolean {
        return this.partStates.get(cloudId)?.wasProtector ?? false;
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

    isFieldRevealed(cloudId: string, field: string): boolean {
        const bio = this.partStates.get(cloudId)?.biography;
        if (!bio) return false;
        switch (field) {
            case 'age': return bio.ageRevealed;
            case 'identity': return bio.identityRevealed;
            case 'job': return bio.jobRevealed;
            case 'jobAppraisal': return bio.jobAppraisalRevealed;
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
        if (this.getProtecting(cloudId).size > 0 && state.dialogues.unburdenedJob) {
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
        const state = this.partStates.get(protectorId);
        if (state) state.wasProtector = true;
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

    // Inter-part relation methods

    setInterPartRelation(fromId: string, toId: string, opts: {
        trust: number;
        stance: number;
        stanceFlipOdds: number;
        dialogues?: ConversationDialogues;
        rumination?: string[];
        impactRecognition?: string[];
        impactRejection?: string[];
    }): void {
        let fromMap = this.interPartRelations.get(fromId);
        if (!fromMap) {
            fromMap = new Map();
            this.interPartRelations.set(fromId, fromMap);
        }
        fromMap.set(toId, {
            fromId,
            toId,
            trust: opts.trust,
            trustFloor: 0,
            stance: opts.stance,
            stanceFlipOdds: opts.stanceFlipOdds,
            stanceFlipOddsSetPoint: opts.stanceFlipOdds,
            dialogues: opts.dialogues,
            rumination: opts.rumination,
            impactRecognition: opts.impactRecognition,
            impactRejection: opts.impactRejection,
        });
    }

    getInterPartRelation(fromId: string, toId: string): InterPartRelation | null {
        return this.interPartRelations.get(fromId)?.get(toId) ?? null;
    }

    getInterPartTrust(fromId: string, toId: string): number {
        return this.interPartRelations.get(fromId)?.get(toId)?.trust ?? 0.5;
    }

    hasInterPartRelation(fromId: string, toId: string): boolean {
        return this.interPartRelations.get(fromId)?.has(toId) ?? false;
    }

    hasHostileRelation(fromId: string, toId: string): boolean {
        const rel = this.interPartRelations.get(fromId)?.get(toId);
        return rel !== undefined && rel.trust < 0.3;
    }

    getHostileRelationTargets(cloudId: string): Set<string> {
        const targets = new Set<string>();
        const fromMap = this.interPartRelations.get(cloudId);
        if (fromMap) {
            for (const [toId, rel] of fromMap) {
                if (rel.trust < 0.3) targets.add(toId);
            }
        }
        return targets;
    }

    getHostileRelationSenders(targetId: string): Set<string> {
        const senders = new Set<string>();
        for (const [fromId, fromMap] of this.interPartRelations) {
            const rel = fromMap.get(targetId);
            if (rel && rel.trust < 0.3) senders.add(fromId);
        }
        return senders;
    }

    getInterPartRelationTargets(cloudId: string): Set<string> {
        const fromMap = this.interPartRelations.get(cloudId);
        return fromMap ? new Set(fromMap.keys()) : new Set();
    }

    getWorstNonSelfInterPartRelation(): { fromId: string; toId: string; trust: number } | null {
        let worst: { fromId: string; toId: string; trust: number } | null = null;
        for (const fromMap of this.interPartRelations.values()) {
            for (const rel of fromMap.values()) {
                if (rel.fromId === rel.toId) continue;
                if (rel.trust >= 1) continue;
                if (worst === null || rel.trust < worst.trust) {
                    worst = { fromId: rel.fromId, toId: rel.toId, trust: rel.trust };
                }
            }
        }
        return worst;
    }

    getMinInterPartTrust(cloudId: string): number {
        const fromMap = this.interPartRelations.get(cloudId);
        if (!fromMap || fromMap.size === 0) return 1;
        let min = 1;
        for (const rel of fromMap.values()) {
            if (rel.trust < min) min = rel.trust;
        }
        return min;
    }

    getPhaseStance(fromId: string, toId: string, rng: () => number): number {
        const rel = this.interPartRelations.get(fromId)?.get(toId);
        if (!rel) return 0;
        const flip = rng() < rel.stanceFlipOdds;
        return flip ? -rel.stance : rel.stance;
    }

    getRelation(fromId: string, toId: string): InterPartRelation | undefined {
        return this.interPartRelations.get(fromId)?.get(toId);
    }

    getRelationSummaries(): { fromId: string; toId: string; stance: number; trust: number }[] {
        const result: { fromId: string; toId: string; stance: number; trust: number }[] = [];
        for (const fromMap of this.interPartRelations.values()) {
            for (const rel of fromMap.values()) {
                result.push({ fromId: rel.fromId, toId: rel.toId, stance: rel.stance, trust: rel.trust });
            }
        }
        return result;
    }

    getRelationStance(fromId: string, toId: string): number {
        return this.interPartRelations.get(fromId)?.get(toId)?.stance ?? 0;
    }

    applyStanceFlip(fromId: string, toId: string, rng: () => number): void {
        const rel = this.interPartRelations.get(fromId)?.get(toId);
        if (!rel) return;
        if (rng() < rel.stanceFlipOdds) {
            rel.stance = -rel.stance;
        }
    }

    addInterPartTrust(fromId: string, toId: string, delta: number, rng: () => number): void {
        const rel = this.interPartRelations.get(fromId)?.get(toId);
        if (rel) {
            if (rel.trustFloor > 0 && delta < 0) delta *= 0.5;
            const newTrust = rel.trust + delta;
            if (newTrust < rel.trustFloor) {
                const overflow = rel.trustFloor - newTrust;
                const flipShare = rng();
                rel.stanceFlipOdds += (1 - rel.stanceFlipOdds) * overflow * flipShare * 0.5;
                const extremeDir = Math.sign(rel.stance) || 1;
                rel.stance = Math.max(-1, Math.min(1, rel.stance + extremeDir * overflow * (1 - flipShare) * 0.4));
            }
            rel.trust = Math.max(rel.trustFloor, Math.min(1, newTrust));
        }
    }

    setInterPartTrustFloor(fromId: string, toId: string, floor: number): void {
        const rel = this.interPartRelations.get(fromId)?.get(toId);
        if (rel) {
            rel.trustFloor = floor;
            if (rel.trust < floor) rel.trust = floor;
        }
    }

    nudgeStance(fromId: string, toId: string, toward: number, amount: number): void {
        const rel = this.interPartRelations.get(fromId)?.get(toId);
        if (!rel) return;
        const diff = toward - rel.stance;
        if (Math.abs(diff) < 0.001) return;
        rel.stance += Math.sign(diff) * Math.min(amount, Math.abs(diff));
    }

    decayFlipOdds(deltaTime: number, conferenceParticipantIds: Set<string>): void {
        const rate = 0.05;
        for (const fromMap of this.interPartRelations.values()) {
            for (const rel of fromMap.values()) {
                if (conferenceParticipantIds.has(rel.fromId) && conferenceParticipantIds.has(rel.toId)) continue;
                const diff = rel.stanceFlipOddsSetPoint - rel.stanceFlipOdds;
                if (Math.abs(diff) < 0.001) continue;
                rel.stanceFlipOdds += diff * (1 - Math.exp(-rate * deltaTime));
            }
        }
    }

    static getTrustBand(trust: number): TrustBand {
        if (trust < 0.3) return 'hostile';
        if (trust < 0.5) return 'guarded';
        if (trust < 0.7) return 'opening';
        return 'collaborative';
    }

    hasInterPartDialogue(fromId: string, toId: string): boolean {
        return !!this.interPartRelations.get(fromId)?.get(toId)?.dialogues;
    }

    private static FALLBACK_CONVERSATIONS: string[][] = [
        ["No!", "That's ridiculous!", "Fine!", "Whatever."],
        ["...", "Something was said.", "Maybe.", "I guess."],
    ];

    getInterPartDialogue(fromId: string, toId: string, phase: IfioPhase, rng: () => number): string | null {
        if (phase === 'listen') return null;
        const rel = this.interPartRelations.get(fromId)?.get(toId);
        const conversations = rel?.dialogues?.[PartStateManager.getTrustBand(rel.trust)];
        const pool = conversations ?? PartStateManager.FALLBACK_CONVERSATIONS;
        if (pool.length === 0) return null;
        const conv = pool[Math.floor(rng() * pool.length)];
        return conv[PHASE_INDEX[phase]] ?? null;
    }

    getRumination(cloudId: string, rng: () => number): string | null {
        const arr = this.interPartRelations.get(cloudId)?.get(cloudId)?.rumination;
        if (!arr || arr.length === 0) return null;
        return arr[Math.floor(rng() * arr.length)];
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

    // Combined methods

    assessNeedAttention(cloudId: string): number {
        const isProtecting = this.getProtecting(cloudId).size > 0;
        const hasHostileRelations = this.getHostileRelationTargets(cloudId).size > 0;
        const isProxy = this.getProxyFor(cloudId).size > 0;

        if (isProtecting || hasHostileRelations) {
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
        this.interPartRelations.delete(cloudId);
        for (const fromMap of this.interPartRelations.values()) {
            fromMap.delete(cloudId);
        }
        this.proxies = this.proxies.filter(
            r => r.cloudId !== cloudId && r.proxyId !== cloudId
        );
    }

    // Serialization

    toJSON(): Pick<SerializedModel, 'partStates' | 'protections' | 'interPartRelations' | 'proxies'> {
        const partStates: Record<string, PartState> = {};
        for (const [id, state] of this.partStates) {
            partStates[id] = {
                ...state,
                biography: { ...state.biography },
                dialogues: { ...state.dialogues },
            };
        }
        const relations: SerializedModel['interPartRelations'] = [];
        for (const fromMap of this.interPartRelations.values()) {
            for (const rel of fromMap.values()) {
                relations.push({
                    fromId: rel.fromId,
                    toId: rel.toId,
                    trust: rel.trust,
                    trustFloor: rel.trustFloor,
                    stance: rel.stance,
                    stanceFlipOdds: rel.stanceFlipOdds,
                    stanceFlipOddsSetPoint: rel.stanceFlipOddsSetPoint,
                    dialogues: rel.dialogues,
                    rumination: rel.rumination,
                    impactRecognition: rel.impactRecognition,
                    impactRejection: rel.impactRejection,
                });
            }
        }
        return {
            partStates,
            protections: [...this.protections],
            interPartRelations: relations,
            proxies: [...this.proxies],
        };
    }

    static fromJSON(json: Pick<SerializedModel, 'partStates' | 'protections' | 'interPartRelations' | 'proxies'>): PartStateManager {
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
        for (const r of json.interPartRelations) {
            let fromMap = manager.interPartRelations.get(r.fromId);
            if (!fromMap) {
                fromMap = new Map();
                manager.interPartRelations.set(r.fromId, fromMap);
            }
            fromMap.set(r.toId, {
                fromId: r.fromId,
                toId: r.toId,
                trust: r.trust,
                trustFloor: r.trustFloor ?? 0,
                stance: r.stance,
                stanceFlipOdds: r.stanceFlipOdds,
                stanceFlipOddsSetPoint: r.stanceFlipOddsSetPoint ?? r.stanceFlipOdds,
                dialogues: r.dialogues,
                rumination: r.rumination,
                impactRecognition: r.impactRecognition,
                impactRejection: r.impactRejection,
            });
        }
        for (const p of json.proxies) {
            manager.addProxy(p.cloudId, p.proxyId);
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
        for (const [fromId, fromMap] of this.interPartRelations) {
            const clonedFromMap = new Map<string, InterPartRelation>();
            for (const [toId, rel] of fromMap) {
                clonedFromMap.set(toId, {
                    ...rel,
                    dialogues: rel.dialogues ? { ...rel.dialogues } : undefined,
                });
            }
            cloned.interPartRelations.set(fromId, clonedFromMap);
        }
        cloned.proxies = this.proxies.map(p => ({ ...p }));
        cloned.beWithUsed = new Set(this.beWithUsed);
        return cloned;
    }
}

export { PartState, PartBiography, PartDialogues } from '../star/partState.js';
