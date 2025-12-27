import { SimulatorModel } from './ifsModel.js';
import { CloudRelationshipManager } from './cloudRelationshipManager.js';
import { DualRNG } from './testability/rng.js';
import type { ControllerActionResult } from './testability/types.js';
import type { BiographyField } from './selfRay.js';

export interface ControllerDependencies {
    model: SimulatorModel;
    relationships: CloudRelationshipManager;
    rng: DualRNG;
    getPartName: (cloudId: string) => string;
}

export interface ActionOptions {
    targetCloudId?: string;
    field?: BiographyField;
    isBlended?: boolean;
}

const UNWILLING_RESPONSES = [
    "I'm not comfortable with that idea.",
    "No, I don't think so.",
    "That's not going to work.",
    "Why would I let you do that?",
];

const NO_JOB_RESPONSES = [
    "Did I say I had a job?",
    "What job?",
    "I don't know what you mean.",
];

const ALREADY_TOLD_RESPONSES = [
    "I told you already.",
    "I already answered that.",
    "You asked me that before.",
    "We covered that.",
];

const COMPASSION_RECEIVED_RESPONSES = [
    "It feels good to hear that.",
    "I appreciate you being here.",
    "I feel a little warmer inside.",
];

export class SimulatorController {
    private model: SimulatorModel;
    private relationships: CloudRelationshipManager;
    private rng: DualRNG;
    private getPartName: (cloudId: string) => string;

    constructor(deps: ControllerDependencies) {
        this.model = deps.model;
        this.relationships = deps.relationships;
        this.rng = deps.rng;
        this.getPartName = deps.getPartName;
    }

    private calculateTrustGain(cloudId: string): number {
        const openness = this.model.parts.getOpenness(cloudId);
        const targetCount = Math.max(1, this.model.getTargetCloudIds().size);
        return openness / targetCount;
    }

    executeAction(actionId: string, cloudId: string, options?: ActionOptions): ControllerActionResult {
        const stateChanges: string[] = [];

        switch (actionId) {
            case 'select_a_target':
                this.model.setTargetCloud(cloudId);
                stateChanges.push(`${cloudId} selected as target`);
                return { success: true, stateChanges };

            case 'join_conference':
                this.model.addTargetCloud(cloudId);
                stateChanges.push(`${cloudId} joined conference`);
                return { success: true, stateChanges };

            case 'step_back':
                return this.handleStepBack(cloudId);

            case 'separate':
                return this.handleSeparate(cloudId, options?.isBlended ?? this.model.isBlended(cloudId));

            case 'blend':
                return this.handleBlend(cloudId);

            case 'job':
                return this.handleJob(cloudId, options?.isBlended ?? this.model.isBlended(cloudId));

            case 'help_protected':
                return this.handleHelpProtected(cloudId);

            case 'who_do_you_see':
                return this.handleWhoDoYouSee(cloudId);

            case 'feel_toward':
                return this.handleFeelToward(cloudId);

            case 'notice_part':
                if (options?.targetCloudId) {
                    return this.handleNoticePart(cloudId, options.targetCloudId);
                }
                return {
                    success: true,
                    stateChanges: [],
                    uiFeedback: { thoughtBubble: { text: "Which part?", cloudId } }
                };

            case 'ray_field_select':
                if (options?.field) {
                    return this.handleRayFieldSelect(cloudId, options.field);
                }
                return { success: false, message: 'No field specified', stateChanges: [] };

            case 'spontaneous_blend':
                return this.handleSpontaneousBlend(cloudId);

            case 'backlash':
                if (options?.targetCloudId) {
                    return this.handleBacklash(cloudId, options.targetCloudId);
                }
                return { success: false, message: 'No target specified', stateChanges: [] };

            default:
                return { success: false, message: `Unknown action: ${actionId}`, stateChanges: [] };
        }
    }

