interface Star {
    x: number; // normalized 0-1
    y: number;
    radius: number;
    opacity: number;
    phase: number;
    speed: number;
    hue: number;
    spawnDelay: number;
}

const STAR_COUNT = 20;
const PURPLE_HUE = 270;
const HUE_RANGE = 60;
const GLYPH_RADIUS = 48; // px, circle radius
const GLYPH_EXCLUSION_PX = 90;

function randomHue(): number {
    return PURPLE_HUE + (Math.random() - 0.5) * HUE_RANGE * 2;
}

function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, outerScale = 1): void {
    const innerRadius = size * 0.2;
    const outerRadius = size * outerScale;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
        const outerAngle = (i * Math.PI / 2) - Math.PI / 2;
        const innerAngle = outerAngle + Math.PI / 4;
        const ox = x + Math.cos(outerAngle) * outerRadius;
        const oy = y + Math.sin(outerAngle) * outerRadius;
        const ix = x + Math.cos(innerAngle) * innerRadius;
        const iy = y + Math.sin(innerAngle) * innerRadius;
        if (i === 0) ctx.moveTo(ox, oy);
        else ctx.lineTo(ox, oy);
        ctx.lineTo(ix, iy);
    }
    ctx.closePath();
    ctx.fill();
}

function randomStar(w: number, h: number, spawnWindow: number): Star {
    const cx = w / 2;
    const cy = h / 2;
    let x: number, y: number;
    do {
        x = Math.random() * w;
        y = Math.random() * h;
    } while ((x - cx) ** 2 + (y - cy) ** 2 < GLYPH_EXCLUSION_PX ** 2);

    return {
        x: x / w,
        y: y / h,
        radius: 3 + Math.random() * 8,
        opacity: 0.4 + Math.random() * 0.6,
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 1.5,
        hue: Math.random() < 0.5 ? 0 : randomHue(),
        spawnDelay: Math.random() * spawnWindow,
    };
}

function renderGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, t: number): void {
    // Circle
    ctx.beginPath();
    ctx.arc(cx, cy, GLYPH_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(180, 120, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Rotating ✦ symbol
    const spinAngle = t * (Math.PI * 2 / 10);
    const pulse = 0.9 + 0.1 * Math.sin(t * Math.PI * 2 / 1.5);
    const symbolSize = GLYPH_RADIUS * 0.7 * pulse;
    const glyphOpacity = 0.6 + 0.4 * Math.sin(t * Math.PI * 2 / 15);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spinAngle);
    ctx.fillStyle = `rgba(255, 200, 150, ${glyphOpacity})`;
    drawSparkle(ctx, 0, 0, symbolSize, 0.8);
    ctx.restore();
}

export function initCurtainStars(): () => void {
    const curtain = document.getElementById('image-curtain');
    if (!curtain) return () => { };

    const starsCanvas = document.createElement('canvas');
    starsCanvas.id = 'curtain-stars';
    starsCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:10;';
    curtain.appendChild(starsCanvas);

    const glyphCanvas = document.getElementById('curtain-glyph') as HTMLCanvasElement | null;

    const minDelayMs = parseInt(curtain.dataset.minDelay ?? '4000', 10);
    const spawnWindow = (minDelayMs / 1000) * 0.875;

    const starsCtx = starsCanvas.getContext('2d')!;
    const glyphCtx = glyphCanvas?.getContext('2d') ?? null;
    let rafId: number;
    let startTime: number | null = null;

    const GLYPH_SIZE = GLYPH_RADIUS * 2 + 4; // canvas size with a small margin
    if (glyphCanvas) {
        glyphCanvas.width = GLYPH_SIZE;
        glyphCanvas.height = GLYPH_SIZE;
    }

    function resize() {
        starsCanvas.width = curtain!.offsetWidth;
        starsCanvas.height = curtain!.offsetHeight;
    }
    resize();

    const stars: Star[] = Array.from({ length: STAR_COUNT }, () =>
        randomStar(starsCanvas.width || 300, starsCanvas.height || 300, spawnWindow)
    );

    function frame(now: number) {
        if (startTime === null) startTime = now;
        const t = (now - startTime) / 1000;

        resize();
        starsCtx.clearRect(0, 0, starsCanvas.width, starsCanvas.height);

        for (const star of stars) {
            if (t < star.spawnDelay) continue;
            const twinkle = 0.5 + 0.5 * Math.sin(t * star.speed + star.phase);
            const alpha = star.opacity * twinkle;
            const isWhite = star.hue === 0;
            starsCtx.fillStyle = isWhite
                ? `rgba(255,255,255,${alpha})`
                : `hsla(${star.hue},80%,85%,${alpha})`;
            drawSparkle(starsCtx, star.x * starsCanvas.width, star.y * starsCanvas.height, star.radius);
        }

        if (glyphCtx && glyphCanvas) {
            glyphCtx.clearRect(0, 0, glyphCanvas.width, glyphCanvas.height);
            renderGlyph(glyphCtx, GLYPH_SIZE / 2, GLYPH_SIZE / 2, t);
        }

        rafId = requestAnimationFrame(frame);
    }

    rafId = requestAnimationFrame(frame);

    const observer = new MutationObserver(() => {
        if (!document.getElementById('image-curtain')) {
            cancelAnimationFrame(rafId);
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
        cancelAnimationFrame(rafId);
        starsCanvas.remove();
        observer.disconnect();
    };
}
