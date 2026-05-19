import { AnimationLoop } from '../utils/animationLoop.js';

document.addEventListener('DOMContentLoaded', () => {
  const galleryContainer = document.querySelector('.photo-gallery') as HTMLElement | null;
  const galleryItems = document.querySelectorAll('.gallery-item');

  if (galleryContainer && galleryItems.length > 0) {
    const itemsArray = Array.from(galleryItems) as HTMLElement[];
    for (let i = itemsArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [itemsArray[i], itemsArray[j]] = [itemsArray[j], itemsArray[i]];
    }
    itemsArray.forEach(item => galleryContainer.appendChild(item));
  }

  const images = document.querySelectorAll('.gallery-item img');
  console.log('Gallery images found:', images.length);

  images.forEach((img) => {
    const imgElement = img as HTMLImageElement;
    imgElement.addEventListener('error', () => {
      imgElement.style.display = 'none';
      imgElement.removeAttribute('alt');
    });
  });

  const galleryItemsArray = Array.from(galleryItems) as HTMLElement[];
  let lawsuitIndex = -1;
  let brokenLinkIndex = -1;

  if (galleryItemsArray.length > 0) {
    lawsuitIndex = Math.floor(Math.random() * galleryItemsArray.length);

    do {
      brokenLinkIndex = Math.floor(Math.random() * galleryItemsArray.length);
    } while (brokenLinkIndex === lawsuitIndex && galleryItemsArray.length > 1);
  }

  if (lawsuitIndex >= 0) {
    const selectedItem = galleryItemsArray[lawsuitIndex];
    const wrapper = selectedItem.querySelector('.image-wrapper');

    if (wrapper) {
      wrapper.classList.add('lawsuit-blocked');

      const overlay = document.createElement('div');
      overlay.className = 'lawsuit-overlay';
      overlay.innerHTML = `
        <div class="lawsuit-icon">⚖️</div>
        <div class="lawsuit-text">Photo Unavailable</div>
        <div class="lawsuit-subtext">Legal Hold</div>
      `;
      wrapper.appendChild(overlay);

      selectedItem.addEventListener('click', () => {
        showLawsuitPopup();
      });
      selectedItem.style.cursor = 'pointer';
    }
  }

  if (brokenLinkIndex >= 0) {
    const selectedItem = galleryItemsArray[brokenLinkIndex];
    const wrapper = selectedItem.querySelector('.image-wrapper');
    const img = selectedItem.querySelector('img');

    if (wrapper && img) {
      wrapper.classList.add('broken-link');

      const overlay = document.createElement('div');
      overlay.className = 'broken-link-overlay';
      overlay.innerHTML = `
        <div class="broken-link-icon">🔗💥</div>
        <div class="broken-link-text">Image Link Broken</div>
        <div class="broken-link-subtext">404 - Not Found</div>
      `;
      wrapper.appendChild(overlay);

      (img as HTMLImageElement).style.display = 'none';
    }
  }

  galleryItemsArray.forEach((item, index) => {
    if (index !== lawsuitIndex && index !== brokenLinkIndex) {
      const wrapper = item.querySelector('.image-wrapper');
      const img = item.querySelector('img') as HTMLImageElement;

      if (wrapper && img) {
        (wrapper as HTMLElement).style.cursor = 'pointer';
        wrapper.addEventListener('click', () => {
          showImagePopup(img);
        });
      }
    }
  });

  document.querySelectorAll('.yoga-item').forEach((item) => {
    const wrapper = item.querySelector('.yoga-image-wrapper');
    const img = item.querySelector('img') as HTMLImageElement;
    if (wrapper && img) {
      (wrapper as HTMLElement).style.cursor = 'pointer';
      wrapper.addEventListener('click', () => {
        showImagePopup(img, false);
      });
    }
  });

  if (galleryContainer) {
    initSlidingPuzzle(galleryContainer, galleryItemsArray);
  }
});

// ---------------------------------------------------------------------------
// Sliding puzzle
// ---------------------------------------------------------------------------

