// Generic engine for emoji critters that drift around a page section and open
// a modal when clicked. Used by goodreadsScrolls (review scrolls) and
// publisherTeasers (image teasers).

export function isDebugMode(): boolean {
    return new URLSearchParams(window.location.search).get('debug') === '1';
}

// ── 2D Perlin noise ──────────────────────────────────────────────────────────

function buildPerm(seed: number): Uint8Array {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = (seed ^ 0xdeadbeef) >>> 0;
    for (let i = 255; i > 0; i--) {
        s = Math.imul(s ^ (s >>> 15), s | 1);
        s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
        s = ((s ^ (s >>> 14)) >>> 0);
        const j = s % (i + 1);
        const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    return perm;
}

function fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a: number, b: number, t: number): number { return a + t * (b - a); }

function grad2(hash: number, x: number, y: number): number {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

function perlin2(perm: Uint8Array, x: number, y: number): number {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    return lerp(
        lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u),
        lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u),
        v,
    );
}

// ── Critter contract ─────────────────────────────────────────────────────────

export interface Critter {
    /** Pin this critter to a specific emoji instead of a random pick from the palette. */
    emoji?: string;
    /** Build the drifting element's inner content (the "card"). The returned
     * element's root receives `gr-scroll`-layer positioning from the engine. */
    buildCard(emoji: string): HTMLElement;
    /** Populate the shared modal with this critter's content and open it. */
    openModal(modal: HTMLElement): void;
    /** Called when the shared modal closes, regardless of which critter opened it. */
    onModalClose?(modal: HTMLElement): void;
    /** Called when the critter respawns off-screen, letting it swap to new content in place. */
    onRespawn?(card: HTMLElement, emoji: string): void;
}

export interface CritterLayerOptions {
    anchorEl: HTMLElement;
    anchorEndEl?: HTMLElement | null;
    buildModal(): HTMLElement;
    /** Width of the drifting card, in rem — used for offscreen/collision math. */
    cardWidthRem: number;
    /** Height of the drifting card, in px — used for band-clamping. */
    cardHeightPx: number;
    emojis?: string[];
    emojiOffsets?: Record<string, number>;
    maxOnscreen?: number;
    /** Exposed as `(window as any).__<debugNamespace>` for debugging in dev. */
    debugNamespace?: string;
}

const DEFAULT_EMOJIS = ['🦋', '🐝', '🐞', '🪰'];
const DEFAULT_EMOJI_OFFSETS: Record<string, number> = { '🦋': -100, '🐝': 180, '🐞': -100, '🪰': -225 };

// ── Drift state ──────────────────────────────────────────────────────────────

type AnimPhase = 'waiting' | 'drifting';

interface DriftState {
    el: HTMLElement;
    sealEl: HTMLElement;
    critterEmoji: string;
    x: number;
    pageY: number;  // page-absolute Y — physics run here; viewport Y = pageY - scrollY
    vx: number;
    vy: number;
    rot: number;
    permRot: Uint8Array;
    t: number;
    destX: number;
    destPageY: number;
    // Drifting circle origin — scroll targets are sampled within ORIGIN_RADIUS of this
    originX: number;
    originPageY: number;
    driftDirX: -1 | 1;
    driftAngle: number;  // radians, ±15° off horizontal
    driftSpeed: number;
    nextDestAt: number;  // ms timestamp — pick next dest only after this
    phase: AnimPhase;
    waitUntil: number;
}

const ORIGIN_RADIUS = 100;
const ACCEL = 40;    // px/s² toward dest
const FRICTION = 0.5; // velocity multiplied each second (lower = more damping)
const MAX_DRIFT_ANGLE = 15 * Math.PI / 180;

function remToPx(rem: number): number {
    return rem * parseFloat(getComputedStyle(document.documentElement).fontSize);
}

function randomBetween(a: number, b: number): number {
    return a + Math.random() * (b - a);
}

