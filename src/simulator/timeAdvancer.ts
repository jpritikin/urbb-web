import type { SimulatorModel } from './ifsModel.js';
import type { MessageOrchestrator } from './messageOrchestrator.js';
import type { RNG } from '../playback/testability/rng.js';

const ATTENTION_CHECK_INTERVAL = 0.5;

export interface SpontaneousBlendEvent {
    cloudId: string;
    urgent: boolean;
}

export interface TimeAdvancerCallbacks {
    getMode: () => 'panorama' | 'foreground';
    onSpontaneousBlend: (event: SpontaneousBlendEvent, accumulatedTime: number) => void;
}

export interface AttentionDemandEntry {
    cloudId: string;
    needAttention: number;
    maxConference: number;
    excess: number;
    urgent: boolean;
    randomVal: number;
    triggered: boolean;
}

export interface TimeAdvancerOptions {
    skipAttentionChecks?: boolean;
}

export class TimeAdvancer {
    private accumulatedTime = 0;
    private intervalCount = 0;
    private cumulativeTime = 0;
    private getModel: () => SimulatorModel;
    private skipAttentionChecks: boolean;
    private attentionDemandLog: AttentionDemandEntry[] = [];

    constructor(
        getModel: () => SimulatorModel,
        private orchestrator: MessageOrchestrator | null,
        private rng: RNG,
        private callbacks: TimeAdvancerCallbacks,
        options?: TimeAdvancerOptions
    ) {
        this.getModel = getModel;
        this.skipAttentionChecks = options?.skipAttentionChecks ?? false;
    }

    setRNG(rng: RNG): void {
        this.rng = rng;
    }

    private get model(): SimulatorModel {
        return this.getModel();
    }

    advance(deltaTime: number): void {
        this.accumulatedTime += deltaTime;
        this.cumulativeTime += deltaTime;
        while (this.accumulatedTime >= ATTENTION_CHECK_INTERVAL) {
            this.accumulatedTime -= ATTENTION_CHECK_INTERVAL;
            this.intervalCount++;
            this.processOneInterval();
            if (!this.skipAttentionChecks) {
                this.checkAttentionDemands();
            }
        }
    }

    getTime(): number {
        return this.cumulativeTime;
    }

    advanceIntervals(count: number): void {
        for (let i = 0; i < count; i++) {
            this.processOneInterval();
            if (!this.skipAttentionChecks) {
                this.checkAttentionDemands();
            }
        }
    }

    getAndResetIntervalCount(): number {
        const count = this.intervalCount;
        this.intervalCount = 0;
        return count;
    }

    getAndResetAttentionDemandLog(): AttentionDemandEntry[] {
        const log = this.attentionDemandLog;
        this.attentionDemandLog = [];
        return log;
    }

    private processOneInterval(): void {
        const inConference = this.callbacks.getMode() === 'foreground';
        this.model.increaseNeedAttention(ATTENTION_CHECK_INTERVAL, inConference);
        this.model.parts.decayFlipOdds(ATTENTION_CHECK_INTERVAL, this.model.getConferenceCloudIds());
        this.model.decayTherapistStanceDeltas(ATTENTION_CHECK_INTERVAL);
        this.orchestrator?.updateTimers(ATTENTION_CHECK_INTERVAL);
        this.orchestrator?.checkAndSendBlendedUtterances(ATTENTION_CHECK_INTERVAL);
        this.orchestrator?.checkAndShowGenericDialogues(ATTENTION_CHECK_INTERVAL);
        this.orchestrator?.checkAndShowSelfLoathing(ATTENTION_CHECK_INTERVAL);
        this.orchestrator?.checkAndShowConversationDialogues(ATTENTION_CHECK_INTERVAL);
    }

    private checkAttentionDemands(): void {
        const inConference = this.callbacks.getMode() === 'foreground';
        const demand = this.model.checkAttentionDemands(this.rng, inConference);

        if (demand) {
            const maxConference = this.model.getMaxConferenceNeedAttention(demand.cloudId);
            const randomVal = this.rng.random('panorama_attention');
            const triggered = demand.urgent || (demand.needAttention - 1) > randomVal;

            this.attentionDemandLog.push({
                cloudId: demand.cloudId,
                needAttention: demand.needAttention,
                maxConference,
                excess: demand.needAttention - maxConference,
                urgent: demand.urgent,
                randomVal,
                triggered,
            });

            if (triggered) {
                this.callbacks.onSpontaneousBlend({
                    cloudId: demand.cloudId,
                    urgent: demand.urgent
                }, this.accumulatedTime);
            }
        }
    }
}