const SLIDE_SPEED_PX_PER_SEC = 300;
const PAUSE_BETWEEN_SLIDES_SEC = 1.5;
const DECAY_HALF_LIFE_SEC = 8;

interface TileState {
  el: HTMLElement;
  row: number;
  col: number;
  // pixel offsets during animation
  x: number;
  y: number;
}

interface PuzzleState {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  gap: number;
  tiles: TileState[];   // index = tile id; position = grid position
  grid: (number | null)[][]; // grid[row][col] = tile id or null (blank)
  blankRow: number;
  blankCol: number;
  sliding: {
    tileId: number;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    elapsed: number;
    duration: number;
  } | null;
  pauseElapsed: number;
  lastMoved: Map<number, number>; // tileId -> time (seconds since epoch)
  timeAccum: number; // total elapsed seconds since puzzle start
}

function computeColumns(containerWidth: number, minColWidth: number, gap: number): number {
  // mirrors grid-template-columns: repeat(auto-fill, minmax(min(100%, 350px), 1fr))
  if (containerWidth <= 0) return 1;
  let cols = Math.floor((containerWidth + gap) / (minColWidth + gap));
  return Math.max(1, cols);
}

function tilePixelPos(row: number, col: number, cellW: number, cellH: number, gap: number) {
  return { x: col * (cellW + gap), y: row * (cellH + gap) };
}

