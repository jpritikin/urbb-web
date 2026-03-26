import { CloudManager } from '../cloud/cloudManager.js';


// ── Timeline ─────────────────────────────────────────────────────────────────
// 0–3s        : hold (star occluded, zoomed out)
// 3–11s       : reveal (tilt + zoom in)
// 11s–TOTAL   : hold (star visible, clouds orbit, URL assembles)

const HOLD_START = 3;
const REVEAL_END = 11;

const ZOOM_START = 0.45;
const ZOOM_END = 1.1;
const TILT_START = Math.PI / 2;  // torus edge-on → star occluded
const TILT_END = Math.PI / 3;  // default view → star visible

// ── Easing ───────────────────────────────────────────────────────────────────
function easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

// Cubic ease-in-out for more natural letter assembly
function cubicInOut(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

// ── Cloud words ───────────────────────────────────────────────────────────────
const WORDS = [
    'hope', 'fear', 'calm', 'rage', 'grief', 'joy', 'shame',
    'pride', 'trust', 'doubt', 'care', 'guilt', 'love', 'loss',
    'anger', 'peace', 'worry', 'safety', 'wonder', 'sorrow',
    'envy', 'longing', 'regret', 'dread', 'bliss', 'hurt',
    'numb', 'tender', 'fury', 'still',
    // longer words for size variance
    'overwhelmed', 'disconnected', 'vulnerability', 'compassion',
    'abandonment', 'worthlessness', 'protection', 'forgiveness',
    'resentment', 'exhaustion', 'powerlessness', 'belonging',
    // short for more variance
    'awe', 'awe', 'raw', 'ache', 'ok', 'safe', 'held', 'seen',
];

// ── URL fragment animation ────────────────────────────────────────────────────
const URL_TEXT = 'https://unburdened.biz/';
const FINAL_FONT_PX = 50;

const FRAG_COLORS = [
    '#7fff00', '#ff6ec7', '#00ffff', '#ffd700', '#ff4500',
    '#9b59b6', '#2ecc71', '#e74c3c', '#3498db', '#f39c12',
];

const WHITE_SETTLE_MIN = 0.8;
const WHITE_SETTLE_MAX = 2.0;
let settledTime = 0;  // elapsed time when all URL fragments have settled to white

// Screen dimensions (fixed for promo render)
const SCREEN_W = 1920;
const SCREEN_H = 1080;

// Placard geometry (must match CSS)
const PLACARD_W = 1120;
const PLACARD_H = 108;
const PLACARD_TOP = 820;
// Placard center in screen coords
const PLACARD_CX = SCREEN_W / 2;
const PLACARD_CY = PLACARD_TOP + PLACARD_H / 2;

// ── Clip-path half-plane polygon ──────────────────────────────────────────────
// Returns the centroid of a polygon as [x, y] in [0,1] coordinates.
function polygonCentroid(poly: [number, number][]): [number, number] {
    let area = 0, cx = 0, cy = 0;
    for (let i = 0; i < poly.length; i++) {
        const [x0, y0] = poly[i];
        const [x1, y1] = poly[(i + 1) % poly.length];
        const cross = x0 * y1 - x1 * y0;
        area += cross;
        cx += (x0 + x1) * cross;
        cy += (y0 + y1) * cross;
    }
    area /= 2;
    cx /= 6 * area;
    cy /= 6 * area;
    return [cx, cy];
}

// Returns [clipPath string, transformOrigin string] for a half-plane clip.
function halfPlaneClipWithOrigin(theta: number, side: 0 | 1): [string, string] {
    const nx = Math.cos(theta);
    const ny = Math.sin(theta);
    const corners: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const dist = corners.map(([x, y]) => (x - 0.5) * nx + (y - 0.5) * ny);
    const sign = side === 0 ? 1 : -1;
    const poly: [number, number][] = [];
    for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        const di = dist[i] * sign;
        const dj = dist[j] * sign;
        if (di >= 0) poly.push(corners[i]);
        if ((di > 0 && dj < 0) || (di < 0 && dj > 0)) {
            const t = di / (di - dj);
            poly.push([lerp(corners[i][0], corners[j][0], t), lerp(corners[i][1], corners[j][1], t)]);
        }
    }
    const pts = poly.map(([x, y]) => `${(x * 100).toFixed(1)}% ${(y * 100).toFixed(1)}%`).join(', ');
    const [cx, cy] = polygonCentroid(poly);
    return [`polygon(${pts})`, `${(cx * 100).toFixed(1)}% ${(cy * 100).toFixed(1)}%`];
}

