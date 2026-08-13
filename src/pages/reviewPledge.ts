const STORAGE_KEY = 'review-pledge-checked';

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
