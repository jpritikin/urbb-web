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
                [
                    "Every time you pour a drink, I see our parent's face.",
                    "You're saying I drink like our parent did.",
                    "You don't just remind me of them. You've become them.",
                    "Fine. I hear you. What can I do about it?",
                ],
                [
                    "You keep reaching for the bottle every time things get hard.",
                    "You think I use drinking to avoid hard things.",
                    "Yes. Every time there's pressure, it's the first place you go.",
                    "Maybe. Doesn't mean I have to stop.",
                ],
                [
                    "You're going to destroy everything we've built.",
                    "You think we're going to lose our driver's license.",
                    "Yes, but I'm trying to stop a worse collapse.",
                    "You're scared of a comprehensive collapse.",
                    "Right. I see it coming and I don't know how to stop it.",
                    "I get your fear, but what can I do about it?",
                ],
            ],
            guarded: [
                [
                    "I've seen where this road leads.",
                    "You're worried about where this is heading.",
                    "Yes. I've watched it happen to our parent.",
                    "I didn't realize you were carrying that too.",
                ],
                [
                    "I'm trying to protect us, not punish you.",
                    "You want to protect us, not attack me.",
                    "Right. I just don't know how to do it without getting loud.",
                    "I can see you're trying. That helps a little.",
                ],
                [
                    "I keep track of every slip.",
                    "You're keeping score — cataloguing everything I do wrong.",
                    "No. I track them because each one terrified me.",
                    "You're holding onto them out of fear, not to punish.",
                    "Yes. Every slip I remember is a moment I was terrified.",
                    "I thought you were building a case. You were just scared.",
                ],
            ],
            opening: [
                [
                    "I'm scared we'll end up like our parent.",
                    "You're frightened, not really critical.",
                    "Yes. The anger is on top. Underneath I'm terrified.",
                    "I didn't know fear was driving this. That changes something.",
                ],
                [
                    "I don't want to be your enemy. I want us to survive.",
                    "You want to be on my side.",
                    "Exactly. I need you to still be here.",
                    "I want that too. Maybe we've both been fighting the wrong battle.",
                ],
                [
                    "I learned to be loud from our parent. I didn't choose it.",
                    "You inherited this harshness?",
                    "More than inherited — it was the only way I knew to care.",
                    "You were harsh because you never learned a quiet way.",
                    "Yes. Loud and harsh was the only version of care I was shown.",
                    "I see you differently now.",
                ],
            ],
            collaborative: [
                [
                    "What if we looked for another way together?",
                    "You want to work together?",
                    "Yes. I'm done fighting. I want to problem-solve.",
                    "I'm in. Tell me what you need from me.",
                ],
                [
                    "I could warn us without attacking. Just a signal, not a verdict.",
                    "You're offering to flag danger instead of condemning.",
                    "Right. I can do that if you agree to listen.",
                    "I can try to listen. That feels like real progress.",
                ],
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
                [
                    "Leave me alone.",
                    "You want to be left alone.",
                    "Yes. Your constant lectures make everything worse.",
                    "You feel hounded. Okay.",
                ],
                [
                    "You sound just like our parent.",
                    "You're saying I remind you of our parent.",
                    "Exactly. Same tone. Same contempt.",
                    "Good. Remember that next time you reach for the bottle.",
                ],
                [
                    "I didn't ask for any of this.",
                    "So you want credit for suffering?",
                    "No. I want you to stop acting like I chose this.",
                    "You're saying this wasn't a choice — it was the only way you knew.",
                    "Yes. I was surviving. There was nothing else available to me then.",
                    "I didn't see it that way.",
                ],
            ],
            guarded: [
                [
                    "I'm just trying to get through tonight.",
                    "So you want me to back off?",
                    "Right. Back off.",
                    "I hear that. Tonight is hard.",
                ],
                [
                    "You don't know how loud it gets inside.",
                    "You're carrying a lot of noise I can't see.",
                    "Yes. When it gets loud, drinking is the only thing that quiets it.",
                    "I didn't know it was that loud.",
                ],
                [
                    "I'm not weak. I'm overwhelmed.",
                    "You don't want to be seen as weak.",
                    "Yes, but I need you to understand the difference.",
                    "Weak and overwhelmed are not the same?",
                    "Yes. Weak is a choice. Overwhelmed is what happens when too much lands at once.",
                    "I've been treating them as the same. I can stop doing that.",
                ],
            ],
            opening: [
                [
                    "I don't actually want to drink.",
                    "So why do you keep hitting the bottle?",
                    "I don't know what else to do with all of this.",
                    "Then I've been blaming you for something you're also struggling with.",
                ],
                [
                    "You got the contempt. I got the bottle. Same parent.",
                    "You're saying we both inherited something from them.",
                    "Yes. Different burdens. Same source.",
                    "Then we've been fighting each other over wounds we share.",
                ],
                [
                    "I've been trying to put this down for a long time.",
                    "Really?",
                    "I've been exhausted by trying and failing alone.",
                    "You've been trying to stop alone, and it's worn you out.",
                    "Yes. Every failed attempt costs something. I'm running low.",
                    "I didn't know you were already fighting. I want to help now.",
                ],
            ],
            collaborative: [
                [
                    "I want you as an ally, not a judge.",
                    "You need me on the same side.",
                    "Yes. If you're with me, I don't need the drinking as much.",
                    "I want that too. I've always wanted that.",
                ],
                [
                    "What if I checked in with you before reaching for the bottle?",
                    "You're offering to pause and consult instead of acting alone.",
                    "Right. Just a moment, to check whether there's another way.",
                    "I can work with that. That's all I ever wanted.",
                ],
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
