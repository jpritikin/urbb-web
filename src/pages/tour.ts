interface TourChoice {
    id: string;
    title: string;
    words: number;
    profileOn: string;
    profileOff: string;
}

interface TourData {
    baseWords: number;
    choices: TourChoice[];
}

interface CardPhysics {
    target: number;
    nominal: number;
    velocity: number;
    min: number;
    max: number;
}

interface DigitState {
    nominal: number;
    target: number;
    tickTimer: number;
    broken: boolean;
    healTimer: number;
}

const TICK_DELAY_MS = 180;
const TICK_NOISE_MS = 140;
const BREAK_PROB_PER_TICK = 0.004;
const HEAL_MIN_MS = 5000;
const HEAL_NOISE_MS = 5000;
const RETRY_MIN_MS = 15000;
const RETRY_NOISE_MS = 15000;
const MAX_ACCEL = 12;
const DAMPING = 0.995;
const BOUNCE_RESTITUTION = 0.85;

// Shuffle phase: probabilistic toggles decay to zero over this duration
const SHUFFLE_DURATION_MS = 10_000;

function loadTourData(): Promise<TourData> {
    const url = (window as any).__tourDataUrl as string;
    return fetch(url).then(r => r.json());
}

function buildCard(choice: TourChoice, included: boolean): HTMLElement {
    const card = document.createElement('div');
    card.className = 'tour-card';
    card.dataset.id = choice.id;

    const titleWrapper = document.createElement('div');
    titleWrapper.className = 'tour-card-title-wrapper';

    const title = document.createElement('h3');
    title.className = 'tour-card-title';
    title.textContent = choice.title;
    titleWrapper.appendChild(title);

    const isNsw = choice.id === 'orgasmic-meditation';
    let nswMask: HTMLElement | null = null;
    if (isNsw) {
        nswMask = document.createElement('div');
        nswMask.className = 'tour-nsw-mask';
        nswMask.setAttribute('role', 'button');
        nswMask.setAttribute('aria-label', 'Click to reveal content');
        nswMask.innerHTML = `<span class="tour-nsw-badge">⚠ NSW</span><span class="tour-nsw-label">Not Safe for Work<br><small>click to reveal</small></span>`;
        titleWrapper.appendChild(nswMask);
    }

    const barRow = document.createElement('div');
    barRow.className = 'tour-bar-row';

    const bar = document.createElement('div');
    bar.className = 'tour-bar-track';
    const fill = document.createElement('div');
    fill.className = 'tour-bar-fill';
    bar.appendChild(fill);

    const wordCount = document.createElement('span');
    wordCount.className = 'tour-card-words';
    wordCount.textContent = choice.words.toLocaleString('en-US') + ' words';

    const toggle = document.createElement('button');
    toggle.className = 'tour-toggle';
    toggle.setAttribute('aria-pressed', String(included));
    toggle.textContent = included ? 'Include' : 'Skip';

    barRow.appendChild(bar);
    barRow.appendChild(wordCount);
    barRow.appendChild(toggle);

    const profile = document.createElement('p');
    profile.className = 'tour-profile';
    profile.textContent = included ? choice.profileOn : choice.profileOff;

    const profileWrapper = isNsw ? document.createElement('div') : null;
    if (profileWrapper) {
        profileWrapper.className = 'tour-nsw-profile-wrapper';
        profileWrapper.appendChild(profile);
        const tileGrid = document.createElement('div');
        tileGrid.className = 'tour-nsw-tile-grid' + (included ? '' : ' tour-nsw-mask--hidden');
        const tileLabels = ['⚠ NSW', 'Not Safe\nfor Work', 'click to\nreveal', '⚠ NSW'];
        for (let i = 0; i < 4; i++) {
            const tile = document.createElement('div');
            tile.className = 'tour-nsw-tile';
            tile.setAttribute('role', 'button');
            tile.setAttribute('aria-label', 'Click to reveal');
            const label = document.createElement('span');
            label.className = 'tour-nsw-tile-label';
            label.textContent = tileLabels[i];
            tile.appendChild(label);
            tileGrid.appendChild(tile);
        }
        profileWrapper.appendChild(tileGrid);
    }

    card.appendChild(titleWrapper);
    card.appendChild(barRow);
    if (profileWrapper) {
        card.appendChild(profileWrapper);
    } else {
        card.appendChild(profile);
    }

    if (nswMask) {
        nswMask.addEventListener('click', (e) => {
            e.stopPropagation();
            nswMask!.classList.add('tour-nsw-mask--hidden');
        });
        const tiles = card.querySelectorAll('.tour-nsw-tile');
        tiles.forEach(tile => {
            tile.addEventListener('click', (e) => {
                e.stopPropagation();
                tile.classList.add('tour-nsw-mask--hidden');
                if (Math.random() < 0.15) {
                    setTimeout(() => tile.classList.remove('tour-nsw-mask--hidden'), 800 + Math.random() * 1200);
                }
            });
        });
    }

    return card;
}