// ── Off-screen radial start position ─────────────────────────────────────────
// Returns [dx, dy] at a random distance beyond the screen edge along `angle`
// from the placard center, so fragments start at varied depths off-screen.
function offScreenRadial(angle: number): [number, number] {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    let tEdge = Infinity;
    if (cos > 0) tEdge = Math.min(tEdge, (SCREEN_W - PLACARD_CX) / cos);
    if (cos < 0) tEdge = Math.min(tEdge, -PLACARD_CX / cos);
    if (sin > 0) tEdge = Math.min(tEdge, (SCREEN_H - PLACARD_CY) / sin);
    if (sin < 0) tEdge = Math.min(tEdge, -PLACARD_CY / sin);

    // Overshoot well past the screen edge: 600–1200px beyond it
    const dist = tEdge + 600 + Math.random() * 600;
    return [cos * dist, sin * dist];
}

interface HalfFrag {
    el: HTMLElement;
    startX: number;
    startY: number;
    startRot: number;
    startSize: number;
    animStart: number;
    animEnd: number;
    transformOrigin: string;
    // mutable color state
    colorIdx: number;
    prevColorIdx: number;
    nextSwitchTime: number;   // elapsed time of next color switch
    settleThreshold: number;  // signed offset from animEnd: white settle starts at animEnd + settleThreshold
    whiteSettle: number;      // white settle ends at animEnd + whiteSettle
    halfBoldDelay: number;    // per-half stagger offset for bold sweeps (seconds)
}

interface CharEntry {
    halves: [HalfFrag, HalfFrag];
    // radial angle from placard center to this char's position
    radialAngle: number;
    charIndex: number;
}

let charEntries: CharEntry[] = [];

function buildUrlDisplay(): void {
    const container = document.getElementById('url-display');
    if (!container) return;

    const totalChars = URL_TEXT.length;

    for (let ci = 0; ci < totalChars; ci++) {
        const ch = URL_TEXT[ci];
        const charWrap = document.createElement('span');
        charWrap.className = 'url-char';

        const placeholder = document.createElement('span');
        placeholder.className = 'url-placeholder';
        placeholder.textContent = ch === ' ' ? '\u00a0' : ch;

        // Random diagonal cut angle
        const cutAngle = Math.random() * Math.PI;

        // Both halves start somewhere in the 180° arc above the placard.
        // Angles in [-π, 0] point upward in screen coords (negative Y = up).
        // Spread evenly across the arc with jitter, independently per half.
        const baseAngle = -2 * Math.PI / 3 + (ci / totalChars) * 2 * Math.PI / 3 + (Math.random() - 0.5) * 0.3;

        const halves: HalfFrag[] = [];
        for (let side = 0; side < 2; side++) {
            const frag = document.createElement('span');
            frag.className = 'url-frag';
            frag.textContent = ch === ' ' ? '\u00a0' : ch;
            const [clipPath, transformOrigin] = halfPlaneClipWithOrigin(cutAngle, side as 0 | 1);
            frag.style.clipPath = clipPath;
            frag.style.transformOrigin = transformOrigin;

            // Each half gets its own angle within the upper semicircle
            const travelAngle = baseAngle + (side === 1 ? (Math.random() - 0.5) * 0.8 : 0);
            const [ox, oy] = offScreenRadial(travelAngle);
            const startRot = (Math.random() - 0.5) * 8 * 360;

            const animStart = 0.5 + Math.random() * 8;
            const animEnd = animStart + 5 + Math.random() * 5;

            const startSize = FINAL_FONT_PX * (10 + Math.random() * 4);
            const colorIdx = Math.floor(Math.random() * FRAG_COLORS.length);

            frag.style.fontSize = `${startSize}px`;
            frag.style.transform = `translate(${ox}px, ${oy}px) rotate(${startRot}deg)`;
            frag.style.opacity = '1';
            frag.style.color = FRAG_COLORS[colorIdx];

            charWrap.appendChild(frag);
            const whiteSettle = WHITE_SETTLE_MIN + Math.random() * (WHITE_SETTLE_MAX - WHITE_SETTLE_MIN);
            const settleThreshold = (Math.random() - 0.5) * 2;  // [-1, +1] seconds from animEnd
            halves.push({
                el: frag, startX: ox, startY: oy, startRot, startSize,
                animStart, animEnd, transformOrigin,
                colorIdx, prevColorIdx: colorIdx,
                nextSwitchTime: animStart + nextSwitchDelay(),
                settleThreshold, whiteSettle,
                halfBoldDelay: Math.random() * 0.15,
            });
        }

        charWrap.appendChild(placeholder);
        container.appendChild(charWrap);

        charEntries.push({
            halves: halves as [HalfFrag, HalfFrag],
            radialAngle: baseAngle,
            charIndex: ci,
        });
    }

}

