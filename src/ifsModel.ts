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
    private markers: Map<string, 1 | 2> = new Map();
    private lastAssignedMarker: 1 | 2 | null = null;
    private history: HistoryEntry[] = [];

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

    assignMarker(cloudId: string): 1 | 2 | null {
        const existingMarker = this.markers.get(cloudId);
        if (existingMarker) {
            this.markers.delete(cloudId);
            this.record({ type: 'clearMarker', cloudId });
            return null;
        }

        let nextMarker: 1 | 2;
        if (this.markers.size === 0) {
            nextMarker = 1;
        } else {
            nextMarker = this.lastAssignedMarker === 1 ? 2 : 1;
        }

        for (const [id, marker] of this.markers) {
            if (marker === nextMarker) {
                this.markers.delete(id);
                break;
            }
        }

        this.markers.set(cloudId, nextMarker);
        this.lastAssignedMarker = nextMarker;
        this.record({ type: 'assignMarker', cloudId, data: { marker: nextMarker } });
        return nextMarker;
    }

    getMarker(cloudId: string): 1 | 2 | null {
        return this.markers.get(cloudId) ?? null;
    }

    clearMarker(cloudId: string): void {
        this.markers.delete(cloudId);
        this.record({ type: 'clearMarker', cloudId });
    }

    clearAllMarkers(): void {
        this.markers.clear();
        this.record({ type: 'clearAllMarkers' });
    }

    getMarkedClouds(): Map<string, 1 | 2> {
        return new Map(this.markers);
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
        this.markers.delete(cloudId);

        this.record({ type: 'stepBack', cloudId, data: { wasTarget, wasBlended } });
    }

    private record(action: StateAction): void {
        this.history.push({ timestamp: Date.now(), action });
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
            case 'assignMarker':
                return `Select ${getName(cloudId!)} (marker ${data?.marker})`;
            case 'clearMarker':
                return `Deselect: ${getName(cloudId!)}`;
            case 'clearAllMarkers':
                return 'Clear all markers';
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
        cloned.markers = new Map(this.markers);
        cloned.lastAssignedMarker = this.lastAssignedMarker;
        return cloned;
    }
}
