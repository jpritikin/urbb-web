import { SimulatorModel } from './ifsModel.js';
import { CloudRelationshipManager } from './cloudRelationshipManager.js';
import { RNG, pickRandom } from './testability/rng.js';
import { OUTCOMES, outcome } from './outcomes.js';
import type { ControllerActionResult } from './testability/types.js';
import type { BiographyField } from './selfRay.js';
import { STAR_CLOUD_ID } from './ifsView/SeatManager.js';

export interface ControllerDependencies {
    getModel: () => SimulatorModel;
    getRelationships: () => CloudRelationshipManager;
    rng: RNG;
    getPartName: (cloudId: string) => string;
}

export interface ActionOptions {
    targetCloudId?: string;
    field?: BiographyField;
    isBlended?: boolean;
}

export interface ValidAction {
    action: string;
    cloudId: string;
    targetCloudId?: string;
    field?: BiographyField;
}

export const ALL_RAY_FIELDS: BiographyField[] = [
    'age', 'identity', 'jobAppraisal', 'jobImpact', 'gratitude',
    'whatNeedToKnow', 'compassion', 'apologize'
];

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
    private getModel: () => SimulatorModel;
    private getRelationships: () => CloudRelationshipManager;
    private rng: RNG;
    private getPartName: (cloudId: string) => string;

    constructor(deps: ControllerDependencies) {
        this.getModel = deps.getModel;
        this.getRelationships = deps.getRelationships;
        this.rng = deps.rng;
        this.getPartName = deps.getPartName;
    }

    private get model(): SimulatorModel {
        return this.getModel();
    }

    private get relationships(): CloudRelationshipManager {
        return this.getRelationships();
    }

    getValidActions(): ValidAction[] {
        const actions: ValidAction[] = [];

        const selfRay = this.model.getSelfRay();
        if (selfRay && this.model.isTarget(selfRay.targetCloudId)) {
            const cloudId = selfRay.targetCloudId;
            const rayFields = this.getValidRayFields(cloudId);
            for (const field of rayFields) {
                actions.push({ action: 'ray_field_select', cloudId, field });
            }
        }

        // Star actions (available when in foreground with targets)
        const starActions = this.getValidStarActions();
        actions.push(...starActions);

        const partIds = this.model.getAllPartIds();
        for (const cloudId of partIds) {
            const cloudActions = this.getValidCloudActions(cloudId);
            actions.push(...cloudActions);
        }

        return actions;
    }

    private getValidStarActions(): ValidAction[] {
        const actions: ValidAction[] = [];
        const targetIds = this.model.getTargetCloudIds();

        if (targetIds.size > 0) {
            actions.push({ action: 'feel_toward', cloudId: STAR_CLOUD_ID });
            actions.push({ action: 'expand_deepen', cloudId: STAR_CLOUD_ID });
        }

        return actions;
    }

    private getValidCloudActions(cloudId: string): ValidAction[] {
        const actions: ValidAction[] = [];

        const isTarget = this.model.isTarget(cloudId);
        const isBlended = this.model.isBlended(cloudId);
        const isSupporting = this.model.getAllSupportingParts().has(cloudId);
        const blendReason = this.model.getBlendReason(cloudId);
        const isSpontaneousBlend = isBlended && blendReason === 'spontaneous';
        const targetIds = this.model.getTargetCloudIds();
        const selfRay = this.model.getSelfRay();
        const protectedIds = this.relationships.getProtecting(cloudId);
        const conferenceParts = this.model.getConferenceCloudIds();
        const inConference = conferenceParts.has(cloudId);

        // select_a_target (panorama mode - can target any non-targeted, non-blended part)
        if (!isTarget && !isBlended) {
            actions.push({ action: 'select_a_target', cloudId });
        }

        // join_conference
        if (isSupporting && !isBlended) {
            actions.push({ action: 'join_conference', cloudId });
        }

        // separate
        if (isBlended) {
            actions.push({ action: 'separate', cloudId });
        }

        // step_back
        if (inConference && !isSpontaneousBlend) {
            actions.push({ action: 'step_back', cloudId });
        }

        // job
        if (isTarget || isBlended) {
            actions.push({ action: 'job', cloudId });
        }

        // who_do_you_see
        if (isTarget) {
            actions.push({ action: 'who_do_you_see', cloudId });
        }

        // blend
        if (isTarget && !isBlended) {
            actions.push({ action: 'blend', cloudId });
        }

        // help_protected
        if (isTarget && protectedIds.size > 0 && this.model.parts.isIdentityRevealed(cloudId)) {
            actions.push({ action: 'help_protected', cloudId });
        }

        // notice_part: any non-blended conference part can notice any other conference part (including self)
        if (inConference && !isBlended) {
            for (const targetPartId of conferenceParts) {
                actions.push({ action: 'notice_part', cloudId, targetCloudId: targetPartId });
            }
        }

        return actions;
    }

    private getValidRayFields(cloudId: string): BiographyField[] {
        const fields: BiographyField[] = [];
        const isProtector = this.relationships.getProtecting(cloudId).size > 0;
        const isIdentityRevealed = this.model.parts.isIdentityRevealed(cloudId);

        fields.push('age', 'identity', 'gratitude', 'compassion', 'apologize');

        const showJobQuestions = !isIdentityRevealed || isProtector;
        if (showJobQuestions) {
            fields.push('jobAppraisal', 'jobImpact');
        } else {
            fields.push('whatNeedToKnow');
        }

        return fields;
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
                stateChanges.push(outcome(cloudId, OUTCOMES.SELECTED_AS_TARGET));
                return { success: true, stateChanges };

            case 'join_conference':
                this.model.addTargetCloud(cloudId);
                stateChanges.push(outcome(cloudId, OUTCOMES.JOINED_CONFERENCE));
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

            case 'expand_deepen':
                return this.handleExpandDeepen();

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
                stateChanges: [outcome(cloudId, OUTCOMES.WANTED_TO_WATCH)],
                uiFeedback: { thoughtBubble: { text: "I want to watch.", cloudId } }
            };
        }

        this.model.stepBackPart(cloudId);
        return {
            success: true,
            stateChanges: [outcome(cloudId, OUTCOMES.STEPPED_BACK)]
        };
    }

    private handleSeparate(cloudId: string, isBlended: boolean): ControllerActionResult {
        if (!isBlended) {
            return { success: false, message: 'Not blended', stateChanges: [] };
        }

        const baseAmount = 0.3;
        const willUnblend = this.model.willUnblendAfterSeparation(cloudId, baseAmount);

        return {
            success: true,
            stateChanges: [outcome(cloudId, willUnblend ? OUTCOMES.UNBLENDED : OUTCOMES.SEPARATING)],
            reduceBlending: { cloudId, amount: baseAmount }
        };
    }

    private handleBlend(cloudId: string): ControllerActionResult {
        this.model.removeTargetCloud(cloudId);
        this.model.addBlendedPart(cloudId, 'therapist');
        return {
            success: true,
            stateChanges: [outcome(cloudId, OUTCOMES.BLENDED)]
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
        if (this.model.parts.isJobRevealed(cloudId)) {
            const protectedIds = this.relationships.getProtecting(cloudId);
            const protecteeInConference = Array.from(protectedIds).some(
                id => this.model.isTarget(id) || this.model.isBlended(id) || this.model.getAllSupportingParts().has(id)
            );
            if (protectedIds.size === 0 || protecteeInConference) {
                this.model.parts.adjustTrust(cloudId, 0.95);
                return {
                    success: true,
                    stateChanges: [outcome(cloudId, OUTCOMES.ALREADY_ANSWERED)],
                    uiFeedback: { thoughtBubble: { text: pickRandom(ALREADY_TOLD_RESPONSES), cloudId } }
                };
            }
        }

        const response = this.getJobResponse(cloudId);
        this.model.parts.revealJob(cloudId);
        const stateChanges = [outcome(cloudId, OUTCOMES.REVEALED_JOB)];

        const result: ControllerActionResult = {
            success: true,
            stateChanges,
            uiFeedback: { thoughtBubble: { text: response, cloudId } }
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
        const willing = trust >= this.rng.random('help_protected:willing');
        const partName = this.getPartName(cloudId);

        if (!willing) {
            const response = pickRandom(UNWILLING_RESPONSES);
            return {
                success: true,
                message: 'Refused',
                stateChanges: [outcome(cloudId, OUTCOMES.REFUSED_TO_HELP)],
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
            stateChanges: [outcome(cloudId, OUTCOMES.CONSENTED_TO_HELP)],
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
        return pickRandom(responses);
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
                    stateChanges: [outcome(topBlendedId, OUTCOMES.IDENTITY_REVEALED)],
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
            if (this.rng.random('who_do_you_see:clear_proxies') < successChance) {
                this.relationships.clearProxies(cloudId);
                return {
                    success: true,
                    stateChanges: [outcome(cloudId, OUTCOMES.PROXIES_CLEARED)],
                    uiFeedback: { thoughtBubble: { text: this.getSelfRecognitionResponse(cloudId), cloudId } }
                };
            }
            const proxyIds = Array.from(proxies);
            return {
                success: true,
                stateChanges: [],
                uiFeedback: {}
            };
        }

        const proxyId = this.rng.pickRandom(availableProxies, 'who_do_you_see:pick_proxy');

        this.model.addBlendedPart(proxyId, 'therapist');
        this.model.parts.revealIdentity(proxyId);
        this.model.parts.markAsProxy(proxyId);

        return {
            success: true,
            stateChanges: [outcome(proxyId, OUTCOMES.BLENDED_AS_PROXY)],
            uiFeedback: {}
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
                    blendedResponses.push({ cloudId: blendedId, response: pickRandom(dialogues) });
                }
            } else {
                const dialogues = this.model.parts.getDialogues(blendedId).genericBlendedDialogues;
                if (dialogues && dialogues.length > 0) {
                    blendedResponses.push({ cloudId: blendedId, response: pickRandom(dialogues) });
                }
            }
        }

        for (const grievanceId of grievanceTargets) {
            const isPending = this.model.isPendingBlend(grievanceId);
            if (!targetIds.has(grievanceId) && !blendedParts.includes(grievanceId) && !isPending) {
                if (this.model.parts.getTrust(grievanceId) < 0.5) {
                    this.model.enqueuePendingBlend(grievanceId, 'therapist');
                    stateChanges.push(outcome(grievanceId, OUTCOMES.PENDING_BLEND));
                }
            }
        }

        const hasPendingBlends = this.model.peekPendingBlend() !== null;
        this.model.parts.revealRelationships(cloudId);
        stateChanges.push(outcome(cloudId, OUTCOMES.REGARD_PART));

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

    private handleExpandDeepen(): ControllerActionResult {
        // Stub - effects will be implemented later
        return { success: true, stateChanges: [] };
    }

    private handleNoticePart(cloudId: string, targetCloudId: string): ControllerActionResult {
        if (cloudId === targetCloudId) {
            return this.handleSelfNotice(cloudId);
        }

        const protectedByMe = this.relationships.getProtecting(cloudId);
        const myProtectors = this.relationships.getProtectedBy(cloudId);

        if (protectedByMe.has(targetCloudId)) {
            return this.handleProtectorNoticingProtectee(cloudId, targetCloudId);
        }

        if (myProtectors.has(targetCloudId)) {
            return this.handleProtecteeNoticingProtector(cloudId, targetCloudId);
        }

        const partsIHurt = this.relationships.getGrievanceTargets(cloudId);
        if (partsIHurt.has(targetCloudId)) {
            return this.handleAttackerNoticingVictim(cloudId, targetCloudId);
        }

        return this.handleGenericNotice(cloudId, targetCloudId);
    }

    private handleSelfNotice(cloudId: string): ControllerActionResult {
        const selfNoticeResponses = [
            "We've met before.",
            "Ah yes, my favorite person.",
            "I knew I'd find me here.",
        ];
        return {
            success: true,
            stateChanges: [outcome(cloudId, OUTCOMES.NOTICED_SELF)],
            uiFeedback: {
                thoughtBubble: {
                    text: pickRandom(selfNoticeResponses),
                    cloudId
                }
            }
        };
    }

    private handleGenericNotice(cloudId: string, targetCloudId: string): ControllerActionResult {
        const genericResponses = [
            "We're in this together.",
            "I notice you.",
            "I see you there.",
        ];
        this.model.changeNeedAttention(targetCloudId, 0.1);
        return {
            success: true,
            stateChanges: [outcome(cloudId, OUTCOMES.NOTICED_GENERIC, targetCloudId)],
            uiFeedback: {
                thoughtBubble: {
                    text: pickRandom(genericResponses),
                    cloudId
                }
            }
        };
    }

    private handleProtectorNoticingProtectee(protectorId: string, protecteeId: string): ControllerActionResult {
        const protecteeName = this.getPartName(protecteeId);
        const protecteeTrust = this.model.parts.getTrust(protecteeId);

        if (protecteeTrust < 1) {
            const burdenRecognitionResponses = [
                `I see how much ${protecteeName} is carrying. My job is so important.`,
                `${protecteeName} has been through so much. That's why I can't stop.`,
                `I feel ${protecteeName}'s pain. Someone has to protect them.`,
                `${protecteeName} is still hurting. I have to keep doing what I do.`,
                `I can see the burden ${protecteeName} carries. It's why I exist.`,
            ];
            return {
                success: true,
                stateChanges: [outcome(protectorId, OUTCOMES.PROTECTOR_RECOGNIZED_BURDEN, protecteeId)],
                uiFeedback: {
                    thoughtBubble: {
                        text: pickRandom(burdenRecognitionResponses),
                        cloudId: protectorId
                    }
                }
            };
        }

        this.model.parts.setUnburdened(protectorId);
        this.model.parts.setNeedAttention(protectorId, 0);

        const unburdenedJob = this.model.parts.getDialogues(protectorId)?.unburdenedJob;
        const response = unburdenedJob
            ? `I see that ${protecteeName} is okay now. ${unburdenedJob}`
            : `I see that ${protecteeName} is okay now. I don't need to protect them anymore.`;

        return {
            success: true,
            stateChanges: [outcome(protectorId, OUTCOMES.PROTECTOR_UNBURDENED)],
            uiFeedback: { thoughtBubble: { text: response, cloudId: protectorId } }
        };
    }

    private handleProtecteeNoticingProtector(protecteeId: string, protectorId: string): ControllerActionResult {
        const protectorName = this.getPartName(protectorId);
        const protecteeTrust = this.model.parts.getTrust(protecteeId);
        const protectorTrust = this.model.parts.getTrust(protectorId);

        const trustDiff = Math.abs(protecteeTrust - protectorTrust);
        const transferAmount = trustDiff * 0.5;

        if (protecteeTrust > protectorTrust) {
            this.model.parts.addTrust(protectorId, transferAmount);
            this.model.parts.addTrust(protecteeId, -transferAmount);
        } else {
            this.model.parts.addTrust(protecteeId, transferAmount);
            this.model.parts.addTrust(protectorId, -transferAmount);
        }

        const recognitionResponses = [
            `I see how hard ${protectorName} has been working to keep me safe.`,
            `${protectorName} has been protecting me all this time.`,
            `I understand now what ${protectorName} has been doing for me.`,
            `Thank you, ${protectorName}. I see your effort.`,
            `${protectorName} carries so much for my sake.`,
        ];

        return {
            success: true,
            stateChanges: [outcome(protecteeId, OUTCOMES.PROTECTEE_RECOGNIZED_PROTECTOR, protectorId)],
            uiFeedback: {
                thoughtBubble: {
                    text: pickRandom(recognitionResponses),
                    cloudId: protecteeId
                }
            }
        };
    }

    private handleAttackerNoticingVictim(attackerId: string, victimId: string): ControllerActionResult {
        if (!this.model.parts.isAttacked(victimId)) {
            return this.handleGenericNotice(attackerId, victimId);
        }

        const victimName = this.getPartName(victimId);

        this.model.changeNeedAttention(victimId, 0.5);

        const recognitionResponses = [
            `I hurt ${victimName}, but I had to.`,
            `I had to hurt ${victimName} to do my job.`,
            `I see the pain I caused ${victimName}. It was necessary.`,
            `${victimName} suffered because of me. I had no choice.`,
        ];

        return {
            success: true,
            stateChanges: [outcome(attackerId, OUTCOMES.ATTACKER_RECOGNIZED_HARM, victimId)],
            uiFeedback: {
                thoughtBubble: {
                    text: pickRandom(recognitionResponses),
                    cloudId: attackerId
                }
            }
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
                stateChanges: [outcome(cloudId, OUTCOMES.ALREADY_ANSWERED)],
                uiFeedback: { thoughtBubble: { text: pickRandom(ALREADY_TOLD_RESPONSES), cloudId } }
            };
        }

        const proxies = this.relationships.getProxies(cloudId);
        if (proxies.size > 0 && this.rng.random('ray_field:deflect') < 0.95) {
            const deflections = [
                "I don't trust you.",
                "Why should I tell you?",
                "You wouldn't understand.",
                "I'm not talking to you.",
                "Leave me alone."
            ];
            return {
                success: true,
                stateChanges: [outcome(cloudId, OUTCOMES.DEFLECTED)],
                uiFeedback: { thoughtBubble: { text: pickRandom(deflections), cloudId } }
            };
        }

        const highTrustFields: BiographyField[] = ['gratitude', 'compassion', 'jobAppraisal', 'jobImpact', 'age', 'identity'];
        if (highTrustFields.includes(field) && this.model.parts.getTrust(cloudId) >= 0.95) {
            this.model.parts.setNeedAttention(cloudId, 0);
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
                    response = pickRandom(COMPASSION_RECEIVED_RESPONSES);
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
                    response = pickRandom(gratitudeResponses);
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
                this.model.parts.revealJob(cloudId);
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

        if (this.rng.random('ray_field:clear_ray') < 0.25) {
            this.model.clearSelfRay();
        }

        const result: ControllerActionResult = {
            success: true,
            stateChanges: backlash
                ? [outcome(backlash.protectorId, OUTCOMES.TRIGGERED_BACKLASH, backlash.protecteeId)]
                : [outcome(cloudId, OUTCOMES.BIOGRAPHY_FIELD, field)],
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
                if (newProtectorTrust < this.rng.random('whatNeedToKnow:backlash_check')) {
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
            return pickRandom(NO_JOB_RESPONSES);
        }

        const dialogues = partState.dialogues.burdenedJobAppraisal;
        if (!dialogues || dialogues.length === 0) {
            this.model.parts.adjustTrust(cloudId, 0.95);
            return pickRandom(NO_JOB_RESPONSES);
        }

        this.model.parts.revealJobAppraisal(cloudId);
        this.model.parts.addTrust(cloudId, 0.05);
        return pickRandom(dialogues);
    }

    private handleJobImpactInternal(cloudId: string): string {
        const partState = this.model.getPartState(cloudId);
        if (!partState) return "...";

        if (!this.model.parts.isIdentityRevealed(cloudId)) {
            this.model.parts.adjustTrust(cloudId, 0.95);
            return pickRandom(NO_JOB_RESPONSES);
        }

        const dialogues = partState.dialogues.burdenedJobImpact;
        if (!dialogues || dialogues.length === 0) {
            this.model.parts.adjustTrust(cloudId, 0.95);
            return pickRandom(NO_JOB_RESPONSES);
        }

        this.model.parts.revealJobImpact(cloudId);
        this.model.parts.addTrust(cloudId, 0.05);
        return pickRandom(dialogues);
    }

    private handleApologizeInternal(cloudId: string): string {
        if (!this.model.parts.isAttacked(cloudId)) {
            this.model.parts.adjustTrust(cloudId, 0.98);
            const confused = [
                "For what?",
                "What are you apologizing for?",
                "I'm not upset with you.",
                "You haven't done anything wrong.",
            ];
            return pickRandom(confused);
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
        if (trust < 0.5 || this.rng.random('apologize:accept') > trust) {
            this.model.parts.adjustTrust(cloudId, 0.9);
            const rejections = [
                "It's going to take more than that.",
                "Words are easy. Show me you mean it.",
                "I'm not ready to forgive yet.",
            ];
            return pickRandom(rejections);
        }

        this.model.parts.clearAttacked(cloudId);
        this.model.parts.addTrust(cloudId, 0.2);
        const acceptances = [
            "Thank you. I appreciate that.",
            "I can tell you mean it. Thank you.",
            "That means a lot to me.",
        ];
        return pickRandom(acceptances);
    }

    private handleSpontaneousBlend(cloudId: string): ControllerActionResult {
        this.model.parts.setNeedAttention(cloudId, 0.95);
        this.model.partDemandsAttention(cloudId);
        return {
            success: true,
            stateChanges: [outcome(cloudId, OUTCOMES.SPONTANEOUSLY_BLENDED)]
        };
    }

    private handleBacklash(protectorId: string, protecteeId: string): ControllerActionResult {
        return {
            success: true,
            stateChanges: [outcome(protectorId, OUTCOMES.TRIGGERED_BACKLASH, protecteeId)],
            triggerBacklash: { protectorId, protecteeId }
        };
    }
}
