const CANVAS_SIZE = 400;
const ROOT_CELL_SCALE = 8;
const NOISE_ALPHA = 120;

const LEVEL_COLORS: Record<number, string> = {
  8: 'rgba(220, 38, 38, 0.7)',
  4: 'rgba(234, 88, 12, 0.7)',
  2: 'rgba(22, 163, 74, 0.7)',
  1: 'rgba(37, 99, 235, 0.7)',
  0: 'rgba(120, 120, 120, 0.4)',
};

const UNCLAIMED = 0, CLAIMED = 1, MID = 2, MID_GAP = 3, GAP = 4;

interface FractalParams {
  drift: number;
  iOdds: number;
  jOdds: number;
  seed: number;
}

class SeededRNG {
  private s: number;
  constructor(seed: number) { this.s = seed | 0; }
  next(): number {
    this.s = (this.s * 1664525 + 1013904223) & 0x7fffffff;
    return this.s / 0x7fffffff;
  }
  randRange(n: number): number { return Math.floor(this.next() * n); }
}

interface LatticeGeometry {
  origin: [number, number];
  e1: [number, number];
  e2: [number, number];
  unitLen: number;
  driftScale: number;
}

function latticeToPixel(
  I: number, J: number, geo: LatticeGeometry, driftRate: number
): [number, number] {
  const dx = (I * geo.unitLen) * geo.e1[0] + (J * geo.unitLen) * geo.e2[0];
  const dy = (I * geo.unitLen) * geo.e1[1] + (J * geo.unitLen) * geo.e2[1];
  const r = Math.hypot(dx, dy);
  const swirl = driftRate * geo.driftScale / (r + geo.driftScale);
  const theta = Math.atan2(dy, dx) + swirl;
  return [geo.origin[0] + r * Math.cos(theta), geo.origin[1] + r * Math.sin(theta)];
}

// Segment stored as lattice index pairs (drift-independent topology)
interface IndexSegment { ai: number; aj: number; bi: number; bj: number; scale: number }

interface GapEntry {
  gpoint: [number, number]; angle: number;
  stepI: number; stepJ: number; seedScale: number | null;
}

interface FractalTopology {
  segments: IndexSegment[];
  geo: LatticeGeometry;
  maxIJ: number;
}