function formatDigits(n: number, length: number): number[] {
    const s = String(Math.round(n)).padStart(length, '0');
    return s.split('').map(Number);
}

function countDigits(n: number): number {
    return Math.max(1, Math.ceil(Math.log10(n + 1)));
}

class DigitDisplay {
    private el: HTMLElement;
    private states: DigitState[] = [];
    private maxDigits: number;
    private retryTimer: number;

    constructor(el: HTMLElement, maxWords: number) {
        this.el = el;
        this.maxDigits = countDigits(maxWords) + 1;
        this.retryTimer = RETRY_MIN_MS + Math.random() * RETRY_NOISE_MS;
        this.render(0);
    }

    setTarget(value: number): void {
        const digits = formatDigits(value, this.maxDigits);
        while (this.states.length < digits.length) {
            const v = digits[this.states.length];
            this.states.push({ nominal: v, target: v, tickTimer: 0, broken: false, healTimer: 0 });
        }
        for (let i = 0; i < digits.length; i++) {
            this.states[i].target = digits[i];
        }
    }

    tick(dt: number): boolean {
        let anyMoving = false;
        let allSettled = true;

        for (const s of this.states) {
            if (s.broken) {
                s.healTimer -= dt;
                if (s.healTimer <= 0) {
                    s.broken = false;
                    s.tickTimer = TICK_DELAY_MS + Math.random() * TICK_NOISE_MS;
                }
                anyMoving = true;
                allSettled = false;
                continue;
            }

            if (s.nominal === s.target) continue;

            allSettled = false;
            s.tickTimer -= dt;
            if (s.tickTimer <= 0) {
                if (Math.random() < BREAK_PROB_PER_TICK) {
                    s.broken = true;
                    s.healTimer = HEAL_MIN_MS + Math.random() * HEAL_NOISE_MS;
                    s.tickTimer = TICK_DELAY_MS + Math.random() * TICK_NOISE_MS;
                    anyMoving = true;
                    continue;
                }
                s.tickTimer = TICK_DELAY_MS + Math.random() * TICK_NOISE_MS;
                s.nominal += s.target > s.nominal ? 1 : -1;
                anyMoving = true;
            } else {
                anyMoving = true;
            }
        }

        if (allSettled) {
            this.retryTimer -= dt;
            if (this.retryTimer <= 0) {
                this.retryTimer = RETRY_MIN_MS + Math.random() * RETRY_NOISE_MS;
                for (const s of this.states) {
                    if (s.nominal !== s.target && !s.broken) {
                        s.tickTimer = Math.random() * TICK_NOISE_MS;
                    }
                }
            }
        } else {
            this.retryTimer = RETRY_MIN_MS + Math.random() * RETRY_NOISE_MS;
        }

        return anyMoving;
    }

    render(value?: number): void {
        if (value !== undefined) {
            const digits = formatDigits(value, this.maxDigits);
            this.states = digits.map(d => ({ nominal: d, target: d, tickTimer: 0, broken: false, healTimer: 0 }));
        }
        this.el.innerHTML = '';
        const nominals = this.states.map(s => s.nominal);
        const num = parseInt(nominals.join(''), 10) || 0;
        const unformatted = String(num).padStart(this.maxDigits, '0');
        const formatted = num.toLocaleString('en-US');
        const offset = unformatted.length - String(num).length;
        let numericCount = 0;
        for (let i = 0; i < formatted.length; i++) {
            const ch = formatted[i];
            if (ch === ',') {
                const sep = document.createElement('span');
                sep.className = 'tour-digit-sep';
                sep.textContent = ',';
                this.el.appendChild(sep);
            } else {
                const stateIdx = offset + numericCount;
                const s = this.states[stateIdx];
                const span = document.createElement('span');
                span.className = 'tour-digit' + (s?.broken ? ' tour-digit--broken' : '');
                span.textContent = ch;
                this.el.appendChild(span);
                numericCount++;
            }
        }
    }

