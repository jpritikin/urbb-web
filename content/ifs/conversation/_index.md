---
title: "IFS Conversation"
version: "v1.0.0"
layout: "ifs-simulator"
activeTab: "conversation"
---

<div class="mobile-warning">

**Mobile detected — Nightmare difficulty unlocked.**
This app is built for wide screens. Proceeding on a narrow device means smaller targets, cramped layouts, and no safety net. We respect the commitment. May your thumbs be true.

</div>

<details>
<summary>Overview</summary>

Two parts from the Alcohol Addiction scenario — **Shamer** and **Drinker** — are in an IFIO-style directed dialogue. The simulation runs in real time. Watch how stance, regulation, and trust evolve as the conversation progresses.

**Goal:** guide both parts to regulation so they can complete conversation cycles and build trust toward *collaborative*.

**Stance** is the core metric for each part, ranging from −1 to +1. Negative means withdrawn or shut down; positive means activated or flooded. Both parts need to stay within ±{{< sim "regulation_stance_limit" >}} (the green zone) for the conversation to advance.

**Each cycle** assigns one part the **SpeakRole** and the other the **ListenRole** for its duration. The SpeakRole part does **Speak → Validate**; the ListenRole part does **Mirror → Empathize** in between. Completing the Empathize step grants a large trust boost and softens the SpeakRole part's stance.

**Trust** accumulates over completed cycles and determines how open and collaborative the dialogue becomes. It has four bands: *hostile → guarded → opening → collaborative*.

**Therapist buttons** let you nudge a part's effective stance by ±{{< sim "therapist_nudge" >}} in real time:

| Button | When to use |
|--------|-------------|
| **Calm** | A part is dysregulated (stance > +{{< sim "regulation_stance_limit" >}}) — push it back toward center |
| **Activate** | A part is withdrawn (stance < −{{< sim "regulation_stance_limit" >}}) — draw it back into engagement. Also use Activate when both parts are *waiting* (neither has a SpeakRole yet) to nominate a SpeakRole part |

The buttons glow when a nudge would help. The therapist delta decays over time, so repeated presses are needed to sustain the effect.

**Self-to-part trust** (the slider on each card) controls how resilient a part is to shocks from the other's words. Higher values mean the part absorbs provocation more stably. You can adjust this mid-conversation.

</details>

<details>
<summary>Reference</summary>

### Stance

Each part holds a raw stance in [−1, +1]. Negative is withdrawn; positive is activated. The **effective stance** adds two transient deltas on top:

```
effective_stance = clamp(raw_stance + therapist_delta + shock_delta, −1, +1)
```

Stance is sampled at the start of each conversation and when a part is re-nominated as the SpeakRole part. The sample draws from a normal distribution around the magnitude value, widened by low self-to-part trust:

```
stddev = (1 − selfTrust) / 4
shift  = 0.5 × (1 − selfTrust)
sample = N(0.5, stddev) clamped to [0,1]
drawn  = sign(magnitude) × min(1, |magnitude| × (sample + shift))
```

A flip occurs with probability `flipOdds`, negating `drawn`. When a part is renominated (cycle boundary), the new raw stance blends 25% of the previous value with 75% of a fresh sample, anchoring memory while allowing drift.

**Stance descriptions:**

| Range | Label |
|-------|-------|
| > +{{< sim "stance_labels.flooding_min" >}} | flooding |
| +{{< sim "regulation_stance_limit" >}} to +{{< sim "stance_labels.flooding_min" >}} | dysregulated |
| −{{< sim "regulation_stance_limit" >}} to +{{< sim "regulation_stance_limit" >}} | regulated |
| −{{< sim "stance_labels.flooding_min" >}} to −{{< sim "regulation_stance_limit" >}} | withdrawing |
| < −{{< sim "stance_labels.flooding_min" >}} | shut down |

---

### Regulation score

The regulation score is a continuous value in [0, 1] that smooths out momentary excursions:

```
if both |stanceA| < {{< sim "regulation_stance_limit" >}} and |stanceB| < {{< sim "regulation_stance_limit" >}}:
    score += 0.5 × dt          (recovers in ~2 s)
else:
    score −= 0.3 × dt          (decays in ~3 s)

regulated = score > 0.5
```

The lag prevents a briefly mis-spoken line from immediately derailing the cycle. Both parts must sustain regulation for the conversation to advance.

