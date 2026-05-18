import {
    tick, createState, getTrustBand, stanceDescription,
    clamp, SetupValues, nextShockDist, drawInitialStance, SimEvent, getEffectiveStance,
    THERAPIST_NUDGE,
} from './ifsConversationSim.js';
import { shamedDrinkerScenario } from './ifsConversationData.js';

// ---- Constants ----

const PART_COLORS = {
    a: { hex: '#3a6ea5', rgb: [80, 130, 220] as [number, number, number] },
    b: { hex: '#a53a3a', rgb: [220, 75, 55] as [number, number, number] },
} as const;

const BALL_COLORS = {
    neutralHi: [255, 215, 80] as [number, number, number],
    neutralMid: [60, 190, 190] as [number, number, number],
    neutralEdge: [130, 60, 200] as [number, number, number],
};

function getEl<T extends Element>(parent: ParentNode, selector: string): T {
    const el = parent.querySelector<T>(selector);
    if (!el) throw new Error(`Missing element: ${selector}`);
    return el;
}

// ---- UI helpers ----

const DYSREGULATED_LABELS: [number, string][] = [
    [0.5, 'Nag'],
    [0.65, 'Jab'],
    [0.75, 'Snap'],
    [0.85, 'Accuse'],
    [0.95, 'Shout'],
    [1.01, 'Explode'],
];

function phaseLabel(phase: string, subtype?: string, senderStance?: number): string {
    if (subtype === 'dysregulated') {
        const stance = senderStance ?? 1;
        const label = DYSREGULATED_LABELS.find(([threshold]) => stance < threshold);
        return label ? label[1] : 'Explode';
    }
    if (phase === 'mirror_again') return 'Mirror Again';
    return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function trustEmoji(band: string): string {
    if (band === 'hostile') return '😤';
    if (band === 'guarded') return '😟';
    if (band === 'opening') return '🙂';
    return '🤝';
}

function pct(v: number): string {
    return (v * 100).toFixed(0) + '%';
}

// ---- Stance histogram ----

const BINS = 40;

function monteCarloStanceHist(magnitude: number, flipOdds: number, selfTrust: number, n = 2000): Float32Array {
    const bins = new Float32Array(BINS);
    for (let i = 0; i < n; i++) {
        const s = drawInitialStance(magnitude, flipOdds, selfTrust);
        const idx = Math.min(BINS - 1, Math.floor((s + 1) / 2 * BINS));
        bins[idx]++;
    }
    return bins;
}

function stanceHistogram(el: HTMLElement, bins: Float32Array, color: string, highlight: number | null = null, mirror = false): void {
    const W = el.clientWidth || 200;
    const H = 48;
    const barW = W / BINS;
    const maxCount = Math.max(...bins, 1);
    const toX = (v: number) => mirror ? (1 - v) / 2 * W : (v + 1) / 2 * W;

    let svg = `<svg width="${W}" height="${H}" style="display:block">`;

    for (let i = 0; i < BINS; i++) {
        const barH = (bins[i] / maxCount) * (H - 12);
        const x = mirror ? (BINS - 1 - i) * barW : i * barW;
        const y = H - 12 - barH;
        svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 0.5).toFixed(1)}" height="${barH.toFixed(1)}" fill="${color}" opacity="0.6"/>`;
    }

    svg += `<line x1="0" y1="${H - 12}" x2="${W}" y2="${H - 12}" stroke="#bbb" stroke-width="1"/>`;
    svg += `<line x1="${W / 2}" y1="${H - 14}" x2="${W / 2}" y2="${H - 10}" stroke="#aaa" stroke-width="1"/>`;
    svg += `<text x="1" y="${H - 1}" font-size="8" fill="#aaa">${mirror ? '+1' : '−1'}</text>`;
    svg += `<text x="${W / 2}" y="${H - 1}" text-anchor="middle" font-size="8" fill="#aaa">0</text>`;
    svg += `<text x="${W - 1}" y="${H - 1}" text-anchor="end" font-size="8" fill="#aaa">${mirror ? '−1' : '+1'}</text>`;

    if (highlight !== null) {
        const x = toX(highlight);
        svg += `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${H - 12}" stroke="${color}" stroke-width="2" opacity="0.95"/>`;
        svg += `<text x="${x.toFixed(1)}" y="9" text-anchor="middle" font-size="8" fill="${color}">${highlight >= 0 ? '+' : ''}${highlight.toFixed(2)}</text>`;
    }

    svg += `</svg>`;
    el.innerHTML = svg;
}

// ---- Combined stance + shock chart (simulation screen) ----

const ONION_MAX = 8;