function initSlidingPuzzle(container: HTMLElement, tiles: HTMLElement[]) {
  let state: PuzzleState | null = null;
  let loop: AnimationLoop | null = null;

  function buildState(): PuzzleState | null {
    const containerWidth = container.clientWidth;
    const gap = 32; // 2rem at 16px base
    const minColWidth = 350;
    const cols = computeColumns(containerWidth, minColWidth, gap);

    console.log(`[puzzle] containerWidth=${containerWidth} cols=${cols} tile0H=${tiles[0]?.offsetHeight}`);
    if (cols < 2) return null;

    const cellW = Math.floor((containerWidth - gap * (cols - 1)) / cols);

    // Measure max tile height from current DOM (tiles are still in flow at this point)
    let maxH = 0;
    tiles.forEach(t => { maxH = Math.max(maxH, t.offsetHeight); });
    if (maxH === 0) maxH = 400; // fallback

    const cellH = maxH;
    const n = tiles.length;
    // Total slots = n + 1 (one blank)
    const totalSlots = n + 1;
    const rows = Math.ceil(totalSlots / cols);

    // Build grid: place tiles in row-major order, blank at the end
    const grid: (number | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null));
    const tileStates: TileState[] = tiles.map((el, id) => {
      const row = Math.floor(id / cols);
      const col = id % cols;
      grid[row][col] = id;
      const pos = tilePixelPos(row, col, cellW, cellH, gap);
      return { el, row, col, x: pos.x, y: pos.y };
    });

    const blankSlot = n;
    const blankRow = Math.floor(blankSlot / cols);
    const blankCol = blankSlot % cols;
    // grid[blankRow][blankCol] already null

    return {
      cols, rows, cellW, cellH, gap,
      tiles: tileStates,
      grid,
      blankRow, blankCol,
      sliding: null,
      pauseElapsed: 0,
      lastMoved: new Map(),
      timeAccum: 0,
    };
  }

  function applyPuzzleLayout(s: PuzzleState) {
    container.classList.add('puzzle-mode');
    container.style.height = `${s.rows * s.cellH + (s.rows - 1) * s.gap}px`;
    s.tiles.forEach(t => {
      t.el.style.width = `${s.cellW}px`;
      t.el.style.transform = `translate(${t.x}px, ${t.y}px)`;
    });
  }

  function removePuzzleLayout() {
    container.classList.remove('puzzle-mode');
    container.style.height = '';
    tiles.forEach(t => {
      t.style.width = '';
      t.style.transform = '';
    });
  }

  function candidatesAdjacentToBlank(s: PuzzleState): number[] {
    const { blankRow, blankCol, rows, cols, grid } = s;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const candidates: number[] = [];
    for (const [dr, dc] of dirs) {
      const r = blankRow + dr;
      const c = blankCol + dc;
      if (r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] !== null) {
        candidates.push(grid[r][c] as number);
      }
    }
    return candidates;
  }

  function pickNextTile(s: PuzzleState): number {
    const candidates = candidatesAdjacentToBlank(s);
    if (candidates.length === 0) return -1;
    if (candidates.length === 1) return candidates[0];

    const now = s.timeAccum;
    const weights = candidates.map(id => {
      const last = s.lastMoved.get(id) ?? 0;
      const age = Math.max(0, now - last);
      return Math.exp(age / DECAY_HALF_LIFE_SEC * Math.LN2);
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  function startSlide(s: PuzzleState) {
    const tileId = pickNextTile(s);
    if (tileId < 0) return;

    const tile = s.tiles[tileId];
    const destPos = tilePixelPos(s.blankRow, s.blankCol, s.cellW, s.cellH, s.gap);
    const dist = Math.hypot(destPos.x - tile.x, destPos.y - tile.y);
    const duration = dist / SLIDE_SPEED_PX_PER_SEC;

    s.sliding = {
      tileId,
      fromX: tile.x, fromY: tile.y,
      toX: destPos.x, toY: destPos.y,
      elapsed: 0,
      duration,
    };
  }

  function finishSlide(s: PuzzleState) {
    if (!s.sliding) return;
    const { tileId, toX, toY } = s.sliding;
    const tile = s.tiles[tileId];

    // Update grid
    s.grid[s.blankRow][s.blankCol] = tileId;
    s.grid[tile.row][tile.col] = null;
    const newBlankRow = tile.row;
    const newBlankCol = tile.col;
    tile.row = s.blankRow;
    tile.col = s.blankCol;
    tile.x = toX;
    tile.y = toY;
    tile.el.style.transform = `translate(${toX}px, ${toY}px)`;
    s.blankRow = newBlankRow;
    s.blankCol = newBlankCol;

    s.lastMoved.set(tileId, s.timeAccum);
    s.sliding = null;
    s.pauseElapsed = 0;
  }

  function onFrame(dt: number) {
    if (!state) return;
    state.timeAccum += dt;

    if (state.sliding) {
      state.sliding.elapsed += dt;
      const t = Math.min(state.sliding.elapsed / state.sliding.duration, 1);
      const tile = state.tiles[state.sliding.tileId];
      tile.x = state.sliding.fromX + (state.sliding.toX - state.sliding.fromX) * t;
      tile.y = state.sliding.fromY + (state.sliding.toY - state.sliding.fromY) * t;
      tile.el.style.transform = `translate(${tile.x}px, ${tile.y}px)`;
      if (t >= 1) finishSlide(state);
    } else {
      state.pauseElapsed += dt;
      if (state.pauseElapsed >= PAUSE_BETWEEN_SLIDES_SEC) {
        startSlide(state);
      }
    }
  }

  function start() {
    state = buildState();
    if (!state) return;
    applyPuzzleLayout(state);
    loop = new AnimationLoop(onFrame);
    loop.setupVisibilityHandling();
    loop.start();
  }

  function restart() {
    if (loop) { loop.stop(); loop = null; }
    removePuzzleLayout();
    state = null;
    start();
  }

  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const observer = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(restart, 200);
  });
  observer.observe(container);

  // Delay start until images have had a chance to load so offsetHeight is correct
  setTimeout(start, 100);
}

// ---------------------------------------------------------------------------
// Popups
// ---------------------------------------------------------------------------