    private handleStepBack(cloudId: string): ControllerActionResult {
        if (this.model.parts.wasProxy(cloudId)) {
            this.model.parts.adjustTrust(cloudId, 0.98);
            return {
                success: true,
                stateChanges: [`${cloudId} wanted to watch`],
                uiFeedback: { thoughtBubble: { text: "I want to watch.", cloudId } }
            };
        }

        this.model.stepBackPart(cloudId);
        return {
            success: true,
            stateChanges: [`${cloudId} stepped back`]
        };
    }

    private handleSeparate(cloudId: string, isBlended: boolean): ControllerActionResult {
        if (!isBlended) {
            return { success: false, message: 'Not blended', stateChanges: [] };
        }

        return {
            success: true,
            stateChanges: [`${cloudId} separating`],
            reduceBlending: { cloudId, amount: 0.3 }
        };
    }

    private handleBlend(cloudId: string): ControllerActionResult {
        this.model.removeTargetCloud(cloudId);
        this.model.addBlendedPart(cloudId, 'therapist');
        return {
            success: true,
            stateChanges: [`${cloudId} blended`]
        };
    }

    private getJobResponse(cloudId: string): string {
        if (this.model.parts.isUnburdened(cloudId)) {
            const unburdenedJob = this.model.parts.getDialogues(cloudId)?.unburdenedJob;
            if (!unburdenedJob) {
                throw new Error(`Part ${cloudId} is unburdened but no unburdenedJob dialogue`);
            }
            return unburdenedJob;
        }

        const protectedIds = this.relationships.getProtecting(cloudId);
        if (protectedIds.size === 0) {
            return "I don't have a job.";
        }
        const protectedId = Array.from(protectedIds)[0];
        const protectedName = this.getPartName(protectedId);
        this.model.parts.revealIdentity(cloudId);
        this.model.parts.revealIdentity(protectedId);
        this.model.summonSupportingPart(cloudId, protectedId);

        return `I protect ${protectedName}.`;
    }

    private handleJob(cloudId: string, isBlended: boolean): ControllerActionResult {
        if (this.model.parts.isIdentityRevealed(cloudId) && !this.model.parts.isUnburdened(cloudId)) {
            const protectedIds = this.relationships.getProtecting(cloudId);
            const protecteeInConference = Array.from(protectedIds).some(
                id => this.model.isTarget(id) || this.model.isBlended(id) || this.model.getAllSupportingParts().has(id)
            );
            if (protectedIds.size === 0 || protecteeInConference) {
                this.model.parts.adjustTrust(cloudId, 0.95);
                return {
                    success: true,
                    stateChanges: [`${cloudId} already answered`]
                };
            }
        }

        this.getJobResponse(cloudId);
        const stateChanges = [`${cloudId} revealed job`];

        const result: ControllerActionResult = {
            success: true,
            stateChanges
        };

        if (isBlended) {
            result.reduceBlending = { cloudId, amount: 0.3 };
        }

        return result;
    }

    private handleHelpProtected(cloudId: string): ControllerActionResult {
        const protectedIds = this.relationships.getProtecting(cloudId);
        if (protectedIds.size === 0) {
            return { success: false, message: 'Not a protector', stateChanges: [] };
        }

        const trust = this.model.parts.getTrust(cloudId);
        const willing = trust >= this.rng.model.random('help_protected:willing');
        const partName = this.getPartName(cloudId);

        if (!willing) {
            const response = this.rng.cosmetic.pickRandom(UNWILLING_RESPONSES);
            return {
                success: true,
                message: 'Refused',
                stateChanges: [`${cloudId} refused to help`],
                uiFeedback: {
                    thoughtBubble: { text: response, cloudId },
                    actionLabel: `Help? ${partName}: refused`
                }
            };
        }

        this.model.parts.setConsentedToHelp(cloudId);
        return {
            success: true,
            message: 'Consented',
            stateChanges: [`${cloudId} consented to help`],
            uiFeedback: {
                thoughtBubble: { text: "Yes, I'd like that.", cloudId },
                actionLabel: `Help? ${partName}: consented`
            }
        };
    }

    private getSelfRecognitionResponse(cloudId: string): string {
        const isProtector = this.relationships.getProtecting(cloudId).size > 0;
        const specific = isProtector
            ? ["I feel your beauty.", "I feel your concern."]
            : ["I feel your compassion.", "I feel your warmth."];
        const responses = [...specific, "I see a brilliant star."];
        return this.rng.cosmetic.pickRandom(responses);
    }

