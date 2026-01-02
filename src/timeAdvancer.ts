import type { SimulatorModel } from './ifsModel.js';
import type { CloudRelationshipManager } from './cloudRelationshipManager.js';
import type { MessageOrchestrator } from './messageOrchestrator.js';
import type { DualRNG } from './testability/rng.js';

const ATTENTION_CHECK_INTERVAL = 0.5;

export interface SpontaneousBlendEvent {
    cloudId: string;
    urgent: boolean;
}

export interface TimeAdvancerCallbacks {
    getMode: () => 'panorama' | 'foreground';
    onSpontaneousBlend: (event: SpontaneousBlendEvent, lastAttentionCheck: number) => void;
}

export interface TimeAdvancerOptions {
    skipAttentionChecks?: boolean;
}

export class TimeAdvancer {
    private lastAttentionCheck = 0;
    private intervalCount = 0;
    private getModel: () => SimulatorModel;
    private getRelationships: () => CloudRelationshipManager;
    private skipAttentionChecks: boolean;

    constructor(
        getModel: () => SimulatorModel,
        getRelationships: () => CloudRelationshipManager,
        private orchestrator: MessageOrchestrator | null,
        private rng: DualRNG,
        private callbacks: TimeAdvancerCallbacks,
        options?: TimeAdvancerOptions
    ) {
        this.getModel = getModel;
        this.getRelationships = getRelationships;
        this.skipAttentionChecks = options?.skipAttentionChecks ?? false;
    }

    private get model(): SimulatorModel {
        return this.getModel();
    }

    private get relationships(): CloudRelationshipManager {
        return this.getRelationships();
    }

    /**
     * Advance simulation time by deltaTime seconds.
     * This handles all time-based effects: needAttention growth, message timers,
     * grievance messages, generic dialogues, and spontaneous blend checks.
     *
     * When compressed=true (for playback), we step through time in ATTENTION_CHECK_INTERVAL
     * increments to ensure RNG consumption matches real-time playback.
     */
    advance(deltaTime: number, compressed: boolean = false): void {
        if (compressed) {
            this.advanceCompressed(deltaTime);
        } else {
            this.advanceRealtime(deltaTime);
        }
    }

    /**
     * Real-time advancement: accumulates deltaTime and processes in fixed intervals.
     * This ensures RNG consumption matches compressed playback.
     */
    private advanceRealtime(deltaTime: number): void {
        this.lastAttentionCheck += deltaTime;
        this.processAccumulatedTime();
    }

    /**
     * Compressed advancement: adds full duration and processes in fixed intervals.
     */
    private advanceCompressed(deltaTime: number): void {
        this.lastAttentionCheck += deltaTime;
        this.processAccumulatedTime();
    }

    /**
     * Process accumulated time in fixed ATTENTION_CHECK_INTERVAL chunks.
     * Both real-time and compressed modes use this to ensure identical RNG patterns.
     */
    private processAccumulatedTime(): void {
        while (this.lastAttentionCheck >= ATTENTION_CHECK_INTERVAL) {
            this.lastAttentionCheck -= ATTENTION_CHECK_INTERVAL;
            this.intervalCount++;

            const inConference = this.callbacks.getMode() === 'foreground';
            this.model.increaseNeedAttention(this.relationships, ATTENTION_CHECK_INTERVAL, inConference);
            this.orchestrator?.updateTimers(ATTENTION_CHECK_INTERVAL);
            this.orchestrator?.checkAndSendGrievanceMessages();
            this.orchestrator?.checkAndShowGenericDialogues(ATTENTION_CHECK_INTERVAL);

            this.checkAttentionDemands();
        }
    }

    getAndResetIntervalCount(): number {
        const count = this.intervalCount;
        this.intervalCount = 0;
        return count;
    }

    advanceIntervals(count: number): void {
        for (let i = 0; i < count; i++) {
            const inConference = this.callbacks.getMode() === 'foreground';
            this.model.increaseNeedAttention(this.relationships, ATTENTION_CHECK_INTERVAL, inConference);
            this.orchestrator?.updateTimers(ATTENTION_CHECK_INTERVAL);
            this.orchestrator?.checkAndSendGrievanceMessages();
            this.orchestrator?.checkAndShowGenericDialogues(ATTENTION_CHECK_INTERVAL);
            this.checkAttentionDemands();
        }
    }

    private checkAttentionDemands(): void {
        const inPanorama = this.callbacks.getMode() === 'panorama';
        const demand = this.model.checkAttentionDemands(this.relationships, this.rng.model, !inPanorama);

        if (demand) {
            const randomVal = this.rng.model.random('panorama_attention');
            const panoramaTriggered = inPanorama && (demand.needAttention - 1) > randomVal;

            if (demand.urgent || panoramaTriggered) {
                this.callbacks.onSpontaneousBlend({
                    cloudId: demand.cloudId,
                    urgent: demand.urgent
                }, this.lastAttentionCheck);
            }
        }
    }
}