function buildLattice(
  globalOrigin: [number, number], initialAngle: number, cellScale: number,
  required: Set<string>, lattice: Map<string, number>,
  stepI: number, stepJ: number, segments: IndexSegment[], gaps: GapEntry[],
  geo: LatticeGeometry, driftRate: number,
  iOdds: number, jOdds: number, rng: SeededRNG
) {
  const k = (i: number, j: number) => `${i},${j}`;
  const isUnclaimed = (gi: number, gj: number) => (lattice.get(k(gi, gj)) ?? UNCLAIMED) === UNCLAIMED;

  const globalPositions = new Map<string, [number, number]>();
  globalPositions.set(k(0, 0), globalOrigin);
  const parentEdge = new Map<string, { gstart: [number, number]; gend: [number, number] }>();

  const frontier: [number, number, number, number][] = [
    [0, 0, stepI, 0], [0, 0, 0, stepJ]
  ];

  while (frontier.length > 0) {
    const idx = rng.randRange(frontier.length);
    const [i, j, ni, nj] = frontier[idx];
    frontier[idx] = frontier[frontier.length - 1];
    frontier.pop();

    const gstart = globalPositions.get(k(i, j))!;
    const isIStep = ni === i + stepI && nj === j;
    const gstep: [number, number] = isIStep
      ? [cellScale * stepI, 0] : [0, cellScale * stepJ];
    const angle = initialAngle + (isIStep ? Math.PI / 4 : -Math.PI / 4);
    const gend: [number, number] = [gstart[0] + gstep[0], gstart[1] + gstep[1]];

    const midIndices: [number, number][] = [];
    for (let m = 1; m < cellScale; m++) {
      midIndices.push([
        gstart[0] + (gstep[0] * m) / cellScale,
        gstart[1] + (gstep[1] * m) / cellScale
      ]);
    }

    if (!isUnclaimed(gend[0], gend[1]) || midIndices.some(([mi, mj]) => !isUnclaimed(mi, mj))) {
      const pe = parentEdge.get(k(i, j));
      if (pe) {
        const gmid: [number, number] = [(pe.gstart[0] + pe.gend[0]) / 2, (pe.gstart[1] + pe.gend[1]) / 2];
        const mid = latticeToPixel(gmid[0], gmid[1], geo, driftRate);
        const outward = [mid[0] - geo.origin[0], mid[1] - geo.origin[1]];
        const direction = [Math.cos(angle), Math.sin(angle)];
        if (outward[0] * direction[0] + outward[1] * direction[1] > 0 && isUnclaimed(gmid[0], gmid[1])) {
          lattice.set(k(gmid[0], gmid[1]), GAP);
          gaps.push({ gpoint: gmid, angle: initialAngle, stepI, stepJ, seedScale: null });
        }
      }
      continue;
    }

    if (!required.has(k(gend[0], gend[1]))) continue;

    lattice.set(k(gstart[0], gstart[1]), CLAIMED);
    lattice.set(k(gend[0], gend[1]), CLAIMED);

    const half = cellScale / 2;
    for (let m = 1; m < cellScale; m++) {
      const mi = midIndices[m - 1];
      const seedScale = m & -m;
      const statusCode = seedScale === half ? MID_GAP : MID;
      lattice.set(k(mi[0], mi[1]), statusCode);
      gaps.push({ gpoint: mi, angle: initialAngle, stepI, stepJ, seedScale });
    }

    gaps.push({ gpoint: gstart, angle: initialAngle, stepI, stepJ, seedScale: null });
    gaps.push({ gpoint: gend, angle: initialAngle, stepI, stepJ, seedScale: null });

    globalPositions.set(k(ni, nj), gend);
    parentEdge.set(k(ni, nj), { gstart, gend });

    const isAxisEdge = (gstart[0] === gend[0] && gstart[0] === 0) || (gstart[1] === gend[1] && gstart[1] === 0);
    if (!isAxisEdge) {
      const points: [number, number][] = [gstart, ...midIndices, gend];
      for (let m = 0; m < points.length - 1; m++) {
        const [ai, aj] = points[m];
        const [bi, bj] = points[m + 1];
        segments.push({ ai, aj, bi, bj, scale: cellScale });
      }
    }

    const t = cellScale > 1 ? Math.log2(cellScale) / Math.log2(ROOT_CELL_SCALE) : 0;
    const effIOdds = 1.0 - t * (1.0 - iOdds);
    const effJOdds = 1.0 - t * (1.0 - jOdds);
    if (rng.next() < effIOdds) frontier.push([ni, nj, ni + stepI, nj]);
    if (rng.next() < effJOdds) frontier.push([ni, nj, ni, nj + stepJ]);
  }
}

function frontierBlocked(
  gstart: [number, number], cellScale: number, required: Set<string>,
  lattice: Map<string, number>, stepI: number, stepJ: number
): boolean {
  const k = (i: number, j: number) => `${i},${j}`;
  const isUnclaimed = (gi: number, gj: number) => (lattice.get(k(gi, gj)) ?? UNCLAIMED) === UNCLAIMED;
  for (const gstep of [[cellScale * stepI, 0], [0, cellScale * stepJ]] as [number, number][]) {
    const gend: [number, number] = [gstart[0] + gstep[0], gstart[1] + gstep[1]];
    if (!required.has(k(gend[0], gend[1]))) continue;
    const mids: [number, number][] = [];
    for (let m = 1; m < cellScale; m++)
      mids.push([gstart[0] + (gstep[0] * m) / cellScale, gstart[1] + (gstep[1] * m) / cellScale]);
    if (isUnclaimed(gend[0], gend[1]) && mids.every(([mi, mj]) => isUnclaimed(mi, mj)))
      return false;
  }
  return true;
}