    private handleWhoDoYouSee(cloudId: string): ControllerActionResult {
        const blendedParts = this.model.getBlendedPartsWithDegrees();
        if (blendedParts.size > 0) {
            const topBlended = Array.from(blendedParts.entries())
                .sort((a, b) => b[1] - a[1])[0];
            const topBlendedId = topBlended[0];
            const partName = this.getPartName(topBlendedId);

            if (!this.model.parts.isIdentityRevealed(topBlendedId)) {
                this.model.parts.revealIdentity(topBlendedId);
                return {
                    success: true,
                    stateChanges: [`${topBlendedId} identity revealed`],
                    uiFeedback: { thoughtBubble: { text: `I see the ${partName}.`, cloudId } }
                };
            }
            return {
                success: true,
                stateChanges: [],
                uiFeedback: { thoughtBubble: { text: `I see the ${partName}, just like you do.`, cloudId } }
            };
        }

        const proxies = this.relationships.getProxies(cloudId);
        if (proxies.size === 0) {
            return {
                success: true,
                stateChanges: [],
                uiFeedback: { thoughtBubble: { text: this.getSelfRecognitionResponse(cloudId), cloudId } }
            };
        }

        const targetIds = this.model.getTargetCloudIds();
        const availableProxies = Array.from(proxies).filter(id => !targetIds.has(id));
        if (availableProxies.length === 0) {
            const successChance = this.model.getSelfRay()?.targetCloudId === cloudId ? 0.95 : 0.1;
            if (this.rng.model.random('who_do_you_see:clear_proxies') < successChance) {
                this.relationships.clearProxies(cloudId);
                return {
                    success: true,
                    stateChanges: [`${cloudId} proxies cleared`],
                    uiFeedback: { thoughtBubble: { text: this.getSelfRecognitionResponse(cloudId), cloudId } }
                };
            }
            const proxyIds = Array.from(proxies);
            const proxyId = this.rng.cosmetic.pickRandom(proxyIds);
            const proxyName = this.getPartName(proxyId);
            return {
                success: true,
                stateChanges: [],
                uiFeedback: { thoughtBubble: { text: `I see the ${proxyName}.`, cloudId } }
            };
        }

        const proxyId = this.rng.model.pickRandom(availableProxies, 'who_do_you_see:pick_proxy');
        const proxyName = this.getPartName(proxyId);

        this.model.addBlendedPart(proxyId, 'therapist');
        this.model.parts.revealIdentity(proxyId);

        return {
            success: true,
            stateChanges: [`${proxyId} blended as proxy`],
            uiFeedback: { thoughtBubble: { text: `I see the ${proxyName}.`, cloudId } }
        };
    }

    private handleFeelToward(cloudId: string): ControllerActionResult {
        const stateChanges: string[] = [];
        const grievanceTargets = this.relationships.getGrievanceTargets(cloudId);
        const targetIds = this.model.getTargetCloudIds();
        const blendedParts = this.model.getBlendedParts();
        const blendedResponses: { cloudId: string; response: string }[] = [];

        for (const blendedId of blendedParts) {
            if (this.relationships.hasGrievance(blendedId, cloudId)) {
                const dialogues = this.relationships.getGrievanceDialogues(blendedId, cloudId);
                if (dialogues.length > 0) {
                    blendedResponses.push({ cloudId: blendedId, response: this.rng.cosmetic.pickRandom(dialogues) });
                }
            } else {
                const dialogues = this.model.parts.getDialogues(blendedId).genericBlendedDialogues;
                if (dialogues && dialogues.length > 0) {
                    blendedResponses.push({ cloudId: blendedId, response: this.rng.cosmetic.pickRandom(dialogues) });
                }
            }
        }

        for (const grievanceId of grievanceTargets) {
            const isPending = this.model.isPendingBlend(grievanceId);
            if (!targetIds.has(grievanceId) && !blendedParts.includes(grievanceId) && !isPending) {
                if (this.model.parts.getTrust(grievanceId) < 0.5) {
                    this.model.enqueuePendingBlend(grievanceId, 'therapist');
                    stateChanges.push(`${grievanceId} pending blend`);
                }
            }
        }

        const hasPendingBlends = this.model.peekPendingBlend() !== null;
        this.model.parts.revealRelationships(cloudId);
        stateChanges.push(`${cloudId} relationships revealed`);

        if (blendedParts.length === 0 && !hasPendingBlends) {
            return {
                success: true,
                stateChanges,
                createSelfRay: { cloudId }
            };
        }

        if (blendedResponses.length > 0) {
            this.model.parts.adjustTrust(cloudId, 0.9);
            return {
                success: true,
                stateChanges,
                uiFeedback: {
                    thoughtBubble: { text: blendedResponses[0].response, cloudId: blendedResponses[0].cloudId }
                }
            };
        }

        return { success: true, stateChanges };
    }

