// Conical spotlight beam + ellipse glow that wobbles over a framed image,
// inspired by the off-frame-origin cone construction in rubb-chap/animate.py.

import { isDebugMode } from './driftingCritters.js';

const WOBBLE_PROPORTION = 1.2;   // glow centre wobble, as a fraction of the shorter radius
const WOBBLE_PERIOD_MS = 2500;   // time between wobble waypoints
const ORIGIN_X_OFFSET = 0.6;     // source distance beyond the left/right edge, as a fraction of width
const DEST_OFFSET_FACTOR = 0.32; // how far the glow's resting point shifts side to side, as a fraction of width
const ORIGIN_Y_OFFSET = 0.35;    // source height above the top edge, as a fraction of height
const GLOW_RADIUS_FACTOR = 0.32; // ellipse radius, as a fraction of the shorter canvas dimension
const GLOW_ASPECT = 1.15;        // ellipse rx:ry ratio
const TINT = [255, 235, 191] as const; // warm beam color (matches animate.py's intensity tint)
const PEAK_ALPHA = 0.55;

interface TangentAngles {
    min: number;
    max: number;
}

function ellipseTangentAngles(px: number, py: number, cx: number, cy: number, rx: number, ry: number): TangentAngles {
    const dx = px - cx;
    const dy = py - cy;
    const u = dx / rx;
    const v = dy / ry;
    const d = Math.sqrt(u * u + v * v);
    if (d <= 1) {
        const base = Math.atan2(dy, dx);
        return { min: base - Math.PI / 2, max: base + Math.PI / 2 };
    }
    const half = Math.acos(1 / d);
    const baseAngle = Math.atan2(v, u);
    const t1 = baseAngle + half;
    const t2 = baseAngle - half;
    const tp1x = cx + rx * Math.cos(t1);
    const tp1y = cy + ry * Math.sin(t1);
    const tp2x = cx + rx * Math.cos(t2);
    const tp2y = cy + ry * Math.sin(t2);
    const a1 = Math.atan2(tp1y - py, tp1x - px);
    const a2 = Math.atan2(tp2y - py, tp2x - px);
    return { min: Math.min(a1, a2), max: Math.max(a1, a2) };
}

function easeInOut(t: number): number {
    return t * t * (3 - 2 * t);
}

function rgba(alpha: number): string {
    return `rgba(${TINT[0]}, ${TINT[1]}, ${TINT[2]}, ${alpha})`;
}

type SidePhase = 'holding' | 'gliding' | 'reversing';

// Drives a value that lingers at -1 or 1, then glides to the other side on a random
// hold schedule. Each glide has a chance to stall partway and reverse back to its
// starting side, easing from wherever it currently sits so the motion stays continuous.
interface SideScheduleOptions {
    holdMinMs: number;     // minimum time spent settled on one side
    holdMaxMs: number;     // maximum time spent settled on one side
    glideMs: number;       // time spent gliding from one side to the other
    abortGlideChance: number; // odds [0, 1] a side switch stalls partway and reverses back
}

class SideSchedule {
    private side: -1 | 1;
    private reverseToSide: -1 | 1 = 1;
    private phase: SidePhase = 'holding';
    private from: number;
    private to: number;
    private glideStartedAt: number;
    private dueAt: number;

    constructor(private readonly rng: () => number, now: number, private readonly opts: SideScheduleOptions) {
        this.side = rng() < 0.5 ? -1 : 1;
        this.from = this.side;
        this.to = this.side;
        this.glideStartedAt = now;
        this.dueAt = now + this.randomHoldMs();
    }

    value(now: number): number {
        const t = Math.min((now - this.glideStartedAt) / this.opts.glideMs, 1);
        const current = this.from + (this.to - this.from) * easeInOut(t);

        if (this.phase === 'holding' && now >= this.dueAt) {
            const originalSide = this.side;
            this.beginGlide(this.side === 1 ? -1 : 1, current, now);
            if (this.rng() < this.opts.abortGlideChance) {
                this.phase = 'reversing';
                this.reverseToSide = originalSide;
                this.dueAt = now + this.opts.glideMs * (0.3 + this.rng() * 0.4);
            }
        } else if (this.phase === 'reversing' && now >= this.dueAt) {
            this.beginGlide(this.reverseToSide, current, now);
        } else if (this.phase === 'gliding' && t >= 1) {
            this.phase = 'holding';
            this.dueAt = now + this.randomHoldMs();
        }

        return current;
    }

    private randomHoldMs(): number {
        return this.opts.holdMinMs + this.rng() * (this.opts.holdMaxMs - this.opts.holdMinMs);
    }

    private beginGlide(target: -1 | 1, current: number, now: number): void {
        this.side = target;
        this.phase = 'gliding';
        this.from = current;
        this.to = target;
        this.glideStartedAt = now;
        this.dueAt = now + this.opts.glideMs + this.randomHoldMs();
    }
}

// Smoothly interpolated 1-D noise: lerps between random waypoints sampled every `periodMs`.
function wobbleNoise(rng: () => number, t: number, periodMs: number): number {
    const phase = t / periodMs;
    const i = Math.floor(phase);
    const frac = phase - i;
    const a = sampleAt(rng, i);
    const b = sampleAt(rng, i + 1);
    const eased = frac * frac * (3 - 2 * frac);
    return a + (b - a) * eased;
}

const noiseCache = new Map<number, number>();
function sampleAt(rng: () => number, i: number): number {
    let v = noiseCache.get(i);
    if (v === undefined) {
        v = rng() * 2 - 1;
        noiseCache.set(i, v);
        if (noiseCache.size > 64) noiseCache.delete(noiseCache.keys().next().value!);
    }
    return v;
}

