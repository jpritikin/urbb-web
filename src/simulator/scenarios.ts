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

function setupAlcoholScenario(cloudManager: CloudManager): void {
    const lonelyOne = cloudManager.addCloud('lonely one', {
        partAge: 5,
        trust: 0.2,
        dialogues: {
            genericBlendedDialogues: [
                "Nobody's coming.",
                "I just want someone to stay.",
                "Is it safe yet?",
            ],
        },
    });

    const alcoholicParent = cloudManager.addCloud('alcoholic parent', {
        partAge: 'adult',
        dialogues: {
            genericBlendedDialogues: [
                "This is just what we do.",
                "You'll understand when you're older.",
                "Everyone needs something to take the edge off.",
            ],
        },
    });

    const drinker = cloudManager.addCloud('Drinker', {
        trust: 0.2,
        partAge: 15,
        dialogues: {
            burdenedJobAppraisal: [
                "I'm the only one who can quiet things down.",
                "Without me, everything gets too loud.",
            ],
            unburdenedJob: "I help you rest.",
        },
    });

    const shamer = cloudManager.addCloud('Shamer', {
        trust: 0.2,
        partAge: 8,
        dialogues: {
            burdenedJobAppraisal: [
                "Someone has to hold the line.",
                "If I stop watching, we lose control.",
            ],
            unburdenedJob: "I help you notice patterns.",
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
            "The Drinker learned this from our parent. It's the only comfort they know.",
            "The Drinker is just trying to quiet the noise. I get that now.",
        ],
        impactRejection: [
            "The Drinker is destroying us. I can't see past that.",
            "All the Drinker does is repeat our parent's mistakes.",
        ],
        dialogues: {
            hostile: [
                ["You're turning us into them.", "You don't know what you're talking about.", "I see exactly what's happening!", "..."],
                ["Put it down.", "You can't make me.", "Watch me.", "..."],
            ],
            guarded: [
                ["I've seen where this goes.", "You think you know everything?", "I know enough.", "Maybe you do."],
                ["I'm trying to protect us.", "From what?", "From becoming our parent.", "That's... a lot to carry."],
            ],
            opening: [
                ["I'm scared for us.", "You're scared?", "Yes. I don't want us to end up like them.", "I didn't know you were scared too."],
                ["I'm not trying to punish you.", "Then what are you doing?", "Trying to break the cycle.", "That sounds exhausting."],
            ],
            collaborative: [
                ["What if we found another way to rest?", "You'd stop yelling at me?", "If you'd let me help.", "I'm listening."],
            ],
        },
    });

    relationships.setInterPartRelation(drinker.id, shamer.id, {
        trust: 0.2,
        stance: -0.4,
        stanceFlipOdds: 0.4,
        impactRecognition: [
            "The Shamer is terrified we'll end up like our parent. That's why they won't stop.",
            "The Shamer is trying to break a cycle. I just wish they'd stop yelling.",
        ],
        impactRejection: [
            "The Shamer sounds exactly like our parent. I can't hear them.",
            "All the Shamer does is make everything louder.",
        ],
        dialogues: {
            hostile: [
                ["Leave me alone.", "You think ignoring me fixes anything?", "It's better than your lectures.", "..."],
                ["You sound just like them.", "Don't say that.", "Then stop acting like it.", "..."],
            ],
            guarded: [
                ["I'm just trying to get through the night.", "By doing the same thing they did?", "It's different.", "Is it though?"],
                ["You don't understand how loud it gets.", "The feelings?", "Everything.", "I hear you."],
            ],
            opening: [
                ["I don't want to do this either.", "You don't?", "No. But I don't know what else to do.", "Maybe we can figure that out."],
                ["I learned this from them, didn't I?", "You're starting to see it?", "Yeah.", "That takes courage to say."],
            ],
            collaborative: [
                ["What if you helped me instead of shaming me?", "I... could try.", "I need you on my side.", "I've always been on your side. I was just afraid."],
            ],
        },
    });

    relationships.setInterPartRelation(drinker.id, drinker.id, {
        trust: 0.2,
        stance: -0.3,
        stanceFlipOdds: 0.3,
        rumination: ["I'm just like them.", "I can't stop.", "I disgust myself."],
    });

    relationships.setInterPartRelation(shamer.id, shamer.id, {
        trust: 0.2,
        stance: 0.6,
        stanceFlipOdds: 0.05,
        rumination: ["We're turning into them.", "I can't stop this."],
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