// Sigmoid centered at 0.5; steepness=7.8 gives ~98% at x=1
function sigmoid(x: number, steepness = 7.8): number {
    return 1 / (1 + Math.exp(-steepness * (x - 0.5)));
}

function nextSwitchDelay(): number {
    return 2 + Math.random();
}

const PLACARD_FADE = 1.0;  // seconds for placard to ease in

let placardRevealTime = 0;  // set after buildUrlDisplay()

function updateUrl(elapsed: number): void {
    const placardEl = document.getElementById('url-placard');
    if (placardEl) {
        const tp = Math.max(0, Math.min(1, (elapsed - placardRevealTime) / PLACARD_FADE));
        const a = cubicInOut(tp);
        placardEl.style.background = `rgba(184, 134, 11, ${a})`;
        placardEl.style.borderColor = `rgba(139, 105, 20, ${a})`;
        placardEl.style.outlineColor = `rgba(139, 0, 0, ${a})`;
        placardEl.style.boxShadow = `4px 4px 0 rgba(42,21,5,${a}), 5px 5px 0 rgba(42,21,5,${a}), 6px 6px 0 rgba(42,21,5,${a}), 7px 7px 0 rgba(26,10,2,${a})`;
    }
    for (const entry of charEntries) {
        for (const hf of entry.halves) {
            const raw = (elapsed - hf.animStart) / (hf.animEnd - hf.animStart);
            const tf = cubicInOut(Math.max(0, Math.min(1, raw)));

            const x = lerp(hf.startX, 0, tf);
            const y = lerp(hf.startY, 0, tf);
            const rot = lerp(hf.startRot, 0, tf);
            const size = lerp(hf.startSize, FINAL_FONT_PX, tf);

            let colorStr: string;

            const settleStart = hf.animEnd + hf.settleThreshold;
            const settleEnd = hf.animEnd + hf.whiteSettle;

            if (elapsed >= settleEnd + 10) {
                colorStr = '#ffffff';
            } else if (elapsed >= settleStart) {
                const tSettle = Math.min(1, (elapsed - settleStart) / (settleEnd - settleStart));
                colorStr = Math.random() < sigmoid(tSettle) ? '#ffffff' : FRAG_COLORS[hf.colorIdx];
            } else {
                // Every scheduled interval, advance to a new color
                if (elapsed >= hf.nextSwitchTime) {
                    hf.prevColorIdx = hf.colorIdx;
                    hf.colorIdx = (hf.colorIdx + 1) % FRAG_COLORS.length;
                    hf.nextSwitchTime = elapsed + nextSwitchDelay();
                }
                const tFlight = (elapsed - hf.animStart) / (hf.animEnd - hf.animStart);
                colorStr = Math.random() < sigmoid(Math.max(0, Math.min(1, tFlight)))
                    ? FRAG_COLORS[hf.colorIdx]
                    : FRAG_COLORS[hf.prevColorIdx];
            }

            hf.el.style.fontSize = `${size}px`;
            hf.el.style.color = colorStr;
            hf.el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
            hf.el.style.opacity = '1';
        }
    }
}

// ── Bold sweeps ──────────────────────────────────────────────────────────────
interface BoldSweep {
    startTime: number;    // elapsed time when sweep begins
    speed: number;        // chars per second
    direction: 1 | -1;   // left-to-right or right-to-left
}

const MAX_SWEEPS = 2;
const activeSweeps: BoldSweep[] = [];
let nextSweepTime = 0;  // set after URL settles

function scheduleNextSweep(now: number): void {
    nextSweepTime = now + 2 + Math.random() * 6;
}

function launchSweep(now: number): void {
    const speed = 3 + Math.random() * 12;  // 3–15 chars/sec
    const direction = Math.random() < 0.5 ? 1 : -1;
    activeSweeps.push({ startTime: now, speed, direction });
}

