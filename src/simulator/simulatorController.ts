import { SimulatorModel } from './ifsModel.js';
import { PartStateManager } from '../cloud/partStateManager.js';
import { RNG, pickRandom } from '../playback/testability/rng.js';
import { OUTCOMES, outcome } from './outcomes.js';
import type { ControllerActionResult } from '../playback/testability/types.js';
import type { BiographyField } from '../star/selfRay.js';
import { STAR_CLOUD_ID } from './view/SeatManager.js';

export interface ControllerDependencies {
    getModel: () => SimulatorModel;
    getRelationships: () => PartStateManager;
    rng: RNG;
    getPartName: (cloudId: string) => string;
}

export interface ActionOptions {
    targetCloudId?: string;
    field?: BiographyField;
    isBlended?: boolean;
    stanceDelta?: number;
}

export interface ValidAction {
    action: string;
    cloudId: string;
    targetCloudId?: string;
    field?: BiographyField;
    stanceDelta?: number;
}

export const ALL_RAY_FIELDS: BiographyField[] = [
    'age', 'identity', 'jobAppraisal', 'gratitude', 'compassion'
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

const VALIDATE_FAILURE_RESPONSES = [
    "That doesn't resonate.",
    "What are you talking about?",
    "That's not what I meant.",
    "You're not listening.",
];

export class SimulatorController {
    private getModel: () => SimulatorModel;
    private getRelationships: () => PartStateManager;
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

    private get relationships(): PartStateManager {
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

        actions.push({ action: 'add_target', cloudId: STAR_CLOUD_ID });

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

        // be_with
        if (isBlended) {
            actions.push({ action: 'be_with', cloudId });
        }

        // validate
        if (isBlended) {
            actions.push({ action: 'validate', cloudId });
        }

        // step_back
        if (inConference && !isSpontaneousBlend) {
            actions.push({ action: 'step_back', cloudId });
        }

        // job
        if (isTarget || isBlended) {
            actions.push({ action: 'job', cloudId });
        }

        // blend
        if (isTarget && !isBlended) {
            actions.push({ action: 'blend', cloudId });
        }

        // help_protected
        if (isTarget && protectedIds.size > 0 && this.model.parts.isIdentityRevealed(cloudId)) {
            actions.push({ action: 'help_protected', cloudId });
        }

        // nudge_stance: available when conversation is active and part is a participant
        if (this.model.isConversationInitialized()) {
            const participants = this.model.getConversationParticipantIds();
            if (participants && (participants[0] === cloudId || participants[1] === cloudId)) {
                actions.push({ action: 'nudge_stance', cloudId });
            }
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

        fields.push('age', 'identity', 'gratitude', 'compassion');

        const isFormerProtector = this.model.parts.isFormerProtector(cloudId);
        const showJobQuestions = !isIdentityRevealed || isProtector || isFormerProtector;
        if (showJobQuestions) {
            fields.push('jobAppraisal');
        }

        return fields;
    }

    private calculateTrustGain(cloudId: string): number {
        const openness = this.model.parts.getOpenness(cloudId);
        const targetCount = Math.max(1, this.model.getTargetCloudIds().size);
        return openness / targetCount;
    }

    private checkBacklash(cloudId: string, trustGain: number, rngLabel: string): { protectorId: string; protecteeId: string; extras: string[] } | undefined {
        const protectorIds = this.relationships.getProtectedBy(cloudId);
        const triggered: string[] = [];
        for (const protectorId of protectorIds) {
            if (!this.model.parts.hasConsentedToHelp(protectorId)) {
                const protectorTrust = this.model.parts.getTrust(protectorId);
                const newProtectorTrust = protectorTrust - trustGain / 2;
                this.model.parts.setTrust(protectorId, newProtectorTrust);
                if (newProtectorTrust / 2 < this.rng.random(rngLabel)) {
                    triggered.push(protectorId);
                }
            }
        }
        if (triggered.length > 0) {
            const pickIndex = Math.floor(this.rng.random(rngLabel + ':pick') * triggered.length);
            const pick = triggered[pickIndex];
            const extras = triggered.filter((_, i) => i !== pickIndex);
            return { protectorId: pick, protecteeId: cloudId, extras };
        }
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

            case 'be_with':
                return this.handleBeWith(cloudId);

            case 'blend':
                return this.handleBlend(cloudId);

            case 'job':
                return this.handleJob(cloudId, options?.isBlended ?? this.model.isBlended(cloudId));

            case 'help_protected':
                return this.handleHelpProtected(cloudId);

            case 'feel_toward':
                if (options?.targetCloudId) {
                    return this.handleFeelToward(options.targetCloudId);
                }
                this.model.setPendingAction({ actionId: 'feel_toward', sourceCloudId: cloudId });
                return { success: true, stateChanges: [] };

            case 'expand_deepen':
                return this.handleExpandDeepen();

            case 'add_target':
                this.model.setPendingAction({ actionId: 'add_target', sourceCloudId: STAR_CLOUD_ID });
                this.model.setMode('panorama');
                return { success: true, stateChanges: [] };

            case 'notice_part':
                if (options?.targetCloudId) {
                    return this.handleNoticePart(cloudId, options.targetCloudId);
                }
                this.model.setPendingAction({ actionId: 'notice_part', sourceCloudId: cloudId });
                return { success: true, stateChanges: [] };

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

            case 'validate':
                return this.handleValidate(cloudId);

            case 'nudge_stance': {
                const delta = options?.stanceDelta ?? 0;
                this.model.addTherapistStanceDelta(cloudId, delta);
                return {
                    success: true,
                    stateChanges: [outcome(cloudId, OUTCOMES.STANCE_NUDGED)]
                };
            }

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

        this.model.removeFromConference(cloudId);
        return {
            success: true,
            stateChanges: [outcome(cloudId, OUTCOMES.STEPPED_BACK)]
        };
    }

    private handleSeparate(cloudId: string, isBlended: boolean): ControllerActionResult {
        if (!isBlended) {
            // Part may have been promoted to target while menu was open (timing race)
            if (this.model.isTarget(cloudId)) {
                return { success: true, stateChanges: [outcome(cloudId, OUTCOMES.UNBLENDED)] };
            }
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

    private handleBeWith(cloudId: string): ControllerActionResult {
        if (this.model.parts.isBeWithUsed(cloudId)) {
            return {
                success: true,
                stateChanges: [outcome(cloudId, OUTCOMES.NO_CHANGE)],
                uiFeedback: { thoughtBubble: { text: "*Shrug*", cloudId } }
            };
        }

        this.model.parts.markBeWithUsed(cloudId);
        this.model.parts.addTrust(cloudId, 0.1);
        const currentNeed = this.model.parts.getNeedAttention(cloudId);
        this.model.parts.setNeedAttention(cloudId, currentNeed * 0.9);
        return {
            success: true,
            stateChanges: [outcome(cloudId, OUTCOMES.ACCOMPANIED)],
            uiFeedback: { thoughtBubble: { text: '🤗', cloudId } }
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
        if (this.model.parts.isFormerProtector(cloudId)) {
            const unburdenedJob = this.model.parts.getDialogues(cloudId)?.unburdenedJob;
            if (unburdenedJob) return unburdenedJob;
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

    private handleNoticeSelf(cloudId: string): ControllerActionResult {
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
            const proxyId = this.rng.pickRandom(Array.from(proxies), 'who_do_you_see:ack_proxy');
            const proxyName = this.getPartName(proxyId);
            return {
                success: true,
                stateChanges: [],
                uiFeedback: { thoughtBubble: { text: `I see ${proxyName}.`, cloudId } }
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
        const hostileTargets = this.relationships.getHostileRelationTargets(cloudId);
        const targetIds = this.model.getTargetCloudIds();
        const blendedParts = this.model.getBlendedParts();
        const blendedResponses: { cloudId: string; response: string }[] = [];

        for (const blendedId of blendedParts) {
            if (this.relationships.hasHostileRelation(blendedId, cloudId)) {
                const dialogue = this.relationships.getInterPartDialogue(blendedId, cloudId, 'speak', () => this.rng.random('dialogue_pick'));
                if (dialogue) {
                    blendedResponses.push({ cloudId: blendedId, response: dialogue });
                }
            } else {
                const dialogues = this.model.parts.getDialogues(blendedId).genericBlendedDialogues;
                if (dialogues && dialogues.length > 0) {
                    blendedResponses.push({ cloudId: blendedId, response: pickRandom(dialogues) });
                }
            }
        }

        for (const hostileId of hostileTargets) {
            const isPending = this.model.isPendingBlend(hostileId);
            if (!targetIds.has(hostileId) && !blendedParts.includes(hostileId) && !isPending) {
                if (this.model.parts.getTrust(hostileId) < 0.5) {
                    this.model.enqueuePendingBlend(hostileId, 'therapist');
                    stateChanges.push(outcome(hostileId, OUTCOMES.PENDING_BLEND));
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
        if (targetCloudId === STAR_CLOUD_ID) {
            return this.handleNoticeSelf(cloudId);
        }
        if (cloudId === targetCloudId) {
            return this.handleSelfNotice(cloudId);
        }

        const protectedByMe = this.relationships.getProtecting(cloudId);
        const myProtectors = this.relationships.getProtectedBy(cloudId);

        let result: ControllerActionResult;

        if (protectedByMe.has(targetCloudId)) {
            result = this.handleProtectorNoticingProtectee(cloudId, targetCloudId);
        } else if (myProtectors.has(targetCloudId)) {
            result = this.handleProtecteeNoticingProtector(cloudId, targetCloudId);
        } else {
            if (this.relationships.hasInterPartRelation(cloudId, targetCloudId)) {
                result = this.handleImpactRecognition(cloudId, targetCloudId);
            } else {
                const partsIHurt = this.relationships.getHostileRelationTargets(cloudId);
                if (partsIHurt.has(targetCloudId)) {
                    result = this.handleAttackerNoticingVictim(cloudId, targetCloudId);
                } else {
                    result = this.handleGenericNotice(cloudId, targetCloudId);
                }
            }
        }

        return result;
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

        if (protecteeTrust < 0.95) {
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

        this.relationships.removeProtection(protectorId, protecteeId);
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
        return this.handleGenericNotice(attackerId, victimId);
    }

    private handleImpactRecognition(cloudId: string, targetCloudId: string): ControllerActionResult {
        const protectorName = this.getPartName(targetCloudId);
        const rel = this.relationships.getInterPartRelation(cloudId, targetCloudId);
        if (rel && rel.trustFloor > 0) {
            this.model.parts.adjustTrust(cloudId, 0.98);
            return {
                success: true,
                stateChanges: [outcome(cloudId, OUTCOMES.ALREADY_ANSWERED)],
                uiFeedback: { thoughtBubble: { text: `Yes, I already understand ${protectorName}'s intent.`, cloudId } }
            };
        }

        const noticerTrust = this.model.parts.getTrust(cloudId);
        const protectorTrust = this.model.parts.getTrust(targetCloudId);

        const genericSuccess = [
            `I can see ${protectorName} is trying to help, even if it hurts.`,
            `Maybe ${protectorName} doesn't know another way.`,
            `I think ${protectorName} is scared too.`,
        ];
        const genericFailure = [
            `I don't trust ${protectorName}. Not yet.`,
            `${protectorName} only makes things worse.`,
            `I can't see past what ${protectorName} does to me.`,
        ];

        const interPartTrust = rel?.trust ?? 0;
        if (noticerTrust >= protectorTrust && interPartTrust >= 0.5) {
            const pool = rel?.impactRecognition ?? genericSuccess;
            this.relationships.setInterPartTrustFloor(cloudId, targetCloudId, 0.25);
            return {
                success: true,
                stateChanges: [outcome(cloudId, OUTCOMES.RECOGNIZED_PROTECTOR_IMPACT, targetCloudId)],
                uiFeedback: { thoughtBubble: { text: pickRandom(pool), cloudId } }
            };
        }

        const pool = rel?.impactRejection ?? genericFailure;
        return {
            success: true,
            stateChanges: [outcome(cloudId, OUTCOMES.IMPACT_RECOGNITION_FAILED, targetCloudId)],
            uiFeedback: { thoughtBubble: { text: pickRandom(pool), cloudId } }
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

        const highTrustFields: BiographyField[] = ['gratitude', 'compassion', 'jobAppraisal', 'age', 'identity'];
        const selfRelationHealed = this.model.parts.getMinInterPartTrust(cloudId) >= 1;
        if (highTrustFields.includes(field) && this.model.parts.getTrust(cloudId) >= 0.95 && selfRelationHealed) {
            this.model.parts.setNeedAttention(cloudId, 0);
            return {
                success: true,
                stateChanges: [],
                uiFeedback: { thoughtBubble: { text: "Thanks, but there are other parts that need your attention more urgently.", cloudId } }
            };
        }

        let response: string | null = null;
        let trustGain = 0;
        let backlash: { protectorId: string; protecteeId: string; extras: string[] } | undefined;

        switch (field) {
            case 'compassion': {
                const isProtector = this.relationships.getProtecting(cloudId).size > 0;
                trustGain = this.calculateTrustGain(cloudId);
                if (isProtector) {
                    trustGain *= 0.25;
                }
                backlash = this.checkBacklash(cloudId, trustGain, 'compassion:backlash_check');
                if (!backlash) {
                    this.model.parts.addTrust(cloudId, trustGain);
                    const trust = this.model.parts.getTrust(cloudId);
                    response = trust >= 1 ? "I feel understood." : pickRandom(COMPASSION_RECEIVED_RESPONSES);
                } else {
                    response = "*Shrug*";
                    trustGain = 0;
                }
                break;
            }

            case 'gratitude': {
                const isFormerProtector = this.model.parts.isFormerProtector(cloudId);
                const stillProtecting = this.relationships.getProtecting(cloudId).size > 0;
                if (stillProtecting && !this.model.parts.isJobAppraisalRevealed(cloudId)) {
                    response = "You don't even know what I do.";
                    this.model.parts.adjustTrust(cloudId, 0.95);
                    break;
                }
                if (stillProtecting) {
                    trustGain = this.calculateTrustGain(cloudId);
                    backlash = this.checkBacklash(cloudId, trustGain, 'gratitude:backlash_check');
                    if (!backlash) {
                        this.model.parts.addTrust(cloudId, trustGain);
                        const protecteeIds = this.relationships.getProtecting(cloudId);
                        const protecteeName = protecteeIds.size > 0
                            ? this.getPartName([...protecteeIds][0])
                            : null;
                        if (this.model.parts.getTrust(cloudId) >= 0.95 && protecteeName) {
                            response = `Thank you. But I can't stop yet — I'm still watching over ${protecteeName}.`;
                        } else {
                            const gratitudeResponses = [
                                "I'm not used to being appreciated. Thank you.",
                                "This is unfamiliar. No one ever thanks me.",
                                "You're grateful? That's new.",
                                "I've been working so hard for so long. Thank you for noticing.",
                            ];
                            response = pickRandom(gratitudeResponses);
                        }
                    } else {
                        trustGain = 0;
                    }
                } else if (isFormerProtector) {
                    const selfTrust = this.model.parts.getTrust(cloudId);
                    const totalGain = this.calculateTrustGain(cloudId);
                    const selfRelationShare = selfTrust * selfTrust;
                    const selfPartGain = totalGain * (1 - selfRelationShare);
                    const selfRelationGain = totalGain * selfRelationShare;
                    this.model.parts.addTrust(cloudId, selfPartGain);
                    this.model.parts.addInterPartTrust(cloudId, cloudId, selfRelationGain, () => this.rng.random('self_relation_trust'));
                    const selfRelTrust = this.model.parts.getInterPartTrust(cloudId, cloudId);
                    if (selfRelTrust >= 1) {
                        response = "I forgive myself. I was doing my best.";
                    } else {
                        const gratitudeResponses = [
                            "Maybe I'm not so terrible after all.",
                            "Thank you... I'm starting to believe it.",
                            "It's hard to accept, but thank you.",
                        ];
                        response = pickRandom(gratitudeResponses);
                    }
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
                backlash = this.checkBacklash(cloudId, 0.05, 'jobAppraisal:backlash_check');
                if (!backlash) {
                    response = this.handleJobAppraisalInternal(cloudId);
                }
                break;

            case 'age':
                backlash = this.checkBacklash(cloudId, 0.05, 'age:backlash_check');
                if (!backlash) {
                    response = this.revealAge(cloudId);
                    this.model.parts.addTrust(cloudId, 0.05);
                }
                break;

            case 'identity':
                response = this.revealIdentity(cloudId);
                backlash = this.checkBacklash(cloudId, 0.05, 'identity:backlash_check');
                if (!backlash) {
                    this.model.parts.addTrust(cloudId, 0.05);
                }
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
        this.model.changeNeedAttention(cloudId, -0.3);
        return pickRandom(dialogues);
    }

    private handleSpontaneousBlend(cloudId: string): ControllerActionResult {
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
            triggerBacklash: { protectorId, protecteeId, extras: [] }
        };
    }

    private handleValidate(cloudId: string): ControllerActionResult {
        const bubble = this.model.getThoughtBubbles().find(b => b.cloudId === cloudId && !b.validated && b.partInitiated);
        if (!bubble) {
            this.model.parts.addTrust(cloudId, -0.1);
            return {
                success: true,
                stateChanges: [outcome(cloudId, OUTCOMES.VALIDATE_FAILED)],
                uiFeedback: {
                    thoughtBubble: { text: pickRandom(VALIDATE_FAILURE_RESPONSES), cloudId }
                }
            };
        }

        const trust = this.model.parts.getTrust(cloudId);
        const trustGain = 0.2 * (1 - trust);
        this.model.parts.addTrust(cloudId, trustGain);
        this.model.validateThoughtBubble(bubble.id, 5);

        return {
            success: true,
            stateChanges: [outcome(cloudId, OUTCOMES.VALIDATED)],
            trustGain
        };
    }
}
