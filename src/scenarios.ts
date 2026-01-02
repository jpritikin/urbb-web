import { CloudManager } from './cloudManager.js';
import { Cloud } from './cloudShape.js';
import type { RecordedSession } from './testability/types.js';

export interface Scenario {
    id: string;
    name: string;
    difficulty: 'Easy' | 'Medium' | 'Hard';
    estimatedMinutes: number;
    description: string;
    setup: (cloudManager: CloudManager) => void;
    recordedSessionPath?: string;
}

let recordedSessionCache: Map<string, RecordedSession> = new Map();

export async function loadRecordedSession(path: string): Promise<RecordedSession | null> {
    if (recordedSessionCache.has(path)) {
        return recordedSessionCache.get(path)!;
    }
    try {
        const response = await fetch(path);
        if (!response.ok) return null;
        const session = await response.json() as RecordedSession;
        recordedSessionCache.set(path, session);
        return session;
    } catch {
        return null;
    }
}

interface CoreParts {
    innerCritic: Cloud;
    criticized: Cloud;
}

function setupCoreParts(cloudManager: CloudManager): CoreParts {
    const innerCritic = cloudManager.addCloud('Inner Critic', {
        trust: 0.3,
        partAge: 8,
        dialogues: {
            burdenedJobAppraisal: [
                "I'm exhausted with my job.",
                "I don't want to criticize, but I have to.",
            ],
            burdenedJobImpact: [
                "I am harsh, but I help avoid critiques from outside.",
            ],
            unburdenedJob: "I help you foresee risks.",
        },
    });

    const criticized = cloudManager.addCloud('criticized one', {
        partAge: 'child',
        trust: 0.2,
        dialogues: {
            genericBlendedDialogues: [
                "Please don't look at me.",
                "I'm trying to hide.",
                "Is it safe?",
            ],
        },
    });

    const relationships = cloudManager.getRelationships();
    relationships.addProtection(innerCritic.id, criticized.id);
    relationships.setGrievance(innerCritic.id, [innerCritic.id], [
        "I'm a terrible person.",
        "I hate myself."
    ]);

    return { innerCritic, criticized };
}

function setupEasyScenario(cloudManager: CloudManager): void {
    setupCoreParts(cloudManager);
}

function setupMediumScenario(cloudManager: CloudManager): void {
    const { innerCritic, criticized } = setupCoreParts(cloudManager);

    const threeYearOld = cloudManager.addCloud('toddler', {
        partAge: 3,
        dialogues: {
            genericBlendedDialogues: [
                "Play with me!",
                "I want attention!",
                "Why?",
            ],
        },
    });

    const adult = cloudManager.addCloud('self-image', {
        partAge: 'adult',
        dialogues: {
            genericBlendedDialogues: [
                "I need to maintain appearances.",
                "What will people think?",
                "I should have it together by now.",
            ],
        },
    });

    const relationships = cloudManager.getRelationships();
    relationships.setGrievance(innerCritic.id, [threeYearOld.id], [
        "You got us criticized.",
        "You always make mistakes.",
        "Don't do anything risky.",
        "Be careful or you'll embarrass yourself.",
    ]);

    relationships.addProxy(innerCritic.id, adult.id);
    relationships.addProxy(criticized.id, adult.id);
    relationships.addProxy(threeYearOld.id, adult.id);
}

export const SCENARIOS: Scenario[] = [
    {
        id: 'easy',
        name: 'Inner Critic',
        difficulty: 'Easy',
        estimatedMinutes: 1,
        description: 'A protector-exile pair. Learn the basics of IFS.',
        setup: setupEasyScenario,
        recordedSessionPath: '/recordings/protectorBacklash.json',
    },
    {
        id: 'medium',
        name: 'Self Proxies',
        difficulty: 'Medium',
        estimatedMinutes: 5,
        description: 'Deal with proxy relationships while addressing the Inner Critic.',
        setup: setupMediumScenario,
        recordedSessionPath: '/recordings/criticWithProxy.json',
    },
];