    private handleNoticePart(protectorId: string, targetCloudId: string): ControllerActionResult {
        const protectedIds = this.relationships.getProtecting(protectorId);
        if (!protectedIds.has(targetCloudId)) {
            return {
                success: false,
                stateChanges: [],
                uiFeedback: { thoughtBubble: { text: "That's not a part I protect.", cloudId: protectorId } }
            };
        }

        const targetTrust = this.model.parts.getTrust(targetCloudId);
        if (targetTrust < 1) {
            return {
                success: false,
                stateChanges: [],
                uiFeedback: { thoughtBubble: { text: "I don't see anything different.", cloudId: protectorId } }
            };
        }

        const targetName = this.getPartName(targetCloudId);
        this.model.parts.setUnburdened(protectorId);
        this.model.parts.setNeedAttention(protectorId, 0);

        const unburdenedJob = this.model.parts.getDialogues(protectorId)?.unburdenedJob;
        const response = unburdenedJob
            ? `I see that ${targetName} is okay now. ${unburdenedJob}`
            : `I see that ${targetName} is okay now. I don't need to protect them anymore.`;

        return {
            success: true,
            stateChanges: [`${protectorId} unburdened`],
            uiFeedback: { thoughtBubble: { text: response, cloudId: protectorId } }
        };
    }

