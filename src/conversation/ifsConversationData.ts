import { ScenarioConfig } from './ifsConversationSim.js';

// Each tuple is self-contained. Index order:
// 4-step: [speak, mirror, validate, empathize]
// 6-step: [speak, mirror, clarify, mirror_again, validate, empathize]
// Speaker lines: speak, clarify, validate
// Listener lines: mirror, mirror_again, empathize

export const shamedDrinkerScenario: ScenarioConfig = {
    partA: { id: 'shamer', name: 'Shamer' },
    partB: { id: 'drinker', name: 'Drinker' },
    relAB: {
        // Shamer speaks, Drinker listens
        trust: 0.2, trustFloor: 0,
        dialogues: {
            hostile: [
                [
                    "Every time you pour a drink, I see our parent's face.", // speak  (Shamer)
                    "You're saying I drink like our parent did.",   // mirror (Drinker)
                    "You don't just remind me of them. You've become them.", // validate (Shamer)
                    "Fine. I hear you. What can I do about it?", // empathize (Drinker)
                ],
                [
                    "You keep reaching for the bottle every time things get hard.", // speak  (Shamer)
                    "You think I use drinking to avoid hard things.", // mirror (Drinker)
                    "Yes. Every time there's pressure, it's the first place you go.", // validate (Shamer)
                    "Maybe. Doesn't mean I have to stop.",   // empathize (Drinker)
                ],
                [
                    "You're going to destroy everything we've built.", // speak  (Shamer)
                    "You think we're going to lose our driver's license.",             // mirror (Drinker)
                    "Yes, but I'm trying to stop a worse collapse.", // clarify (Shamer)
                    "You're scared of a comprehensive collapse.", // mirror_again (Drinker)
                    "Right. I see it coming and I don't know how to stop it.", // validate (Shamer)
                    "I get your fear, but what can I do about it?", // empathize (Drinker)
                ],
            ],
            guarded: [
                [
                    "I've seen where this road leads.",            // speak  (Shamer)
                    "You're worried about where this is heading.", // mirror (Drinker)
                    "Yes. I've watched it happen to our parent.", // validate (Shamer)
                    "I didn't realize you were carrying that too.", // empathize (Drinker)
                ],
                [
                    "I'm trying to protect us, not punish you.",   // speak  (Shamer)
                    "You want to protect us, not attack me.",            // mirror (Drinker)
                    "Right. I just don't know how to do it without getting loud.", // validate (Shamer)
                    "I can see you're trying. That helps a little.", // empathize (Drinker)
                ],
                [
                    "I keep track of every slip.",                 // speak  (Shamer)
                    "You're keeping score — cataloguing everything I do wrong.", // mirror (Drinker)
                    "No. I track them because each one terrified me.", // clarify (Shamer)
                    "You're holding onto them out of fear, not to punish.", // mirror_again (Drinker)
                    "Yes. Every slip I remember is a moment I was terrified.", // validate (Shamer)
                    "I thought you were building a case. You were just scared.", // empathize (Drinker)
                ],
            ],
            opening: [
                [
                    "I'm scared we'll end up like our parent.", // speak (Shamer)
                    "You're frightened, not really critical.",        // mirror (Drinker)
                    "Yes. The anger is on top. Underneath I'm terrified.", // validate (Shamer)
                    "I didn't know fear was driving this. That changes something.", // empathize (Drinker)
                ],
                [
                    "I don't want to be your enemy. I want us to survive.", // speak (Shamer)
                    "You want to be on my side.",                   // mirror (Drinker)
                    "Exactly. I need you to still be here.",        // validate (Shamer)
                    "I want that too. Maybe we've both been fighting the wrong battle.", // empathize (Drinker)
                ],
                [
                    "I learned to be loud from our parent. I didn't choose it.", // speak (Shamer)
                    "You inherited this harshness?",  // mirror (Drinker)
                    "More than inherited — it was the only way I knew to care.", // clarify (Shamer)
                    "You were harsh because you never learned a quiet way.", // mirror_again (Drinker)
                    "Yes. Loud and harsh was the only version of care I was shown.", // validate (Shamer)
                    "I see you differently now.", // empathize (Drinker)
                ],
            ],
            collaborative: [
                [
                    "What if we looked for another way together?", // speak (Shamer)
                    "You want to work together?", // mirror (Drinker)
                    "Yes. I'm done fighting. I want to problem-solve.", // validate (Shamer)
                    "I'm in. Tell me what you need from me.",       // empathize (Drinker)
                ],
                [
                    "I could warn us without attacking. Just a signal, not a verdict.", // speak (Shamer)
                    "You're offering flag danger instead of condemning.", // mirror (Drinker)
                    "Right. I can do that if you agree to listen.", // validate (Shamer)
                    "I can try to listen. That feels like real progress.", // empathize (Drinker)
                ],
            ],
        },
    },
    relBA: {
        // Drinker speaks, Shamer listens
        trust: 0.2, trustFloor: 0,
        dialogues: {
            hostile: [
                [
                    "Leave me alone.",                             // speak  (Drinker)
                    "You want to be left alone.",                  // mirror (Shamer)
                    "Yes. Your constant lectures make everything worse.", // validate (Drinker)
                    "You feel hounded. Okay.",              // empathize (Shamer)
                ],
                [
                    "You sound just like our parent.",             // speak  (Drinker)
                    "You're saying I remind you of our parent.",   // mirror (Shamer)
                    "Exactly. Same tone. Same contempt.",          // validate (Drinker)
                    "Good. Remember that next time you reach for the bottle.", // empathize (Shamer)
                ],
                [
                    "I didn't ask for any of this.",               // speak  (Drinker)
                    "So you want credit for suffering?",           // mirror (Shamer)
                    "No. I want you to stop acting like I chose this.", // clarify (Drinker)
                    "You're saying this wasn't a choice — it was the only way you knew.", // mirror_again (Shamer)
                    "Yes. I was surviving. There was nothing else available to me then.", // validate (Drinker)
                    "I didn't see it that way.", // empathize (Shamer)
                ],
            ],
            guarded: [
                [
                    "I'm just trying to get through tonight.",     // speak  (Drinker)
                    "So you want me to back off?", // mirror (Shamer)
                    "Right. Back off.", // validate (Drinker)
                    "I hear that. Tonight is hard.",           // empathize (Shamer)
                ],
                [
                    "You don't know how loud it gets inside.",     // speak  (Drinker)
                    "You're carrying a lot of noise I can't see.", // mirror (Shamer)
                    "Yes. When it gets loud, drinking is the only thing that quiets it.", // validate (Drinker)
                    "I didn't know it was that loud.", // empathize (Shamer)
                ],
                [
                    "I'm not weak. I'm overwhelmed.",              // speak  (Drinker)
                    "You don't want to be seen as weak.",          // mirror (Shamer)
                    "Yes, but I need you to understand the difference.", // clarify (Drinker)
                    "Weak and overwhelmed are not the same?", // mirror_again (Shamer)
                    "Yes. Weak is a choice. Overwhelmed is what happens when too much lands at once.", // validate (Drinker)
                    "I've been treating them as the same. I can stop doing that.", // empathize (Shamer)
                ],
            ],
            opening: [
                [
                    "I don't actually want to drink.",             // speak  (Drinker)
                    "So why do you keep hitting the bottle?", // mirror (Shamer)
                    "I don't know what else to do with all of this.", // validate (Drinker)
                    "Then I've been blaming you for something you're also struggling with.", // empathize (Shamer)
                ],
                [
                    "You got the contempt. I got the bottle. Same parent.", // speak (Drinker)
                    "You're saying we both inherited something from them.", // mirror (Shamer)
                    "Yes. Different burdens. Same source.", // validate (Drinker)
                    "Then we've been fighting each other over wounds we share.", // empathize (Shamer)
                ],
                [
                    "I've been trying to put this down for a long time.", // speak (Drinker)
                    "Really?",                 // mirror (Shamer)
                    "I've been exhausted by trying and failing alone.", // clarify (Drinker)
                    "You've been trying to stop alone, and it's worn you out.", // mirror_again (Shamer)
                    "Yes. Every failed attempt costs something. I'm running low.", // validate (Drinker)
                    "I didn't know you were already fighting. I want to help now.", // empathize (Shamer)
                ],
            ],
            collaborative: [
                [
                    "I want you as an ally, not a judge.",         // speak  (Drinker)
                    "You need me on the same side.",               // mirror (Shamer)
                    "Yes. If you're with me, I don't need the drinking as much.", // validate (Drinker)
                    "I want that too. I've always wanted that.",   // empathize (Shamer)
                ],
                [
                    "What if I checked in with you before reaching for the bottle?", // speak (Drinker)
                    "You're offering to pause and consult instead of acting alone.", // mirror (Shamer)
                    "Right. Just a moment, to check whether there's another way.", // validate (Drinker)
                    "I can work with that. That's all I ever wanted.", // empathize (Shamer)
                ],
            ],
        },
    },
};
