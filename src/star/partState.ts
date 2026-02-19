export type SelfReaction = 'shrug' | 'gratitude' | 'compassion' | null;

export interface PartBiography {
    ageRevealed: boolean;
    partAge: number | string | null;
    protectsRevealed: boolean;
    selfReaction: SelfReaction;
    relationshipsRevealed: boolean;
    identityRevealed: boolean;
    jobRevealed: boolean;
    jobAppraisalRevealed: boolean;
    consentedToHelp: boolean;
}

export interface PartDialogues {
    burdenedJobAppraisal?: string[];
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
    wasProtector: boolean;
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
        wasProtector: false,
        biography: {
            ageRevealed: false,
            partAge: options?.partAge ?? null,
            protectsRevealed: false,
            selfReaction: null,
            relationshipsRevealed: false,
            identityRevealed: false,
            jobRevealed: false,
            jobAppraisalRevealed: false,
            consentedToHelp: false,
        },
        dialogues: options?.dialogues ?? {},
    };
}