// Cyan tangent rays + origin dot + orange ellipse outline, mirroring animate.py's draw_debug.
function drawDebug(ctx: CanvasRenderingContext2D, originX: number, originY: number,
    cx: number, cy: number, rx: number, ry: number,
    minAngle: number, maxAngle: number, rayLen: number): void {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.7)';
    for (const angle of [minAngle, maxAngle]) {
        ctx.beginPath();
        ctx.moveTo(originX, originY);
        ctx.lineTo(originX + rayLen * Math.cos(angle), originY + rayLen * Math.sin(angle));
        ctx.stroke();
    }

    ctx.fillStyle = 'rgba(0, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(originX, originY, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 128, 0, 0.7)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

export interface SpotlightHandle {
    stop(): void;
}

/** Start an animated conical spotlight over `canvas`, sized to `frameEl`'s box. Returns a handle to stop it. */
export function startSpotlight(canvas: HTMLCanvasElement, frameEl: HTMLElement, seed: number): SpotlightHandle {
    const ctx = canvas.getContext('2d')!;
    const rng = mulberry32(seed);
    const wobbleAngleSeed = rng();
    const debug = isDebugMode();
    let stopped = false;
    let lastDrawTime = 0;
    const MIN_FRAME_MS = 100;

    // Independent side-switching schedules for the source and the glow's landing point,
    // so the beam doesn't always sweep and land in lockstep.
    const sourceSide = new SideSchedule(rng, performance.now(), {
        holdMinMs: 10000,
        holdMaxMs: 40000,
        glideMs: 8000,
        abortGlideChance: 0.3,
    });
    const focusSide = new SideSchedule(rng, performance.now(), {
        holdMinMs: 5000,
        holdMaxMs: 25000,
        glideMs: 5000,
        abortGlideChance: 0.5,
    });

    function resize(): void {
        const rect = frameEl.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(frameEl);

    function draw(now: number): void {
        if (stopped) return;
        if (now - lastDrawTime >= MIN_FRAME_MS) {
            lastDrawTime = now;
            render(now);
        }
        requestAnimationFrame(draw);
    }

    function render(now: number): void {
        const w = canvas.width;
        const h = canvas.height;
        if (w === 0 || h === 0) return;
        ctx.clearRect(0, 0, w, h);

        const shortSide = Math.min(w, h);
        const rx = shortSide * GLOW_RADIUS_FACTOR * GLOW_ASPECT;
        const ry = shortSide * GLOW_RADIUS_FACTOR;
        const maxWobble = Math.min(rx, ry) * WOBBLE_PROPORTION;
        const wobbleAngle = wobbleAngleSeed * Math.PI * 2 + now / (WOBBLE_PERIOD_MS * 2.7);
        const wobbleMag = wobbleNoise(rng, now, WOBBLE_PERIOD_MS) * maxWobble;

        const sourceSideValue = sourceSide.value(now);
        const focusSideValue = focusSide.value(now);

        const cx = w / 2 + focusSideValue * w * DEST_OFFSET_FACTOR + Math.cos(wobbleAngle) * wobbleMag;
        const cy = h / 2 + Math.sin(wobbleAngle) * wobbleMag;

        const originX = w / 2 + sourceSideValue * w * (0.5 + ORIGIN_X_OFFSET);
        const originY = -h * ORIGIN_Y_OFFSET;

        ctx.globalCompositeOperation = 'lighter';

        // Cone: filled triangle from the off-frame origin to the points where its tangent
        // lines touch the ellipse — a visible shaft that terminates right at the glow's edge.
        const { min, max } = ellipseTangentAngles(originX, originY, cx, cy, rx, ry);
        const coneReach = Math.hypot(cx - originX, cy - originY);
        const p1x = originX + coneReach * Math.cos(min);
        const p1y = originY + coneReach * Math.sin(min);
        const p2x = originX + coneReach * Math.cos(max);
        const p2y = originY + coneReach * Math.sin(max);

        // Pull the cone's far edge in short of the ellipse and feather it with a blur so
        // the straight-edged triangle dissolves into the glow instead of butting against it.
        const coneShrink = Math.min(rx, ry) * 0.6;
        const coneFeatherReach = Math.max(coneReach - coneShrink, 0);
        const fp1x = originX + coneFeatherReach * Math.cos(min);
        const fp1y = originY + coneFeatherReach * Math.sin(min);
        const fp2x = originX + coneFeatherReach * Math.cos(max);
        const fp2y = originY + coneFeatherReach * Math.sin(max);

        const coneGrad = ctx.createLinearGradient(originX, originY, cx, cy);
        coneGrad.addColorStop(0, rgba(PEAK_ALPHA * 0.18));
        coneGrad.addColorStop(1, rgba(PEAK_ALPHA * 0.5));
        ctx.save();
        ctx.filter = `blur(${Math.max(coneShrink * 0.5, 1)}px)`;
        ctx.fillStyle = coneGrad;
        ctx.beginPath();
        ctx.moveTo(originX, originY);
        ctx.lineTo(fp1x, fp1y);
        ctx.lineTo(fp2x, fp2y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // Ellipse glow at the beam's landing point.
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(rx, ry);
        const glowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        glowGrad.addColorStop(0, rgba(PEAK_ALPHA * 0.8));
        glowGrad.addColorStop(0.4, rgba(PEAK_ALPHA * 0.5));
        glowGrad.addColorStop(1, rgba(0));
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.globalCompositeOperation = 'source-over';

        if (debug) drawDebug(ctx, originX, originY, cx, cy, rx, ry, min, max, Math.hypot(w, h) * 2);
    }

    requestAnimationFrame(draw);

    return {
        stop(): void {
            stopped = true;
            resizeObserver.disconnect();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        },
    };
}

// Deterministic PRNG so each teaser's wobble is reproducible across loads.
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function(): number {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
