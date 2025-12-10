interface ProtectionRelation {
    protectorId: string;
    protectedId: string;
}

interface GrievanceRelation {
    cloudId: string;
    targetId: string;
    grievance: number;
}

interface SelfReferenceRelation {
    cloudId: string;
    targetId: string;
}

export class CloudRelationshipManager {
    private protections: ProtectionRelation[] = [];
    private grievances: GrievanceRelation[] = [];
    private selfRefs: SelfReferenceRelation[] = [];

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

    setGrievance(cloudId: string, targetId: string, grievance: number): void {
        const existing = this.grievances.findIndex(
            g => g.cloudId === cloudId && g.targetId === targetId
        );
        if (existing !== -1) {
            this.grievances[existing].grievance = grievance;
        } else {
            this.grievances.push({ cloudId, targetId, grievance });
        }
    }

    getGrievance(cloudId: string, targetId: string): number {
        const relation = this.grievances.find(
            g => g.cloudId === cloudId && g.targetId === targetId
        );
        return relation?.grievance ?? 0;
    }

    getGrievances(cloudId: string): Map<string, number> {
        const map = new Map<string, number>();
        this.grievances
            .filter(g => g.cloudId === cloudId)
            .forEach(g => map.set(g.targetId, g.grievance));
        return map;
    }

    removeGrievance(cloudId: string, targetId: string): void {
        this.grievances = this.grievances.filter(
            g => !(g.cloudId === cloudId && g.targetId === targetId)
        );
    }

    addSelfReference(cloudId: string, targetId: string | string[]): void {
        const targetIds = Array.isArray(targetId) ? targetId : [targetId];
        for (const id of targetIds) {
            if (!this.hasSelfReference(cloudId, id)) {
                this.selfRefs.push({ cloudId, targetId: id });
            }
        }
    }

    removeSelfReference(cloudId: string, targetId: string): void {
        this.selfRefs = this.selfRefs.filter(
            r => !(r.cloudId === cloudId && r.targetId === targetId)
        );
    }

    getSelfReferences(cloudId: string): Set<string> {
        return new Set(
            this.selfRefs
                .filter(r => r.cloudId === cloudId)
                .map(r => r.targetId)
        );
    }

    getReferencedBy(targetId: string): Set<string> {
        return new Set(
            this.selfRefs
                .filter(r => r.targetId === targetId)
                .map(r => r.cloudId)
        );
    }

    removeCloud(cloudId: string): void {
        this.protections = this.protections.filter(
            p => p.protectorId !== cloudId && p.protectedId !== cloudId
        );
        this.grievances = this.grievances.filter(
            g => g.cloudId !== cloudId && g.targetId !== cloudId
        );
        this.selfRefs = this.selfRefs.filter(
            r => r.cloudId !== cloudId && r.targetId !== cloudId
        );
    }

    hasProtection(protectorId: string, protectedId: string): boolean {
        return this.protections.some(
            p => p.protectorId === protectorId && p.protectedId === protectedId
        );
    }

    hasSelfReference(cloudId: string, targetId: string): boolean {
        return this.selfRefs.some(
            r => r.cloudId === cloudId && r.targetId === targetId
        );
    }
}
