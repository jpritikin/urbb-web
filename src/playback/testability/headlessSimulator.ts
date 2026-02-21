import { SimulatorModel, PartMessage } from '../../simulator/ifsModel.js';
import { PartStateManager } from '../../cloud/partStateManager.js';
import { SeededRNG, RNG, createModelRNG, RngLogEntry } from './rng.js';
import { SimulatorController } from '../../simulator/simulatorController.js';
import { ActionEffectApplicator } from '../../simulator/actionEffectApplicator.js';
import { MessageOrchestrator, MessageOrchestratorView } from '../../simulator/messageOrchestrator.js';
import { TimeAdvancer } from '../../simulator/timeAdvancer.js';
import type {
    PartConfig, RelationshipConfig, Scenario, ActionResult,
    SerializedModel, OrchestratorSnapshot, ModelSnapshot
} from './types.js';
import type { BiographyField } from '../../star/selfRay.js';

export interface TestableSimulator {
    executeAction(action: string, cloudId: string, targetCloudId?: string, field?: string, newMode?: 'panorama' | 'foreground', stanceDelta?: number): ActionResult;
    advanceIntervals(count: number, orchState?: OrchestratorSnapshot): void;
    getModelStateSnapshot(): ModelSnapshot;
    getMode(): 'panorama' | 'foreground';
    setMode(mode: 'panorama' | 'foreground'): void;
}

export interface SimulatorDiagnostics {
    getRngCount(): number;
    getModelRngLog(): RngLogEntry[];
    getOrchestratorDebugState(): OrchestratorSnapshot;
}

class HeadlessView implements MessageOrchestratorView {
    private model: SimulatorModel | null = null;
    private onMessageReceived: ((message: PartMessage) => void) | null = null;

    setModel(model: SimulatorModel): void {
        this.model = model;
    }

    setOnMessageReceived(callback: (message: PartMessage) => void): void {
        this.onMessageReceived = callback;
    }

    getCloudState(cloudId: string): unknown | null {
        if (!this.model) return null;
        // Return a truthy object if the part is in the conference (targeted or blended)
        const isTarget = this.model.getTargetCloudIds().has(cloudId);
        const isBlended = this.model.getBlendedParts().includes(cloudId);
        return (isTarget || isBlended) ? {} : null;
    }
    startMessage(_message: PartMessage, _senderId: string, _targetId: string): void {
        // Message delivery is now handled by model.advanceMessages() called from orchestrator.updateTimers()
    }
}

export class HeadlessSimulator implements TestableSimulator, SimulatorDiagnostics {
    private model: SimulatorModel;
    private rng: RNG;
    private controller: SimulatorController;
    private effectApplicator: ActionEffectApplicator;
    private orchestrator: MessageOrchestrator;
    private headlessView: HeadlessView;
    private timeAdvancer: TimeAdvancer;

    constructor(config?: { seed?: number }) {
        this.model = new SimulatorModel();
        this.rng = createModelRNG(config?.seed);
        this.controller = this.createController();
        this.effectApplicator = new ActionEffectApplicator(() => this.model);
        this.headlessView = new HeadlessView();
        this.headlessView.setModel(this.model);
        this.orchestrator = this.createOrchestrator();
        this.timeAdvancer = this.createTimeAdvancer();
    }

    private createController(): SimulatorController {
        return new SimulatorController({
            getModel: () => this.model,
            getRelationships: () => this.model.parts,
            rng: this.rng,
            getPartName: (id) => this.model.parts.getPartName(id),
        });
    }

    private createOrchestrator(): MessageOrchestrator {
        const orchestrator = new MessageOrchestrator(
            () => this.model,
            this.headlessView,
            () => this.model.parts,
            this.rng,
            {
                act: (_label, fn) => fn(),
                showThoughtBubble: (text, cloudId) => {
                    this.model.addThoughtBubble(text, cloudId, true);
                },
                getCloudById: (id) => this.model.getPartState(id) ? { id } : null,
            }
        );
        this.headlessView.setOnMessageReceived((message) => orchestrator.onMessageReceived(message));
        return orchestrator;
    }

    private createTimeAdvancer(): TimeAdvancer {
        return new TimeAdvancer(
            () => this.model,
            this.orchestrator,
            this.rng,
            {
                getMode: () => this.model.getMode(),
                onSpontaneousBlend: (event) => {
                    this.model.partDemandsAttention(event.cloudId);
                },
                onPendingBlendReady: (cloudId) => {
                    const pending = this.model.getPendingBlends().find(p => p.cloudId === cloudId);
                    if (pending) {
                        this.model.removePendingBlend(cloudId);
                        if (this.model.getConferenceCloudIds().has(cloudId)) {
                            this.model.addBlendedPart(cloudId, pending.reason);
                        } else {
                            this.model.partDemandsAttention(cloudId);
                        }
                    }
                },
            },
            { skipAttentionChecks: false }
        );
    }

    static fromSession(
        initialModel: SerializedModel,
        seed?: number
    ): HeadlessSimulator {
        const sim = new HeadlessSimulator({ seed });
        sim.model = SimulatorModel.fromJSON(initialModel);
        sim.controller = sim.createController();
        sim.effectApplicator = new ActionEffectApplicator(() => sim.model);
        sim.headlessView.setModel(sim.model);
        sim.orchestrator = sim.createOrchestrator();
        sim.timeAdvancer = sim.createTimeAdvancer();
        return sim;
    }

