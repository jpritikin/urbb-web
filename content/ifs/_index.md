---
title: "IFS Simulator"
version: "v1.1.0"
---

<link rel="stylesheet" href="/css/animations.css">
<link rel="stylesheet" href="/css/ifs.css">
<script type="module" src="/js/ifs.js"></script>

<div id="cloud-container"></div>

<div id="cloud-controls">
  <h3>Cloud Generator Controls</h3>
  <div class="control-row">
    <div>
      <label for="cloud-word">Word:</label>
      <input type="text" id="cloud-word" value="protector">
    </div>
    <div>
      <label for="cloud-type">Type:</label>
      <select id="cloud-type">
        <option value="stratocumulus">Stratocumulus</option>
        <option value="cumulus" selected>Cumulus</option>
      </select>
    </div>
    <div>
      <label for="cloud-zoom">Zoom:</label>
      <input type="range" id="cloud-zoom" min="0.5" max="5" step="0.1" value="1">
      <span id="zoom-value">1.0x</span>
    </div>
    <div>
      <label>
        <input type="checkbox" id="cloud-debug" checked>
        Debug mode
      </label>
    </div>
  </div>
  <div class="button-row">
    <button id="cloud-add">Add Cloud</button>
    <button id="cloud-clear">Clear All</button>
  </div>
  <div id="knot-positions" style="margin-top: 1em; padding: 0.5em; border: 1px dotted #666; font-size: 0.85em; max-height: 300px; overflow-y: auto;">
    No cloud selected
  </div>
</div>
