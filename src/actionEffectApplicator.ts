import { SimulatorModel } from './ifsModel';
import { SimulatorView } from './ifsView';
import { ControllerActionResult } from './testability/types';

export class ActionEffectApplicator {
    constructor(
        private model: SimulatorModel,
        private view?: SimulatorView
    ) {}

    apply(result: ControllerActionResult, _cloudId: string): void {
        if (result.uiFeedback?.thoughtBubble && this.view) {
            this.model.addThoughtBubble(
                result.uiFeedback.thoughtBubble.text,
                result.uiFeedback.thoughtBubble.cloudId
            );
        }
        if (result.uiFeedback?.actionLabel && this.view) {
            this.view.setAction(result.uiFeedback.actionLabel);
        }
        if (result.reduceBlending) {
            this.reduceBlending(result.reduceBlending.cloudId, result.reduceBlending.amount);
        }
        if (result.triggerBacklash) {
            this.triggerBacklash(result.triggerBacklash.protectorId, result.triggerBacklash.protecteeId);
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
    }

    private triggerBacklash(protectorId: string, protecteeId: string): void {
        this.model.parts.adjustTrust(protecteeId, 0.5);
        const trust = this.model.parts.getTrust(protectorId);
        this.model.parts.addNeedAttention(protectorId, 0.5 * (1 - trust));
        this.model.addBlendedPart(protectorId, 'spontaneous');
        this.model.stepBackPart(protecteeId);
    }
}
