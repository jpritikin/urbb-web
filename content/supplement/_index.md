---
title: "Online Supplement"
version: "v1.4.8"
---

## What is This?

An **online supplement** extends a printed book into the digital realm. It offers materials that don't translate well to 📄 paper. This supplement offers an interactive IFS (Internal Family Systems) therapist simulator, Santo Daime hymn recordings, and an interactive bibliography with direct links to peer reviewed academic sources. These resources complement the printed text.

## What is Internal Family Systems (IFS)?

Religion and mental health have always overlapped in their attempts to understand troubled minds. Is that voice divine revelation or auditory hallucination? Is ego dissolution mystical or pathological? Religious traditions developed frameworks like spirit possession 👻 and contemplative practices 🧘 to address such questions. Modern mental health professionals inherit these challenges. They encounter the same phenomena—voices, ego dissolution, altered states—but interpret them through secular frameworks rather than religious ones.

Internal Family Systems (IFS) is a transformative therapeutic approach developed by Dr. Richard Schwartz. It's based on the recognition that our psyche is naturally multiple—composed of various sub-personalities or "parts"—and that this multiplicity is not pathological but normal.

This psychological framework serves the book in two ways. Proactively, we need to recognize when religious practices risk causing harm and know how to adjust or abandon such practices. 🛡️ Reactively, we need to recognize tenacious inner conflicts and know how to facilitate dialogue that de-escalates the tensions between polarized sides. 💬

### Therapist Simulator

Various apps exist to help IFS clients map their parts—tracking protectors, exiles, and their relationships in visual diagrams. 🗺️ These tools serve a real purpose. But we're doing something different here.

