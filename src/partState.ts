export type SelfReaction = 'shrug' | 'gratitude' | 'compassion' | null;

export interface PartBiography {
    ageRevealed: boolean;
    partAge: number | string | null;
    protectsRevealed: boolean;
    selfReaction: SelfReaction;
    relationshipsRevealed: boolean;
    identityRevealed: boolean;
    unburdenedJobRevealed: boolean;
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
    agreedWaitUntil: number;
    wasProxy: boolean;
    attacked: boolean;
    biography: PartBiography;
    dialogues: PartDialogues;
}

export function createPartState(id: string, name: string, options?: {
    trust?: number;
    needAttention?: number;
    agreedWaitUntil?: number;
    partAge?: number | string;
    dialogues?: PartDialogues;
}): PartState {
    const waitDuration = options?.agreedWaitUntil ?? 10;
    return {
        id,
        name,
        trust: options?.trust ?? 0.5,
        needAttention: options?.needAttention ?? 0.1,
        agreedWaitUntil: Date.now() + waitDuration * 1000,
        wasProxy: false,
        attacked: false,
        biography: {
            ageRevealed: false,
            partAge: options?.partAge ?? null,
            protectsRevealed: false,
            selfReaction: null,
            relationshipsRevealed: false,
            identityRevealed: false,
            unburdenedJobRevealed: false,
            jobAppraisalRevealed: false,
            jobImpactRevealed: false,
            consentedToHelp: false,
        },
        dialogues: options?.dialogues ?? {},
    };
}
