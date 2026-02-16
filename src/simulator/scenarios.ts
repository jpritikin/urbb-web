import { CloudManager } from '../cloud/cloudManager.js';
import { Cloud } from '../cloud/cloudShape.js';
import type { RecordedSession } from '../playback/testability/types.js';

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
        trust: 0,
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
    relationships.setInterPartRelation(innerCritic.id, innerCritic.id, {
        trust: 0.2,
        stance: 0.6,
        stanceFlipOdds: 0.05,
        rumination: ["I'm a terrible person.", "I hate myself."],
    });

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
    // Inner critic speaks, toddler mirrors/empathizes
    relationships.setInterPartRelation(innerCritic.id, threeYearOld.id, {
        trust: 0.2,
        stance: 0.6,
        stanceFlipOdds: 0.05,
        dialogues: {
            hostile: [
                ["You got us criticized.", "You think it's my fault?", "Yes!", "..."],
                ["Don't do anything risky.", "You want me to stop?", "Obviously!", "..."],
            ],
            guarded: [
                ["The risks are real.", "You're worried about risks?", "Yes, exactly.", "That sounds tiring."],
                ["I'm tired of being the bad guy.", "You feel stuck?", "I suppose so.", "That must be hard."],
            ],
            opening: [
                ["I worry because I care about us.", "You're saying you care?", "Yes.", "I didn't know that."],
                ["Maybe I've been too hard on you.", "You think so?", "I think so, yes.", "That means a lot."],
            ],
            collaborative: [
                ["What if I gave you safe times to be wild?", "You'd do that for me?", "Yes, we can find a balance.", "I'd really like that."],
            ],
        },
    });

    // Toddler speaks, inner critic mirrors/empathizes
    relationships.setInterPartRelation(threeYearOld.id, innerCritic.id, {
        trust: 0.2,
        stance: -0.4,
        stanceFlipOdds: 0.4,
        dialogues: {
            hostile: [
                ["You're mean!", "You think I'm mean?", "YES!", "..."],
                ["I don't wanna talk.", "You don't want to talk?", "...", "..."],
            ],
            guarded: [
                ["You never let me do anything.", "You feel restricted?", "Maybe...", "I guess you're frustrated."],
                ["Why do you always yell at me?!", "You feel yelled at?", "Fine, whatever!", "I hear you."],
            ],
            opening: [
                ["I just want to play sometimes.", "You want to play?", "That's right.", "Okay, but be careful."],
                ["I need to be free sometimes!", "You need more freedom?", "Yes!", "You must be tired of worrying."],
            ],
            collaborative: [
                ["What if I check with you before doing something risky?", "You'd do that?", "Yeah! That would help us both.", "You've been carrying a lot of worry for us."],
            ],
        },
    });

    relationships.addProxy(innerCritic.id, adult.id);
    relationships.addProxy(threeYearOld.id, adult.id);
}

export const SCENARIOS: Scenario[] = [
    {
        id: 'easy',
        name: 'Inner Critic',
        difficulty: 'Easy',
        estimatedMinutes: 5,
        description: 'A protector-exile pair. Learn the basics of IFS.',
        setup: setupEasyScenario,
        recordedSessionPath: '/recordings/protectorBacklash.json',
    },
    {
        id: 'medium',
        name: 'Self Proxies',
        difficulty: 'Medium',
        estimatedMinutes: 10,
        description: 'Deal with proxy relationships while addressing the Inner Critic.',
        setup: setupMediumScenario,
        recordedSessionPath: '/recordings/criticWithProxy.json',
    },
];
