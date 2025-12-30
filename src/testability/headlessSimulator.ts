import { SimulatorModel, PartMessage } from '../ifsModel.js';
import { CloudRelationshipManager } from '../cloudRelationshipManager.js';
import { SeededRNG, DualRNG, createDualRNG } from './rng.js';
import { SimulatorController } from '../simulatorController.js';
import { ActionEffectApplicator } from '../actionEffectApplicator.js';
import { MessageOrchestrator, MessageOrchestratorView } from '../messageOrchestrator.js';
import type {
    PartConfig, RelationshipConfig, Scenario, ActionResult,
    SerializedModel, SerializedRelationships
} from './types.js';
import type { BiographyField } from '../selfRay.js';

class HeadlessView implements MessageOrchestratorView {
    private model: SimulatorModel | null = null;
    private onMessageReceived: ((message: PartMessage) => void) | null = null;

    setModel(model: SimulatorModel): void {
        this.model = model;
    }

    setOnMessageReceived(callback: (message: PartMessage) => void): void {
        this.onMessageReceived = callback;
    }

    hasActiveSpiralExits(): boolean { return false; }
    isAwaitingArrival(_cloudId: string): boolean { return false; }
    getCloudState(cloudId: string): unknown | null {
        if (!this.model) return null;
        // Return a truthy object if the part is in the conference (targeted or blended)
        const isTarget = this.model.getTargetCloudIds().has(cloudId);
        const isBlended = this.model.getBlendedParts().includes(cloudId);
        return (isTarget || isBlended) ? {} : null;
    }
    startMessage(message: PartMessage, _senderId: string, _targetId: string): void {
        // Immediately deliver message in headless mode
        this.onMessageReceived?.(message);
    }
}

export class HeadlessSimulator {
    private model: SimulatorModel;
    private relationships: CloudRelationshipManager;
    private rng: DualRNG;
    private controller: SimulatorController;
    private effectApplicator: ActionEffectApplicator;
    private orchestrator: MessageOrchestrator;
    private headlessView: HeadlessView;

    constructor(config?: { seed?: number }) {
        this.model = new SimulatorModel();
        this.relationships = new CloudRelationshipManager();
        this.rng = createDualRNG(config?.seed);
        this.controller = this.createController();
        this.effectApplicator = new ActionEffectApplicator(this.model);
        this.headlessView = new HeadlessView();
        this.headlessView.setModel(this.model);
        this.orchestrator = this.createOrchestrator();
    }

    private createController(): SimulatorController {
        return new SimulatorController({
            model: this.model,
            relationships: this.relationships,
            rng: this.rng,
            getPartName: (id) => this.model.parts.getPartName(id)
        });
    }

    private createOrchestrator(): MessageOrchestrator {
        const orchestrator = new MessageOrchestrator(
            this.model,
            this.headlessView,
            this.relationships,
            this.rng,
            {
                act: (_label, fn) => fn(),
                showThoughtBubble: () => {},
                getCloudById: (id) => this.model.getPartState(id) ? { id } : null,
            }
        );
        this.headlessView.setOnMessageReceived((message) => orchestrator.onMessageReceived(message));
        return orchestrator;
    }

    static fromSession(
        initialModel: SerializedModel,
        initialRelationships: SerializedRelationships,
        seed?: number
    ): HeadlessSimulator {
        const sim = new HeadlessSimulator({ seed });
        sim.model = SimulatorModel.fromJSON(initialModel);
        sim.relationships = CloudRelationshipManager.fromJSON(initialRelationships);
        sim.controller = sim.createController();
        sim.effectApplicator = new ActionEffectApplicator(sim.model);
        sim.headlessView.setModel(sim.model);
        sim.orchestrator = sim.createOrchestrator();
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
            this.relationships.addProtection(p.protectorId, p.protectedId);
        }
        for (const g of config.grievances ?? []) {
            this.relationships.setGrievance(g.cloudId, g.targetIds, g.dialogues);
        }
        for (const p of config.proxies ?? []) {
            this.relationships.addProxy(p.cloudId, p.proxyId);
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

    executeAction(action: string, cloudId: string, targetCloudId?: string, field?: string): ActionResult {
        const result = this.controller.executeAction(action, cloudId, {
            targetCloudId,
            field: field as BiographyField | undefined,
            isBlended: this.model.isBlended(cloudId)
        });

        this.effectApplicator.apply(result, cloudId);
        this.model.checkAndSetVictory(this.relationships);

        return {
            success: result.success,
            message: result.message,
            stateChanges: result.stateChanges
        };
    }

    checkWillingness(cloudId: string): boolean {
        const trust = this.model.parts.getTrust(cloudId);
        return trust >= this.rng.model.random();
    }

    advanceTime(deltaTime: number): void {
        this.model.increaseNeedAttention(this.relationships, deltaTime, true);
        this.orchestrator.updateTimers(deltaTime);
        this.orchestrator.checkAndSendGrievanceMessages();
        this.orchestrator.checkAndShowGenericDialogues(deltaTime);
    }

    getModel(): SimulatorModel {
        return this.model;
    }

    getRelationships(): CloudRelationshipManager {
        return this.relationships;
    }

    getModelJSON(): SerializedModel {
        return this.model.toJSON();
    }

    getRelationshipsJSON(): SerializedRelationships {
        return this.relationships.toJSON();
    }

    getModelRngSeed(): number | undefined {
        const rng = this.rng.model;
        return rng instanceof SeededRNG ? rng.getInitialSeed() : undefined;
    }

    getRngCounts(): { model: number; cosmetic: number } {
        return {
            model: this.rng.model.getCallCount(),
            cosmetic: this.rng.cosmetic.getCallCount()
        };
    }

    getModelRngLog(): string[] {
        return this.rng.model.getCallLog();
    }

    getOrchestratorDebugState(): { blendTimers: Record<string, number>; cooldowns: Record<string, number>; pending: Record<string, string> } {
        return this.orchestrator.getDebugState();
    }

    getModelStateSnapshot(): { targets: string[]; blended: string[] } {
        return {
            targets: [...this.model.getTargetCloudIds()],
            blended: this.model.getBlendedParts(),
        };
    }

    setViewState(_viewState: { cloudStates?: Record<string, unknown> } | undefined): void {
        // No-op: HeadlessView now reads directly from the model
    }
}
