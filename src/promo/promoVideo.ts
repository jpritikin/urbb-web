import { CloudManager } from '../cloud/cloudManager.js';

// ── Timeline ─────────────────────────────────────────────────────────────────
// 0–3s   : hold (star occluded, zoomed out)
// 3–11s  : reveal (tilt + zoom in)
// 11–15s : hold (star visible, clouds orbit)

const HOLD_START = 3;
const REVEAL_END = 11;
const TOTAL = 15;

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
const FINAL_FONT_PX = 48;

const FRAG_COLORS = [
    '#7fff00', '#ff6ec7', '#00ffff', '#ffd700', '#ff4500',
    '#9b59b6', '#2ecc71', '#e74c3c', '#3498db', '#f39c12',
];

const URL_ANIM_START = 1;
const URL_ANIM_END = 10;

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
// Returns clip-path polygon strings for the two halves of a unit box [0,0]→[1,1]
// cut by a line through (0.5, 0.5) at angle `theta` (radians).
// side=0: the half where the normal points (cos θ, sin θ) is positive
// side=1: the opposite half
function halfPlaneClip(theta: number, side: 0 | 1): string {
    // Normal to cut line
    const nx = Math.cos(theta);
    const ny = Math.sin(theta);

    // The 4 corners of the unit box
    const corners = [
        [0, 0], [1, 0], [1, 1], [0, 1],
    ];

    // Signed distance of each corner from the line through (0.5, 0.5)
    const dist = corners.map(([x, y]) => (x - 0.5) * nx + (y - 0.5) * ny);

    // For side 0 we keep corners where dist >= 0, for side 1 where dist <= 0
    const sign = side === 0 ? 1 : -1;

    // Build polygon by walking edges and collecting kept corners + intersections
    const poly: [number, number][] = [];
    for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        const di = dist[i] * sign;
        const dj = dist[j] * sign;
        if (di >= 0) poly.push(corners[i] as [number, number]);
        // Edge crosses the line
        if ((di > 0 && dj < 0) || (di < 0 && dj > 0)) {
            const t = di / (di - dj);
            const ix = lerp(corners[i][0], corners[j][0], t);
            const iy = lerp(corners[i][1], corners[j][1], t);
            poly.push([ix, iy]);
        }
    }

    const pts = poly.map(([x, y]) => `${(x * 100).toFixed(1)}% ${(y * 100).toFixed(1)}%`).join(', ');
    return `polygon(${pts})`;
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

    // Overshoot just past the screen edge: 100–400px beyond it
    const dist = tEdge + 100 + Math.random() * 300;
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
    // mutable color state
    colorIdx: number;
    settledAt: number;   // elapsed time when tf first hit 1, or -1
    settledR: number;
    settledG: number;
    settledB: number;
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
        const baseAngle = -Math.PI + (ci / totalChars) * Math.PI + (Math.random() - 0.5) * 0.3;

        const halves: HalfFrag[] = [];
        for (let side = 0; side < 2; side++) {
            const frag = document.createElement('span');
            frag.className = 'url-frag';
            frag.textContent = ch === ' ' ? '\u00a0' : ch;
            frag.style.clipPath = halfPlaneClip(cutAngle, side as 0 | 1);

            // Each half gets its own angle within the upper semicircle
            const travelAngle = baseAngle + (side === 1 ? (Math.random() - 0.5) * 0.8 : 0);
            const [ox, oy] = offScreenRadial(travelAngle);
            const startRot = (Math.random() - 0.5) * 2 * 360;

            // Each fragment has its own arrival window within the global anim range
            const totalWindow = URL_ANIM_END - URL_ANIM_START;
            const fragDuration = 2 + Math.random() * 3;
            const animStart = URL_ANIM_START + Math.random() * (totalWindow - fragDuration);
            const animEnd = animStart + fragDuration;

            const startSize = FINAL_FONT_PX * (6 + Math.random() * 4);
            const colorIdx = Math.floor(Math.random() * FRAG_COLORS.length);

            frag.style.fontSize = `${startSize}px`;
            frag.style.transform = `translate(${ox}px, ${oy}px) rotate(${startRot}deg)`;
            frag.style.opacity = '0';
            frag.style.color = FRAG_COLORS[colorIdx];

            charWrap.appendChild(frag);
            halves.push({
                el: frag, startX: ox, startY: oy, startRot, startSize,
                animStart, animEnd,
                colorIdx, settledAt: -1, settledR: 255, settledG: 255, settledB: 255,
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

// Sigmoid: steeper = faster transition probability ramp
function sigmoid(x: number, steepness = 5): number {
    return 1 / (1 + Math.exp(-steepness * (x - 0.5)));
}

const WHITE_SETTLE = 0.4;  // seconds to fade to white after arrival
const PLACARD_FADE = 1.0;  // seconds for placard to ease in

let placardRevealTime = Infinity;  // set when enough fragments have arrived

function updateUrl(elapsed: number): void {
    // Trigger placard once 3 fragments have settled
    if (placardRevealTime === Infinity) {
        let settledCount = 0;
        for (const entry of charEntries) {
            for (const hf of entry.halves) {
                if (hf.settledAt >= 0) settledCount++;
            }
        }
        if (settledCount >= 3) placardRevealTime = elapsed;
    }

    const placardEl = document.getElementById('url-placard');
    if (placardEl) {
        const tp = Math.max(0, Math.min(1, (elapsed - placardRevealTime) / PLACARD_FADE));
        placardEl.style.opacity = String(cubicInOut(tp));
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

            if (tf >= 1) {
                // Record the moment of arrival and the color we landed on
                if (hf.settledAt < 0) {
                    hf.settledAt = elapsed;
                    const hex = FRAG_COLORS[hf.colorIdx];
                    hf.settledR = parseInt(hex.slice(1, 3), 16);
                    hf.settledG = parseInt(hex.slice(3, 5), 16);
                    hf.settledB = parseInt(hex.slice(5, 7), 16);
                }
                const tw = Math.min(1, (elapsed - hf.settledAt) / WHITE_SETTLE);
                const r = Math.round(lerp(hf.settledR, 255, tw));
                const g = Math.round(lerp(hf.settledG, 255, tw));
                const b = Math.round(lerp(hf.settledB, 255, tw));
                colorStr = `rgb(${r},${g},${b})`;
            } else {
                // Stochastic color switching: P(switch) rises via sigmoid as tf → 1
                const pSwitch = sigmoid(tf);
                if (Math.random() < pSwitch) {
                    hf.colorIdx = (hf.colorIdx + 1) % FRAG_COLORS.length;
                }
                colorStr = FRAG_COLORS[hf.colorIdx];
            }

            hf.el.style.fontSize = `${size}px`;
            hf.el.style.color = colorStr;
            hf.el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
            hf.el.style.opacity = elapsed < hf.animStart ? '0' : '1';
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

// ── Main loop ─────────────────────────────────────────────────────────────────
function startPromo(): void {
    buildUrlDisplay();
    const cm = setupSimulator();

    (window as any).promoReady = true;

    let startTime: number | null = null;
    let lastTilt = TILT_START;

    function tick(now: number): void {
        if (startTime === null) startTime = now;
        const elapsed = (now - startTime) / 1000;
        const t = Math.min(elapsed, TOTAL);

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

        updateUrl(t);

        if (t < TOTAL) {
            requestAnimationFrame(tick);
        } else {
            (window as any).promoDone = true;
        }
    }

    requestAnimationFrame(tick);
}

document.addEventListener('DOMContentLoaded', startPromo);
