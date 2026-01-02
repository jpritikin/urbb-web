import { WAIT_DURATION, type RecordedAction, type RecordedSession, type SerializedModel, type SerializedRelationships, type OrchestratorSnapshot, type ModelSnapshot } from './types.js';
import type { RNG, SeededRNG, RngLogEntry } from './rng.js';

export class ActionRecorder {
    private actions: RecordedAction[] = [];
    private initialModel: SerializedModel | null = null;
    private initialRelationships: SerializedRelationships | null = null;
    private modelSeed: number = 0;
    private codeVersion: string = '';
    private platform: 'desktop' | 'mobile' = 'desktop';
    private startTimestamp: number = 0;
    private sessionStartTime: number = 0;
    private lastActionTime: number = 0;
    private rng: RNG | null = null;
    private lastRngCount: number = 0;
    private pendingSpontaneousBlendTime: number | null = null;
    private pendingSpontaneousBlendRngCount: number | null = null;
    private pendingSpontaneousBlendLastAttentionCheck: number | null = null;
    private accumulatedEffectiveTime: number = 0;

    start(
        initialModel: SerializedModel,
        initialRelationships: SerializedRelationships,
        codeVersion: string,
        platform: 'desktop' | 'mobile',
        rng?: SeededRNG
    ): void {
        this.actions = [];
        this.initialModel = initialModel;
        this.initialRelationships = initialRelationships;
        this.codeVersion = codeVersion;
        this.platform = platform;
        this.modelSeed = rng?.getInitialSeed() ?? 0;
        this.startTimestamp = Date.now();
        this.sessionStartTime = performance.now();
        this.lastActionTime = performance.now();
        this.rng = rng ?? null;
    }

    markSpontaneousBlendTriggered(rngCount: number, lastAttentionCheck: number): void {
        this.pendingSpontaneousBlendTime = performance.now();
        this.pendingSpontaneousBlendRngCount = rngCount;
        this.pendingSpontaneousBlendLastAttentionCheck = lastAttentionCheck;
    }

    addEffectiveTime(deltaTime: number): void {
        this.accumulatedEffectiveTime += deltaTime;
    }

    recordIntervals(count: number): void {
        if (count <= 0 || !this.initialModel) return;
        let rngCounts: { model: number } | undefined;
        let rngLog: RngLogEntry[] | undefined;
        if (this.rng) {
            const currentCount = this.rng.getCallCount();
            rngCounts = { model: currentCount };
            const fullLog = this.rng.getCallLog();
            rngLog = fullLog.slice(this.lastRngCount);
            this.lastRngCount = currentCount;
        }
        this.actions.push({
            action: 'process_intervals',
            cloudId: '',
            count,
            rngCounts,
            rngLog,
        });
    }

    record(action: RecordedAction, orchState?: OrchestratorSnapshot, modelState?: ModelSnapshot): void {
        const now = performance.now();
        const elapsedTime = (now - this.lastActionTime) / 1000;
        const effectiveTime = this.accumulatedEffectiveTime;
        this.accumulatedEffectiveTime = 0;
        const cumulativeTime = (now - this.sessionStartTime) / 1000;
        this.lastActionTime = now;
        let rngCounts: { model: number } | undefined;
        let rngLog: RngLogEntry[] | undefined;
        if (this.rng) {
            const currentCount = this.rng.getCallCount();
            rngCounts = { model: currentCount };
            const fullLog = this.rng.getCallLog();
            rngLog = fullLog.slice(this.lastRngCount);
            this.lastRngCount = currentCount;
        }

        let preActionTime: number | undefined;
        let triggerRngCount: number | undefined;
        let triggerLastAttentionCheck: number | undefined;
        if (action.action === 'spontaneous_blend' && this.pendingSpontaneousBlendTime !== null) {
            preActionTime = (this.pendingSpontaneousBlendTime - (now - elapsedTime * 1000)) / 1000;
            triggerRngCount = this.pendingSpontaneousBlendRngCount ?? undefined;
            triggerLastAttentionCheck = this.pendingSpontaneousBlendLastAttentionCheck ?? undefined;
            this.pendingSpontaneousBlendTime = null;
            this.pendingSpontaneousBlendRngCount = null;
            this.pendingSpontaneousBlendLastAttentionCheck = null;
        }

        const waitCount = Math.floor(elapsedTime / WAIT_DURATION);

        this.actions.push({ ...action, elapsedTime, effectiveTime, waitCount, cumulativeTime, preActionTime, triggerRngCount, triggerLastAttentionCheck, rngCounts, rngLog, orchState, modelState });
    }

    getSession(
        finalModel?: SerializedModel,
        finalRelationships?: SerializedRelationships
    ): RecordedSession | null {
        if (!this.initialModel || !this.initialRelationships) {
            return null;
        }
        return {
            version: 1,
            codeVersion: this.codeVersion,
            platform: this.platform,
            modelSeed: this.modelSeed,
            timestamp: this.startTimestamp,
            initialModel: this.initialModel,
            initialRelationships: this.initialRelationships,
            actions: [...this.actions],
            finalModel,
            finalRelationships,
        };
    }

    getActions(): RecordedAction[] {
        return [...this.actions];
    }

    clear(): void {
        this.actions = [];
        this.initialModel = null;
        this.initialRelationships = null;
        this.modelSeed = 0;
        this.codeVersion = '';
        this.startTimestamp = 0;
    }

    isRecording(): boolean {
        return this.initialModel !== null;
    }
}

export function sessionToJSON(session: RecordedSession): string {
    return JSON.stringify(session, null, 2);
}

export function sessionFromJSON(json: string): RecordedSession {
    const parsed = JSON.parse(json);
    if (parsed.version !== 1) {
        throw new Error(`Unsupported session version: ${parsed.version}`);
    }
    return parsed as RecordedSession;
}

export async function copySessionToClipboard(session: RecordedSession): Promise<void> {
    const json = sessionToJSON(session);
    await navigator.clipboard.writeText(json);
}

export async function pasteSessionFromClipboard(): Promise<RecordedSession> {
    const json = await navigator.clipboard.readText();
    return sessionFromJSON(json);
}
