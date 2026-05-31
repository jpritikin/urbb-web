interface Review {
    reviewer: string;
    stars: number;
    date: string;
    text: string;
}

const PARODY_REVIEWS: Review[] = [
    {
        reviewer: 'DaemonPossessed1987',
        stars: 5,
        date: 'March 3, 2026',
        text: 'I opened this book and my houseplants immediately achieved enlightenment. They refuse to be watered now. They say they have transcended thirst. I blame the author personally.',
    },
    {
        reviewer: 'SkepticalProfessor42',
        stars: 1,
        date: 'April 1, 2026',
        text: 'I was promised religion WITHOUT belief. I still accidentally believed three things before breakfast. This book has failed to deliver on its core premise. One star.',
    },
    {
        reviewer: 'CastanedaWasRight',
        stars: 5,
        date: 'February 14, 2026',
        text: 'My IFS parts held a committee meeting about this book. The exile loved it. The manager gave it three stars but was overruled. The firefighter didn\'t finish it but felt very strongly about chapter seven. We have reached consensus: five stars.',
    },
    {
        reviewer: 'NeuroPhenomEnjoyer',
        stars: 4,
        date: 'January 9, 2026',
        text: 'Docked one star because the bibliography cited papers I have not read and now I feel obligated to read them. This book has given me homework. I did not consent to homework.',
    },
    {
        reviewer: 'SpiritualMarketingMBA',
        stars: 5,
        date: 'May 1, 2026',
        text: 'As a New Age influencer I came for the aesthetic and stayed for the citations. The footnotes alone cured my sciatica. My daemon wrote this review. I was not present for most of it.',
    },
];

