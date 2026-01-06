export type SelfReaction = 'shrug' | 'gratitude' | 'compassion' | null;

export interface PartBiography {
    ageRevealed: boolean;
    partAge: number | string | null;
    protectsRevealed: boolean;
    selfReaction: SelfReaction;
    relationshipsRevealed: boolean;
    identityRevealed: boolean;
    unburdened: boolean;
    jobRevealed: boolean;
    jobAppraisalRevealed: boolean;
    jobImpactRevealed: boolean;
    consentedToHelp: boolean;
}

export interface PartDialogues {
    burdenedJobAppraisal?: string[];
    burdenedJobImpact?: string[];
    unburdenedJob?: string;
    gratitudeResponse?: string;
    compassionResponse?: string;
    genericBlendedDialogues?: string[];
}

export interface PartState {
    id: string;
    name: string;
    trust: number;
    needAttention: number;
    wasProxy: boolean;
    biography: PartBiography;
    dialogues: PartDialogues;
}

export function createPartState(id: string, name: string, options?: {
    trust?: number;
    needAttention?: number;
    partAge?: number | string;
    dialogues?: PartDialogues;
}): PartState {
    return {
        id,
        name,
        trust: options?.trust ?? 0.5,
        needAttention: options?.needAttention ?? 0.1,
        wasProxy: false,
        biography: {
            ageRevealed: false,
            partAge: options?.partAge ?? null,
            protectsRevealed: false,
            selfReaction: null,
            relationshipsRevealed: false,
            identityRevealed: false,
            unburdened: false,
            jobRevealed: false,
            jobAppraisalRevealed: false,
            jobImpactRevealed: false,
            consentedToHelp: false,
        },
        dialogues: options?.dialogues ?? {},
    };
}
