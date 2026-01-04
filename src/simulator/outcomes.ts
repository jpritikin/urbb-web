// Canonical outcome identifiers for actions
// Used by SimulatorController to generate stateChanges
// Used by coverage tools to enumerate all possible outcomes

export const OUTCOMES = {
    // Conference management
    SELECTED_AS_TARGET: 'selected_as_target',
    JOINED_CONFERENCE: 'joined_conference',
    STEPPED_BACK: 'stepped_back',
    WANTED_TO_WATCH: 'wanted_to_watch',

    // Blending
    BLENDED: 'blended',
    SEPARATING: 'separating',
    SPONTANEOUSLY_BLENDED: 'spontaneously_blended',
    ACCOMPANIED: 'accompanied',

    // Help/consent
    CONSENTED_TO_HELP: 'consented_to_help',
    REFUSED_TO_HELP: 'refused_to_help',

    // Identity/revelation
    IDENTITY_REVEALED: 'identity_revealed',
    REGARD_PART: 'regard_part',
    REVEALED_JOB: 'revealed_job',
    ALREADY_ANSWERED: 'already_answered',

    // Proxies
    PROXIES_CLEARED: 'proxies_cleared',
    BLENDED_AS_PROXY: 'blended_as_proxy',

    // Ray field outcomes
    DEFLECTED: 'deflected',
    BIOGRAPHY_FIELD: 'biography_field',

    // notice_part outcomes
    NOTICED_SELF: 'noticed_self',
    NOTICED_GENERIC: 'noticed_generic',
    PROTECTOR_RECOGNIZED_BURDEN: 'protector_recognized_burden',
    PROTECTOR_UNBURDENED: 'protector_unburdened',
    PROTECTEE_RECOGNIZED_PROTECTOR: 'protectee_recognized_protector',
    ATTACKER_RECOGNIZED_HARM: 'attacker_recognized_harm',

    // Backlash
    TRIGGERED_BACKLASH: 'triggered_backlash',

    // Pending
    PENDING_BLEND: 'pending_blend',

    // No-op / failures
    NO_CHANGE: 'no_change',
    NOT_PROTECTOR: 'not_protector',

    // Separate outcomes
    UNBLENDED: 'unblended',

    // Validate outcomes
    VALIDATED: 'validated',
    VALIDATE_FAILED: 'validate_failed',
} as const;

export type Outcome = typeof OUTCOMES[keyof typeof OUTCOMES];

// Map from action to its possible outcomes
export const ACTION_OUTCOMES: Record<string, Outcome[]> = {
    select_a_target: [OUTCOMES.SELECTED_AS_TARGET],
    join_conference: [OUTCOMES.JOINED_CONFERENCE],
    step_back: [OUTCOMES.STEPPED_BACK, OUTCOMES.WANTED_TO_WATCH],
    blend: [OUTCOMES.BLENDED],
    separate: [OUTCOMES.SEPARATING, OUTCOMES.UNBLENDED],
    be_with: [OUTCOMES.ACCOMPANIED],
    spontaneous_blend: [OUTCOMES.SPONTANEOUSLY_BLENDED],

    job: [OUTCOMES.REVEALED_JOB, OUTCOMES.ALREADY_ANSWERED],

    help_protected: [OUTCOMES.CONSENTED_TO_HELP, OUTCOMES.REFUSED_TO_HELP],

    who_do_you_see: [
        OUTCOMES.IDENTITY_REVEALED,
        OUTCOMES.PROXIES_CLEARED,
        OUTCOMES.BLENDED_AS_PROXY,
        OUTCOMES.NO_CHANGE,
    ],

    feel_toward: [
        OUTCOMES.REGARD_PART,
    ],

    expand_deepen: [],

    notice_part: [
        OUTCOMES.NOTICED_SELF,
        OUTCOMES.NOTICED_GENERIC,
        OUTCOMES.PROTECTOR_RECOGNIZED_BURDEN,
        OUTCOMES.PROTECTOR_UNBURDENED,
        OUTCOMES.PROTECTEE_RECOGNIZED_PROTECTOR,
        OUTCOMES.ATTACKER_RECOGNIZED_HARM,
    ],

    ray_field_select: [
        OUTCOMES.BIOGRAPHY_FIELD,
        OUTCOMES.DEFLECTED,
        OUTCOMES.ALREADY_ANSWERED,
        OUTCOMES.TRIGGERED_BACKLASH,
    ],

    validate: [
        OUTCOMES.VALIDATED,
        OUTCOMES.VALIDATE_FAILED,
    ],
};

// Helper to format stateChange string
export function outcome(cloudId: string, outcomeKey: Outcome, extra?: string): string {
    if (extra) {
        return `${cloudId}:${outcomeKey}:${extra}`;
    }
    return `${cloudId}:${outcomeKey}`;
}

// Helper to parse stateChange string back to outcome
export function parseOutcome(stateChange: string): { cloudId: string; outcome: Outcome; extra?: string } | null {
    const parts = stateChange.split(':');
    if (parts.length < 2) return null;
    return {
        cloudId: parts[0],
        outcome: parts[1] as Outcome,
        extra: parts[2],
    };
}
