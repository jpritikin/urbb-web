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

export class CloudRelationshipManager {
    private protections: ProtectionRelation[] = [];
    private grievances: GrievanceRelation[] = [];
    private proxies: ProxyRelation[] = [];

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

    removeCloud(cloudId: string): void {
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
    }

    hasProtection(protectorId: string, protectedId: string): boolean {
        return this.protections.some(
            p => p.protectorId === protectorId && p.protectedId === protectedId
        );
    }

    hasProxy(cloudId: string, proxyId: string): boolean {
        return this.proxies.some(
            r => r.cloudId === cloudId && r.proxyId === proxyId
        );
    }

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
}
