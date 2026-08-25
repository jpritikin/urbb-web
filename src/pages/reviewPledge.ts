const STORAGE_KEY = 'review-pledge-checked';

const CONFIRM_EMOJIS = ['💋', '🎉', '🎊', '🪄', '💎', '🔑', '❤️', '💥', '💦'];
const CONFIRM_ROTATED_EMOJIS = new Set(['💋', '🔑']);
const CONFIRM_EMOJI_SPEED = 90;
const CONFIRM_EMOJI_DURATION_MS = 900;
const CONFIRM_WAVE_COUNT = 10;
const CONFIRM_WAVE_INTERVAL_MS = 250;

function spawnConfirmWave(originX: number, originY: number): void {
    const r = Math.random();
    const count = r < 0.6 ? 1 : r < 0.9 ? 2 : 3;

    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = CONFIRM_EMOJI_SPEED * (0.5 + Math.random() * 0.5);
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;
        const emoji = CONFIRM_EMOJIS[Math.floor(Math.random() * CONFIRM_EMOJIS.length)];
        const shouldRotate = CONFIRM_ROTATED_EMOJIS.has(emoji);
        const angularVelocity = shouldRotate ? (Math.random() - 0.5) * 400 : 0;

        const el = document.createElement('span');
        el.className = 'confirm-burst-emoji';
        el.textContent = emoji;
        el.style.left = `${originX}px`;
        el.style.top = `${originY}px`;
        document.body.appendChild(el);

        const start = performance.now();
        const animate = (now: number) => {
            const age = now - start;
            const t = Math.min(1, age / CONFIRM_EMOJI_DURATION_MS);
            const x = originX + vx * (age / 1000);
            const y = originY + vy * (age / 1000);
            const scale = 1 + t;
            const rotation = shouldRotate ? 45 + angularVelocity * (age / 1000) : 0;
            el.style.transform = `translate(${x - originX}px, ${y - originY}px) rotate(${rotation}deg) scale(${scale})`;
            el.style.opacity = String(1 - t);
            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                el.remove();
            }
        };
        requestAnimationFrame(animate);
    }
}

function spawnConfirmBurst(originEl: HTMLElement): void {
    const rect = originEl.getBoundingClientRect();
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height / 2;

    for (let wave = 0; wave < CONFIRM_WAVE_COUNT; wave++) {
        setTimeout(() => spawnConfirmWave(originX, originY), wave * CONFIRM_WAVE_INTERVAL_MS);
    }
}

const HEX_WIDTH = 60;
const HEX_HEIGHT = 52;
const HEX_COL_SPACING = HEX_WIDTH * 0.75;
const RING_COUNT = 4;
const RING_DELAY_MS = 90;
const RING_DURATION_MS = 700;
const HIT_ANIMATION_MS = RING_DELAY_MS * RING_COUNT + RING_DURATION_MS;

// Axial coordinates (q, r) for a flat-top hex grid.
type Axial = { q: number; r: number };

const AXIAL_DIRECTIONS: Axial[] = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

function axialRing(center: Axial, radius: number): Axial[] {
    if (radius === 0) return [center];
    const results: Axial[] = [];
    let hex: Axial = { q: center.q + AXIAL_DIRECTIONS[4].q * radius, r: center.r + AXIAL_DIRECTIONS[4].r * radius };
    for (let side = 0; side < 6; side++) {
        for (let step = 0; step < radius; step++) {
            results.push(hex);
            hex = { q: hex.q + AXIAL_DIRECTIONS[side].q, r: hex.r + AXIAL_DIRECTIONS[side].r };
        }
    }
    return results;
}

function axialToPixel(a: Axial): { x: number; y: number } {
    const x = a.q * HEX_COL_SPACING;
    const y = (a.r + a.q / 2) * HEX_HEIGHT;
    return { x, y };
}

function renderTile(container: HTMLElement, a: Axial, ringDelayMs: number): void {
    const { x, y } = axialToPixel(a);
    const tile = document.createElement('div');
    tile.className = 'hex-tile hex-burst';
    tile.style.left = `${x}px`;
    tile.style.top = `${y}px`;
    tile.style.animationDelay = `${ringDelayMs}ms`;
    container.appendChild(tile);
}

function spawnForceFieldHit(clientX: number, clientY: number): void {
    const hit = document.createElement('div');
    hit.className = 'force-field-hit';
    hit.style.left = `${clientX}px`;
    hit.style.top = `${clientY}px`;

    const center: Axial = { q: 0, r: 0 };
    for (let radius = 0; radius < RING_COUNT; radius++) {
        const ringDelay = radius * RING_DELAY_MS;
        for (const a of axialRing(center, radius)) {
            renderTile(hit, a, ringDelay);
        }
    }

    document.body.appendChild(hit);
    setTimeout(() => hit.remove(), HIT_ANIMATION_MS);
}

document.addEventListener('DOMContentLoaded', () => {
    const checkbox = document.getElementById('review-pledge-checkbox') as HTMLInputElement;
    const rest = document.getElementById('rest-of-page');
    const pledgeContainer = document.getElementById('review-pledge-container');

    if (!checkbox || !rest || !pledgeContainer) return;

    let scrollTimer: ReturnType<typeof setTimeout> | undefined;

    const applyState = (checked: boolean) => {
        rest.classList.toggle('review-gate-locked', !checked);
    };

    checkbox.checked = localStorage.getItem(STORAGE_KEY) === 'true';
    applyState(checkbox.checked);

    checkbox.addEventListener('change', () => {
        if (checkbox.checked) spawnConfirmBurst(checkbox);
        localStorage.setItem(STORAGE_KEY, String(checkbox.checked));
        applyState(checkbox.checked);
    });

    rest.addEventListener('click', (event) => {
        if (checkbox.checked) return;
        event.preventDefault();
        event.stopPropagation();

        const mouseEvent = event as MouseEvent;
        spawnForceFieldHit(mouseEvent.clientX, mouseEvent.clientY);

        if (scrollTimer !== undefined) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
            pledgeContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, HIT_ANIMATION_MS);
    }, { capture: true });
});
