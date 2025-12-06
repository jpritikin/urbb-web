---
title: "Online Supplement"
version: "v1.4.1"
---

<link rel="stylesheet" href="/css/supplement.css">

## What Is This?

An **online supplement** extends a printed book into the digital realm. 🌐 It offers materials that don't translate well to paper. 📄 This supplement offers an interactive IFS (Internal Family Systems) therapist simulator, 🧠 Santo Daime hymn recordings, 🎵 and an interactive bibliography with direct links to peer reviewed academic sources. 📚 These resources complement the printed text. ✨

## What is Internal Family Systems (IFS)?

Religion and mental health have always overlapped in their attempts to understand troubled minds. 🧠 Is that voice divine revelation or auditory hallucination? ❓ Is ego dissolution mystical or pathological? Religious traditions developed frameworks like spirit possession 👻 and contemplative practices 🧘 to address such questions. Modern mental health professionals inherit these challenges. They encounter the same phenomena—voices, ego dissolution, altered states—but interpret them through secular frameworks rather than religious ones.

Internal Family Systems (IFS) is a transformative therapeutic approach developed by Dr. Richard Schwartz. 🧠 It's based on the recognition that our psyche is naturally multiple—composed of various sub-personalities or "parts"—and that this multiplicity is not pathological but normal. 👥✨

This psychological framework serves the book in two ways. ✨ Proactively, we need to recognize when religious practices risk causing harm and know how to adjust or abandon such practices. 🛡️ Reactively, we need to recognize tenacious inner conflicts and know how to facilitate dialogue that de-escalates the tensions between polarized sides. 💬

### Therapist Simulator

Various apps exist to help IFS clients map their parts—tracking protectors, exiles, and their relationships in visual diagrams. 🗺️ These tools serve a real purpose. But we're doing something different here. ✨

This simulator opens a window into what it's like to *be* an IFS therapist. 🪟 You'll practice the therapeutic stance: curious but not intrusive, present but not directive, holding space while parts reveal themselves at their own pace. 🧘 The work isn't about cataloging your internal system. It's about embodying the quality of attention that allows parts to feel safe enough to speak. 💬

Whether you're considering IFS therapy, already working with a therapist, or training to become one yourself, this simulator offers direct experience with the therapeutic process from the therapist's perspective. 🎓

<div id="ifs-intro-container">
  <button id="enter-simulator-btn" class="simulator-enter-button">
    🧠 Enter IFS Simulator
  </button>
</div>

## Hymn Player

