import { SimulatorModel } from './ifsModel';
import { SimulatorView } from './ifsView';
import { ControllerActionResult } from '../playback/testability/types.js';

export class ActionEffectApplicator {
    constructor(
        private getModel: () => SimulatorModel,
        private view?: SimulatorView
    ) {}

    private get model(): SimulatorModel {
        return this.getModel();
    }

    apply(result: ControllerActionResult, _cloudId: string): void {
        if (result.uiFeedback?.thoughtBubble && this.view) {
            this.model.addThoughtBubble(result.uiFeedback.thoughtBubble.text, result.uiFeedback.thoughtBubble.cloudId);
        }
        if (result.reduceBlending) {
            this.reduceBlending(result.reduceBlending.cloudId, result.reduceBlending.amount);
        }
        if (result.triggerBacklash) {
            this.triggerBacklash(result.triggerBacklash.protectorId, result.triggerBacklash.protecteeId, result.triggerBacklash.extras);
        }
        if (result.createSelfRay) {
            this.model.setSelfRay(result.createSelfRay.cloudId);
        }
    }

    private reduceBlending(cloudId: string, baseAmount: number): void {
        if (!this.model.isBlended(cloudId)) return;

        const amount = this.model.calculateSeparationAmount(cloudId, baseAmount);
        const currentDegree = this.model.getBlendingDegree(cloudId);
        const targetDegree = Math.max(0, currentDegree - amount);
        this.model.setBlendingDegree(cloudId, targetDegree);
        if (targetDegree === 0) {
            this.model.promoteBlendedToTarget(cloudId);
        }
    }

    private triggerBacklash(protectorId: string, protecteeId: string, extras: string[]): void {
        const trust = this.model.parts.getTrust(protectorId);
        this.model.changeNeedAttention(protectorId, 0.5 * (1 - trust));
        if (this.model.getConferenceCloudIds().has(protectorId)) {
            this.model.addBlendedPart(protectorId, 'spontaneous');
        } else {
            this.model.partDemandsAttention(protectorId);
        }
        for (const extraId of extras) {
            this.model.enqueuePendingBlend(extraId, 'spontaneous');
        }
    }
}