function stanceChartInner(
    W: number,
    stance: number,
    shockMag: number,
    history: number[],
    color: string,
    mirror: boolean,
    rawStance?: number,
): string {
    const H = 56;
    const axisY = H - 14;
    const toX = (v: number) => mirror ? (1 - v) / 2 * W : (v + 1) / 2 * W;

    let s = '';

    // Regulated zone (±0.3)
    const regLo = toX(-0.3);
    const regHi = toX(0.3);
    const regX = Math.min(regLo, regHi);
    const regW = Math.abs(regHi - regLo);
    s += `<rect x="${regX.toFixed(1)}" y="0" width="${regW.toFixed(1)}" height="${axisY}" fill="#d4edda" opacity="0.5"/>`;

    // Axis
    s += `<line x1="0" y1="${axisY}" x2="${W}" y2="${axisY}" stroke="#bbb" stroke-width="1"/>`;
    s += `<line x1="${(W / 2).toFixed(1)}" y1="${axisY - 2}" x2="${(W / 2).toFixed(1)}" y2="${axisY + 2}" stroke="#aaa" stroke-width="1"/>`;
    s += `<text x="1" y="${H - 1}" font-size="8" fill="#aaa">${mirror ? '+1' : '−1'}</text>`;
    s += `<text x="${(W / 2).toFixed(1)}" y="${H - 1}" text-anchor="middle" font-size="8" fill="#aaa">0</text>`;
    s += `<text x="${W - 1}" y="${H - 1}" text-anchor="end" font-size="8" fill="#aaa">${mirror ? '−1' : '+1'}</text>`;

    // Onion skin: previous positions, oldest → most transparent/smaller
    for (let i = 0; i < history.length; i++) {
        const age = history.length - i;
        const t = age / ONION_MAX;
        const opacity = (Math.sqrt(1 - t) * 0.55).toFixed(2);
        const r = (5 * (1 - t * 0.6)).toFixed(1);
        const x = toX(history[i]);
        s += `<circle cx="${x.toFixed(1)}" cy="${(axisY - 10).toFixed(1)}" r="${r}" fill="#888" opacity="${opacity}"/>`;
    }

    // Shock range bracket
    if (shockMag > 0.001) {
        const lo = clamp(stance - shockMag);
        const hi = clamp(stance + shockMag);
        const x1 = toX(lo);
        const x2 = toX(hi);
        const bracketY = axisY - 10;
        const tickH = 5;
        s += `<line x1="${x1.toFixed(1)}" y1="${(bracketY - tickH).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${(bracketY - tickH).toFixed(1)}" stroke="${color}" stroke-width="1.5" opacity="0.4"/>`;
        s += `<line x1="${x1.toFixed(1)}" y1="${(bracketY - tickH - 3).toFixed(1)}" x2="${x1.toFixed(1)}" y2="${(bracketY + tickH - 3).toFixed(1)}" stroke="${color}" stroke-width="1.5" opacity="0.4"/>`;
        s += `<line x1="${x2.toFixed(1)}" y1="${(bracketY - tickH - 3).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${(bracketY + tickH - 3).toFixed(1)}" stroke="${color}" stroke-width="1.5" opacity="0.4"/>`;
    }

    // Raw (uncorrected) stance: hollow circle + arrow from effective → raw
    if (rawStance !== undefined && Math.abs(rawStance - stance) > 0.01) {
        const rx = toX(rawStance);
        const cy2 = axisY - 10;
        s += `<line x1="${rx.toFixed(1)}" y1="${(cy2 - 7).toFixed(1)}" x2="${rx.toFixed(1)}" y2="${(cy2 + 7).toFixed(1)}" stroke="${color}" stroke-width="2" opacity="0.55"/>`;
        const ex = toX(stance);
        const dx = rx - ex;
        if (Math.abs(dx) > 3) {
            const dir = dx > 0 ? 1 : -1;
            s += `<line x1="${ex.toFixed(1)}" y1="${cy2.toFixed(1)}" x2="${(rx - dir * 6).toFixed(1)}" y2="${cy2.toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="3,2" opacity="0.55"/>`;
            s += `<polygon points="${rx.toFixed(1)},${cy2.toFixed(1)} ${(rx - dir * 5).toFixed(1)},${(cy2 - 3).toFixed(1)} ${(rx - dir * 5).toFixed(1)},${(cy2 + 3).toFixed(1)}" fill="${color}" opacity="0.55"/>`;
        }
    }

    // Current stance dot + label
    const cx = toX(stance);
    const cy = axisY - 10;
    s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="${color}" opacity="0.9"/>`;
    const labelX = Math.max(16, Math.min(W - 16, cx));
    s += `<text x="${labelX.toFixed(1)}" y="${(cy - 8).toFixed(1)}" text-anchor="middle" font-size="8" fill="${color}" font-weight="bold">${stance >= 0 ? '+' : ''}${stance.toFixed(2)}</text>`;

    return s;
}

function stanceChart(
    el: HTMLElement,
    stance: number,
    shockMag: number,
    history: number[],
    color: string,
    mirror = false,
    rawStance?: number,
): void {
    const W = el.clientWidth || 200;
    const H = 56;
    let svgEl = el.querySelector('svg');
    if (!svgEl) {
        svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgEl.setAttribute('style', 'display:block');
        el.appendChild(svgEl);
    }
    svgEl.setAttribute('width', String(W));
    svgEl.setAttribute('height', String(H));
    svgEl.innerHTML = stanceChartInner(W, stance, shockMag, history, color, mirror, rawStance);
}

function showSetup(container: HTMLElement, onStart: (v: SetupValues) => void): void {
    const { partA, partB } = shamedDrinkerScenario;
    container.innerHTML = `
        <div class="ifs-setup">
            <h3>Before the conversation begins</h3>
            <p>
                Configure each part's starting conditions before the conversation begins.
            </p>
            <div class="ifs-setup-grid">
                <div class="ifs-setup-section">
                    <div class="ifs-setup-section-title">${partA.name}</div>
                    <div class="ifs-setup-row">
                        <label for="ifs-stance-a">Stance tendency</label>
                        <div class="ifs-slider-wrap">
                            <input type="range" id="ifs-stance-a" min="-1" max="1" step="0.05" value="0.6">
                            <span class="ifs-slider-val" id="ifs-stance-a-val">+0.60</span>
                        </div>
                        <div class="ifs-trust-hint" id="ifs-stance-a-hint"></div>
                    </div>
                    <div class="ifs-setup-row">
                        <label for="ifs-flip-a">Neuroticism</label>
                        <div class="ifs-slider-wrap">
                            <input type="range" id="ifs-flip-a" min="0" max="0.5" step="0.05" value="0.05">
                            <span class="ifs-slider-val" id="ifs-flip-a-val">5%</span>
                        </div>
                        <div class="ifs-trust-hint" id="ifs-flip-a-hint"></div>
                    </div>
                    <div class="ifs-setup-row">
                        <label for="ifs-trust-a">Self-to-part trust</label>
                        <div class="ifs-slider-wrap">
                            <input type="range" id="ifs-trust-a" min="0" max="1" step="0.05" value="0.2">
                            <span class="ifs-slider-val" id="ifs-trust-a-val">0.20</span>
                        </div>
                        <div class="ifs-trust-hint" id="ifs-trust-a-hint"></div>
                    </div>
                    <div class="ifs-stance-bar-label">Initial stance distribution</div>
                    <div id="ifs-dist-a"></div>
                </div>
                <div class="ifs-setup-section">
                    <div class="ifs-setup-section-title">${partB.name}</div>
                    <div class="ifs-setup-row">
                        <label for="ifs-stance-b">Stance tendency</label>
                        <div class="ifs-slider-wrap">
                            <input type="range" id="ifs-stance-b" min="-1" max="1" step="0.05" value="-0.4" dir="rtl">
                            <span class="ifs-slider-val" id="ifs-stance-b-val">-0.40</span>
                        </div>
                        <div class="ifs-trust-hint" id="ifs-stance-b-hint"></div>
                    </div>
                    <div class="ifs-setup-row">
                        <label for="ifs-flip-b">Neuroticism</label>
                        <div class="ifs-slider-wrap">
                            <input type="range" id="ifs-flip-b" min="0" max="0.5" step="0.05" value="0.4">
                            <span class="ifs-slider-val" id="ifs-flip-b-val">40%</span>
                        </div>
                        <div class="ifs-trust-hint" id="ifs-flip-b-hint"></div>
                    </div>
                    <div class="ifs-setup-row">
                        <label for="ifs-trust-b">Self-to-part trust</label>
                        <div class="ifs-slider-wrap">
                            <input type="range" id="ifs-trust-b" min="0" max="1" step="0.05" value="0.2">
                            <span class="ifs-slider-val" id="ifs-trust-b-val">0.20</span>
                        </div>
                        <div class="ifs-trust-hint" id="ifs-trust-b-hint"></div>
                    </div>
                    <div class="ifs-stance-bar-label">Initial stance distribution</div>
                    <div id="ifs-dist-b"></div>
                </div>
            </div>
            <button id="ifs-start-btn" class="ifs-start-btn">Start conversation</button>
        </div>
    `;

    function stanceHint(v: number): string {
        if (v > 0.6) return 'Strongly activated — will enter the conversation flooded.';
        if (v > 0.3) return 'Moderately activated — likely dysregulated at the start.';
        if (v > -0.3) return 'Near neutral — starts close to regulation.';
        if (v > -0.6) return 'Withdrawn — tends to pull back rather than engage.';
        return 'Deeply withdrawn — may be shut down or avoidant.';
    }

    function neuroticismHint(v: number): string {
        if (v < 0.1) return 'Very consistent — reliably activates in its default direction.';
        if (v < 0.2) return 'Mostly consistent — rarely flips.';
        if (v < 0.35) return 'Some unpredictability — occasionally responds in unexpected ways.';
        if (v < 0.45) return 'Quite unpredictable — just as likely to flip as not.';
        return 'Highly unpredictable — as likely to flip as not.';
    }

    function trustHint(v: number): string {
        if (v < 0.2) return 'Almost no Self-energy — highly reactive to shocks.';
        if (v < 0.4) return 'Minimal Self-energy — quite vulnerable.';
        if (v < 0.6) return 'Some Self-energy — absorbs moderate shocks.';
        if (v < 0.8) return 'Good Self-energy — fairly stable.';
        return 'Strong Self-energy — resilient to shocks.';
    }

    function updateDist(prefix: string, color: string, mirror = false): void {
        const mag = parseFloat(container.querySelector<HTMLInputElement>(`#ifs-stance-${prefix}`)!.value);
        const flip = parseFloat(container.querySelector<HTMLInputElement>(`#ifs-flip-${prefix}`)!.value);
        const trust = parseFloat(container.querySelector<HTMLInputElement>(`#ifs-trust-${prefix}`)!.value);
        const el = container.querySelector<HTMLElement>(`#ifs-dist-${prefix}`)!;
        stanceHistogram(el, monteCarloStanceHist(mag, flip, trust), color, null, mirror);
    }

    function wireSlider(id: string, valId: string, fmt: (v: number) => string, onChange?: () => void): void {
        const slider = getEl<HTMLInputElement>(container, `#${id}`);
        const valEl = getEl<HTMLElement>(container, `#${valId}`);
        const update = () => {
            valEl.textContent = fmt(parseFloat(slider.value));
            onChange?.();
        };
        slider.addEventListener('input', update);
        update();
    }

    wireSlider('ifs-stance-a', 'ifs-stance-a-val', v => (v >= 0 ? '+' : '') + v.toFixed(2), () => {
        container.querySelector<HTMLElement>('#ifs-stance-a-hint')!.textContent =
            stanceHint(parseFloat(container.querySelector<HTMLInputElement>('#ifs-stance-a')!.value));
        updateDist('a', PART_COLORS.a.hex);
    });
    wireSlider('ifs-flip-a', 'ifs-flip-a-val', v => Math.round(v * 100) + '%', () => {
        container.querySelector<HTMLElement>('#ifs-flip-a-hint')!.textContent =
            neuroticismHint(parseFloat(container.querySelector<HTMLInputElement>('#ifs-flip-a')!.value));
        updateDist('a', PART_COLORS.a.hex);
    });
    wireSlider('ifs-trust-a', 'ifs-trust-a-val', v => v.toFixed(2), () => {
        container.querySelector<HTMLElement>('#ifs-trust-a-hint')!.textContent =
            trustHint(parseFloat(container.querySelector<HTMLInputElement>('#ifs-trust-a')!.value));
        updateDist('a', PART_COLORS.a.hex);
    });

    wireSlider('ifs-stance-b', 'ifs-stance-b-val', v => (v >= 0 ? '+' : '') + v.toFixed(2), () => {
        container.querySelector<HTMLElement>('#ifs-stance-b-hint')!.textContent =
            stanceHint(parseFloat(container.querySelector<HTMLInputElement>('#ifs-stance-b')!.value));
        updateDist('b', PART_COLORS.b.hex, true);
    });
    wireSlider('ifs-flip-b', 'ifs-flip-b-val', v => Math.round(v * 100) + '%', () => {
        container.querySelector<HTMLElement>('#ifs-flip-b-hint')!.textContent =
            neuroticismHint(parseFloat(container.querySelector<HTMLInputElement>('#ifs-flip-b')!.value));
        updateDist('b', PART_COLORS.b.hex, true);
    });
    wireSlider('ifs-trust-b', 'ifs-trust-b-val', v => v.toFixed(2), () => {
        container.querySelector<HTMLElement>('#ifs-trust-b-hint')!.textContent =
            trustHint(parseFloat(container.querySelector<HTMLInputElement>('#ifs-trust-b')!.value));
        updateDist('b', PART_COLORS.b.hex, true);
    });

    container.querySelector('#ifs-start-btn')!.addEventListener('click', () => {
        const g = (id: string) => parseFloat(container.querySelector<HTMLInputElement>(`#${id}`)!.value);
        onStart({
            selfTrustA: g('ifs-trust-a'),
            selfTrustB: g('ifs-trust-b'),
            stanceA: g('ifs-stance-a'),
            stanceB: g('ifs-stance-b'),
            flipOddsA: g('ifs-flip-a'),
            flipOddsB: g('ifs-flip-b'),
        });
    });
}