    getCurrentDisplayValue(): number {
        return parseInt(this.states.map(s => s.nominal).join(''), 10) || 0;
    }
}

const BOLT_ON_MIN = 50;
const BOLT_ON_NOISE = 80;
const BOLT_OFF_MIN = 400;
const BOLT_OFF_NOISE = 900;

interface BoltState {
    active: boolean;
    timer: number;
}

function drawLightning(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
    const segments = 8;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const jitter = len * 0.18;

    const pts: [number, number][] = [[x1, y1]];
    for (let i = 1; i < segments; i++) {
        const t = i / segments;
        const mx = x1 + dx * t + (Math.random() - 0.5) * jitter;
        const my = y1 + dy * t + (Math.random() - 0.5) * jitter;
        pts.push([mx, my]);
    }
    pts.push([x2, y2]);

    const isDark = document.documentElement.classList.contains('dark');
    const useGreen = Math.random() < 0.5;
    const fillColor = useGreen
        ? (isDark ? 'rgba(74, 222, 128, 0.85)' : 'rgba(22, 163, 74, 0.85)')
        : 'rgba(255, 255, 255, 0.85)';
    const coreColor = useGreen
        ? (isDark ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.8)')
        : (isDark ? 'rgba(74, 222, 128, 0.6)' : 'rgba(22, 163, 74, 0.6)');

    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(120, 120, 120, 0.6)';
    ctx.shadowBlur = 6;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = coreColor;
    ctx.lineWidth = 0.5;
    ctx.shadowBlur = 0;
    ctx.stroke();
}

// Semi-stochastic greedy algorithm to select choices hitting targetWords as closely as possible.
// Sorts choices by words descending, then greedily includes each if it gets us closer to target,
// with small random perturbations to avoid always producing identical results.
function selectChoicesForTarget(
    choices: TourChoice[],
    baseWords: number,
    targetWords: number
): Map<string, boolean> {
    const sorted = [...choices].sort((a, b) => b.words - a.words);
    const result = new Map<string, boolean>();
    for (const c of choices) result.set(c.id, false);

    let current = baseWords;
    // Shuffle slightly for variety: swap adjacent pairs probabilistically
    for (let i = 0; i < sorted.length - 1; i++) {
        if (Math.random() < 0.25) {
            [sorted[i], sorted[i + 1]] = [sorted[i + 1], sorted[i]];
        }
    }

    for (const choice of sorted) {
        const withIt = Math.abs(current + choice.words - targetWords);
        const withoutIt = Math.abs(current - targetWords);
        // Add a small random bias so repeated drags to same position vary slightly
        const bias = (Math.random() - 0.5) * choice.words * 0.1;
        if (withIt + bias < withoutIt) {
            result.set(choice.id, true);
            current += choice.words;
        }
    }
    return result;
}

