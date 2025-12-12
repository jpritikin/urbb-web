interface ProtectionRelation {
    protectorId: string;
    protectedId: string;
}

interface GrievanceRelation {
    cloudId: string;
    targetId: string;
    grievance: number;
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
        this.grievances = this.grievances.filter(
            g => g.cloudId !== cloudId && g.targetId !== cloudId
        );
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
        const grievances = this.getGrievances(cloudId);
        const hasActiveGrievances = Array.from(grievances.values()).some(g => g > 0);
        const isProxy = this.getProxyFor(cloudId).size > 0;

        if (isProtecting || hasActiveGrievances) {
            return 0.5;
        }
        if (isProxy) {
            return 0.1;
        }
        return 0.3;
    }
}