    setupParts(parts: PartConfig[]): void {
        for (const part of parts) {
            this.model.registerPart(part.id, part.name, {
                trust: part.trust,
                needAttention: part.needAttention,
                partAge: part.partAge,
                dialogues: part.dialogues,
            });
        }
    }

    setupRelationships(config: RelationshipConfig): void {
        for (const p of config.protections ?? []) {
            this.model.parts.addProtection(p.protectorId, p.protectedId);
        }
        for (const r of config.interPartRelations ?? []) {
            this.model.parts.setInterPartRelation(r.fromId, r.toId, {
                trust: r.trust,
                stance: r.stance,
                stanceFlipOdds: r.stanceFlipOdds,
                dialogues: r.dialogues,
                rumination: r.rumination,
                impactRecognition: r.impactRecognition,
                impactRejection: r.impactRejection,
            });
        }
        for (const p of config.proxies ?? []) {
            this.model.parts.addProxy(p.cloudId, p.proxyId);
        }
    }

    setupFromScenario(scenario: Scenario): void {
        this.setupParts(scenario.parts);
        this.setupRelationships(scenario.relationships);

        for (const cloudId of scenario.initialTargets ?? []) {
            this.model.addTargetCloud(cloudId);
        }
        for (const blend of scenario.initialBlended ?? []) {
            this.model.addBlendedPart(blend.cloudId, blend.reason, blend.degree ?? 1);
        }
    }

    executeAction(action: string, cloudId: string, targetCloudId?: string, field?: string, newMode?: 'panorama' | 'foreground', stanceDelta?: number): ActionResult {
        if (action === 'mode_change' && newMode) {
            this.model.setMode(newMode);
            this.model.syncConversation(this.rng);
            return { success: true, stateChanges: [`mode -> ${newMode}`] };
        }

        if (action === 'promote_pending_blend') {
            const tempQueue: { cloudId: string; reason: 'spontaneous' | 'therapist' }[] = [];
            let item = this.model.dequeuePendingBlend();
            while (item && item.cloudId !== cloudId) {
                tempQueue.push(item);
                item = this.model.dequeuePendingBlend();
            }
            for (const temp of tempQueue) {
                this.model.enqueuePendingBlend(temp.cloudId, temp.reason);
            }
            if (item) {
                this.model.addBlendedPart(cloudId, item.reason);
            }
            return { success: true, stateChanges: [`${cloudId}:promoted_to_blended`] };
        }

        // Handle add_target pending action completion (mirroring UI's completePendingAction)
        const pending = this.model.getPendingAction();
        if (pending?.actionId === 'add_target' && action === 'select_a_target') {
            this.model.setPendingAction(null);
            this.model.addTargetCloud(cloudId);
            this.model.setMode('foreground');
            this.model.syncConversation(this.rng);
            this.model.checkAndSetVictory();
            return { success: true, stateChanges: [`${cloudId}:selected_as_target`] };
        }

        const result = this.controller.executeAction(action, cloudId, {
            targetCloudId,
            field: field as BiographyField | undefined,
            isBlended: this.model.isBlended(cloudId),
            stanceDelta,
        });

        this.effectApplicator.apply(result, cloudId);
        this.model.syncConversation(this.rng);
        this.model.checkAndSetVictory();

        return {
            success: result.success,
            message: result.message,
            stateChanges: result.stateChanges
        };
    }

    checkWillingness(cloudId: string): boolean {
        const trust = this.model.parts.getTrust(cloudId);
        return trust >= this.rng.random();
    }

    advanceTime(deltaTime: number): void {
        this.timeAdvancer.advance(deltaTime);
    }

    advanceIntervals(count: number, orchState?: OrchestratorSnapshot): void {
        if (orchState) {
            this.orchestrator.restoreState(orchState);
        }
        this.timeAdvancer.advanceIntervals(count);
    }

    getModel(): SimulatorModel {
        return this.model;
    }

    getRelationships(): PartStateManager {
        return this.model.parts;
    }

    getModelJSON(): SerializedModel {
        return this.model.toJSON();
    }

    getModelRngSeed(): number | undefined {
        return this.rng instanceof SeededRNG ? this.rng.getInitialSeed() : undefined;
    }

    getRngCount(): number {
        return this.rng.getCallCount();
    }

    getModelRngLog(): RngLogEntry[] {
        return this.rng.getCallLog();
    }

    getOrchestratorDebugState(): OrchestratorSnapshot {
        return this.orchestrator.getDebugState();
    }

    getModelStateSnapshot(): ModelSnapshot {
        return {
            targets: [...this.model.getTargetCloudIds()],
            blended: this.model.getBlendedParts(),
            selfRay: this.model.getSelfRay()?.targetCloudId ? { targetCloudId: this.model.getSelfRay()!.targetCloudId } : null,
            thoughtBubbles: this.model.getThoughtBubbles().map(b => ({ id: b.id, cloudId: b.cloudId, text: b.text, validated: b.validated, partInitiated: b.partInitiated })),
        };
    }

    setViewState(_viewState: { cloudStates?: Record<string, unknown> } | undefined): void {
        // No-op: HeadlessView now reads directly from the model
    }

    setMode(mode: 'panorama' | 'foreground'): void {
        this.model.setMode(mode);
    }

    getMode(): 'panorama' | 'foreground' {
        return this.model.getMode();
    }
}
