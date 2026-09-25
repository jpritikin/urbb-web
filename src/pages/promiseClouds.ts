import { Cloud } from '../cloud/cloudShape.js';

const MAX_CLOUDS = 4;
const CLOUD_SCALE = 1.6;
const VERTICAL_MARGIN_RATIO = 0.6;

const LIGHT_MODE_OPACITY = 0.45;
const DARK_MODE_OPACITY = 0.25;

const WIND_MAGNITUDE_MIN_PXPS = 0;
const WIND_MAGNITUDE_MAX_PXPS = 22;
const WIND_MAGNITUDE_CHANGE_MIN_SEC = 8;
const WIND_MAGNITUDE_CHANGE_MAX_SEC = 20;

// Direction changes on its own, slower timer so left/right flips are rarer
// and more deliberate than the speed wandering within a direction.
const WIND_DIRECTIONS = [-1, 0, 1];
const WIND_DIRECTION_CHANGE_MIN_SEC = 120;
const WIND_DIRECTION_CHANGE_MAX_SEC = 600;

// Parts-like words: things that could hijack a person (fear, grandiosity, old
// wounds, irritation) rather than IFS outcomes/concepts (Self-leadership,
// unburdening) that aren't themselves parts.
const CLOUD_WORDS = [
    'fear', 'grandiosity', 'irritation', 'adrenaline', 'defiance',
    'panic', 'need-to-be-needed', 'dread', 'shame', 'rage', 'vigilance',
];

const TEXT_FADE_IN_SEC = 3;
const REVEALED_HOLD_SEC = 2;
const CLOUD_FADE_OUT_SEC = 5;

type RevealPhase = 'drifting' | 'textFadeIn' | 'holding' | 'fadingOut';

interface DriftingCloud {
    cloud: Cloud;
    speedFactor: number;
    revealPhase: RevealPhase;
    revealTimer: number;
}

function randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

function pickWord(used: Set<string>): string {
    const available = CLOUD_WORDS.filter((w) => !used.has(w));
    const pool = available.length > 0 ? available : CLOUD_WORDS;
    return pool[Math.floor(Math.random() * pool.length)];
}