    private handleRayFieldSelect(cloudId: string, field: BiographyField): ControllerActionResult {
        const partState = this.model.getPartState(cloudId);
        if (!partState) {
            return { success: false, message: 'Part not found', stateChanges: [] };
        }

        if (this.model.parts.isFieldRevealed(cloudId, field)) {
            this.model.parts.adjustTrust(cloudId, 0.98);
            return {
                success: true,
                stateChanges: [],
                uiFeedback: { thoughtBubble: { text: this.rng.cosmetic.pickRandom(ALREADY_TOLD_RESPONSES), cloudId } }
            };
        }

        const proxies = this.relationships.getProxies(cloudId);
        if (proxies.size > 0 && this.rng.model.random('ray_field:deflect') < 0.95) {
            const deflections = [
                "I don't trust you.",
                "Why should I tell you?",
                "You wouldn't understand.",
                "I'm not talking to you.",
                "Leave me alone."
            ];
            return {
                success: true,
                stateChanges: [`${cloudId} deflected`],
                uiFeedback: { thoughtBubble: { text: this.rng.cosmetic.pickRandom(deflections), cloudId } }
            };
        }

        const highTrustFields: BiographyField[] = ['gratitude', 'compassion', 'jobAppraisal', 'jobImpact', 'age', 'identity'];
        if (highTrustFields.includes(field) && this.model.parts.getTrust(cloudId) >= 0.95) {
            return {
                success: true,
                stateChanges: [],
                uiFeedback: { thoughtBubble: { text: "Thanks, but there are other parts that need your attention more urgently.", cloudId } }
            };
        }

        if (this.model.parts.isAttacked(cloudId) && this.model.parts.isTrustAtCeiling(cloudId) && highTrustFields.includes(field)) {
            return {
                success: true,
                stateChanges: [],
                uiFeedback: { thoughtBubble: { text: "Aren't you going to apologize?", cloudId } }
            };
        }

        let response: string | null;
        let trustGain = 0;
        let backlash: { protectorId: string; protecteeId: string } | undefined;

        switch (field) {
            case 'whatNeedToKnow': {
                const result = this.handleWhatNeedToKnowInternal(cloudId);
                response = result.response;
                trustGain = this.calculateTrustGain(cloudId);
                backlash = result.triggerBacklash;
                break;
            }

            case 'compassion': {
                const isProtector = this.relationships.getProtecting(cloudId).size > 0;
                trustGain = this.calculateTrustGain(cloudId);
                if (isProtector) {
                    response = "*Shrug*";
                    trustGain *= 0.25;
                } else {
                    response = this.rng.cosmetic.pickRandom(COMPASSION_RECEIVED_RESPONSES);
                }
                this.model.parts.addTrust(cloudId, trustGain);
                break;
            }

            case 'gratitude': {
                const protectedIds = this.relationships.getProtecting(cloudId);
                if (protectedIds.size > 0) {
                    const gratitudeResponses = [
                        "I'm not used to being appreciated. Thank you.",
                        "This is unfamiliar. No one ever thanks me.",
                        "You're grateful? That's new.",
                        "I've been working so hard for so long. Thank you for noticing.",
                    ];
                    response = this.rng.cosmetic.pickRandom(gratitudeResponses);
                    trustGain = this.calculateTrustGain(cloudId);
                    this.model.parts.addTrust(cloudId, trustGain);
                } else {
                    response = "Gratitude? For what?";
                    this.model.parts.adjustTrust(cloudId, 0.98);
                }
                break;
            }

            case 'job':
                response = this.getJobResponse(cloudId);
                this.model.parts.addTrust(cloudId, 0.05);
                break;

            case 'jobAppraisal':
                response = this.handleJobAppraisalInternal(cloudId);
                break;

            case 'jobImpact':
                response = this.handleJobImpactInternal(cloudId);
                break;

            case 'apologize':
                response = this.handleApologizeInternal(cloudId);
                break;

            case 'age':
                response = this.revealAge(cloudId);
                this.model.parts.addTrust(cloudId, 0.05);
                break;

            case 'identity':
                response = this.revealIdentity(cloudId);
                this.model.parts.addTrust(cloudId, 0.05);
                break;

            default:
                return { success: false, message: `Unknown field: ${field}`, stateChanges: [] };
        }

        if (this.rng.model.random('ray_field:clear_ray') < 0.25) {
            this.model.clearSelfRay();
        }

        const result: ControllerActionResult = {
            success: true,
            stateChanges: [`${cloudId} ${field} handled`],
            uiFeedback: response ? { thoughtBubble: { text: response, cloudId } } : undefined,
            trustGain
        };
        if (backlash) {
            result.triggerBacklash = backlash;
        }
        return result;
    }

    private revealAge(cloudId: string): string {
        this.model.parts.revealAge(cloudId);
        const age = this.model.getPartState(cloudId)?.biography.partAge;
        if (typeof age === 'number') {
            return `I'm ${age} years old.`;
        } else if (typeof age === 'string') {
            return `I'm a ${age}.`;
        }
        return "I'm not sure how old I am.";
    }

    private revealIdentity(cloudId: string): string {
        this.model.parts.revealIdentity(cloudId);
        return '';
    }

    private handleWhatNeedToKnowInternal(cloudId: string): { response: string; triggerBacklash?: { protectorId: string; protecteeId: string } } {
        const trustGain = this.calculateTrustGain(cloudId);
        const protectorIds = this.relationships.getProtectedBy(cloudId);

        this.model.parts.addTrust(cloudId, trustGain);

        let backlash: { protectorId: string; protecteeId: string } | undefined;
        for (const protectorId of protectorIds) {
            if (!this.model.parts.hasConsentedToHelp(protectorId)) {
                const protectorTrust = this.model.parts.getTrust(protectorId);
                const newProtectorTrust = protectorTrust - trustGain / 2;
                this.model.parts.setTrust(protectorId, newProtectorTrust);
                if (newProtectorTrust < this.rng.model.random('whatNeedToKnow:backlash_check')) {
                    backlash = { protectorId, protecteeId: cloudId };
                    break;
                }
            }
        }

        const trust = this.model.parts.getTrust(cloudId);
        const response = trust >= 1 ? "I feel understood." : "Blah blah blah.";
        return { response, triggerBacklash: backlash };
    }

