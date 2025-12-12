export type SelfReaction = 'shrug' | 'gratitude' | 'compassion' | null;

export interface PartBiography {
    ageRevealed: boolean;
    partAge: number | string | null;
    protectsRevealed: boolean;
    selfReaction: SelfReaction;
    relationshipsRevealed: boolean;
    identityRevealed: boolean;
    jobRevealed: boolean;
}

export interface PartDialogues {
    burdenedProtector?: string[];
    burdenedGrievance?: string[];
    unburdenedJob?: string;
}

export interface PartState {
    id: string;
    name: string;
    trust: number;
    needAttention: number;
    agreedWaitUntil: number;
    wasProxy: boolean;
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
        biography: {
            ageRevealed: false,
            partAge: options?.partAge ?? null,
            protectsRevealed: false,
            selfReaction: null,
            relationshipsRevealed: false,
            identityRevealed: false,
            jobRevealed: false,
        },
        dialogues: options?.dialogues ?? {},
    };
}