function isDebugMode(): boolean {
    const param = new URLSearchParams(window.location.search).get('debug');
    if (param === '0') return false;
    if (param === '1') return true;
    const host = window.location.hostname;
    return host !== 'unburdened.biz' && host !== 'www.unburdened.biz';
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

// ── Scroll state ─────────────────────────────────────────────────────────────

type AnimPhase = 'waiting' | 'drifting';

const CRITTER_EMOJIS = ['🦋', '🐝', '🐞', '🪰'];
const CRITTER_OFFSETS: Record<string, number> = { '🦋': -100, '🐝': 180, '🐞': -100, '🪰': -225 };

interface ScrollState {
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

const SCROLL_WIDTH_REM = 11;
const SCROLL_HEIGHT_PX = 90;
const MAX_ONSCREEN = 5;
const ORIGIN_RADIUS = 100;
const ACCEL = 40;    // px/s² toward dest
const FRICTION = 0.5; // velocity multiplied each second (lower = more damping)

function starsHtml(n: number): string {
    return Array.from({ length: 5 }, (_, i) =>
        `<span class="gr-scroll-star ${i < n ? 'lit' : ''}">${i < n ? '✦' : '✧'}</span>`
    ).join('');
}

function buildScrollEl(review: Review): { el: HTMLElement; sealEl: HTMLElement; critterEmoji: string } {
    const el = document.createElement('div');
    el.className = 'gr-scroll';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', `Review by ${review.reviewer} — click to read`);
    const preview = review.text.slice(0, 80) + (review.text.length > 80 ? '…' : '');
    const emoji = CRITTER_EMOJIS[Math.floor(Math.random() * CRITTER_EMOJIS.length)];
    el.innerHTML = `
    <div class="gr-scroll-seal">${emoji}</div>
    <div class="gr-scroll-inner">
      <div class="gr-scroll-header">
        <span class="gr-scroll-name">${review.reviewer}</span>
        <span class="gr-scroll-stars">${starsHtml(review.stars)}</span>
        <span class="gr-scroll-date">${review.date}</span>
      </div>
      <div class="gr-scroll-preview">"${preview}"</div>
    </div>`;
    const sealEl = el.querySelector('.gr-scroll-seal') as HTMLElement;
    return { el, sealEl, critterEmoji: emoji };
}

function buildModal(): HTMLElement {
    const modal = document.createElement('div');
    modal.className = 'gr-review-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
    <div class="gr-review-modal-inner">
      <button class="gr-review-modal-close" aria-label="Close">✕</button>
      <div class="gr-review-modal-content">
        <div class="gr-review-modal-header">
          <span class="gr-review-modal-name"></span>
          <span class="gr-review-modal-stars"></span>
          <span class="gr-review-modal-date"></span>
        </div>
        <p class="gr-review-modal-text"></p>
        <a class="gr-review-modal-source no-underline hover:no-underline"
           href="https://www.goodreads.com/book/show/249868833-religion-unburdened-by-belief"
           target="_blank" rel="noopener">via Goodreads ↗</a>
      </div>
    </div>`;
    return modal;
}

function remToPx(rem: number): number {
    return rem * parseFloat(getComputedStyle(document.documentElement).fontSize);
}

function randomBetween(a: number, b: number): number {
    return a + Math.random() * (b - a);
}


// Returns page-absolute Y band spanning the full Acclaim section
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

const MAX_DRIFT_ANGLE = 15 * Math.PI / 180;

function randomDriftAngle(driftDirX: -1 | 1): number {
    const angle = randomBetween(-MAX_DRIFT_ANGLE, MAX_DRIFT_ANGLE);
    return driftDirX === 1 ? angle : Math.PI + angle;
}

function initScroll(el: HTMLElement, sealEl: HTMLElement, critterEmoji: string, bandTop: number, bandBot: number, index: number, total: number, seed: number): ScrollState {
    const driftDirX: -1 | 1 = Math.random() < 0.5 ? 1 : -1;
    const scrollWidthPx = remToPx(SCROLL_WIDTH_REM);
    const originX = driftDirX === 1
        ? -ORIGIN_RADIUS - scrollWidthPx
        : window.innerWidth + ORIGIN_RADIUS + scrollWidthPx;
    const originPageY = randomBetween(bandTop, bandBot - SCROLL_HEIGHT_PX);
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

function resolveCollisions(states: ScrollState[], dt: number, bandTop: number, bandBot: number): void {
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
        active[i].originPageY = Math.max(bandTop, Math.min(bandBot - SCROLL_HEIGHT_PX, active[i].originPageY));
    }

    // Decay durations for pairs no longer colliding
    for (const key of collisionDurations.keys()) {
        if (!activeKeys.has(key)) {
            collisionDurations.delete(key);
            collisionBias.delete(key);
        }
    }
}

export function initGoodreadsScrolls(anchorEl: HTMLElement): void {
    const debug = isDebugMode();
    fetch('https://data.unburdened.biz/reviews.json')
        .then(r => r.json())
        .then((data: { reviews: Review[]; fetchedAt?: string }) => {
            const reviews = [...(data.reviews ?? [])];
            console.log(`[grScrolls] R2 returned ${reviews.length} review(s), fetchedAt=${data.fetchedAt ?? 'unknown'}`);
            if (debug) reviews.push(...PARODY_REVIEWS);
            if (!reviews.length) return;
            spawnScrolls(reviews, anchorEl, debug);
        })
        .catch((err) => {
            console.warn('[grScrolls] fetch failed:', err);
            if (debug) spawnScrolls([...PARODY_REVIEWS], anchorEl, debug);
        });
}

function spawnScrolls(reviews: Review[], anchorEl: HTMLElement, debug = false): void {
    const capped = reviews.slice(0, MAX_ONSCREEN);
    const container = document.createElement('div');
    container.className = 'gr-scrolls-layer';
    container.setAttribute('aria-label', 'Drifting reader scrolls');
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

    const anchorEnd = document.getElementById('goodreads-scrolls-anchor-end');
    const [bandTop, bandBot] = getPageYBand(anchorEl, anchorEnd);

    const modal = buildModal();
    document.documentElement.appendChild(modal);

    const openModal = (review: Review) => {
        (modal.querySelector('.gr-review-modal-name') as HTMLElement).textContent = review.reviewer;
        (modal.querySelector('.gr-review-modal-stars') as HTMLElement).innerHTML = starsHtml(review.stars);
        (modal.querySelector('.gr-review-modal-date') as HTMLElement).textContent = review.date;
        (modal.querySelector('.gr-review-modal-text') as HTMLElement).textContent = review.text;
        modal.classList.add('is-open');
        (modal.querySelector('.gr-review-modal-close') as HTMLElement).focus();
    };
    const closeModal = () => modal.classList.remove('is-open');

    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    (modal.querySelector('.gr-review-modal-close') as HTMLElement).addEventListener('click', closeModal);
    document.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); });

    const states: ScrollState[] = capped.map((review, i) => {
        const { el, sealEl, critterEmoji } = buildScrollEl(review);
        el.style.visibility = 'hidden';
        container.appendChild(el);
        const state = initScroll(el, sealEl, critterEmoji, bandTop, bandBot, i, capped.length, i * 1337 + 42);

        el.addEventListener('click', e => { e.stopPropagation(); openModal(review); });
        el.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(review); }
        });

        return state;
    });

    let lastTime = performance.now();
    const MIN_FRAME_MS = 100; // max 10 updates/sec

    function tick(now: number): void {
        if (now - lastTime < MIN_FRAME_MS) { requestAnimationFrame(tick); return; }
        const dt = Math.min((now - lastTime) / 1000, 0.15);
        lastTime = now;

        const [bt, bb] = getPageYBand(anchorEl, anchorEnd);

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

                // Drift the circle origin along its angled trajectory
                state.originX += Math.cos(state.driftAngle) * state.driftSpeed * dt;
                state.originPageY += Math.sin(state.driftAngle) * state.driftSpeed * dt;
                // Bounce off top/bottom band walls
                if (state.originPageY < bt) {
                    state.originPageY = bt;
                    state.driftAngle = -state.driftAngle;
                } else if (state.originPageY > bb - SCROLL_HEIGHT_PX) {
                    state.originPageY = bb - SCROLL_HEIGHT_PX;
                    state.driftAngle = -state.driftAngle;
                }

                // Respawn origin on opposite side when scroll is fully off-screen
                const scrollWidthPx = remToPx(SCROLL_WIDTH_REM);
                let respawned = false;
                if (state.originX > window.innerWidth + ORIGIN_RADIUS + scrollWidthPx) {
                    state.originX = -ORIGIN_RADIUS - scrollWidthPx;
                    state.originPageY = randomBetween(bt, bb - SCROLL_HEIGHT_PX);
                    state.driftSpeed = randomBetween(8, 16);
                    state.driftAngle = randomDriftAngle(1);
                    respawned = true;
                } else if (state.originX < -ORIGIN_RADIUS - scrollWidthPx) {
                    state.originX = window.innerWidth + ORIGIN_RADIUS + scrollWidthPx;
                    state.originPageY = randomBetween(bt, bb - SCROLL_HEIGHT_PX);
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
                const speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
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

        resolveCollisions(states, dt, bt, bb);
        // Render all drifting scrolls: scroll offset applied instantly here
        for (const state of states) {
            if (state.phase === 'drifting') {
                const viewY = pageToViewportY(state.pageY);
                state.el.style.transform = `translate(${state.x}px, ${viewY}px) rotate(${state.rot}deg)`;
                const speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
                if (speed > 1) {
                    const heading = Math.atan2(state.vy, state.vx) * 180 / Math.PI;
                    const offset = CRITTER_OFFSETS[state.critterEmoji] ?? 0;
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

                // Line from scroll position (top-left) to dest (also top-left)
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

    (window as any).__grScrolls = {
        states,
        reviews: capped,
        /** Print a summary of each scroll's current position and phase */
        status() {
            states.forEach((s, i) => {
                const r = capped[i];
                console.log(`[${i}] ${r.reviewer} | phase=${s.phase} x=${s.x.toFixed(0)} pageY=${s.pageY.toFixed(0)} vx=${s.vx.toFixed(1)} vy=${s.vy.toFixed(1)}`);
            });
        },
        /** Force-open the modal for scroll index i (0-based) */
        open(i: number) { states[i]?.el.click(); },
        /** Teleport scroll i to viewport centre */
        center(i: number) {
            const s = states[i];
            if (!s) return;
            s.x = window.innerWidth / 2;
            s.pageY = window.scrollY + window.innerHeight / 2;
            s.vx = s.vy = 0;
        },
        /** Dump the raw review objects */
        dump() { console.table(capped); },
    };

    requestAnimationFrame(tick);
}

