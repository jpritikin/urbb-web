import type { AnimatedStar } from './starAnimation.js';

export function createFillColorDebugPanel(star: AnimatedStar): HTMLElement {
    const panel = document.createElement('div');
    panel.style.cssText = `
        position: fixed; bottom: 10px; right: 10px; width: 150px; height: 150px;
        background: #222; border: 2px solid #666; border-radius: 4px;
        cursor: crosshair; z-index: 9999;
    `;

    const canvas = document.createElement('canvas');
    canvas.width = 150;
    canvas.height = 150;
    panel.appendChild(canvas);

    const ctx = canvas.getContext('2d')!;
    const color = star.getFillColor();

    for (let y = 0; y < 150; y++) {
        for (let x = 0; x < 150; x++) {
            const s = (x / 149) * 100;
            const l = 100 - (y / 149) * 100;
            ctx.fillStyle = `hsl(${color.h}, ${s}%, ${l}%)`;
            ctx.fillRect(x, y, 1, 1);
        }
    }

    const marker = document.createElement('div');
    marker.style.cssText = `
        position: absolute; width: 10px; height: 10px; border: 2px solid white;
        border-radius: 50%; pointer-events: none; transform: translate(-50%, -50%);
        box-shadow: 0 0 2px black;
    `;
    panel.appendChild(marker);

    const updateMarker = () => {
        const c = star.getFillColor();
        marker.style.left = `${(c.s / 100) * 150}px`;
        marker.style.top = `${(1 - c.l / 100) * 150}px`;
    };
    updateMarker();

    const handleInput = (e: MouseEvent | TouchEvent) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        const x = Math.max(0, Math.min(149, clientX - rect.left));
        const y = Math.max(0, Math.min(149, clientY - rect.top));
        const s = (x / 149) * 100;
        const l = 100 - (y / 149) * 100;
        star.setFillColor(s, l);
        updateMarker();
    };

    let dragging = false;
    panel.addEventListener('mousedown', (e) => { dragging = true; handleInput(e); });
    panel.addEventListener('mousemove', (e) => { if (dragging) handleInput(e); });
    panel.addEventListener('mouseup', () => { dragging = false; });
    panel.addEventListener('mouseleave', () => { dragging = false; });
    panel.addEventListener('touchstart', (e) => { e.preventDefault(); handleInput(e); });
    panel.addEventListener('touchmove', (e) => { e.preventDefault(); handleInput(e); });

    return panel;
}