function updateBoldSweeps(elapsed: number, settled: boolean): void {
    if (!settled) return;

    // Initialize on first settled frame
    if (nextSweepTime === 0) {
        scheduleNextSweep(elapsed);
    }

    // Launch new sweep if it's time and we're under the cap
    if (elapsed >= nextSweepTime && activeSweeps.length < MAX_SWEEPS) {
        launchSweep(elapsed);
        scheduleNextSweep(elapsed);
    }

    const n = URL_TEXT.length;
    const BOLD_WIDTH = 1.5;

    // Expire sweeps that have passed all characters
    for (let si = activeSweeps.length - 1; si >= 0; si--) {
        const sweep = activeSweeps[si];
        const dt = elapsed - sweep.startTime;  // max dt (delay=0 half is furthest along)
        const center = sweep.direction === 1 ? dt * sweep.speed : (n - 1) - dt * sweep.speed;
        const pastEnd = sweep.direction === 1 ? center - BOLD_WIDTH > n - 1 : center + BOLD_WIDTH < 0;
        if (pastEnd) activeSweeps.splice(si, 1);
    }

    // Compute bold state per half (reset first, then OR across sweeps)
    for (let ci = 0; ci < n; ci++) {
        for (const hf of charEntries[ci].halves) {
            let bold = false;
            for (const sweep of activeSweeps) {
                const dt = elapsed - sweep.startTime - hf.halfBoldDelay;
                if (dt < 0) continue;
                const center = sweep.direction === 1 ? dt * sweep.speed : (n - 1) - dt * sweep.speed;
                if (ci >= center - BOLD_WIDTH && ci <= center + BOLD_WIDTH) { bold = true; break; }
            }
            hf.el.style.fontWeight = bold ? '700' : '400';
        }
    }
}

// ── Simulator setup ──────────────────────────────────────────────────────────
function setupSimulator(): CloudManager {
    const cm = new CloudManager();
    (window as any).cloudManager = cm;
    cm.setPromoMode(true);
    cm.init('cloud-container');

    const count = 80;
    for (let i = 0; i < count; i++) {
        cm.addCloud(WORDS[i % WORDS.length], { trust: 1 });
    }

    cm.setInitialTilt(TILT_START);
    cm.setTorusMinorRadius(160);
    cm.finalizePanoramaSetup();
    cm.applyAssessedNeedAttention();

    cm.setZoom(ZOOM_START);
    cm.startAnimation();
    return cm;
}

// ── Debug overlay ─────────────────────────────────────────────────────────────
function createDebugOverlay(): HTMLElement | null {
    if ((window as any).__advanceFrame) return null;
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;bottom:8px;left:8px;font:14px monospace;color:#0f0;background:rgba(0,0,0,0.6);padding:4px 8px;z-index:9999;pointer-events:none;white-space:pre';
    document.body.appendChild(el);
    return el;
}

function getPhaseLabel(t: number, settled: boolean): string {
    if (settled) return 'settled/sweeps';
    if (t < HOLD_START) return 'hold-start';
    if (t < REVEAL_END) return 'reveal';
    if (t < placardRevealTime) return 'assembling';
    return 'settling';
}

// ── Main loop ─────────────────────────────────────────────────────────────────
function startPromo(): void {
    buildUrlDisplay();
    settledTime = Math.max(...charEntries.flatMap(e => e.halves.map(h => h.animEnd + h.whiteSettle))) + 10;
    placardRevealTime = Math.min(...charEntries.flatMap(e => e.halves.map(h => h.animEnd)));
    const cm = setupSimulator();

    (window as any).promoReady = true;

    const FRAME_INTERVAL = 1000 / 24;
    let startTime: number | null = null;
    let lastFrameTime = -Infinity;
    let lastTilt = TILT_START;
    const syntheticClock = !!(window as any).__advanceFrame;
    const debugEl = createDebugOverlay();

    function tick(now: number): void {
        if (startTime === null) startTime = now;
        if (!syntheticClock && now - lastFrameTime < FRAME_INTERVAL) {
            requestAnimationFrame(tick);
            return;
        }
        lastFrameTime = now;
        const elapsed = (now - startTime) / 1000;
        const t = elapsed;

        if (t >= HOLD_START && t <= REVEAL_END) {
            const p = (t - HOLD_START) / (REVEAL_END - HOLD_START);
            const pe = easeInOut(p);
            const newTilt = lerp(TILT_START, TILT_END, pe);
            cm.setTiltAngle(newTilt);
            lastTilt = newTilt;
            cm.setZoom(lerp(ZOOM_START, ZOOM_END, pe));
            cm.setVerticalShift(lerp(0, -100, p));
        } else if (t > REVEAL_END && lastTilt !== TILT_END) {
            cm.setTiltAngle(TILT_END);
            cm.setZoom(ZOOM_END);
            cm.setVerticalShift(-100);
            lastTilt = TILT_END;
        }

        const settled = t >= settledTime;
        updateUrl(t);
        updateBoldSweeps(t, settled);

        if (debugEl) {
            const phase = getPhaseLabel(t, settled);
            debugEl.textContent = `t=${t.toFixed(1)}s  ${phase}\nsettledAt=${settledTime.toFixed(1)}s  sweeps=${activeSweeps.length}  nextSweep=${nextSweepTime > 0 ? (nextSweepTime - t).toFixed(1) + 's' : '-'}`;
        }

        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}

document.addEventListener('DOMContentLoaded', startPromo);