function buildSubfractals(
  initialGaps: GapEntry[], startScale: number, minScale: number,
  required: Set<string>, lattice: Map<string, number>, segments: IndexSegment[],
  geo: LatticeGeometry, driftRate: number,
  iOdds: number, jOdds: number, rng: SeededRNG
) {
  const k = (i: number, j: number) => `${i},${j}`;
  const visited = new Set<string>();
  let currentGaps = initialGaps.slice();
  let cellScale = startScale;

  while (cellScale >= minScale && currentGaps.length > 0) {
    for (let i = currentGaps.length - 1; i > 0; i--) {
      const j = rng.randRange(i + 1);
      [currentGaps[i], currentGaps[j]] = [currentGaps[j], currentGaps[i]];
    }
    const nextGaps: GapEntry[] = [];
    for (const gap of currentGaps) {
      const vk = `${k(gap.gpoint[0], gap.gpoint[1])},${cellScale}`;
      if (visited.has(vk)) continue;
      visited.add(vk);

      let claimed = false;
      if (gap.seedScale !== null && cellScale > gap.seedScale) {
        claimed = false;
      } else if (frontierBlocked(gap.gpoint, cellScale, required, lattice, gap.stepI, gap.stepJ)) {
        claimed = false;
      } else {
        const before = segments.length;
        const subGaps: GapEntry[] = [];
        buildLattice(gap.gpoint, gap.angle, cellScale, required, lattice,
          gap.stepI, gap.stepJ, segments, subGaps,
          geo, driftRate, iOdds, jOdds, rng);
        claimed = segments.length > before;
        if (claimed) nextGaps.push(...subGaps);
      }
      if (!claimed) nextGaps.push(gap);
    }
    currentGaps = nextGaps;
    cellScale = Math.floor(cellScale / 2);
  }
}