// Returns page-absolute Y band spanning the full anchored section
function getPageYBand(anchorEl: HTMLElement, anchorEnd: HTMLElement | null): [number, number] {
    const topRect = anchorEl.getBoundingClientRect();
    const pageTop = topRect.top + window.scrollY;
    if (anchorEnd) {
        const botRect = anchorEnd.getBoundingClientRect();
        return [pageTop, botRect.bottom + window.scrollY];
    }
    const pageBot = topRect.bottom + window.scrollY;
    const mid = (pageTop + pageBot) / 2;
    const halfBand = Math.max(160, (pageBot - pageTop) / 2);
    return [pageTop, pageBot > pageTop ? pageBot : mid + halfBand];
}

// Pick a random dest within ORIGIN_RADIUS of the given origin
function newDest(originX: number, originPageY: number): [number, number] {
    const angle = randomBetween(0, Math.PI * 2);
    const r = randomBetween(0, ORIGIN_RADIUS);
    return [originX + Math.cos(angle) * r, originPageY + Math.sin(angle) * r];
}

// Convert page-absolute Y to viewport Y for position:fixed rendering
function pageToViewportY(pageY: number): number {
    return pageY - window.scrollY;
}

function randomDriftAngle(driftDirX: -1 | 1): number {
    const angle = randomBetween(-MAX_DRIFT_ANGLE, MAX_DRIFT_ANGLE);
    return driftDirX === 1 ? angle : Math.PI + angle;
}

function initDrift(
    el: HTMLElement, sealEl: HTMLElement, critterEmoji: string,
    bandTop: number, bandBot: number, index: number, seed: number,
    cardWidthPx: number, cardHeightPx: number,
): DriftState {
    const driftDirX: -1 | 1 = Math.random() < 0.5 ? 1 : -1;
    const originX = driftDirX === 1
        ? -ORIGIN_RADIUS - cardWidthPx
        : window.innerWidth + ORIGIN_RADIUS + cardWidthPx;
    const originPageY = randomBetween(bandTop, bandBot - cardHeightPx);
    const [destX, destPageY] = newDest(originX, originPageY);
    const stagger = index === 0 ? randomBetween(0, 500) : randomBetween(3000, 10000);

    return {
        el,
        sealEl,
        critterEmoji,
        x: originX,
        pageY: originPageY,
        vx: 0,
        vy: 0,
        rot: 0,
        permRot: buildPerm(seed),
        t: Math.random() * 100,
        destX,
        destPageY,
        originX,
        originPageY,
        driftDirX,
        driftAngle: randomDriftAngle(driftDirX),
        driftSpeed: randomBetween(8, 16),
        nextDestAt: 0,
        phase: 'waiting',
        waitUntil: performance.now() + stagger,
    };
}

// Repulsive force between circle origins, escalating with collision duration
const collisionDurations = new Map<string, number>();
const collisionBias = new Map<string, number>(); // stable angular bias per pair

function resolveCollisions(states: DriftState[], dt: number, bandTop: number, bandBot: number, cardHeightPx: number): void {
    const active = states.filter(s => s.phase === 'drifting');
    const minDist = ORIGIN_RADIUS * 2;
    const activeKeys = new Set<string>();

    for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
            const a = active[i], b = active[j];
            const dx = b.originX - a.originX;
            const dy = b.originPageY - a.originPageY;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            if (dist < minDist) {
                const key = `${i}-${j}`;
                activeKeys.add(key);
                const dur = (collisionDurations.get(key) ?? 0) + dt;
                collisionDurations.set(key, dur);
                if (!collisionBias.has(key)) collisionBias.set(key, randomBetween(-Math.PI / 6, Math.PI / 6));
                const scale = 1 + dur * 2;
                const force = (minDist - dist) * 30 * scale * dt;
                const jitter = collisionBias.get(key)!;
                const cos = Math.cos(jitter), sin = Math.sin(jitter);
                const nx = dx / dist, ny = dy / dist;
                const jx = nx * cos - ny * sin, jy = nx * sin + ny * cos;
                a.originX -= jx * force;
                a.originPageY -= jy * force;
                b.originX += jx * force;
                b.originPageY += jy * force;
            }
        }
        // Clamp origin Y within band
        active[i].originPageY = Math.max(bandTop, Math.min(bandBot - cardHeightPx, active[i].originPageY));
    }

    // Decay durations for pairs no longer colliding
    for (const key of collisionDurations.keys()) {
        if (!activeKeys.has(key)) {
            collisionDurations.delete(key);
            collisionBias.delete(key);
        }
    }
}