    private handleJobAppraisalInternal(cloudId: string): string {
        const partState = this.model.getPartState(cloudId);
        if (!partState) return "...";

        if (!this.model.parts.isIdentityRevealed(cloudId)) {
            this.model.parts.adjustTrust(cloudId, 0.95);
            return this.rng.cosmetic.pickRandom(NO_JOB_RESPONSES);
        }

        const dialogues = partState.dialogues.burdenedJobAppraisal;
        if (!dialogues || dialogues.length === 0) {
            this.model.parts.adjustTrust(cloudId, 0.95);
            return this.rng.cosmetic.pickRandom(NO_JOB_RESPONSES);
        }

        this.model.parts.revealJobAppraisal(cloudId);
        this.model.parts.addTrust(cloudId, 0.05);
        return this.rng.cosmetic.pickRandom(dialogues);
    }

    private handleJobImpactInternal(cloudId: string): string {
        const partState = this.model.getPartState(cloudId);
        if (!partState) return "...";

        if (!this.model.parts.isIdentityRevealed(cloudId)) {
            this.model.parts.adjustTrust(cloudId, 0.95);
            return this.rng.cosmetic.pickRandom(NO_JOB_RESPONSES);
        }

        const dialogues = partState.dialogues.burdenedJobImpact;
        if (!dialogues || dialogues.length === 0) {
            this.model.parts.adjustTrust(cloudId, 0.95);
            return this.rng.cosmetic.pickRandom(NO_JOB_RESPONSES);
        }

        this.model.parts.revealJobImpact(cloudId);
        this.model.parts.addTrust(cloudId, 0.05);
        return this.rng.cosmetic.pickRandom(dialogues);
    }

    private handleApologizeInternal(cloudId: string): string {
        if (!this.model.parts.isAttacked(cloudId)) {
            return "What are you apologizing for?";
        }

        const grievanceSenders = this.relationships.getGrievanceSenders(cloudId);
        const hasUnburdenedAttacker = Array.from(grievanceSenders).some(
            senderId => this.model.parts.isUnburdened(senderId)
        );
        if (!hasUnburdenedAttacker) {
            this.model.parts.adjustTrust(cloudId, 0.95);
            return "The ones who attacked me are still burdened. How can I trust you?";
        }

        const trust = this.model.parts.getTrust(cloudId);
        if (trust < 0.5 || this.rng.model.random('apologize:accept') > trust) {
            this.model.parts.adjustTrust(cloudId, 0.9);
            const rejections = [
                "It's going to take more than that.",
                "Words are easy. Show me you mean it.",
                "I'm not ready to forgive yet.",
            ];
            return this.rng.cosmetic.pickRandom(rejections);
        }

        this.model.parts.clearAttacked(cloudId);
        this.model.parts.addTrust(cloudId, 0.2);
        const acceptances = [
            "Thank you. I appreciate that.",
            "I can tell you mean it. Thank you.",
            "That means a lot to me.",
        ];
        return this.rng.cosmetic.pickRandom(acceptances);
    }

    private handleSpontaneousBlend(cloudId: string): ControllerActionResult {
        this.model.parts.setNeedAttention(cloudId, 0.95);
        this.model.partDemandsAttention(cloudId);
        return {
            success: true,
            stateChanges: [`${cloudId} spontaneously blended`]
        };
    }

    private handleBacklash(protectorId: string, protecteeId: string): ControllerActionResult {
        return {
            success: true,
            stateChanges: [`${protectorId} triggered backlash on ${protecteeId}`],
            triggerBacklash: { protectorId, protecteeId }
        };
    }
}