// ---- Recording ----

interface EventRecord {
    t: number;
    type: 'shock' | 'rawStance' | 'message' | 'phase' | 'nominate' | 'therapist';
    detail: string;
    // shock extras
    shockDelta?: number;
    effectiveStanceBefore?: number;
    effectiveStanceAfter?: number;
    accumulatedShockDelta?: number;
    // rawStance extras
    rawStanceBefore?: number;
    rawStanceAfter?: number;
    reason?: string;
    // phase extras
    oldPhaseSR?: string;
    oldPhaseLR?: string;
    newPhaseSR?: string;
    newPhaseLR?: string;
    rawStanceA?: number;
    rawStanceB?: number;
    // message extras
    ballPos?: number;
    // nominate extras
    sampledStance?: number;
}

const VERSION = '1.1.7';

interface Recording {
    version: string;
    setup: SetupValues;
    simTime?: number;
    events: EventRecord[];
}

function downloadRecording(rec: Recording): void {
    const blob = new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ifs-conversation-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// ---- Simulation screen ----

function simHTML(): string {
    return `
        <div class="ifs-conv-wrap">
            <div class="ifs-log-wrap">
                <div class="ifs-log-label">
                    <div class="ifs-regulation" id="ifs-regulation"></div>
                    <div class="ifs-reg-score">Regulation: <span id="ifs-reg-score"></span></div>
                    <div class="ifs-cycles">Cycles completed: <span id="ifs-cycles"></span></div>
                    <div class="ifs-sim-controls">
                        <button id="ifs-pause-btn" title="Pause/Resume (R to download recording)">Pause</button>
                        <span class="ifs-speed-label">Speed:</span>
                        <button class="ifs-speed-btn ifs-active" data-speed="0.25">¼×</button>
                        <button class="ifs-speed-btn" data-speed="1">1×</button>
                        <button class="ifs-speed-btn" data-speed="4">4×</button>
                    </div>
                </div>
                <div class="ifs-log"></div>
            </div>
            <div class="ifs-status-wrap">
                <div class="ifs-status"></div>
                <svg class="ifs-arc-svg" xmlns="http://www.w3.org/2000/svg">
                    <circle class="ifs-arc-ball" r="14" cx="-40" cy="-40"/>
                </svg>
                <div id="ifs-nominate-banner" class="ifs-nominate-banner" style="display:none">
                    Both parts are withdrawn. Use Activate to nominate a SpeakRole part.
                </div>
            </div>
        </div>
        <div id="ifs-congrats-banner" class="ifs-congrats-banner" style="display:none">
            <h2>You won!</h2>
            <p>Both parts have reached deep mutual trust — the conversation has become truly collaborative.</p>
            <p>Feel free to keep experimenting. The simulation will continue running.</p>
            <button class="ifs-congrats-close">Continue</button>
        </div>
    `;
}

function statusHTML(state: ReturnType<typeof createState>): string {
    const { partA, partB } = state;
    return `
        <div class="ifs-status-grid">
            <div class="ifs-part-card" id="ifs-card-a">
                <div class="ifs-part-name">${partA.name} — <span class="ifs-role" id="ifs-role-a"></span></div>
                <div class="ifs-card-cols">
                    <div class="ifs-phase">Phase: <strong id="ifs-phase-a"></strong></div>
                    <div class="ifs-trust-val ifs-card-col-trust" id="ifs-trust-row-ab"><span id="ifs-trust-ab-emoji"></span> <strong id="ifs-trust-ab"></strong> <span class="ifs-band" id="ifs-band-ab"></span></div>
                </div>
                <div class="ifs-desc" id="ifs-stance-desc-a"></div>
                <div class="ifs-stance-bar" id="ifs-sbar-a"></div>
                <div class="ifs-stance-bar-label">Stance distribution</div>
                <div id="ifs-sim-dist-a"></div>
                <div class="ifs-setup-row">
                    <label for="ifs-sim-trust-a">Self-to-part trust</label>
                    <div class="ifs-slider-wrap">
                        <input type="range" id="ifs-sim-trust-a" min="0" max="1" step="0.05" value="${partA.selfTrust.toFixed(2)}">
                        <span class="ifs-slider-val" id="ifs-sim-trust-a-val">${partA.selfTrust.toFixed(2)}</span>
                    </div>
                </div>
                <div class="ifs-therapist-delta">Therapist Δ: <span id="ifs-delta-a"></span></div>
                <div class="ifs-controls">
                    <button class="ifs-btn" id="ifs-calm-a">◀ Calm</button>
                    <button class="ifs-btn" id="ifs-activate-a">Activate ▶</button>
                </div>
            </div>

            <div class="ifs-part-card" id="ifs-card-b">
                <div class="ifs-part-name">${partB.name} — <span class="ifs-role" id="ifs-role-b"></span></div>
                <div class="ifs-card-cols">
                    <div class="ifs-phase">Phase: <strong id="ifs-phase-b"></strong></div>
                    <div class="ifs-trust-val ifs-card-col-trust" id="ifs-trust-row-ba"><span id="ifs-trust-ba-emoji"></span> <strong id="ifs-trust-ba"></strong> <span class="ifs-band" id="ifs-band-ba"></span></div>
                </div>
                <div class="ifs-desc" id="ifs-stance-desc-b"></div>
                <div class="ifs-stance-bar" id="ifs-sbar-b"></div>
                <div class="ifs-stance-bar-label">Stance distribution</div>
                <div id="ifs-sim-dist-b"></div>
                <div class="ifs-setup-row">
                    <label for="ifs-sim-trust-b">Self-to-part trust</label>
                    <div class="ifs-slider-wrap">
                        <input type="range" id="ifs-sim-trust-b" min="0" max="1" step="0.05" value="${partB.selfTrust.toFixed(2)}">
                        <span class="ifs-slider-val" id="ifs-sim-trust-b-val">${partB.selfTrust.toFixed(2)}</span>
                    </div>
                </div>
                <div class="ifs-therapist-delta">Therapist Δ: <span id="ifs-delta-b"></span></div>
                <div class="ifs-controls">
                    <button class="ifs-btn" id="ifs-activate-b">◀ Activate</button>
                    <button class="ifs-btn" id="ifs-calm-b">Calm ▶</button>
                </div>
            </div>
        </div>
    `;
}

function buildBallGradient(arcSvg: SVGSVGElement, arcBall: SVGCircleElement): { stop0: SVGStopElement; stop1: SVGStopElement; stop2: SVGStopElement } {
    const svgNS = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(svgNS, 'defs');
    const grad = document.createElementNS(svgNS, 'radialGradient');
    grad.setAttribute('id', 'ifs-ball-grad');
    grad.setAttribute('cx', '35%');
    grad.setAttribute('cy', '35%');
    grad.setAttribute('r', '65%');
    grad.setAttribute('gradientUnits', 'objectBoundingBox');
    const stop0 = document.createElementNS(svgNS, 'stop');
    stop0.setAttribute('offset', '0%');
    const stop1 = document.createElementNS(svgNS, 'stop');
    stop1.setAttribute('offset', '55%');
    const stop2 = document.createElementNS(svgNS, 'stop');
    stop2.setAttribute('offset', '100%');
    grad.appendChild(stop0);
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
    arcSvg.insertBefore(defs, arcSvg.firstChild);
    arcBall.setAttribute('fill', 'url(#ifs-ball-grad)');
    return { stop0, stop1, stop2 };
}

function lerpColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
    return [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
    ];
}