export function initTour(): void {
    // On mobile, move the fixed bar to <html> so position:fixed is not
    // affected by body's flex layout (which breaks fixed in Firefox).
    if (window.innerWidth <= 767) {
        const totalBar = document.querySelector('.tour-total-bar');
        if (totalBar) document.documentElement.appendChild(totalBar);
    }

    loadTourData().then(data => {
        const container = document.getElementById('tour-cards')!;
        const displayEl = document.getElementById('tour-word-display')!;
        const sidebarEl = document.getElementById('tour-word-display-sidebar')!;
        const archetypeEl = document.getElementById('tour-archetype')!;
        const slider = document.getElementById('tour-master-slider') as HTMLInputElement;
        const sliderMinLabel = document.getElementById('tour-slider-min')!;
        const sliderMaxLabel = document.getElementById('tour-slider-max')!;

        const canvas = document.createElement('canvas');
        canvas.className = 'tour-lightning-canvas';
        container.appendChild(canvas);
        const ctx = canvas.getContext('2d')!;

        const physics: Map<string, CardPhysics> = new Map();
        const elements: Map<string, HTMLElement> = new Map();
        const included: Map<string, boolean> = new Map();
        const minTotal = data.baseWords;
        const maxTotal = data.baseWords + data.choices.reduce((s, c) => s + c.words, 0);
        const WORDS_PER_PAGE = 250;

        const minPages = Math.round(minTotal / WORDS_PER_PAGE);
        const maxPages = Math.round(maxTotal / WORDS_PER_PAGE);
        sliderMinLabel.textContent = `${minPages} pp`;
        sliderMaxLabel.textContent = `${maxPages} pp`;

        const display = new DigitDisplay(displayEl, maxTotal);
        const sidebarDisplay = new DigitDisplay(sidebarEl, maxTotal);

        // Shuffle phase state
        let shuffleElapsed = 0;
        let shuffleDone = false;
        // Per-card: next scheduled toggle time during shuffle
        const shuffleNextToggle = new Map<string, number>();

        function stopShuffle(): void {
            shuffleDone = true;
        }

        // Sigmoid-based probability: high at t=0, decays to ~0 at SHUFFLE_DURATION_MS
        // Rate of random toggle attempts per card per ms
        function shuffleToggleProb(elapsedMs: number): number {
            // Logistic decay: p = 1 / (1 + exp(k*(t - t_half)))
            // tuned so p≈0.95 at t=0 and p≈0.05 at t=SHUFFLE_DURATION_MS
            const k = 8 / SHUFFLE_DURATION_MS;
            const tHalf = SHUFFLE_DURATION_MS / 2;
            return 1 / (1 + Math.exp(k * (elapsedMs - tHalf)));
        }

        function applyToggle(choice: TourChoice, nowIncluded: boolean, skipSliderSync = false): void {
            included.set(choice.id, nowIncluded);
            const card = elements.get(choice.id)!;
            const toggle = card.querySelector('.tour-toggle') as HTMLButtonElement;
            toggle.setAttribute('aria-pressed', String(nowIncluded));
            toggle.textContent = nowIncluded ? 'Include' : 'Skip';
            const profile = card.querySelector('.tour-profile') as HTMLElement;
            profile.textContent = nowIncluded ? choice.profileOn : choice.profileOff;
            if (choice.id === 'orgasmic-meditation') {
                const tileGrid = card.querySelector('.tour-nsw-tile-grid') as HTMLElement | null;
                if (nowIncluded) {
                    tileGrid?.classList.remove('tour-nsw-mask--hidden');
                    tileGrid?.querySelectorAll('.tour-nsw-tile').forEach(t => t.classList.remove('tour-nsw-mask--hidden'));
                } else {
                    tileGrid?.classList.add('tour-nsw-mask--hidden');
                }
            }
            const p = physics.get(choice.id)!;
            p.target = nowIncluded ? choice.words : 0;
            if (!skipSliderSync) {
                const words = data.baseWords + data.choices.reduce((s, c) => s + (included.get(c.id) ? c.words : 0), 0);
                syncSliderToWords(words);
            }
        }

        function applySliderTarget(targetWords: number): void {
            const newStates = selectChoicesForTarget(data.choices, data.baseWords, targetWords);
            for (const choice of data.choices) {
                const nowIncluded = newStates.get(choice.id)!;
                if (nowIncluded !== included.get(choice.id)) {
                    applyToggle(choice, nowIncluded, true);
                }
            }
        }

        slider.addEventListener('input', () => {
            stopShuffle();
            const t = Number(slider.value) / 1000;
            const targetWords = Math.round(minTotal + t * (maxTotal - minTotal));
            applySliderTarget(targetWords);
        });

        // Sync slider position to current word count
        function syncSliderToWords(words: number): void {
            const t = (words - minTotal) / (maxTotal - minTotal);
            slider.value = String(Math.round(t * 1000));
        }

        // Initial state: all random
        let latentSum = data.baseWords;
        let displaySum = data.baseWords;

        for (const choice of data.choices) {
            const initIncluded = Math.random() < 0.5;
            included.set(choice.id, initIncluded);
            const target = initIncluded ? choice.words : 0;
            physics.set(choice.id, {
                target,
                nominal: target,
                velocity: 0,
                min: 0,
                max: choice.words,
            });

            const card = buildCard(choice, initIncluded);
            container.appendChild(card);
            elements.set(choice.id, card);
            latentSum += target;

            // Schedule first shuffle toggle for this card
            shuffleNextToggle.set(choice.id, Math.random() * 2000);

            const toggle = card.querySelector('.tour-toggle') as HTMLButtonElement;
            const barTrack = card.querySelector('.tour-bar-track') as HTMLElement;

            toggle.addEventListener('click', () => {
                stopShuffle();
                const nowIncluded = !included.get(choice.id);
                applyToggle(choice, nowIncluded);
            });

            barTrack.addEventListener('mouseenter', () => barTrack.classList.add('tour-bar-track--active'));
            barTrack.addEventListener('mouseleave', () => barTrack.classList.remove('tour-bar-track--active'));
            barTrack.addEventListener('touchstart', () => {
                barTrack.classList.add('tour-bar-track--active');
                setTimeout(() => barTrack.classList.remove('tour-bar-track--active'), 750);
            }, { passive: true });

            barTrack.addEventListener('click', () => {
                const p = physics.get(choice.id)!;
                const settled = Math.abs(p.nominal - p.target) <= 0.5 && Math.abs(p.velocity) <= 0.5;
                if (settled) {
                    // Jolt: kick toward the opposite boundary then let physics bounce back
                    const toward = p.target === p.max ? -1 : 1;
                    p.velocity = toward * (0.4 + Math.random() * 0.4);
                } else {
                    p.nominal = p.target;
                    p.velocity = 0;
                }
                lastTime = null;
                requestAnimationFrame(animate);
            });
        }

        display.setTarget(latentSum);
        display.render(latentSum);
        sidebarDisplay.setTarget(latentSum);
        sidebarDisplay.render(latentSum);
        displaySum = latentSum;
        updateArchetype(data, latentSum, archetypeEl);
        syncSliderToWords(latentSum);

        const boltStates = new Map<string, BoltState>();

        function getBoltState(key: string): BoltState {
            if (!boltStates.has(key)) {
                boltStates.set(key, { active: false, timer: Math.random() * BOLT_OFF_NOISE });
            }
            return boltStates.get(key)!;
        }

        let lastTime: number | null = null;
        let lastFrameTime: number | null = null;
        const FRAME_INTERVAL = 1000 / 15;

        function syncCanvas(): void {
            const rect = container.getBoundingClientRect();
            if (canvas.width !== rect.width || canvas.height !== rect.height) {
                canvas.width = rect.width;
                canvas.height = rect.height;
            }
        }

        function tickShuffle(dt: number): void {
            if (shuffleDone) return;
            shuffleElapsed += dt;
            if (shuffleElapsed >= SHUFFLE_DURATION_MS) {
                stopShuffle();
                return;
            }
            const prob = shuffleToggleProb(shuffleElapsed);
            for (const choice of data.choices) {
                let next = shuffleNextToggle.get(choice.id)!;
                next -= dt;
                if (next <= 0) {
                    if (Math.random() < prob) {
                        applyToggle(choice, !included.get(choice.id), true);
                    }
                    // Space next check: shorter intervals early, longer late
                    const interval = 300 + (1 - prob) * 1200;
                    next = interval + Math.random() * interval;
                }
                shuffleNextToggle.set(choice.id, next);
            }
        }

        function animate(ts: number): void {
            requestAnimationFrame(animate);
            if (lastFrameTime !== null && ts - lastFrameTime < FRAME_INTERVAL) return;
            const dt = lastTime === null ? 16 : Math.min(ts - lastTime, 100);
            lastFrameTime = ts;
            lastTime = ts;

            tickShuffle(dt);

            syncCanvas();
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            let newLatent = data.baseWords;
            const animatingFills: HTMLElement[] = [];

            for (const choice of data.choices) {
                const p = physics.get(choice.id)!;
                const card = elements.get(choice.id)!;
                const fill = card.querySelector('.tour-bar-fill') as HTMLElement;

                const moving = Math.abs(p.nominal - p.target) > 0.5 || Math.abs(p.velocity) > 0.5;

                if (moving) {
                    const accel = (p.target - p.nominal) * (MAX_ACCEL / p.max);
                    p.velocity = p.velocity * DAMPING + accel * (dt / 1000);
                    p.nominal += p.velocity * (dt / 1000) * p.max;

                    if (p.nominal < p.min) {
                        p.nominal = p.min;
                        p.velocity = -p.velocity * BOUNCE_RESTITUTION;
                    }
                    if (p.nominal > p.max) {
                        p.nominal = p.max;
                        p.velocity = -p.velocity * BOUNCE_RESTITUTION;
                    }
                    animatingFills.push(fill);
                } else {
                    p.nominal = p.target;
                    p.velocity = 0;
                }

                const pct = p.max > 0 ? (p.nominal / p.max) * 100 : 0;
                fill.style.width = `${pct}%`;
                newLatent += p.nominal;
            }

            if (animatingFills.length >= 2) {
                const containerRect = container.getBoundingClientRect();

                for (let i = 0; i < animatingFills.length - 1; i++) {
                    for (let j = i + 1; j < animatingFills.length; j++) {
                        const key = `${i}:${j}`;
                        const bolt = getBoltState(key);
                        bolt.timer -= dt;
                        if (bolt.timer <= 0) {
                            bolt.active = !bolt.active;
                            bolt.timer = bolt.active
                                ? BOLT_ON_MIN + Math.random() * BOLT_ON_NOISE
                                : BOLT_OFF_MIN + Math.random() * BOLT_OFF_NOISE;
                        }
                        if (bolt.active) {
                            const rA = animatingFills[i].getBoundingClientRect();
                            const rB = animatingFills[j].getBoundingClientRect();
                            const vh = window.innerHeight;
                            const aOnscreen = rA.bottom >= 0 && rA.top <= vh;
                            const bOnscreen = rB.bottom >= 0 && rB.top <= vh;
                            if (!aOnscreen || !bOnscreen) continue;
                            drawLightning(
                                ctx,
                                rA.right - containerRect.left, rA.top + rA.height / 2 - containerRect.top,
                                rB.right - containerRect.left, rB.top + rB.height / 2 - containerRect.top
                            );
                        }
                    }
                }
            }

            latentSum = newLatent;
            const roundedLatent = Math.round(latentSum);
            display.setTarget(roundedLatent);
            sidebarDisplay.setTarget(roundedLatent);
            display.tick(dt);
            sidebarDisplay.tick(dt);
            display.render();
            sidebarDisplay.render();

            const newDisplaySum = display.getCurrentDisplayValue();
            if (newDisplaySum !== displaySum) {
                displaySum = newDisplaySum;
                updateArchetype(data, latentSum, archetypeEl);
            }
        }

        container.addEventListener('click', () => { lastTime = null; });

        requestAnimationFrame(animate);
    });
}

document.addEventListener('DOMContentLoaded', initTour);

function updateArchetype(data: TourData, wordCount: number, el: HTMLElement): void {
    const total = data.baseWords + data.choices.reduce((s, c) => s + c.words, 0);
    const pct = wordCount / total;

    let text: string;
    if (pct < 0.55) {
        text = "You are a sleek, purposeful reader. You eat only the meat and leave the bones with practiced efficiency. The author respects this, privately.";
    } else if (pct < 0.75) {
        text = "You have chosen the balanced path—curious enough to wander, wise enough to know when to stop. A sensible human being, which is rarer than it sounds.";
    } else if (pct < 0.92) {
        text = "You are thorough. Possibly dangerously so. You have probably re-read things. You circle passages. Your marginalia have marginalia.";
    } else {
        text = "You are reading everything. Every word. Including this one. You cannot be stopped. You are not a reader; you are a force of sustained attention that happens to be wearing a person.";
    }

    if (el.textContent !== text) {
        el.style.opacity = '0';
        setTimeout(() => {
            el.textContent = text;
            el.style.opacity = '1';
        }, 300);
    }
}