---

### Conversation cycle

Each cycle assigns one part the **SpeakRole** and the other the **ListenRole**. These roles persist until the cycle completes or a violation resets them. The `listen` phase (passive waiting) appears for both roles at different steps — it is a phase name, not a role.

**4-step** (standard):

| Step | SpeakRole | ListenRole |
|------|-----------|------------|
| 1 | **Speak** | `listen` |
| 2 | `listen` | **Mirror** |
| 3 | **Validate** | `listen` |
| 4 | `listen` | **Empathize** |

**6-step** (repair loop — when the selected dialogue tuple has 6 lines):

| Step | SpeakRole | ListenRole |
|------|-----------|------------|
| 1 | **Speak** | `listen` |
| 2 | `listen` | **Mirror** |
| 3 | **Clarify** | `listen` |
| 4 | `listen` | **Mirror again** |
| 5 | **Validate** | `listen` |
| 6 | `listen` | **Empathize** |

The 6-step path is chosen automatically based on the dialogue tuple selected for that cycle (some trust bands only include 4-line tuples). It is the simulation's representation of a repair loop when the first mirror misses.

All utterances within a single cycle — SpeakRole and ListenRole lines alike — come from the **same tuple**, selected at the start of that cycle from the SpeakRole part's relationship. A ListenRole violation ends the cycle early and a new tuple is drawn for the next cycle.

**Phase advancement** happens only when `regulated = true`. Each utterance fires after a {{< sim "respond_delay" >}}-second timer elapses. When dysregulated, only the **SpeakRole part** can still utter (probabilistically, see below); all other phases wait.

**Cycle completion** (ListenRole part finishes Empathize):
- Trust boost (SpeakRole only): `Δtrust = {{< sim "cycle_trust_boost_factor" >}} × (1 − trust)` — a large, diminishing-returns gain toward 1.0
- SpeakRole part's raw stance softened: `raw_stance × {{< sim "cycle_stance_soften" >}}`
- Roles reset; the part with the higher effective stance becomes the next SpeakRole part

---

### Utterance timing

When regulated, each phase fires after a **{{< sim "respond_delay" >}}-second respond timer** resets on every phase transition.

When dysregulated, the SpeakRole part whose stance exceeds +{{< sim "regulation_stance_limit" >}} can speak early. The mechanism depends on which phase the SpeakRole part currently holds:

- **Active phase** (`speak`, `clarify`, `validate`): fires probabilistically each tick:
  ```
  p(speak in dt) = clamp(stance + 0.3, 0, 1) × 0.5 × dt
  ```
  A flooded SpeakRole part (+1.0) has ~65% chance per second; a barely-dysregulated one has ~30%. After firing, the phase does not advance until regulation returns.

- **`listen` phase** (waiting for the ListenRole part to mirror/empathize): fires after a grace-period timer (same duration as a ListenRole violation). When regulation returns, the ListenRole part's turn resumes normally — no phase advance is deferred.

The label shown reflects the speaker's stance intensity at the moment of utterance:

| Stance | Label |
|--------|-------|
| < 0.50 | Nag |
| < 0.65 | Jab |
| < 0.75 | Snap |
| < 0.85 | Accuse |
| < 0.95 | Shout |
| ≥ 0.95 | Explode |

---

### Stance shocks

Every utterance applies a **stance shock** to the receiver. The shock magnitude is proportional to the speaker's effective stance and attenuated by both parties' trust, and amplified by a **dysregulated-streak multiplier**:

```
streakMult = e^(k × streak)     where k = ln(1.2)/5  ≈ 0.0365
shockMag   = streakMult × 0.3 × |speakerStance| × 2 / ((1 + selfTrust) × (1 + interPartTrust))
```

`streak` counts consecutive dysregulated utterances the receiver has absorbed without a regulated break. At 5 consecutive dysregulated utterances the multiplier reaches ~1.20 (+20%), and it keeps growing exponentially. Any regulated utterance resets the receiver's streak to 0.

By default the shock pushes the receiver toward the **opposite** polarity: a positive (activated) speaker pushes the receiver negative (withdrawal); a negative (withdrawn) speaker pulls the receiver positive (activation). With probability `flipOdds` — the same **Neuroticism** parameter set in the setup screen — the direction reverses, pulling the receiver **toward** the speaker's polarity, modelling a part that mirrors or is drawn into the other's state rather than reacting against it.