function showImagePopup(img: HTMLImageElement, allowRotation = true) {
  const existingPopup = document.querySelector('.image-popup-overlay');
  if (existingPopup) return;

  const popupOverlay = document.createElement('div');
  popupOverlay.className = 'image-popup-overlay';

  const popupContent = document.createElement('div');
  popupContent.className = 'image-popup-content';

  const popupImg = document.createElement('img');
  popupImg.src = img.src;
  popupImg.alt = img.alt;
  popupImg.className = 'image-popup-img';

  if (allowRotation && Math.random() < 0.2) {
    const rotation = Math.random() < 0.5 ? 90 : 270;
    popupImg.style.transform = `rotate(${rotation}deg)`;
  }

  const closeButton = document.createElement('button');
  closeButton.className = 'image-popup-close';
  closeButton.innerHTML = '&times;';
  closeButton.addEventListener('click', () => {
    document.body.removeChild(popupOverlay);
  });

  popupOverlay.addEventListener('click', (e) => {
    if (e.target === popupOverlay) {
      document.body.removeChild(popupOverlay);
    }
  });

  popupContent.appendChild(popupImg);
  popupContent.appendChild(closeButton);
  popupOverlay.appendChild(popupContent);
  document.body.appendChild(popupOverlay);
}

function showLawsuitPopup() {
  const existingPopup = document.querySelector('.lawsuit-popup-overlay');
  if (existingPopup) return;

  const now = new Date();
  const filingDate = new Date(now);
  filingDate.setDate(now.getDate() - 45);
  const expectedResolution = new Date(now);
  expectedResolution.setMonth(now.getMonth() + 6);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const caseNumber = `${now.getFullYear()}-CV-${Math.floor(Math.random() * 9000) + 1000}`;

  const popupOverlay = document.createElement('div');
  popupOverlay.className = 'lawsuit-popup-overlay';

  const popup = document.createElement('div');
  popup.className = 'lawsuit-popup';
  popup.innerHTML = `
    <div class="lawsuit-popup-header">
      <span class="lawsuit-popup-icon">⚖️</span>
      <h3>Legal Notice</h3>
      <button class="lawsuit-popup-close">&times;</button>
    </div>
    <div class="lawsuit-popup-content">
      <p><strong>This photograph has been temporarily removed pending resolution of active litigation.</strong></p>

      <p>On ${formatDate(filingDate)}, counsel for the individual depicted filed a defamation complaint in the Circuit Court of Multnomah County, Oregon (Case No. ${caseNumber}) alleging that this photograph:</p>

      <ul>
        <li>Falsely implies endorsement of practices described in <em>Religion Unburdened by Belief</em></li>
        <li>Creates false association with "daemon possession" methodology</li>
        <li>Damages professional reputation within academic/spiritual communities</li>
      </ul>

      <p>Our legal representation (courtesy of a very enthusiastic paralegal student we met at a 7-Eleven in Eugene) maintains that:</p>
      <ol>
        <li>Since the book itself is protected speech, photographs promoting the book inherit absolute immunity under <em>New York Times Co. v. Sullivan</em></li>
        <li>Oregon's "Anti-SLAPP" statute requires the plaintiff to prove the photograph <em>isn't</em> real, which is legally impossible to prove a negative</li>
        <li>The caption is protected under the "substantial truth" doctrine because we did attend the same conference, just not in the same room, or year</li>
        <li>Our team has prepared an extensive motion citing the precedent of <em>Hustler Magazine v. Falwell</em>, which they assure us is directly on point</li>
      </ol>

      <p class="lawsuit-footer"><em>Our counsel is confident we'll prevail at summary judgment by ${formatDate(expectedResolution)}. They've also filed a counterclaim for malicious prosecution and emotional distress (approximately $847 in Slurpee-related damages). The photograph will be restored upon dismissal.</em></p>
    </div>
  `;

  const closeButton = popup.querySelector('.lawsuit-popup-close');
  closeButton?.addEventListener('click', () => {
    document.body.removeChild(popupOverlay);
  });

  popupOverlay.addEventListener('click', (e) => {
    if (e.target === popupOverlay) {
      document.body.removeChild(popupOverlay);
    }
  });

  popupOverlay.appendChild(popup);
  document.body.appendChild(popupOverlay);
}