This simulator opens a window into what it's like to *be* an IFS therapist. You'll practice the therapeutic stance: curious but not intrusive, present but not directive, holding space while the client's simulated parts reveal themselves at their own pace. The work isn't about cataloging your internal system. It's about experiencing the therapist's perspective—a mashup of [Oregon Trail](https://oregontrail.ws/games/the-oregon-trail/)-style gameplay and therapeutic choices.

Whether you're considering IFS therapy, already working with a therapist, or training to become one yourself, this simulator offers direct experience with the therapeutic process from the therapist's perspective.

<div id="ifs-intro-container">
  <button id="enter-simulator-btn" class="simulator-enter-button">
    Enter IFS Simulator
  </button>
</div>

## Hymn Player

[Santo Daime](https://www.santodaime.org/) is a Brazilian ayahuasca religion where participants drink a psychoactive brew and then—here's the interesting part—maintain external focus through synchronized hymn singing and ritual movements. While the drug pulls attention inward toward private visions, the discipline (called *firmeza* or "firmness") is staying anchored in shared reality with the community. The hymns function as collective reference points 🎵, objects of mutual attention that help everyone navigate altered states together rather than drifting into isolated experiences (more details in chapter 7).

The recordings here exist somewhere in the liminal space between "technically adequate" and "why did he think this was a good idea?" The author, possessing neither musical training nor appropriate shame, recorded himself singing these hymns in multitrack (at least 3 layers of his own voice, no instruments). Multiple voices is how these hymns would always be heard in actual Santo Daime rituals—and conveniently, the layering helps conceal the author's weakness in Portuguese pronunciation. Listen to at least one.

Maybe learn the melody to "Examine A Consciência" while doing dishes. Hum along awkwardly in your kitchen. Let us share a few moments before you return to your regularly scheduled doomscrolling. Have mercy on my needy parts that are deeply embarrassed about making this emotional appeal but are doing it anyway because the alternative feels somehow worse.

<div id="cassette-player-container">
  <div id="cassette-deck">
    <div id="salmon-container">
      <canvas id="salmon-canvas"></canvas>
    </div>
    <div class="hymn-player">
      <audio id="hymn-audio" preload="metadata">
        <source id="hymn-source" src="" type="audio/mpeg">
      </audio>
      <div id="player-controls">
        <button id="play-pause-btn" disabled>▶</button>
        <button id="loop-btn" title="Loop current track">🔁</button>
        <button id="play-next-btn" class="active" title="Play through all available hymns">⏭️</button>
        <div id="current-hymn-display">No cassette loaded</div>
      </div>
    </div>
  </div>

  <div id="hymn-list-container">
    <div id="hymn-list-scroll">
      <div id="hymn-list">
        <div class="hymn-item unlocked" data-hymn="examine-a-consciência" data-title="Examine A Consciência">
          <span class="hymn-title">Examine A Consciência</span>
        </div>
        <div class="hymn-item locked" data-hymn="eu-não-sou-deus" data-title="Eu Não Sou Deus">
          <span class="hymn-title">Eu Não Sou Deus</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item unlocked" data-hymn="a-força-e-a-verdade" data-title="A Força E A Verdade">
          <span class="hymn-title">A Força E A Verdade</span>
        </div>
        <div class="hymn-item unlocked" data-hymn="não-creia-nos-mestres" data-title="Não Creia Nos Mestres Que Te Aparecem">
          <span class="hymn-title">Não Creia Nos Mestres Que Te Aparecem</span>
        </div>
        <div class="hymn-item locked" data-hymn="eu-pedi-uma-graça" data-title="Eu Pedi Uma Graça">
          <span class="hymn-title">Eu Pedi Uma Graça</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item unlocked" data-hymn="sentado-no-trono" data-title="Sentado No Trono">
          <span class="hymn-title">Sentado No Trono</span>
        </div>
        <div class="hymn-item unlocked" data-hymn="centro-livre" data-title="Centro Livre">
          <span class="hymn-title">Centro Livre</span>
        </div>
        <div class="hymn-item locked" data-hymn="o-santo-daime-me-chamou" data-title="O Santo Daime Me Chamou">
          <span class="hymn-title">O Santo Daime Me Chamou</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item unlocked" data-hymn="hospital-divino" data-title="Hospital Divino">
          <span class="hymn-title">Hospital Divino</span>
        </div>
        <div class="hymn-item unlocked" data-hymn="chamo-a-força" data-title="Chamo A Força">
          <span class="hymn-title">Chamo A Força</span>
        </div>
        <div class="hymn-item locked" data-hymn="estou-aqui" data-title="Estou Aqui">
          <span class="hymn-title">Estou Aqui</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item locked" data-hymn="batalha" data-title="Batalha">
          <span class="hymn-title">Batalha</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item locked" data-hymn="o-daime-é-o-daime" data-title="O Daime É O Daime">
          <span class="hymn-title">O Daime É O Daime</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item locked" data-hymn="linha-do-tucum" data-title="Linha Do Tucum">
          <span class="hymn-title">Linha Do Tucum</span>
          <span class="hymn-lock">🔒</span>
        </div>
        <div class="hymn-item unlocked" data-hymn="deus-é-para-todos" data-title="Deus É Para Todos">
          <span class="hymn-title">Deus É Para Todos</span>
        </div>
        <div class="hymn-item unlocked" data-hymn="eu-provo-com-os-meus-irmãos" data-title="Eu Provo Com Os Meus Irmãos">
          <span class="hymn-title">Eu Provo Com Os Meus Irmãos</span>
        </div>
        <div class="hymn-item unlocked" data-hymn="brilho-do-sol" data-title="Brilho do Sol">
          <span class="hymn-title">Brilho do Sol</span>
        </div>
        <div class="hymn-item unlocked" data-hymn="sol-lua-estrela" data-title="Sol, Lua, Estrela">
          <span class="hymn-title">Sol, Lua, Estrela</span>
        </div>
        <div class="hymn-item locked" data-hymn="mamãe-vosso-brilho-é-tão-lindo" data-title="Mamãe Vosso Brilho É Tão Lindo">
          <span class="hymn-title">Mamãe Vosso Brilho É Tão Lindo</span>
          <span class="hymn-lock">🔒</span>
        </div>
      </div>
    </div>
    <p style="margin-top: 1rem; font-size: 0.9rem; color: #888; font-style: italic;">
      <strong>About locked hymns:</strong> The 🔒 locked recordings are only available as part of the audiobook. If you'd like access to the full collection, consider purchasing the audiobook.
    </p>
  </div>
</div>

## Bibliography

You know those spiritual bestsellers that open each chapter with a quote from the Upanishads? The ones invoking "quantum principles" and "the field of pure potentiality"? That distill millennia of Eastern philosophy into exactly seven convenient laws? That present "universal energy" and "infinite organizing power" as self-evident truths requiring no empirical support beyond Rumi agreeing with Lao Tzu? The ones that never cite a single peer-reviewed study?

Here, every claim (where possible) connects to peer-reviewed research across multiple disciplines:

- <span class="bib-filter-label" data-filter="psychology">**Psychology & Psychotherapy**</span>: <span class="bib-filter" data-filter="psychology">Clinical psychology</span>, <span class="bib-filter" data-filter="psychology">developmental psychology</span>, <span class="bib-filter" data-filter="psychology">Internal Family Systems</span>, <span class="bib-filter" data-filter="psychology">attachment theory</span>, <span class="bib-filter" data-filter="psychology">trauma treatment</span>
- <span class="bib-filter-label" data-filter="psychopharmacology">**Psychopharmacology**</span>: <span class="bib-filter" data-filter="psychopharmacology">Psychedelic research</span>, <span class="bib-filter" data-filter="psychopharmacology">cannabinoid science</span>, <span class="bib-filter" data-filter="psychopharmacology">neurochemistry</span>, <span class="bib-filter" data-filter="psychopharmacology">pharmacokinetics</span>
- <span class="bib-filter-label" data-filter="neuroscience">**Neuroscience & Consciousness Studies**</span>: <span class="bib-filter" data-filter="neuroscience">Cognitive neuroscience</span>, <span class="bib-filter" data-filter="neuroscience">neurophenomenology</span>, <span class="bib-filter" data-filter="neuroscience">phenomenology of consciousness</span>, <span class="bib-filter" data-filter="neuroscience">altered states research</span>
- <span class="bib-filter-label" data-filter="contemplative">**Contemplative Science**</span>: <span class="bib-filter" data-filter="contemplative">Meditation research</span>, <span class="bib-filter" data-filter="contemplative">mindfulness studies</span>, <span class="bib-filter" data-filter="contemplative">mystical experience measurement</span>
- <span class="bib-filter-label" data-filter="anthropology">**Anthropology & Ethnography**</span>: <span class="bib-filter" data-filter="anthropology">Religious anthropology</span>, <span class="bib-filter" data-filter="anthropology">ayahuasca traditions</span>, <span class="bib-filter" data-filter="anthropology">cross-cultural ritual practices</span>, <span class="bib-filter" data-filter="anthropology">Santo Daime ethnography</span>
- <span class="bib-filter-label" data-filter="religious-studies">**Religious Studies & Philosophy**</span>: <span class="bib-filter" data-filter="religious-studies">Philosophy of religion</span>, <span class="bib-filter" data-filter="religious-studies">comparative religion</span>, <span class="bib-filter" data-filter="religious-studies">epistemology</span>, <span class="bib-filter" data-filter="religious-studies">phenomenology</span>
- <span class="bib-filter-label" data-filter="archaeology">**Archaeology & Prehistory**</span>: <span class="bib-filter" data-filter="archaeology">Paleolithic cave art</span>, <span class="bib-filter" data-filter="archaeology">prehistoric ritual use of psychoactive substances</span>, <span class="bib-filter" data-filter="archaeology">evolution of religious behavior</span>
- <span class="bib-filter-label" data-filter="social-psychology">**Social Psychology**</span>: <span class="bib-filter" data-filter="social-psychology">Group dynamics</span>, <span class="bib-filter" data-filter="social-psychology">collective effervescence</span>, <span class="bib-filter" data-filter="social-psychology">prosocial behavior</span>, <span class="bib-filter" data-filter="social-psychology">empathy research</span>

We've done the work. We've tracked down the actual papers. We dare you to click any citation and see for yourself.

<div id="bibliography-container">
  <p style="font-style: italic; color: #888;">Bibliography loading...</p>
</div>
