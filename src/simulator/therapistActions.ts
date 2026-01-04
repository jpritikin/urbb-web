export interface TherapistAction {
    id: string;
    question: string;
    shortName: string;
    category: 'discovery' | 'relationship' | 'history' | 'role';
}

export const STAR_MENU_ACTIONS: TherapistAction[] = [
    { id: 'feel_toward', question: 'How do you feel toward?', shortName: 'Feel', category: 'relationship' },
    { id: 'expand_deepen', question: 'Feel calm and patient. Allow this feeling to expand and deepen.', shortName: 'Expand', category: 'relationship' },
];

export const CLOUD_MENU_ACTIONS: TherapistAction[] = [
    { id: 'notice_part', question: 'What do you notice about that part?', shortName: 'Notice', category: 'discovery' },
    { id: 'who_do_you_see', question: 'Who do you see when you look at the client?', shortName: 'Who?', category: 'discovery' },
    { id: 'job', question: "What is your job?", shortName: 'Job', category: 'role' },
    { id: 'join_conference', question: 'Can $PART join the conference?', shortName: 'Join', category: 'relationship' },
    { id: 'separate', question: 'Can you ask $PART to separate a bit and sit next to you?', shortName: 'Separate', category: 'relationship' },
    { id: 'be_with', question: 'Let $PART know that you are here with it.', shortName: 'Be with', category: 'relationship' },
    { id: 'step_back', question: 'Can you ask $PART to step back?', shortName: 'Step back', category: 'relationship' },
    { id: 'blend', question: 'Can you blend with $PART?', shortName: 'Blend', category: 'relationship' },
    { id: 'help_protected', question: 'If we could help $PROTECTED, would you be interested in that?', shortName: 'Help?', category: 'relationship' },
    { id: 'validate', question: "Reflect and validate the part's behavior.", shortName: 'Validate', category: 'relationship' },
];

export const SELFRAY_MENU_ACTIONS: TherapistAction[] = [
    { id: 'age', question: 'How old are you?', shortName: 'Age', category: 'discovery' },
    { id: 'identity', question: 'Who are you?', shortName: 'Identity', category: 'discovery' },
    { id: 'jobAppraisal', question: 'How do you like your job?', shortName: 'Appraisal', category: 'discovery' },
    { id: 'jobImpact', question: 'How do you understand the impact of your job?', shortName: 'Impact', category: 'discovery' },
    { id: 'whatNeedToKnow', question: 'What do you need?', shortName: 'Need?', category: 'discovery' },
    { id: 'gratitude', question: 'Thank you for being here', shortName: 'Gratitude', category: 'relationship' },
    { id: 'compassion', question: 'I care about you', shortName: 'Compassion', category: 'relationship' },
    { id: 'apologize', question: 'Apologize for allowing other parts to attack', shortName: 'Apologize', category: 'relationship' },
];

export const ALL_ACTION_IDS = [...STAR_MENU_ACTIONS, ...CLOUD_MENU_ACTIONS, ...SELFRAY_MENU_ACTIONS].map(a => a.id);

export const STAR_ACTION_IDS = new Set(STAR_MENU_ACTIONS.map(a => a.id));
export const CLOUD_ACTION_IDS = new Set(CLOUD_MENU_ACTIONS.map(a => a.id));
export const SELFRAY_ACTION_IDS = new Set(SELFRAY_MENU_ACTIONS.map(a => a.id));

export function isStarMenuAction(actionId: string): boolean {
    return STAR_ACTION_IDS.has(actionId);
}

export function isCloudMenuAction(actionId: string): boolean {
    return CLOUD_ACTION_IDS.has(actionId);
}

export function isSelfRayMenuAction(actionId: string): boolean {
    return SELFRAY_ACTION_IDS.has(actionId);
}
