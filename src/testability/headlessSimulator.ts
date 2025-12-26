import { SimulatorModel } from '../ifsModel.js';
import { CloudRelationshipManager } from '../cloudRelationshipManager.js';
import { SeededRNG, DualRNG, createDualRNG } from './rng.js';
import { SimulatorController } from '../simulatorController.js';
import { ActionEffectApplicator } from '../actionEffectApplicator.js';
import type {
    PartConfig, RelationshipConfig, Scenario, ActionResult,
    SerializedModel, SerializedRelationships
} from './types.js';
import type { BiographyField } from '../selfRay.js';

export class HeadlessSimulator {
    private model: SimulatorModel;
    private relationships: CloudRelationshipManager;
    private rng: DualRNG;
    private controller: SimulatorController;
    private effectApplicator: ActionEffectApplicator;

    constructor(config?: { seed?: number }) {
        this.model = new SimulatorModel();
        this.relationships = new CloudRelationshipManager();
        this.rng = createDualRNG(config?.seed);
        this.controller = this.createController();
        this.effectApplicator = new ActionEffectApplicator(this.model);
    }

    private createController(): SimulatorController {
        return new SimulatorController({
            model: this.model,
            relationships: this.relationships,
            rng: this.rng,
            getPartName: (id) => this.model.parts.getPartName(id)
        });
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
        this.model.increaseGrievanceNeedAttention(this.relationships, deltaTime);
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
}
