import type { RecordedAction } from './testability/types.js';

const KNOWN_ACTIONS = new Set([
    'join_conference',
    'step_back',
    'separate',
    'blend',
    'job',
    'feel_toward',
    'who_do_you_see',
    'help_protected',
    'notice_part',
    'ray_field_select',
    'spontaneous_blend',
    'backlash',
]);

export function isValidAction(actionId: string): boolean {
    return KNOWN_ACTIONS.has(actionId);
}

export function validateRecordedAction(action: RecordedAction, knownCloudIds: Set<string>): void {
    if (!isValidAction(action.action)) {
        throw new Error(`Unknown action: ${action.action}`);
    }
    if (!knownCloudIds.has(action.cloudId)) {
        throw new Error(`Unknown cloudId: ${action.cloudId}`);
    }
    if (action.targetCloudId && !knownCloudIds.has(action.targetCloudId)) {
        throw new Error(`Unknown targetCloudId: ${action.targetCloudId}`);
    }
}

export function formatActionLabel(
    action: RecordedAction,
    getPartName: (cloudId: string) => string
): string {
    const name = getPartName(action.cloudId);
    const targetName = action.targetCloudId ? getPartName(action.targetCloudId) : undefined;

    switch (action.action) {
        case 'join_conference':
            return `Click: ${name}`;

        case 'step_back':
            return `Step back: ${name}`;

        case 'separate':
            return `Separate: ${name}`;

        case 'blend':
            return `Blend: ${name}`;

        case 'job':
            return `Job: ${name}`;

        case 'feel_toward':
            return `Feel toward: ${name}`;

        case 'who_do_you_see':
            return `Who do you see: ${name}`;

        case 'help_protected':
            return `Help protected: ${name}`;

        case 'notice_part':
            if (targetName) {
                return `Notice: ${name} notices ${targetName}`;
            }
            return `Notice part: ${name}`;

        case 'ray_field_select':
            return `Ask ${action.field}: ${name}`;

        case 'spontaneous_blend':
            return `${name} demands attention`;

        case 'backlash':
            return `Backlash: ${name}`;

        default:
            throw new Error(`Unknown action: ${action.action}`);
    }
}