/**
 * Spawn a layer of drifting critters over the page section anchored by
 * `options.anchorEl`/`anchorEndEl`. Each critter's card comes from
 * `items[i].buildCard()`, and clicking it calls `items[i].openModal(modal)`
 * on the shared modal returned by `options.buildModal()`.
 */
export function spawnCritterLayer(items: Critter[], options: CritterLayerOptions): void {
    const {
        anchorEl, anchorEndEl = null, buildModal,
        cardWidthRem, cardHeightPx,
        emojis = DEFAULT_EMOJIS, emojiOffsets = DEFAULT_EMOJI_OFFSETS,
        maxOnscreen = 5, debugNamespace,
    } = options;
    const debug = isDebugMode();

    const capped = items.slice(0, maxOnscreen);
    const container = document.createElement('div');
    container.className = 'gr-scrolls-layer';
    container.setAttribute('aria-label', 'Drifting critters');
    document.body.appendChild(container);

    let debugCanvas: HTMLCanvasElement | null = null;
    let debugCtx: CanvasRenderingContext2D | null = null;
    if (debug) {
        debugCanvas = document.createElement('canvas');
        debugCanvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999';
        document.body.appendChild(debugCanvas);
        debugCtx = debugCanvas.getContext('2d');
    }

    container.classList.add('gr-scrolls-layer--visible');

    const [bandTop, bandBot] = getPageYBand(anchorEl, anchorEndEl);

    const modal = buildModal();
    document.documentElement.appendChild(modal);
    const closeModal = () => {
        modal.classList.remove('is-open');
        for (const item of items) item.onModalClose?.(modal);
    };
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    modal.querySelector('.gr-review-modal-close, .blurb-modal-close')?.addEventListener('click', closeModal);
    document.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); });

    const cardWidthPx = remToPx(cardWidthRem);

    const states: DriftState[] = capped.map((item, i) => {
        const emoji = item.emoji ?? emojis[Math.floor(Math.random() * emojis.length)];
        const card = item.buildCard(emoji);
        card.classList.add('gr-scroll');
        card.style.width = `${cardWidthRem}rem`;
        const sealEl = card.querySelector('.gr-scroll-seal') as HTMLElement;
        card.style.visibility = 'hidden';
        container.appendChild(card);
        const state = initDrift(card, sealEl, emoji, bandTop, bandBot, i, i * 1337 + 42, cardWidthPx, cardHeightPx);

        const open = () => { item.openModal(modal); modal.classList.add('is-open'); };
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.addEventListener('click', e => { e.stopPropagation(); open(); });
        card.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });

        return state;
    });

    let lastTime = performance.now();
    const MIN_FRAME_MS = 100; // max 10 updates/sec

    function tick(now: number): void {
        if (now - lastTime < MIN_FRAME_MS) { requestAnimationFrame(tick); return; }
        const dt = Math.min((now - lastTime) / 1000, 0.15);
        lastTime = now;

        const [bt, bb] = getPageYBand(anchorEl, anchorEndEl);

        for (let i = 0; i < states.length; i++) {
            const state = states[i];

            if (state.phase === 'waiting') {
                const viewY = pageToViewportY(state.pageY);
                state.el.style.transform = `translate(${state.x}px, ${viewY}px)`;
                if (now >= state.waitUntil) {
                    state.phase = 'drifting';
                    state.el.style.visibility = '';
                }
                continue;
            }

            if (state.phase === 'drifting') {
                state.t += dt;

                // Drift the circle origin along its angled trajectory.
                // Lerp speed 2x→1x as origin moves from fully offscreen to fully onscreen.
                const offscreenDist = Math.max(0,
                    state.originX < 0
                        ? -(state.originX + cardWidthPx)
                        : (state.originX - window.innerWidth + cardWidthPx)
                );
                const offscreenT = Math.min(1, offscreenDist / (ORIGIN_RADIUS + cardWidthPx));
                const effectiveSpeed = state.driftSpeed * (1 + offscreenT);
                state.originX += Math.cos(state.driftAngle) * effectiveSpeed * dt;
                state.originPageY += Math.sin(state.driftAngle) * effectiveSpeed * dt;
                // Bounce off top/bottom band walls
                if (state.originPageY < bt) {
                    state.originPageY = bt;
                    state.driftAngle = -state.driftAngle;
                } else if (state.originPageY > bb - cardHeightPx) {
                    state.originPageY = bb - cardHeightPx;
                    state.driftAngle = -state.driftAngle;
                }

                // Respawn origin on opposite side when card is fully off-screen
                let respawned = false;
                if (state.originX > window.innerWidth + ORIGIN_RADIUS + cardWidthPx) {
                    state.originX = -ORIGIN_RADIUS - cardWidthPx;
                    state.originPageY = randomBetween(bt, bb - cardHeightPx);
                    state.driftSpeed = randomBetween(8, 16);
                    state.driftAngle = randomDriftAngle(1);
                    respawned = true;
                } else if (state.originX < -ORIGIN_RADIUS - cardWidthPx) {
                    state.originX = window.innerWidth + ORIGIN_RADIUS + cardWidthPx;
                    state.originPageY = randomBetween(bt, bb - cardHeightPx);
                    state.driftSpeed = randomBetween(8, 16);
                    state.driftAngle = randomDriftAngle(-1);
                    respawned = true;
                }
                if (respawned) {
                    const [ndx, ndy] = newDest(state.originX, state.originPageY);
                    state.x = state.originX;
                    state.pageY = state.originPageY;
                    state.destX = ndx;
                    state.destPageY = ndy;
                    state.vx = 0;
                    state.vy = 0;
                    state.nextDestAt = 0;
                    capped[i].onRespawn?.(state.el, state.critterEmoji);
                    state.sealEl = state.el.querySelector('.gr-scroll-seal') as HTMLElement;
                }

                // Accelerate toward dest, friction, integrate
                const toX = state.destX - state.x;
                const toY = state.destPageY - state.pageY;
                const dist = Math.sqrt(toX * toX + toY * toY) || 1;
                state.vx += (toX / dist) * ACCEL * dt;
                state.vy += (toY / dist) * ACCEL * dt;
                const frictionFactor = Math.pow(FRICTION, dt);
                state.vx *= frictionFactor;
                state.vy *= frictionFactor;
                state.x += state.vx * dt;
                state.pageY += state.vy * dt;

                state.rot = perlin2(state.permRot, state.t * 0.1, 0.5) * 15;

                // Settle detection: close to dest and slow
                const dxDest = state.x - state.destX;
                const dyDest = state.pageY - state.destPageY;
                if (dxDest * dxDest + dyDest * dyDest < 15 * 15) {
                    if (state.nextDestAt === 0) state.nextDestAt = now + randomBetween(100, 500);
                    if (now >= state.nextDestAt) {
                        const [ndx, ndy] = newDest(state.originX, state.originPageY);
                        state.destX = ndx; state.destPageY = ndy;
                        state.nextDestAt = 0;
                    }
                } else {
                    state.nextDestAt = 0;
                }
            }
        }

        resolveCollisions(states, dt, bt, bb, cardHeightPx);
        // Render all drifting cards: scroll offset applied instantly here
        for (const state of states) {
            if (state.phase === 'drifting') {
                const viewY = pageToViewportY(state.pageY);
                state.el.style.transform = `translate(${state.x}px, ${viewY}px) rotate(${state.rot}deg)`;
                const speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
                if (speed > 1) {
                    const heading = Math.atan2(state.vy, state.vx) * 180 / Math.PI;
                    const offset = emojiOffsets[state.critterEmoji] ?? 0;
                    state.sealEl.style.transform = `rotate(${heading - offset}deg)`;
                }
            }
        }

        if (debugCtx && debugCanvas) {
            debugCanvas.width = window.innerWidth;
            debugCanvas.height = window.innerHeight;
            const ctx = debugCtx;
            ctx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);

            // Band rectangle
            const bandTopView = pageToViewportY(bt);
            const bandBotView = pageToViewportY(bb);
            ctx.globalAlpha = 0.08;
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, bandTopView, window.innerWidth, bandBotView - bandTopView);
            ctx.globalAlpha = 0.3;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.strokeRect(0, bandTopView, window.innerWidth, bandBotView - bandTopView);

            const colors = ['#f00', '#0b0', '#00f', '#f80', '#80f'];
            for (let i = 0; i < states.length; i++) {
                const state = states[i];
                if (state.phase !== 'drifting') continue;
                const color = colors[i % colors.length];

                // Drifting circle origin
                const originViewY = pageToViewportY(state.originPageY);
                ctx.globalAlpha = 0.25;
                ctx.beginPath();
                ctx.arc(state.originX, originViewY, ORIGIN_RADIUS, 0, Math.PI * 2);
                ctx.strokeStyle = color;
                ctx.lineWidth = 1.5;
                ctx.stroke();
                // Origin center dot
                ctx.globalAlpha = 0.6;
                ctx.beginPath();
                ctx.arc(state.originX, originViewY, 4, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();

                // Dest dot
                const destViewY = pageToViewportY(state.destPageY);
                ctx.globalAlpha = 0.9;
                ctx.beginPath();
                ctx.arc(state.destX, destViewY, 6, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();

                // Line from card position (top-left) to dest (also top-left)
                ctx.globalAlpha = 0.5;
                ctx.beginPath();
                ctx.moveTo(state.x, pageToViewportY(state.pageY));
                ctx.lineTo(state.destX, destViewY);
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.globalAlpha = 1;

                // Speed and distance label near the dest dot
                const dxD = state.x - state.destX;
                const dyD = state.pageY - state.destPageY;
                const dist = Math.sqrt(dxD * dxD + dyD * dyD);
                const spd = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
                const label = `d:${dist.toFixed(0)} v:${spd.toFixed(0)}`;
                ctx.font = '11px monospace';
                const lx = state.destX + 9, ly = destViewY - 5;
                const tw = ctx.measureText(label).width;
                ctx.globalAlpha = 0.75;
                ctx.fillStyle = '#000';
                ctx.fillRect(lx - 2, ly - 11, tw + 4, 14);
                ctx.globalAlpha = 1;
                ctx.fillStyle = '#fff';
                ctx.fillText(label, lx, ly);
            }
        }

        requestAnimationFrame(tick);
    }

    if (debugNamespace) {
        (window as any)[debugNamespace] = {
            states,
            items: capped,
            /** Print a summary of each critter's current position and phase */
            status() {
                states.forEach((s, i) => {
                    console.log(`[${i}] phase=${s.phase} x=${s.x.toFixed(0)} pageY=${s.pageY.toFixed(0)} vx=${s.vx.toFixed(1)} vy=${s.vy.toFixed(1)}`);
                });
            },
            /** Force-open the modal for critter index i (0-based) */
            open(i: number) { states[i]?.el.click(); },
            /** Teleport critter i to viewport centre */
            center(i: number) {
                const s = states[i];
                if (!s) return;
                s.x = window.innerWidth / 2;
                s.pageY = window.scrollY + window.innerHeight / 2;
                s.vx = s.vy = 0;
            },
        };
    }

    requestAnimationFrame(tick);
}
