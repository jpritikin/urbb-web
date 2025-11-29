---
title: "Online Supplement"
---

<link rel="stylesheet" href="/css/supplement.css">

## Hymn Player

<div id="cassette-player-container">
  <div id="cassette-deck">
    <div id="salmon-container">
      <canvas id="salmon-canvas" width="400" height="300"></canvas>
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
    <div id="hymn-list">
      <div class="hymn-item unlocked" data-hymn="examine-a-consciencia" data-title="Examine A Consciência">
        <span class="hymn-number">71</span>
        <span class="hymn-title">Examine A Consciência</span>
      </div>
      <div class="hymn-item unlocked" data-hymn="eu-nao-sou-deus" data-title="Eu Não Sou Deus">
        <span class="hymn-number">152</span>
        <span class="hymn-title">Eu Não Sou Deus</span>
      </div>
      <div class="hymn-item locked" data-hymn="a-forca-e-a-verdade" data-title="A Força E A Verdade">
        <span class="hymn-number">11</span>
        <span class="hymn-title">A Força E A Verdade</span>
        <span class="hymn-lock">🔒</span>
      </div>
      <div class="hymn-item locked" data-hymn="eu-pedi-uma-graca" data-title="Eu Pedi Uma Graça">
        <span class="hymn-number">54</span>
        <span class="hymn-title">Eu Pedi Uma Graça</span>
        <span class="hymn-lock">🔒</span>
      </div>
      <div class="hymn-item unlocked" data-hymn="sentado-no-trono" data-title="Sentado No Trono">
        <span class="hymn-number">59</span>
        <span class="hymn-title">Sentado No Trono</span>
      </div>
      <div class="hymn-item locked" data-hymn="centro-livre" data-title="Centro Livre">
        <span class="hymn-number">39</span>
        <span class="hymn-title">Centro Livre</span>
        <span class="hymn-lock">🔒</span>
      </div>
      <div class="hymn-item locked" data-hymn="o-santo-daime-me-chamou" data-title="O Santo Daime Me Chamou">
        <span class="hymn-number">50</span>
        <span class="hymn-title">O Santo Daime Me Chamou</span>
        <span class="hymn-lock">🔒</span>
      </div>
      <div class="hymn-item locked" data-hymn="hospital-divino" data-title="Hospital Divino">
        <span class="hymn-number">62</span>
        <span class="hymn-title">Hospital Divino</span>
        <span class="hymn-lock">🔒</span>
      </div>
      <div class="hymn-item locked" data-hymn="chamo-a-forca" data-title="Chamo A Força">
        <span class="hymn-number">—</span>
        <span class="hymn-title">Chamo A Força</span>
        <span class="hymn-lock">🔒</span>
      </div>
      <div class="hymn-item locked" data-hymn="estou-aqui" data-title="Estou Aqui">
        <span class="hymn-number">111</span>
        <span class="hymn-title">Estou Aqui</span>
        <span class="hymn-lock">🔒</span>
      </div>
      <div class="hymn-item locked" data-hymn="batalha" data-title="Batalha">
        <span class="hymn-number">115</span>
        <span class="hymn-title">Batalha</span>
        <span class="hymn-lock">🔒</span>
      </div>
      <div class="hymn-item locked" data-hymn="o-daime-e-o-daime" data-title="O Daime É O Daime">
        <span class="hymn-number">84</span>
        <span class="hymn-title">O Daime É O Daime</span>
        <span class="hymn-lock">🔒</span>
      </div>
      <div class="hymn-item locked" data-hymn="linha-do-tucum" data-title="Linha Do Tucum">
        <span class="hymn-number">108</span>
        <span class="hymn-title">Linha Do Tucum</span>
        <span class="hymn-lock">🔒</span>
      </div>
      <div class="hymn-item locked" data-hymn="deus-e-para-todos" data-title="Deus É Para Todos">
        <span class="hymn-number">115</span>
        <span class="hymn-title">Deus É Para Todos</span>
        <span class="hymn-lock">🔒</span>
      </div>
      <div class="hymn-item locked" data-hymn="eu-provo-com-os-meus-irmaos" data-title="Eu Provo Com Os Meus Irmãos">
        <span class="hymn-number">8</span>
        <span class="hymn-title">Eu Provo Com Os Meus Irmãos</span>
        <span class="hymn-lock">🔒</span>
      </div>
      <div class="hymn-item unlocked" data-hymn="brilho-do-sol" data-title="Brilho do Sol">
        <span class="hymn-number">26</span>
        <span class="hymn-title">Brilho do Sol</span>
      </div>
    </div>
  </div>
</div>

## Bibliography

<div id="bibliography-container">
  <p style="font-style: italic; color: #888;">Bibliography loading...</p>
</div>

<script src="/js/salmonAnimation.js"></script>
<script src="/js/bibliographyEffects.js"></script>