The shock accumulates in `shockDelta` and decays exponentially: `shockDelta × e^(−{{< sim "delta_decay_rate" >}} × dt)`, returning to baseline in ~{{< sim "delta_half_life" >}} seconds if no further shocks arrive.

The **ball** tracks the speaker — it arcs toward whichever part is about to utter. The ball exists to orient new players, but the clinical discipline is to look away from it: shocks land on the *receiver*, not the sender, so the listener's stance card is where the action is. Toni Herbine-Blank, developer of IFIO, is known for her ability to watch the listening partner during demonstration sessions while the room's attention would usually follow the speaker. Practice ignoring the ball and tracking the quieter card instead.

**Shock overflow:** if the accumulated shock would push the receiver's effective stance below −1, the excess is converted to a trust penalty:

```
Δtrust = −{{< sim "overflow_trust_penalty" >}} × overflow
```

This models the relational cost of flooding a withdrawn part past its limit.

---

### Polarity flip

When a shock drives the receiver's effective stance below −{{< sim "regulation_stance_limit" >}}, there is a further chance equal to `flipOdds` of a **polarity flip**: the part's withdrawn energy suddenly reverses into activation:

```
new_raw = drawInitialStance(−effective_stance, 0, selfTrust)
```

The part becomes the new speaker, emits a generic outburst line ("I can't take it anymore" etc.), and the speaker receives a **counter-shock** equal to the polarity shift magnitude, nudging them back from the extreme. This models a part that has been pushed into shutdown finally erupting.

---

### Trust and trust bands

Trust is a per-relationship value in [0, 1] (Shamer→Drinker and Drinker→Shamer are tracked separately).

| Band | Trust range | Character |
|------|-------------|-----------|
| hostile | < {{< sim "trust_bands.hostile_max" >}} | raw, attacking |
| guarded | {{< sim "trust_bands.guarded_min" >}} – {{< sim "trust_bands.guarded_max" >}} | cautious, partial |
| opening | {{< sim "trust_bands.opening_min" >}} – {{< sim "trust_bands.opening_max" >}} | curious, softer |
| collaborative | ≥ {{< sim "trust_bands.collaborative_min" >}} | partnered, problem-solving |

The active trust band selects which pool of dialogue tuples to draw from. A cycle completion pulls trust halfway to 1.0. Trust only decreases via shock overflow; the floor is 0 (or a configurable floor, unused in the default scenario).

When both relationships exceed 0.89, a congratulations banner appears — the conversation has reached deep mutual trust.

---

### ListenRole violation

If the **ListenRole part's** effective stance exceeds +{{< sim "regulation_stance_limit" >}} for more than **1 second**, it becomes the new SpeakRole part — interrupting the current cycle and rolling a new dialogue tuple. The newly promoted SpeakRole part immediately fires a dysregulated utterance, shocking the new ListenRole part toward negative stance. This breaks oscillation loops where both parts remain dysregulated indefinitely. This models a part that cannot hold the ListenRole when flooded.

The same grace-period timer also applies to the **SpeakRole part when in the `listen` phase** (see Utterance timing above) — it fires an outburst without swapping roles or interrupting the cycle.

---

### Therapist influence

Each Calm/Activate press adds ±{{< sim "therapist_nudge" >}} to the part's `therapistDelta`. Multiple presses stack, clamped so the effective stance stays within [−1, +1]. The delta decays exponentially at the same rate as shock deltas (`e^(−{{< sim "delta_decay_rate" >}} × dt)`), halving roughly every {{< sim "delta_half_life" >}} seconds.

In the **waiting** state (both parts withdrawn), therapist Activate raises a part's effective stance above 0, which nominates it as the SpeakRole part and resamples its raw stance.

---

### Nomination and SpeakRole selection

At each cycle boundary the part with the **higher effective stance** is nominated as the SpeakRole part. If both are negative, both enter *waiting*. On nomination the new SpeakRole part's raw stance is resampled (75% fresh draw, 25% memory of prior stance), and a new dialogue tuple is rolled from the current trust band's pool.

</details>

---

<link rel="stylesheet" href="/css/ifsConversation.css">

<div id="ifs-conversation-root"></div>

<script type="module" src="/js/conversation/ifsConversation.js"></script>
