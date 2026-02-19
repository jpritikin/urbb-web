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
                "Criticizing you wears me out.",
                "I hate doing this job.",
            ],
            unburdenedJob: "I help you spot danger early.",
        },
    });

    const criticized = cloudManager.addCloud('criticized one', {
        partAge: 'child',
        trust: 0.2,
        dialogues: {
            genericBlendedDialogues: [
                "Don't look at me.",
                "I need to hide.",
                "Are we safe yet?",
            ],
        },
    });

    const relationships = cloudManager.getRelationships();
    relationships.addProtection(innerCritic.id, criticized.id);
    relationships.setInterPartRelation(innerCritic.id, innerCritic.id, {
        trust: 0.2,
        stance: 0.6,
        stanceFlipOdds: 0.05,
        rumination: ["I'm a terrible person for criticizing.", "I hate what criticizing does."],
    });

    return { innerCritic, criticized };
}

function setupEasyScenario(cloudManager: CloudManager): void {
    setupCoreParts(cloudManager);
}

function setupAlcoholScenario(cloudManager: CloudManager): void {
    const lonelyOne = cloudManager.addCloud('lonely one', {
        partAge: 5,
        trust: 0.2,
        dialogues: {
            genericBlendedDialogues: [
                "Nobody comes.",
                "Please don't leave.",
                "Are we safe yet?",
            ],
        },
    });

    const alcoholicParent = cloudManager.addCloud('alcoholic parent', {
        partAge: 'adult',
        dialogues: {
            genericBlendedDialogues: [
                "This is what families do.",
                "Drinking takes the edge off.",
                "Drinking makes sense when you're older.",
            ],
        },
    });

    const drinker = cloudManager.addCloud('Drinker', {
        trust: 0.2,
        partAge: 15,
        dialogues: {
            burdenedJobAppraisal: [
                "Drinking quiets the pain — nothing else works.",
                "Without drinking, the feelings flood in.",
            ],
            unburdenedJob: "I help you rest and recover.",
        },
    });

    const shamer = cloudManager.addCloud('Shamer', {
        trust: 0.2,
        partAge: 8,
        dialogues: {
            burdenedJobAppraisal: [
                "Shaming the Drinker is the only brake we have.",
                "If the Shamer stops, the drinking gets worse.",
            ],
            unburdenedJob: "I help you learn from patterns.",
        },
    });

    const relationships = cloudManager.getRelationships();

    relationships.addProtection(drinker.id, lonelyOne.id);
    relationships.addProtection(shamer.id, lonelyOne.id);

    relationships.addProxy(lonelyOne.id, alcoholicParent.id);
    relationships.addProxy(drinker.id, alcoholicParent.id);

    relationships.setInterPartRelation(shamer.id, drinker.id, {
        trust: 0.2,
        stance: 0.6,
        stanceFlipOdds: 0.05,
        impactRecognition: [
            "The Drinker learned drinking from our parent — drinking is the only comfort the Drinker knows.",
            "The Drinker drinks to quiet the loneliness. The Shamer can see that now.",
        ],
        impactRejection: [
            "The Drinker is tearing us apart. The Shamer can't get past the damage.",
            "The Drinker is repeating our parent's mistakes exactly.",
        ],
        dialogues: {
            hostile: [
                ["The Drinker is turning us into our parent.", "The Shamer doesn't know what the Drinker carries.", "The Shamer sees exactly what's happening.", "..."],
                ["Put the bottle down.", "The Shamer can't stop the Drinker.", "Watch the Shamer try.", "..."],
            ],
            guarded: [
                ["The Shamer has seen where drinking leads.", "The Shamer thinks the Shamer knows everything.", "The Shamer knows enough.", "Maybe the Shamer does."],
                ["The Shamer is trying to protect us.", "Protect us from what?", "From becoming our parent.", "That's a heavy burden to carry."],
            ],
            opening: [
                ["The Shamer is scared for us both.", "The Shamer is scared?", "Yes — scared we'll end up like our parent.", "The Drinker didn't know the Shamer was scared too."],
                ["The Shamer isn't trying to punish the Drinker.", "Then what is the Shamer doing?", "Trying to break the cycle.", "Breaking the cycle sounds exhausting."],
            ],
            collaborative: [
                ["What if we found another way to rest?", "Would the Shamer stop attacking the Drinker?", "If the Drinker lets the Shamer help.", "The Drinker is listening."],
            ],
        },
    });

    relationships.setInterPartRelation(drinker.id, shamer.id, {
        trust: 0.2,
        stance: -0.4,
        stanceFlipOdds: 0.4,
        impactRecognition: [
            "The Shamer is terrified we'll repeat our parent's pattern — that's why the Shamer won't stop.",
            "The Shamer is trying to break the cycle. The Drinker just wishes the Shamer would stop yelling.",
        ],
        impactRejection: [
            "The Shamer sounds exactly like our parent. The Drinker can't hear the Shamer.",
            "The Shamer just makes the pain louder — the Drinker needs to drink more.",
        ],
        dialogues: {
            hostile: [
                ["Leave the Drinker alone.", "Ignoring the Shamer doesn't fix anything.", "The Shamer's lectures make everything worse.", "..."],
                ["The Shamer sounds just like our parent.", "Don't say that.", "Stop acting like our parent, then.", "..."],
            ],
            guarded: [
                ["The Drinker is just trying to get through tonight.", "By doing exactly what our parent did?", "Drinking is different.", "Is drinking really different?"],
                ["The Shamer doesn't know how loud the loneliness gets.", "The loneliness?", "Everything gets loud.", "The Drinker is heard."],
            ],
            opening: [
                ["The Drinker doesn't want to drink.", "The Drinker doesn't?", "No — the Drinker doesn't know what else to do.", "Maybe we can find something together."],
                ["The Drinker learned drinking from our parent, didn't the Drinker?", "Is the Drinker starting to see the pattern?", "Yes.", "Saying that takes courage."],
            ],
            collaborative: [
                ["What if the Shamer helped instead of shaming?", "The Shamer could try.", "The Drinker needs the Shamer on the Drinker's side.", "The Shamer has always been on the Drinker's side — just afraid."],
            ],
        },
    });

    relationships.setInterPartRelation(drinker.id, drinker.id, {
        trust: 0.2,
        stance: -0.3,
        stanceFlipOdds: 0.3,
        rumination: ["The Drinker is turning into our parent.", "The Drinker can't stop drinking.", "Drinking disgusts the Drinker."],
    });

    relationships.setInterPartRelation(shamer.id, shamer.id, {
        trust: 0.2,
        stance: 0.6,
        stanceFlipOdds: 0.05,
        rumination: ["We're turning into our parent.", "The Shamer can't stop the drinking."],
    });
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
        name: 'Alcohol Addiction',
        difficulty: 'Medium',
        estimatedMinutes: 10,
        description: 'An intergenerational pattern: a child who learned to cope by imitating an alcoholic parent.',
        setup: setupAlcoholScenario,
        recordedSessionPath: '/recordings/alcoholAddiction.json',
    },
];
