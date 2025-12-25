import type { RecordedAction, RecordedSession, SerializedModel, SerializedRelationships } from './types.js';
import type { SeededRNG } from './rng.js';

export class ActionRecorder {
    private actions: RecordedAction[] = [];
    private initialModel: SerializedModel | null = null;
    private initialRelationships: SerializedRelationships | null = null;
    private modelSeed: number = 0;
    private startTimestamp: number = 0;
    private lastActionTime: number = 0;

    start(
        initialModel: SerializedModel,
        initialRelationships: SerializedRelationships,
        modelRng?: SeededRNG
    ): void {
        this.actions = [];
        this.initialModel = initialModel;
        this.initialRelationships = initialRelationships;
        this.modelSeed = modelRng?.getInitialSeed() ?? 0;
        this.startTimestamp = Date.now();
        this.lastActionTime = performance.now();
    }

    record(action: RecordedAction): void {
        const now = performance.now();
        const elapsedTime = (now - this.lastActionTime) / 1000;
        this.lastActionTime = now;
        this.actions.push({ ...action, elapsedTime });
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
