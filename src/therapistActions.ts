export interface TherapistAction {
    id: string;
    question: string;
    shortName: string;
    category: 'discovery' | 'relationship' | 'history' | 'role';
}

export const THERAPIST_ACTIONS: TherapistAction[] = [
    { id: 'feel_toward', question: 'How do you feel toward this part?', shortName: 'Feel', category: 'relationship' },
    { id: 'who_do_you_see', question: 'Who do you see when you look at the client?', shortName: 'Who?', category: 'discovery' },
    { id: 'job', question: "What is this part's job?", shortName: 'Job', category: 'role' },
    { id: 'join_conference', question: 'Can this part join the conference?', shortName: 'Join', category: 'relationship' },
    { id: 'separate', question: 'Can you ask that part to separate a bit and sit next to you?', shortName: 'Separate', category: 'relationship' },
    { id: 'step_back', question: 'Can you ask this part to step back?', shortName: 'Step back', category: 'relationship' },
    { id: 'blend', question: 'Can you blend with this part?', shortName: 'Blend', category: 'relationship' },
];