function generateTopology(params: FractalParams, size: number): FractalTopology {
  const rng = new SeededRNG(params.seed);
  const k = (i: number, j: number) => `${i},${j}`;

  const origin: [number, number] = [size / 2, size / 2];
  const baseLength = size / 6;
  const initialAngle = 0;

  const driftRate = params.drift * Math.PI / 180;
  const driftScale = baseLength * 2;

  const e1: [number, number] = [Math.cos(initialAngle + Math.PI / 4), Math.sin(initialAngle + Math.PI / 4)];
  const e2: [number, number] = [Math.cos(initialAngle - Math.PI / 4), Math.sin(initialAngle - Math.PI / 4)];
  const unitLen = baseLength / ROOT_CELL_SCALE;

  const geo: LatticeGeometry = { origin, e1, e2, unitLen, driftScale };

  const corners: [number, number][] = [[0, 0], [size, 0], [0, size], [size, size]];
  const maxR = Math.max(...corners.map(([cx, cy]) => Math.hypot(cx - origin[0], cy - origin[1])));
  const maxIJ = Math.ceil(maxR / unitLen) + 2;

  const lattice = new Map<string, number>();

  const levelPoints = (si: number, sj: number, level: number): [number, number][] => {
    const pts: [number, number][] = [];
    for (let a = 0; a <= level; a++) pts.push([si * a, sj * (level - a)]);
    return pts;
  };

  const visible = (gi: number, gj: number) => {
    const [px, py] = latticeToPixel(gi, gj, geo, driftRate);
    return px >= 0 && px < size && py >= 0 && py < size;
  };

  const quadrants: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const segments: IndexSegment[] = [];

  for (const [stepI, stepJ] of quadrants) {
    let maxLevel = 0;
    for (let level = 2 * maxIJ; level >= 0; level--) {
      if (levelPoints(stepI, stepJ, level).some(([i, j]) => visible(i, j))) {
        maxLevel = level;
        break;
      }
    }

    const required = new Set<string>();
    for (let L = 0; L <= maxLevel + 1; L++) {
      for (const [i, j] of levelPoints(stepI, stepJ, L)) {
        required.add(k(i, j));
      }
    }

    for (const key of required) {
      const [i, j] = key.split(',').map(Number);
      if (i === 0 || j === 0) lattice.delete(key);
    }

    const rootGaps: GapEntry[] = [];
    buildLattice([0, 0], initialAngle, ROOT_CELL_SCALE, required, lattice,
      stepI, stepJ, segments, rootGaps,
      geo, driftRate, params.iOdds, params.jOdds, rng);

    buildSubfractals(rootGaps, ROOT_CELL_SCALE / 2, 1, required, lattice, segments,
      geo, driftRate, params.iOdds, params.jOdds, rng);
  }

  // Axis lines as index segments
  for (const fixedAxis of [0, 1]) {
    for (let m = -maxIJ; m < maxIJ; m++) {
      const ai = fixedAxis === 0 ? 0 : m;
      const aj = fixedAxis === 0 ? m : 0;
      const bi = fixedAxis === 0 ? 0 : m + 1;
      const bj = fixedAxis === 0 ? m + 1 : 0;
      segments.push({ ai, aj, bi, bj, scale: 0 });
    }
  }

  return { segments, geo, maxIJ };
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function initFractalPlayground() {
  const container = document.getElementById('fractal-playground');
  if (!container) return;

  const canvas = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_SIZE * dpr;
  canvas.height = CANVAS_SIZE * dpr;
  canvas.style.width = `${CANVAS_SIZE}px`;
  canvas.style.height = `${CANVAS_SIZE}px`;
  canvas.style.maxWidth = '100%';
  canvas.style.aspectRatio = '1';
  canvas.style.borderRadius = '8px';
  canvas.style.border = '2px dotted #444';

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const controls = document.createElement('div');
  controls.className = 'fractal-controls';

  const params: FractalParams = { drift: 45, iOdds: 0.2, jOdds: 0.2, seed: 42 };
  let speed = 200;
  let generationId = 0;
  let currentTopo: FractalTopology | null = null;
  let drawCursor = 0;
  let animRunning = false;
  let lastFrameTime = 0;
  let showLevels = false;

  function setupStroke() {
    const dark = isDarkMode();
    const alpha = NOISE_ALPHA / 255;
    ctx.strokeStyle = dark ? `rgba(255, 255, 255, ${alpha})` : `rgba(60, 20, 100, ${alpha})`;
    ctx.lineWidth = 1;
  }

  function clearCanvas() {
    const dark = isDarkMode();
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.fillStyle = dark ? '#1a1a2e' : '#e8e5f0';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  }

  function drawSegmentsBatch(segments: IndexSegment[], start: number, end: number, driftRate: number) {
    if (!showLevels) {
      setupStroke();
      ctx.beginPath();
      for (let i = start; i < end; i++) {
        const s = segments[i];
        const [ax, ay] = latticeToPixel(s.ai, s.aj, currentTopo!.geo, driftRate);
        const [bx, by] = latticeToPixel(s.bi, s.bj, currentTopo!.geo, driftRate);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
      return;
    }
    const byScale = new Map<number, [number, number, number, number][]>();
    for (let i = start; i < end; i++) {
      const s = segments[i];
      const [ax, ay] = latticeToPixel(s.ai, s.aj, currentTopo!.geo, driftRate);
      const [bx, by] = latticeToPixel(s.bi, s.bj, currentTopo!.geo, driftRate);
      let list = byScale.get(s.scale);
      if (!list) { list = []; byScale.set(s.scale, list); }
      list.push([ax, ay, bx, by]);
    }
    ctx.lineWidth = 1;
    for (const [scale, lines] of byScale) {
      ctx.strokeStyle = LEVEL_COLORS[scale] ?? LEVEL_COLORS[0];
      ctx.beginPath();
      for (const [ax, ay, bx, by] of lines) {
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
    }
  }

  function redrawUpTo(n: number) {
    if (!currentTopo) return;
    clearCanvas();
    const driftRate = params.drift * Math.PI / 180;
    drawSegmentsBatch(currentTopo.segments, 0, n, driftRate);
  }

  function rerenderDrift() {
    if (!currentTopo) return;
    const wasRunning = animRunning;
    animRunning = false;
    generationId++;
    redrawUpTo(drawCursor);
    if (wasRunning || drawCursor < currentTopo.segments.length) {
      startAnimation(false);
    }
  }

  function startAnimation(fromScratch: boolean) {
    if (!currentTopo) return;
    const myGen = generationId;

    if (fromScratch) {
      drawCursor = 0;
      clearCanvas();
      setupStroke();
    }

    if (speed === 0) {
      drawCursor = currentTopo.segments.length;
      redrawUpTo(drawCursor);
      return;
    }

    if (animRunning) return;
    animRunning = true;
    lastFrameTime = 0;

    function frame(time: number) {
      if (myGen !== generationId || !currentTopo) { animRunning = false; return; }
      if (speed === 0) {
        animRunning = false;
        drawCursor = currentTopo.segments.length;
        redrawUpTo(drawCursor);
        return;
      }
      if (lastFrameTime === 0) lastFrameTime = time;
      const dt = (time - lastFrameTime) / 1000;
      lastFrameTime = time;

      const batch = Math.max(1, Math.floor(speed * dt));
      const end = Math.min(drawCursor + batch, currentTopo.segments.length);
      const driftRate = params.drift * Math.PI / 180;

      drawSegmentsBatch(currentTopo.segments, drawCursor, end, driftRate);
      drawCursor = end;

      if (drawCursor < currentTopo.segments.length) {
        requestAnimationFrame(frame);
      } else {
        animRunning = false;
      }
    }

    requestAnimationFrame(frame);
  }

  function regenerate() {
    generationId++;
    animRunning = false;
    currentTopo = generateTopology(params, CANVAS_SIZE);
    startAnimation(true);
  }

  function makeSlider(label: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void, regenerates = true) {
    const row = document.createElement('div');
    row.className = 'fractal-control-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    const valSpan = document.createElement('span');
    valSpan.className = 'fractal-control-value';
    valSpan.textContent = value.toFixed(step < 1 ? 2 : 0);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      valSpan.textContent = v.toFixed(step < 1 ? 2 : 0);
      onChange(v);
      if (regenerates) regenerate(); else rerenderDrift();
    });
    row.appendChild(lbl);
    row.appendChild(input);
    row.appendChild(valSpan);
    return row;
  }

  function makeKnob(label: string, min: number, max: number, value: number, onChange: (v: number) => void, regenerates = true) {
    const row = document.createElement('div');
    row.className = 'fractal-control-row fractal-knob-row';

    const lbl = document.createElement('label');
    lbl.textContent = label;

    const knobWrap = document.createElement('div');
    knobWrap.className = 'fractal-knob-wrap';

    const knobSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    knobSvg.setAttribute('viewBox', '0 0 60 60');
    knobSvg.setAttribute('class', 'fractal-knob');

    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('cx', '30');
    track.setAttribute('cy', '30');
    track.setAttribute('r', '24');
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke-width', '4');
    track.classList.add('fractal-knob-track');

    const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke-width', '4');
    arc.setAttribute('stroke-linecap', 'round');
    arc.classList.add('fractal-knob-arc');

    const indicator = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    indicator.setAttribute('x1', '30');
    indicator.setAttribute('y1', '30');
    indicator.setAttribute('stroke-width', '2');
    indicator.setAttribute('stroke-linecap', 'round');
    indicator.classList.add('fractal-knob-indicator');

    knobSvg.appendChild(track);
    knobSvg.appendChild(arc);
    knobSvg.appendChild(indicator);

    const valSpan = document.createElement('span');
    valSpan.className = 'fractal-control-value';

    function update(v: number) {
      const clamped = Math.max(min, Math.min(max, v));
      const frac = (clamped - min) / (max - min);
      const startDeg = 135;
      const sweep = 270;
      const angleDeg = startDeg + frac * sweep;
      const angleRad = angleDeg * Math.PI / 180;

      const r = 24;
      const cx = 30, cy = 30;
      const startRad = startDeg * Math.PI / 180;
      const x1 = cx + r * Math.cos(startRad);
      const y1 = cy + r * Math.sin(startRad);
      const x2 = cx + r * Math.cos(angleRad);
      const y2 = cy + r * Math.sin(angleRad);
      const largeArc = frac * sweep > 180 ? 1 : 0;
      arc.setAttribute('d', frac > 0.001 ? `M${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2}` : '');

      const indLen = 18;
      indicator.setAttribute('x2', String(cx + indLen * Math.cos(angleRad)));
      indicator.setAttribute('y2', String(cy + indLen * Math.sin(angleRad)));

      valSpan.textContent = `${clamped.toFixed(0)}°`;
    }

    update(value);

    let dragging = false;
    function angleFromEvent(e: MouseEvent | Touch) {
      const rect = knobSvg.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
    }

    let lastAngle = 0;
    let accumValue = value;

    knobSvg.addEventListener('mousedown', (e) => {
      dragging = true;
      lastAngle = angleFromEvent(e);
      accumValue = params.drift;
      e.preventDefault();
    });
    knobSvg.addEventListener('touchstart', (e) => {
      dragging = true;
      lastAngle = angleFromEvent(e.touches[0]);
      accumValue = params.drift;
      e.preventDefault();
    }, { passive: false });

    const onMove = (e: MouseEvent | Touch) => {
      if (!dragging) return;
      const angle = angleFromEvent(e);
      let delta = angle - lastAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      accumValue = Math.max(min, Math.min(max, accumValue + delta));
      lastAngle = angle;
      update(accumValue);
      onChange(accumValue);
      if (regenerates) regenerate(); else rerenderDrift();
    };

    document.addEventListener('mousemove', (e) => onMove(e));
    document.addEventListener('touchmove', (e) => { if (dragging) onMove(e.touches[0]); }, { passive: true });
    const stopDrag = () => { dragging = false; };
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchend', stopDrag);

    knobWrap.appendChild(knobSvg);
    row.appendChild(lbl);
    row.appendChild(knobWrap);
    row.appendChild(valSpan);
    return row;
  }

  controls.appendChild(makeKnob('Drift', -180, 180, params.drift, v => { params.drift = v; }, false));
  controls.appendChild(makeSlider('I-step odds', 0, 1, 0.01, params.iOdds, v => { params.iOdds = v; }));
  controls.appendChild(makeSlider('J-step odds', 0, 1, 0.01, params.jOdds, v => { params.jOdds = v; }));

  const speedRow = document.createElement('div');
  speedRow.className = 'fractal-control-row';
  const speedLbl = document.createElement('label');
  speedLbl.textContent = 'Speed';
  const speedVal = document.createElement('span');
  speedVal.className = 'fractal-control-value';
  speedVal.textContent = '200 seg/s';
  const SPEED_STEPS = 100;
  function sliderToSpeed(v: number): number {
    if (v >= SPEED_STEPS) return 0;
    return Math.round(10 * Math.pow(100, v / SPEED_STEPS));
  }
  function speedToSlider(s: number): number {
    if (s === 0) return SPEED_STEPS;
    return Math.round(SPEED_STEPS * Math.log(s / 10) / Math.log(100));
  }
  const formatSpeed = (s: number) => s === 0 ? 'instant' : `${s} seg/s`;
  const speedInput = document.createElement('input');
  speedInput.type = 'range';
  speedInput.min = '0';
  speedInput.max = String(SPEED_STEPS);
  speedInput.step = '1';
  speedInput.value = String(speedToSlider(speed));
  speedInput.addEventListener('input', () => {
    speed = sliderToSpeed(parseInt(speedInput.value));
    speedVal.textContent = formatSpeed(speed);
  });
  speedRow.appendChild(speedLbl);
  speedRow.appendChild(speedInput);
  speedRow.appendChild(speedVal);
  controls.appendChild(speedRow);

  const seedRow = document.createElement('div');
  seedRow.className = 'fractal-control-row';
  const seedBtn = document.createElement('button');
  seedBtn.className = 'fractal-seed-btn';
  seedBtn.textContent = '🎲 Randomize';
  seedBtn.addEventListener('click', () => {
    params.seed = Math.floor(Math.random() * 2147483647);
    regenerate();
  });
  seedRow.appendChild(seedBtn);

  const levelsRow = document.createElement('div');
  levelsRow.className = 'fractal-control-row';
  const levelsLabel = document.createElement('label');
  levelsLabel.textContent = 'Show Levels';
  const levelsCheck = document.createElement('input');
  levelsCheck.type = 'checkbox';
  levelsCheck.className = 'fractal-levels-check';
  const legend = document.createElement('div');
  legend.className = 'fractal-legend';
  legend.style.display = 'none';
  for (const [scale, color] of [[8, LEVEL_COLORS[8]], [4, LEVEL_COLORS[4]], [2, LEVEL_COLORS[2]], [1, LEVEL_COLORS[1]], [0, LEVEL_COLORS[0]]] as [number, string][]) {
    const item = document.createElement('span');
    item.className = 'fractal-legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'fractal-legend-swatch';
    swatch.style.background = color;
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(scale === 0 ? 'axis' : `${scale}`));
    legend.appendChild(item);
  }

  levelsCheck.addEventListener('change', () => {
    showLevels = levelsCheck.checked;
    legend.style.display = showLevels ? 'flex' : 'none';
    redrawUpTo(drawCursor);
  });
  levelsRow.appendChild(levelsLabel);
  levelsRow.appendChild(levelsCheck);
  controls.appendChild(levelsRow);
  controls.appendChild(legend);
  controls.appendChild(seedRow);

  container.appendChild(canvas);
  container.appendChild(controls);

  regenerate();

  new MutationObserver(() => rerenderDrift()).observe(
    document.documentElement, { attributes: true, attributeFilter: ['class'] }
  );
}