function showSim(container: HTMLElement, setup: SetupValues, onReset: () => void): void {
    container.innerHTML = simHTML();

    const state = createState(setup, shamedDrinkerScenario);
    (window as any).__simState = state;
    let paused = false;
    let speed = 0.25;
    let lastTime: number | null = null;
    let rafId: number;
    let flashBtnId: string | null = null;
    let flashUntil = 0;
    let waitingStartTime: number | null = null;
    let congratsShown = false;
    const BANNER_DELAY = 3000;

    const recording: Recording = { version: VERSION, setup, events: [] };
    let lastMessageCount = 0;

    const statusEl = getEl<HTMLElement>(container, '.ifs-status');
    const logEl = getEl<HTMLElement>(container, '.ifs-log');
    const arcSvg = getEl<SVGSVGElement>(container, '.ifs-arc-svg');
    const arcBall = getEl<SVGCircleElement>(arcSvg, '.ifs-arc-ball');
    const { stop0, stop1, stop2 } = buildBallGradient(arcSvg, arcBall);

    const pauseBtn = getEl<HTMLButtonElement>(container, '#ifs-pause-btn');

    function onKey(e: KeyboardEvent): void {
        if ((e.key === 'r' || e.key === 'R') && e.target === pauseBtn) { recording.simTime = state.simTime; downloadRecording(recording); }
    }

    function wireControls(): void {
        pauseBtn.addEventListener('click', () => {
            paused = !paused;
            pauseBtn.textContent = paused ? 'Resume' : 'Pause';
        });
        document.addEventListener('keydown', onKey);
        for (const btn of container.querySelectorAll<HTMLButtonElement>('.ifs-speed-btn')) {
            btn.addEventListener('click', () => {
                speed = parseFloat(btn.dataset.speed!);
                for (const b of container.querySelectorAll('.ifs-speed-btn')) b.classList.remove('ifs-active');
                btn.classList.add('ifs-active');
            });
        }
    }

    statusEl.innerHTML = statusHTML(state);
    wireControls();

    const sbarA = getEl<HTMLElement>(statusEl, '#ifs-sbar-a');
    const sbarB = getEl<HTMLElement>(statusEl, '#ifs-sbar-b');
    const simDistA = getEl<HTMLElement>(statusEl, '#ifs-sim-dist-a');
    const simDistB = getEl<HTMLElement>(statusEl, '#ifs-sim-dist-b');
    let binsA = monteCarloStanceHist(setup.stanceA, setup.flipOddsA, setup.selfTrustA);
    let binsB = monteCarloStanceHist(setup.stanceB, setup.flipOddsB, setup.selfTrustB);
    let lastSampledA = state.relAB.stance;
    let lastSampledB = state.relBA.stance;
    const wrapEl = getEl<HTMLElement>(container, '.ifs-status-wrap');
    const historyA: number[] = [];
    const historyB: number[] = [];
    let lastHistorySimTime = -Infinity;
    const HISTORY_INTERVAL = 2;

    function setText(id: string, text: string): void {
        const el = container.querySelector(`#${id}`);
        if (el && el.textContent !== text) el.textContent = text;
    }
    function setClass(id: string, cls: string, on: boolean): void {
        container.querySelector(`#${id}`)?.classList.toggle(cls, on);
    }
    function shockMagFor(receiverId: string): number {
        return Math.abs(nextShockDist(state, receiverId)[0]);
    }

    function wireTherapistBtns(): void {
        function wireBtn(id: string, partId: string, delta: number): void {
            getEl<HTMLButtonElement>(statusEl, `#${id}`).addEventListener('click', () => {
                const rel = partId === state.partA.id ? state.relAB : state.relBA;
                const current = state.conversation.therapistDeltas.get(partId) ?? 0;
                const newDelta = clamp(current + delta, -1 - rel.stance, 1 - rel.stance);
                state.conversation.therapistDeltas.set(partId, newDelta);
                flashBtnId = id;
                flashUntil = performance.now() + 300;
                const name = partId === state.partA.id ? state.partA.name : state.partB.name;
                const action = delta < 0 ? 'calm' : 'activate';
                const shockDelta = state.conversation.shockDeltas.get(partId) ?? 0;
                const effStance = getEffectiveStance(rel.stance, newDelta + shockDelta);
                recording.events.push({
                    t: +state.simTime.toFixed(3),
                    type: 'therapist',
                    detail: `${action} ${name} Δ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} → therapistDelta ${newDelta.toFixed(3)} effStance ${effStance.toFixed(3)}`,
                });
            });
        }
        wireBtn('ifs-calm-a', state.partA.id, -THERAPIST_NUDGE);
        wireBtn('ifs-activate-a', state.partA.id, THERAPIST_NUDGE);
        wireBtn('ifs-calm-b', state.partB.id, -THERAPIST_NUDGE);
        wireBtn('ifs-activate-b', state.partB.id, THERAPIST_NUDGE);
    }
    wireTherapistBtns();

    container.querySelector('.ifs-congrats-close')!.addEventListener('click', () => {
        const banner = container.querySelector<HTMLElement>('#ifs-congrats-banner');
        if (banner) banner.style.display = 'none';
    });

    function wireTrustSlider(id: string, valId: string, part: typeof state.partA, onBinsUpdate: () => void): void {
        const slider = getEl<HTMLInputElement>(statusEl, `#${id}`);
        const valEl = getEl<HTMLElement>(statusEl, `#${valId}`);
        slider.addEventListener('input', () => {
            part.selfTrust = parseFloat(slider.value);
            valEl.textContent = part.selfTrust.toFixed(2);
            onBinsUpdate();
        });
    }
    wireTrustSlider('ifs-sim-trust-a', 'ifs-sim-trust-a-val', state.partA, () => {
        binsA = monteCarloStanceHist(setup.stanceA, setup.flipOddsA, state.partA.selfTrust);
    });
    wireTrustSlider('ifs-sim-trust-b', 'ifs-sim-trust-b-val', state.partB, () => {
        binsB = monteCarloStanceHist(setup.stanceB, setup.flipOddsB, state.partB.selfTrust);
    });

    function captureRecordTick(simEvents: SimEvent[]): void {
        const { partA, partB, conversation, simTime } = state;
        lastMessageCount = state.messages.length;

        for (const e of simEvents) {
            const t = +simTime.toFixed(3);
            if (e.kind === 'shock') {
                const d = e.data;
                const name = d.receiverId === partA.id ? partA.name : partB.name;
                recording.events.push({
                    t: +d.simTime.toFixed(3),
                    type: 'shock',
                    detail: `${name} shock Δ${d.shockDelta >= 0 ? '+' : ''}${d.shockDelta.toFixed(3)} eff ${d.effectiveStanceBefore.toFixed(3)}→${d.effectiveStanceAfter.toFixed(3)}`,
                    shockDelta: +d.shockDelta.toFixed(4),
                    effectiveStanceBefore: +d.effectiveStanceBefore.toFixed(4),
                    effectiveStanceAfter: +d.effectiveStanceAfter.toFixed(4),
                    accumulatedShockDelta: +d.accumulatedShockDelta.toFixed(4),
                });
            } else if (e.kind === 'rawStance') {
                const d = e.data;
                const name = d.partId === partA.id ? partA.name : partB.name;
                recording.events.push({
                    t: +d.simTime.toFixed(3),
                    type: 'rawStance',
                    detail: `${name} raw ${d.rawStanceBefore.toFixed(3)}→${d.rawStanceAfter.toFixed(3)} (${d.reason})`,
                    rawStanceBefore: +d.rawStanceBefore.toFixed(4),
                    rawStanceAfter: +d.rawStanceAfter.toFixed(4),
                    reason: d.reason,
                });
            } else if (e.kind === 'phase') {
                const d = e.data;
                const sName = d.speakRoleId === partA.id ? partA.name : partB.name;
                const lName = d.listenRoleId === partA.id ? partA.name : partB.name;
                recording.events.push({
                    t: +d.simTime.toFixed(3),
                    type: 'phase',
                    detail: `${sName}(SR) ${d.oldPhaseSR}→${d.newPhaseSR}, ${lName}(LR) ${d.oldPhaseLR}→${d.newPhaseLR}`,
                    oldPhaseSR: d.oldPhaseSR, oldPhaseLR: d.oldPhaseLR,
                    newPhaseSR: d.newPhaseSR, newPhaseLR: d.newPhaseLR,
                    rawStanceA: +d.rawStanceA.toFixed(4),
                    rawStanceB: +d.rawStanceB.toFixed(4),
                });
            } else if (e.kind === 'nominate') {
                if (e.data.speakRoleId === partA.id) lastSampledA = e.data.sampledStance;
                else lastSampledB = e.data.sampledStance;
                const name = e.data.speakRoleId === partA.id ? partA.name : partB.name;
                recording.events.push({
                    t,
                    type: 'nominate',
                    detail: `${name} nominated as SpeakRole, sampledStance ${e.data.sampledStance.toFixed(3)}`,
                    sampledStance: +e.data.sampledStance.toFixed(4),
                });
            } else if (e.kind === 'message') {
                const name = e.data.senderId === partA.id ? partA.name : partB.name;
                recording.events.push({ t, type: 'message', detail: `${name} [${e.data.phase}]`, ballPos: +conversation.ballPos.toFixed(4) });
            }
        }
    }

    function updateHistory(stanceA: number, stanceB: number): void {
        if (state.simTime - lastHistorySimTime < HISTORY_INTERVAL) return;
        lastHistorySimTime = state.simTime;
        historyA.push(stanceA);
        if (historyA.length > ONION_MAX) historyA.shift();
        historyB.push(stanceB);
        if (historyB.length > ONION_MAX) historyB.shift();
    }

    function renderStatus(): void {
        const { partA, partB, relAB, relBA, conversation } = state;
        const stanceA = conversation.effectiveStances.get(partA.id) ?? relAB.stance;
        const stanceB = conversation.effectiveStances.get(partB.id) ?? relBA.stance;
        const phaseA = conversation.phases.get(partA.id) ?? 'listen';
        const phaseB = conversation.phases.get(partB.id) ?? 'listen';
        const regulated = conversation.regulationScore > 0.5;
        const dA = conversation.therapistDeltas.get(partA.id) ?? 0;
        const dB = conversation.therapistDeltas.get(partB.id) ?? 0;
        const flashing = performance.now() < flashUntil;

        updateHistory(stanceA, stanceB);

        // Calm = nudge toward 0 when stance > +0.3; Activate when stance < -0.3
        const hintCalmA = stanceA > 0.3;
        const hintActivateA = stanceA < -0.3;
        const hintCalmB = stanceB > 0.3;
        const hintActivateB = stanceB < -0.3;

        const bothWaiting = phaseA === 'waiting' && phaseB === 'waiting';
        const bannerEl = container.querySelector<HTMLElement>('#ifs-nominate-banner');
        if (bothWaiting) {
            if (waitingStartTime === null) waitingStartTime = performance.now();
            if (bannerEl) bannerEl.style.display = performance.now() - waitingStartTime >= BANNER_DELAY ? '' : 'none';
        } else {
            waitingStartTime = null;
            if (bannerEl) bannerEl.style.display = 'none';
        }

        if (!congratsShown && relAB.trust > 0.89 && relBA.trust > 0.89) {
            congratsShown = true;
            const banner = container.querySelector<HTMLElement>('#ifs-congrats-banner');
            if (banner) banner.style.display = '';
        }

        setClass('ifs-card-a', 'ifs-speaker', !bothWaiting && conversation.speakRoleId === partA.id);
        setText('ifs-role-a', bothWaiting ? 'WAITING' : conversation.speakRoleId === partA.id ? 'SPEAKROLE' : 'LISTENROLE');
        setText('ifs-phase-a', phaseLabel(phaseA));
        setText('ifs-stance-desc-a', stanceDescription(stanceA));
        setText('ifs-delta-a', (dA >= 0 ? '+' : '') + dA.toFixed(2));
        setClass('ifs-calm-a', 'ifs-btn-flash', flashBtnId === 'ifs-calm-a' && flashing);
        setClass('ifs-activate-a', 'ifs-btn-flash', flashBtnId === 'ifs-activate-a' && flashing);
        setClass('ifs-calm-a', 'ifs-btn-hint', hintCalmA && !(flashBtnId === 'ifs-calm-a' && flashing));
        setClass('ifs-activate-a', 'ifs-btn-hint', hintActivateA && !(flashBtnId === 'ifs-activate-a' && flashing));
        stanceChart(sbarA, stanceA, shockMagFor(partA.id), historyA.slice(0, -1), PART_COLORS.a.hex, false, relAB.stance);
        stanceHistogram(simDistA, binsA, PART_COLORS.a.hex, lastSampledA, false);

        setText('ifs-trust-ab', relAB.trust.toFixed(2));
        setText('ifs-band-ab', getTrustBand(relAB.trust));
        setText('ifs-trust-ab-emoji', trustEmoji(getTrustBand(relAB.trust)));
        setText('ifs-trust-ba', relBA.trust.toFixed(2));
        setText('ifs-band-ba', getTrustBand(relBA.trust));
        setText('ifs-trust-ba-emoji', trustEmoji(getTrustBand(relBA.trust)));
        setClass('ifs-trust-row-ab', 'ifs-trust-row-speaker', conversation.speakRoleId === partA.id);
        setClass('ifs-trust-row-ba', 'ifs-trust-row-speaker', conversation.speakRoleId === partB.id);

        const regEl = container.querySelector('#ifs-regulation');
        if (regEl) {
            regEl.textContent = regulated ? 'Regulated' : 'Dysregulated';
            regEl.className = `ifs-regulation ${regulated ? 'ifs-regulated' : 'ifs-dysregulated'}`;
        }
        setText('ifs-reg-score', pct(conversation.regulationScore));
        setText('ifs-cycles', String(state.cyclesCompleted));

        setClass('ifs-card-b', 'ifs-speaker', !bothWaiting && conversation.speakRoleId === partB.id);
        setText('ifs-role-b', bothWaiting ? 'WAITING' : conversation.speakRoleId === partB.id ? 'SPEAKROLE' : 'LISTENROLE');
        setText('ifs-phase-b', phaseLabel(phaseB));
        setText('ifs-stance-desc-b', stanceDescription(stanceB));
        setText('ifs-delta-b', (dB >= 0 ? '+' : '') + dB.toFixed(2));
        setClass('ifs-calm-b', 'ifs-btn-flash', flashBtnId === 'ifs-calm-b' && flashing);
        setClass('ifs-activate-b', 'ifs-btn-flash', flashBtnId === 'ifs-activate-b' && flashing);
        setClass('ifs-calm-b', 'ifs-btn-hint', hintCalmB && !(flashBtnId === 'ifs-calm-b' && flashing));
        setClass('ifs-activate-b', 'ifs-btn-hint', hintActivateB && !(flashBtnId === 'ifs-activate-b' && flashing));
        stanceChart(sbarB, stanceB, shockMagFor(partB.id), historyB.slice(0, -1), PART_COLORS.b.hex, true, relBA.stance);
        stanceHistogram(simDistB, binsB, PART_COLORS.b.hex, lastSampledB, true);
    }

    function renderBall(): void {
        const { conversation } = state;
        const wrapW = wrapEl.offsetWidth;
        const wrapH = wrapEl.offsetHeight;
        if (wrapW === 0 || wrapH === 0) return;

        arcSvg.setAttribute('width', String(wrapW));
        arcSvg.setAttribute('height', String(wrapH));

        const p = conversation.ballPos;
        const x = (0.12 + (0.88 - 0.12) * p) * wrapW;
        const arcHeight = Math.min(wrapH * 0.45, 80);
        const y = (wrapH * 0.5) - arcHeight * 4 * p * (1 - p);
        arcBall.setAttribute('cx', String(x));
        arcBall.setAttribute('cy', String(y));

        // Bias 0=A(blue), 0.5=neutral(multicolor), 1=B(red)
        const bias = conversation.ballBias;
        const { neutralHi, neutralMid, neutralEdge } = BALL_COLORS;
        const colorA = PART_COLORS.a.rgb;
        const colorB = PART_COLORS.b.rgb;

        const strength = Math.max(0, (Math.abs(bias - 0.5) - 0.05) / 0.45);
        const sideColor = bias < 0.5 ? colorA : colorB;

        const hi = lerpColor(neutralHi, sideColor, strength);
        const mid = lerpColor(neutralMid, sideColor, strength * 0.7);
        const edge = lerpColor(neutralEdge, sideColor, strength * 0.5);

        stop0.setAttribute('stop-color', `rgb(${hi[0]},${hi[1]},${hi[2]})`);
        stop0.setAttribute('stop-opacity', '0.95');
        stop1.setAttribute('stop-color', `rgb(${mid[0]},${mid[1]},${mid[2]})`);
        stop1.setAttribute('stop-opacity', '0.80');
        stop2.setAttribute('stop-color', `rgb(${edge[0]},${edge[1]},${edge[2]})`);
        stop2.setAttribute('stop-opacity', '0.60');
    }

    let renderedMessageCount = 0;

    function renderLog(): void {
        if (state.messages.length === renderedMessageCount) return;
        const wasAtBottom = logEl.scrollHeight - logEl.clientHeight <= logEl.scrollTop + 4;
        for (let i = renderedMessageCount; i < state.messages.length; i++) {
            const m = state.messages[i];
            const div = document.createElement('div');
            if (m.type === 'trust') {
                const sub = m.subtype ? ` ifs-msg-trust-${m.subtype}` : '';
                div.className = `ifs-msg ifs-msg-trust${sub}`;
                div.innerHTML = `<span class="ifs-msg-trust-text">${m.text}</span>`;
            } else {
                const isA = m.senderId === state.partA.id;
                const name = isA ? state.partA.name : state.partB.name;
                div.className = `ifs-msg ${isA ? 'ifs-msg-left' : 'ifs-msg-right'}`;
                div.innerHTML = `<span class="ifs-msg-sender">${name}</span>` +
                    `<span class="ifs-msg-phase">[${phaseLabel(m.phase, m.subtype, m.senderStance)}]</span>` +
                    `<span class="ifs-msg-text">${m.text}</span>`;
            }
            logEl.appendChild(div);
        }
        renderedMessageCount = state.messages.length;
        if (wasAtBottom) logEl.scrollTop = logEl.scrollHeight;
    }

    function loop(ts: number): void {
        if (lastTime !== null && !paused) {
            const simDt = Math.min((ts - lastTime) / 1000, 0.1) * speed;
            const simEvents = tick(state, simDt);
            captureRecordTick(simEvents);
        }
        lastTime = ts;
        renderStatus();
        renderBall();
        renderLog();
        rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);
}

function mount(container: HTMLElement): void {
    function start(setup: SetupValues): void {
        document.querySelectorAll('details[open]').forEach(d => d.removeAttribute('open'));
        showSim(container, setup, () => showSetup(container, start));
    }
    showSetup(container, start);
}

document.addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('ifs-conversation-root');
    if (!el) return;
    console.log(`IFS Conversation v${VERSION}`);
    mount(el);
});