export function initPromiseClouds(): () => void {
    const containerEl = document.getElementById('promise-clouds');
    if (!containerEl) return () => { };
    const container = containerEl;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('promise-clouds-svg');
    container.appendChild(svg);

    const style = document.createElement('style');
    style.textContent = `.promise-clouds-svg { display: block; }`;
    container.appendChild(style);

    function viewportSize(): { w: number; h: number } {
        return { w: container.clientWidth, h: container.clientHeight };
    }

    function applyViewBox() {
        const { w, h } = viewportSize();
        svg.setAttribute('width', String(w));
        svg.setAttribute('height', String(h));
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    applyViewBox();

    const drifting: DriftingCloud[] = [];
    const usedWords = new Set<string>();

    function spawnCloud(x: number, y: number): DriftingCloud {
        const word = pickWord(usedWords);
        usedWords.add(word);
        const cloud = new Cloud(word, x, y);
        const entry: DriftingCloud = { cloud, speedFactor: randomBetween(0.7, 1.3), revealPhase: 'drifting', revealTimer: 0 };
        const group = cloud.createSVGElements({
            onClick: () => {
                if (entry.revealPhase === 'drifting') {
                    entry.revealPhase = 'textFadeIn';
                    entry.revealTimer = 0;
                }
            },
            onHover: () => { },
            onLongPressStart: () => { },
            onLongPressEnd: () => { },
        });
        const isDarkMode = document.documentElement.classList.contains('dark');
        group.style.opacity = String(isDarkMode ? DARK_MODE_OPACITY : LIGHT_MODE_OPACITY);
        svg.appendChild(group);
        cloud.updateSVGElements(false, undefined, false);
        drifting.push(entry);
        return entry;
    }

    function randomInitialPosition(): { x: number; y: number } {
        const { w, h } = viewportSize();
        const marginY = h * VERTICAL_MARGIN_RATIO;
        return { x: randomBetween(0, w), y: randomBetween(0, marginY) };
    }

    function respawnOnEdge(entry: DriftingCloud, windDirection: number): void {
        const { w, h } = viewportSize();
        const marginY = h * VERTICAL_MARGIN_RATIO;
        const halfWidth = (entry.cloud.textWidth * CLOUD_SCALE) / 2 + entry.cloud.minHeight * CLOUD_SCALE;
        entry.cloud.x = windDirection >= 0 ? -halfWidth : w + halfWidth;
        entry.cloud.y = randomBetween(0, marginY);
        usedWords.delete(entry.cloud.text);
    }

    function replaceWithNewCloud(entry: DriftingCloud): void {
        const index = drifting.indexOf(entry);
        if (index < 0) return;

        const group = entry.cloud.getGroupElement();
        if (group) group.remove();
        usedWords.delete(entry.cloud.text);

        const { w } = viewportSize();
        const windSpeed = windDirection * windMagnitude;
        const halfWidth = (entry.cloud.textWidth * CLOUD_SCALE) / 2 + entry.cloud.minHeight * CLOUD_SCALE;
        const x = windSpeed >= 0 ? -halfWidth : w + halfWidth;
        const { y } = randomInitialPosition();

        drifting.splice(index, 1);
        spawnCloud(x, y);
    }

    for (let i = 0; i < MAX_CLOUDS; i++) {
        const { x, y } = randomInitialPosition();
        spawnCloud(x, y);
    }

    let windDirection = WIND_DIRECTIONS[Math.floor(Math.random() * WIND_DIRECTIONS.length)];
    let windDirectionChangeTimer = randomBetween(WIND_DIRECTION_CHANGE_MIN_SEC, WIND_DIRECTION_CHANGE_MAX_SEC);

    let windMagnitude = randomBetween(WIND_MAGNITUDE_MIN_PXPS, WIND_MAGNITUDE_MAX_PXPS);
    let windTargetMagnitude = randomBetween(WIND_MAGNITUDE_MIN_PXPS, WIND_MAGNITUDE_MAX_PXPS);
    let windMagnitudeChangeTimer = randomBetween(WIND_MAGNITUDE_CHANGE_MIN_SEC, WIND_MAGNITUDE_CHANGE_MAX_SEC);

    const onResize = () => applyViewBox();
    window.addEventListener('resize', onResize);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let rafId: number | null = null;
    let lastTime: number | null = null;

    function frame(now: number) {
        if (lastTime === null) lastTime = now;
        const deltaSec = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;

        windDirectionChangeTimer -= deltaSec;
        if (windDirectionChangeTimer <= 0) {
            windDirection = WIND_DIRECTIONS[Math.floor(Math.random() * WIND_DIRECTIONS.length)];
            windDirectionChangeTimer = randomBetween(WIND_DIRECTION_CHANGE_MIN_SEC, WIND_DIRECTION_CHANGE_MAX_SEC);
        }

        windMagnitudeChangeTimer -= deltaSec;
        if (windMagnitudeChangeTimer <= 0) {
            windTargetMagnitude = randomBetween(WIND_MAGNITUDE_MIN_PXPS, WIND_MAGNITUDE_MAX_PXPS);
            windMagnitudeChangeTimer = randomBetween(WIND_MAGNITUDE_CHANGE_MIN_SEC, WIND_MAGNITUDE_CHANGE_MAX_SEC);
        }
        windMagnitude += (windTargetMagnitude - windMagnitude) * Math.min(1, deltaSec * 0.1);

        const windSpeed = windDirection * windMagnitude;

        const { w } = viewportSize();
        const isDarkMode = document.documentElement.classList.contains('dark');
        const opacity = isDarkMode ? DARK_MODE_OPACITY : LIGHT_MODE_OPACITY;

        const toReplace: DriftingCloud[] = [];

        for (const entry of drifting) {
            entry.cloud.animate(deltaSec);
            entry.cloud.x += windSpeed * entry.speedFactor * deltaSec;

            if (entry.revealPhase === 'drifting') {
                const halfWidth = (entry.cloud.textWidth * CLOUD_SCALE) / 2 + entry.cloud.minHeight * CLOUD_SCALE;
                const offLeft = entry.cloud.x < -halfWidth;
                const offRight = entry.cloud.x > w + halfWidth;
                if ((offLeft && windSpeed < 0) || (offRight && windSpeed >= 0)) {
                    respawnOnEdge(entry, windSpeed);
                }
            }

            entry.cloud.updateSVGElements(false, undefined, false);
            const group = entry.cloud.getGroupElement();
            const textEl = group?.querySelector('text') as SVGTextElement | null;

            let cloudOpacity = opacity;

            if (entry.revealPhase !== 'drifting') {
                entry.revealTimer += deltaSec;
            }

            if (entry.revealPhase === 'textFadeIn') {
                const t = Math.min(1, entry.revealTimer / TEXT_FADE_IN_SEC);
                if (textEl) textEl.setAttribute('opacity', String(t));
                cloudOpacity = opacity + (1 - opacity) * t;
                if (t >= 1) {
                    entry.revealPhase = 'holding';
                    entry.revealTimer = 0;
                }
            } else if (entry.revealPhase === 'holding') {
                if (textEl) textEl.setAttribute('opacity', '1');
                cloudOpacity = 1;
                if (entry.revealTimer >= REVEALED_HOLD_SEC) {
                    entry.revealPhase = 'fadingOut';
                    entry.revealTimer = 0;
                }
            } else if (entry.revealPhase === 'fadingOut') {
                if (textEl) textEl.setAttribute('opacity', '1');
                const t = Math.min(1, entry.revealTimer / CLOUD_FADE_OUT_SEC);
                cloudOpacity = 1 - t;
                if (t >= 1) {
                    toReplace.push(entry);
                }
            }

            if (group) {
                group.setAttribute('transform', `translate(${entry.cloud.x}, ${entry.cloud.y}) scale(${CLOUD_SCALE})`);
                group.style.opacity = String(cloudOpacity);
            }
        }

        for (const entry of toReplace) {
            replaceWithNewCloud(entry);
        }

        rafId = requestAnimationFrame(frame);
    }

    if (!reduceMotion) {
        rafId = requestAnimationFrame(frame);
    }

    return () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        window.removeEventListener('resize', onResize);
        container.innerHTML = '';
    };
}
