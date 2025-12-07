export class CloudRelationshipManager {
    private protections = new Map<string, Set<string>>();
    private grievances = new Map<string, Map<string, number>>();
    private selfRefs = new Map<string, Set<string>>();

    addProtection(protectorId: string, protectedId: string | string[]): void {
        const protectedIds = Array.isArray(protectedId) ? protectedId : [protectedId];
        for (const id of protectedIds) {
            if (!this.protections.has(protectorId)) {
                this.protections.set(protectorId, new Set());
            }
            this.protections.get(protectorId)!.add(id);
        }
    }

    removeProtection(protectorId: string, protectedId: string): void {
        this.protections.get(protectorId)?.delete(protectedId);
    }

    getProtectedBy(cloudId: string): Set<string> {
        const protectors = new Set<string>();
        for (const [protectorId, protectedSet] of this.protections) {
            if (protectedSet.has(cloudId)) {
                protectors.add(protectorId);
            }
        }
        return protectors;
    }

    getProtecting(protectorId: string): Set<string> {
        return new Set(this.protections.get(protectorId) || []);
    }

    setGrievance(cloudId: string, targetId: string, grievance: number): void {
        if (!this.grievances.has(cloudId)) {
            this.grievances.set(cloudId, new Map());
        }
        this.grievances.get(cloudId)!.set(targetId, grievance);
    }

    getGrievance(cloudId: string, targetId: string): number {
        return this.grievances.get(cloudId)?.get(targetId) ?? 0;
    }

    getGrievances(cloudId: string): Map<string, number> {
        return new Map(this.grievances.get(cloudId) || []);
    }

    removeGrievance(cloudId: string, targetId: string): void {
        this.grievances.get(cloudId)?.delete(targetId);
    }

    addSelfReference(cloudId: string, targetId: string | string[]): void {
        const targetIds = Array.isArray(targetId) ? targetId : [targetId];
        for (const id of targetIds) {
            if (!this.selfRefs.has(cloudId)) {
                this.selfRefs.set(cloudId, new Set());
            }
            this.selfRefs.get(cloudId)!.add(id);
        }
    }

    removeSelfReference(cloudId: string, targetId: string): void {
        this.selfRefs.get(cloudId)?.delete(targetId);
    }

    getSelfReferences(cloudId: string): Set<string> {
        return new Set(this.selfRefs.get(cloudId) || []);
    }

    getReferencedBy(targetId: string): Set<string> {
        const referrers = new Set<string>();
        for (const [cloudId, targetSet] of this.selfRefs) {
            if (targetSet.has(targetId)) {
                referrers.add(cloudId);
            }
        }
        return referrers;
    }

    removeCloud(cloudId: string): void {
        this.protections.delete(cloudId);
        for (const protectedSet of this.protections.values()) {
            protectedSet.delete(cloudId);
        }

        this.grievances.delete(cloudId);
        for (const grievanceMap of this.grievances.values()) {
            grievanceMap.delete(cloudId);
        }

        this.selfRefs.delete(cloudId);
        for (const targetSet of this.selfRefs.values()) {
            targetSet.delete(cloudId);
        }
    }

    hasProtection(protectorId: string, protectedId: string): boolean {
        return this.protections.get(protectorId)?.has(protectedId) ?? false;
    }

    hasSelfReference(cloudId: string, targetId: string): boolean {
        return this.selfRefs.get(cloudId)?.has(targetId) ?? false;
    }
}