[Santo Daime](https://www.santodaime.org/) is a Brazilian ayahuasca religion where participants drink a psychoactive brew and then—here's the interesting part—maintain external focus through synchronized hymn singing and ritual movements. While the drug pulls attention inward toward private visions, the discipline (called *firmeza* or "firmness") is staying anchored in shared reality with the community. The hymns function as collective reference points, objects of mutual attention that help everyone navigate altered states together rather than drifting into isolated experiences (more details in chapter 7).

The recordings here exist somewhere in the liminal space between "technically adequate" and "why did he think this was a good idea?" The author, possessing neither musical training nor appropriate shame, recorded himself singing these hymns in multitrack (at least 3 layers of his own voice, no instruments). Listen to at least one.

Maybe learn the melody to "Examine A Consciência" while doing dishes. Hum along awkwardly in your kitchen. Let us share a few moments before you return to your regularly scheduled doomscrolling. Have mercy on my needy parts that are deeply embarrassed about making this emotional appeal but are doing it anyway because the alternative feels somehow worse.

<div id="cassette-player-container">
  <div id="cassette-deck">
    <div id="salmon-container">
      <canvas id="salmon-canvas"></canvas>
    </div>
    <div class="hymn-player">
      <audio id="hymn-audio" preload="metadata" loop>
        <source id="hymn-source" src="" type="audio/mpeg">
      </audio>
      <div id="player-controls">
        <button id="play-pause-btn" disabled>▶</button>
        <button id="loop-btn" class="active" title="Loop enabled">🔁</button>
        <div id="current-hymn-display">No cassette loaded</div>
      </div>
    </div>
  </div>

  <div id="hymn-list-container">
    <div id="hymn-list-scroll">
      <div id="hymn-list">
        <div class="hymn-item unlocked" data-hymn="examine-a-consciencia" data-title="Examine A Consciência">
          <span class="hymn-title">Examine A Consciência</span>
        </div>
        <div class="hymn-item unlocked" data-hymn="eu-nao-sou-deus" data-title="Eu Não Sou Deus">
          <span class="hymn-title">Eu Não Sou Deus</span>
        </div>
        <div class="hymn-item locked" data-hymn="a-forca-e-a-verdade" data-title="A Força E A Verdade">
          <span class="hymn-title">A Força E A Verdade</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item locked" data-hymn="eu-pedi-uma-graca" data-title="Eu Pedi Uma Graça">
          <span class="hymn-title">Eu Pedi Uma Graça</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item unlocked" data-hymn="sentado-no-trono" data-title="Sentado No Trono">
          <span class="hymn-title">Sentado No Trono</span>
        </div>
        <div class="hymn-item locked" data-hymn="centro-livre" data-title="Centro Livre">
          <span class="hymn-title">Centro Livre</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item locked" data-hymn="o-santo-daime-me-chamou" data-title="O Santo Daime Me Chamou">
          <span class="hymn-title">O Santo Daime Me Chamou</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item locked" data-hymn="hospital-divino" data-title="Hospital Divino">
          <span class="hymn-title">Hospital Divino</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item locked" data-hymn="chamo-a-forca" data-title="Chamo A Força">
          <span class="hymn-title">Chamo A Força</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item locked" data-hymn="estou-aqui" data-title="Estou Aqui">
          <span class="hymn-title">Estou Aqui</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item locked" data-hymn="batalha" data-title="Batalha">
          <span class="hymn-title">Batalha</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item locked" data-hymn="o-daime-e-o-daime" data-title="O Daime É O Daime">
          <span class="hymn-title">O Daime É O Daime</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item locked" data-hymn="linha-do-tucum" data-title="Linha Do Tucum">
          <span class="hymn-title">Linha Do Tucum</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item locked" data-hymn="deus-e-para-todos" data-title="Deus É Para Todos">
          <span class="hymn-title">Deus É Para Todos</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item locked" data-hymn="eu-provo-com-os-meus-irmaos" data-title="Eu Provo Com Os Meus Irmãos">
          <span class="hymn-title">Eu Provo Com Os Meus Irmãos</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item unlocked" data-hymn="brilho-do-sol" data-title="Brilho do Sol">
          <span class="hymn-title">Brilho do Sol</span>
        </div>
        <div class="hymn-item unlocked" data-hymn="sol-lua-estrela" data-title="Sol, Lua, Estrela">
          <span class="hymn-title">Sol, Lua, Estrela</span>
        </div>
      </div>
    </div>
    <p style="margin-top: 1rem; font-size: 0.9rem; color: #888; font-style: italic;">
      <strong>About locked hymns:</strong> The 🔒 locked recordings are only available as part of the audiobook. If you'd like access to the full collection, consider purchasing the audio edition.
    </p>
  </div>
</div>

## Bibliography

You know those spiritual bestsellers that open each chapter with a quote from the Upanishads? The ones invoking "quantum principles" and "the field of pure potentiality"? That distill millennia of Eastern philosophy into exactly seven convenient laws? That present "universal energy" and "infinite organizing power" as self-evident truths requiring no empirical support beyond Rumi agreeing with Lao Tzu? The ones that never cite a single peer-reviewed study?

Here, every claim (where possible) connects to peer-reviewed research across multiple disciplines:

- **Psychology & Psychotherapy**: Clinical psychology, developmental psychology, Internal Family Systems, attachment theory, trauma treatment
- **Psychopharmacology**: Psychedelic research, cannabinoid science, neurochemistry, pharmacokinetics
- **Neuroscience & Consciousness Studies**: Cognitive neuroscience, neurophenomenology, phenomenology of consciousness, altered states research
- **Contemplative Science**: Meditation research, mindfulness studies, mystical experience measurement
- **Anthropology & Ethnography**: Religious anthropology, ayahuasca traditions, cross-cultural ritual practices, Santo Daime ethnography
- **Religious Studies & Philosophy**: Philosophy of religion, comparative religion, epistemology, phenomenology
- **Archaeology & Prehistory**: Paleolithic cave art, prehistoric ritual use of psychoactive substances, evolution of religious behavior
- **Social Psychology**: Group dynamics, collective effervescence, prosocial behavior, empathy research

We've done the work. We've tracked down the actual papers. We dare you to click any citation and see for yourself.

<div id="bibliography-container">
  <p style="font-style: italic; color: #888;">Bibliography loading...</p>
</div>

<script src="/js/salmonAnimation.js"></script>
<script src="/js/bibliographyEffects.js"></script>
<script src="/js/ifsSimulatorEntrance.js"></script>
