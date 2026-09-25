const SVG_NS = 'http://www.w3.org/2000/svg';
const RAY_COUNT = 15;
const RAY_GAP = 20;
const RAY_INNER_RADIUS = 80;
const RAY_OUTER_RADIUS = 2600;
const RAY_HALF_ANGLE_MIN_DEG = 0.75;
const RAY_HALF_ANGLE_MAX_DEG = 1.75;
const RAY_ANGLE_MIN_DEG = 90;
const RAY_ANGLE_MAX_DEG = 180;
const CORE_RADIUS = 90;
const HUE_MIN = 0;
const HUE_MAX = 70;
const FADE_PERIOD_MIN_SEC = 8;
const FADE_PERIOD_MAX_SEC = 20;
const RAY_MAX_OPACITY = 0.5;
const SPARKLE_MAX_OPACITY = 0.9;
const SPARKLES_PER_RAY_PER_1000PX = 25;
const SPARKLE_SPEED_MIN_PXPS = 6;
const SPARKLE_SPEED_MAX_PXPS = 14;
const SPARKLE_SIZE_MIN = 3;
const SPARKLE_SIZE_MAX = 14;
const SPARKLE_FLICKER_RATE = 0.6;
const SPARKLE_CROSS_ANGLE_MIN_DEG = 70;
const SPARKLE_CROSS_ANGLE_MAX_DEG = 110;
const SPARKLE_CROSS_ANGLE_RATE_DEG_PER_SEC = 8;
const MAX_FRAME_DELTA_SEC = 0.1;

interface Ray {
    element: SVGPathElement;
    periodSec: number;
    phase: number;
    angleDeg: number;
    halfAngleDeg: number;
}

interface Sparkle {
    element: SVGPathElement;
    angleDeg: number;
    halfAngleDeg: number;
    progress: number;
    speed: number;
    offsetRatio: number;
    flicker: number;
    flickerTarget: number;
    crossAngleDeg: number;
    crossAngleTargetDeg: number;
}

const RAY_MAX_OVERLAP_RATIO = 0.5;
const RAY_PLACEMENT_MAX_ATTEMPTS = 200;

function randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

function pickRayAngle(existingRays: { angleDeg: number; halfAngleDeg: number }[], halfAngleDeg: number): number {
    for (let attempt = 0; attempt < RAY_PLACEMENT_MAX_ATTEMPTS; attempt++) {
        const angle = randomBetween(RAY_ANGLE_MIN_DEG, RAY_ANGLE_MAX_DEG);
        const overlaps = existingRays.some((other) => {
            const minSeparationDeg = (halfAngleDeg + other.halfAngleDeg) * (1 - RAY_MAX_OVERLAP_RATIO);
            return Math.abs(angle - other.angleDeg) < minSeparationDeg;
        });
        if (!overlaps) return angle;
    }
    return randomBetween(RAY_ANGLE_MIN_DEG, RAY_ANGLE_MAX_DEG);
}

function makeRayPath(cx: number, cy: number, angleDeg: number, halfAngleDeg: number): SVGPathElement {
    const half = (halfAngleDeg * Math.PI) / 180;
    const angle = (angleDeg * Math.PI) / 180;
    const innerRadius = RAY_INNER_RADIUS + RAY_GAP;

    const innerLeftX = cx + innerRadius * Math.cos(angle - half);
    const innerLeftY = cy + innerRadius * Math.sin(angle - half);
    const innerRightX = cx + innerRadius * Math.cos(angle + half);
    const innerRightY = cy + innerRadius * Math.sin(angle + half);
    const outerLeftX = cx + RAY_OUTER_RADIUS * Math.cos(angle - half);
    const outerLeftY = cy + RAY_OUTER_RADIUS * Math.sin(angle - half);
    const outerRightX = cx + RAY_OUTER_RADIUS * Math.cos(angle + half);
    const outerRightY = cy + RAY_OUTER_RADIUS * Math.sin(angle + half);

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute(
        'd',
        `M ${innerLeftX} ${innerLeftY} L ${outerLeftX} ${outerLeftY} L ${outerRightX} ${outerRightY} L ${innerRightX} ${innerRightY} Z`
    );
    return path;
}

export function initPromiseSun(): () => void {
    const container = document.getElementById('promise-sun');
    if (!container) return () => { };

    const cx = 0;
    const cy = 0;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('promise-sun-svg');

    const sunContainer = container;

    function updateViewBox() {
        const w = sunContainer.clientWidth;
        const h = sunContainer.clientHeight;
        svg.setAttribute('width', String(w));
        svg.setAttribute('height', String(h));
        svg.setAttribute('viewBox', `${-w} 0 ${w} ${h}`);
    }
    updateViewBox();

    const defs = document.createElementNS(SVG_NS, 'defs');
    const coreGradient = document.createElementNS(SVG_NS, 'radialGradient');
    coreGradient.setAttribute('id', 'promise-core-fill');
    coreGradient.innerHTML = `
        <stop offset="0%" stop-color="var(--promise-core-color-1)" />
        <stop offset="60%" stop-color="var(--promise-core-color-2)" />
        <stop offset="100%" stop-color="var(--promise-core-color-3)" />
    `;
    defs.appendChild(coreGradient);

    const rayGroup = document.createElementNS(SVG_NS, 'g');
    const rays: Ray[] = [];
    for (let i = 0; i < RAY_COUNT; i++) {
        const halfAngleDeg = randomBetween(RAY_HALF_ANGLE_MIN_DEG, RAY_HALF_ANGLE_MAX_DEG);
        const angle = pickRayAngle(rays, halfAngleDeg);
        const path = makeRayPath(cx, cy, angle, halfAngleDeg);
        const hue = randomBetween(HUE_MIN, HUE_MAX);
        const color = `hsl(${hue}, 90%, 60%)`;

        const gradientId = `promise-ray-fade-${i}`;
        const gradient = document.createElementNS(SVG_NS, 'linearGradient');
        gradient.setAttribute('id', gradientId);
        gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
        gradient.setAttribute('x1', String(cx + RAY_INNER_RADIUS * Math.cos((angle * Math.PI) / 180)));
        gradient.setAttribute('y1', String(cy + RAY_INNER_RADIUS * Math.sin((angle * Math.PI) / 180)));
        gradient.setAttribute('x2', String(cx + RAY_OUTER_RADIUS * Math.cos((angle * Math.PI) / 180)));
        gradient.setAttribute('y2', String(cy + RAY_OUTER_RADIUS * Math.sin((angle * Math.PI) / 180)));
        gradient.innerHTML = `
            <stop offset="0%" stop-color="${color}" stop-opacity="1" />
            <stop offset="60%" stop-color="${color}" stop-opacity="0.35" />
            <stop offset="100%" stop-color="${color}" stop-opacity="0" />
        `;
        defs.appendChild(gradient);

        path.setAttribute('fill', `url(#${gradientId})`);
        rayGroup.appendChild(path);
        rays.push({
            element: path,
            periodSec: randomBetween(FADE_PERIOD_MIN_SEC, FADE_PERIOD_MAX_SEC),
            phase: Math.random() * Math.PI * 2,
            angleDeg: angle,
            halfAngleDeg,
        });
    }
    svg.appendChild(defs);
    svg.appendChild(rayGroup);

    const viewportDiagonal = Math.sqrt(
        sunContainer.clientWidth ** 2 + sunContainer.clientHeight ** 2
    );
    const visibleRayLength = Math.min(RAY_OUTER_RADIUS, viewportDiagonal) - RAY_INNER_RADIUS - RAY_GAP;
    const sparklesPerRay = Math.max(1, Math.round((visibleRayLength / 1000) * SPARKLES_PER_RAY_PER_1000PX));

    const sparkleGroup = document.createElementNS(SVG_NS, 'g');
    const sparkles: Sparkle[] = [];
    for (const ray of rays) {
        for (let s = 0; s < sparklesPerRay; s++) {
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('stroke', 'white');
            path.setAttribute('stroke-width', '2');
            sparkleGroup.appendChild(path);
            sparkles.push({
                element: path,
                angleDeg: ray.angleDeg,
                halfAngleDeg: ray.halfAngleDeg,
                progress: Math.random(),
                speed: randomBetween(SPARKLE_SPEED_MIN_PXPS, SPARKLE_SPEED_MAX_PXPS) / visibleRayLength,
                offsetRatio: (Math.random() - 0.5) * 2,
                flicker: Math.random(),
                flickerTarget: Math.random(),
                crossAngleDeg: randomBetween(SPARKLE_CROSS_ANGLE_MIN_DEG, SPARKLE_CROSS_ANGLE_MAX_DEG),
                crossAngleTargetDeg: randomBetween(SPARKLE_CROSS_ANGLE_MIN_DEG, SPARKLE_CROSS_ANGLE_MAX_DEG),
            });
        }
    }
    svg.appendChild(sparkleGroup);

    const core = document.createElementNS(SVG_NS, 'circle');
    core.setAttribute('cx', String(cx));
    core.setAttribute('cy', String(cy));
    core.setAttribute('r', String(CORE_RADIUS));
    core.setAttribute('fill', 'url(#promise-core-fill)');
    svg.appendChild(core);

    container.appendChild(svg);

    const style = document.createElement('style');
    style.textContent = `
        #promise-sun { --promise-core-color-1: #fde68a; --promise-core-color-2: #f59e0b; --promise-core-color-3: #d97706; }
        .dark #promise-sun { --promise-core-color-1: #fcd34d; --promise-core-color-2: #ea580c; --promise-core-color-3: #9a3412; }
        .promise-sun-svg { display: block; position: absolute; top: 0; right: 0; }
    `;
    container.appendChild(style);

    const onResize = () => updateViewBox();
    window.addEventListener('resize', onResize);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let rafId: number | null = null;
    let startTime: number | null = null;
    let lastElapsedSec = 0;

    function updateSparklePositions() {
        const isDarkMode = document.documentElement.classList.contains('dark');
        const sparkleMaxOpacity = isDarkMode ? SPARKLE_MAX_OPACITY / 3 : SPARKLE_MAX_OPACITY;
        for (const sparkle of sparkles) {
            const half = (sparkle.halfAngleDeg * Math.PI) / 180;
            const rayAngle = (sparkle.angleDeg * Math.PI) / 180;
            const radius = RAY_INNER_RADIUS + RAY_GAP + sparkle.progress * (RAY_OUTER_RADIUS - RAY_INNER_RADIUS - RAY_GAP);
            const spread = sparkle.offsetRatio * half;
            const finalAngle = rayAngle + spread;
            const x = cx + radius * Math.cos(finalAngle);
            const y = cy + radius * Math.sin(finalAngle);

            const size = SPARKLE_SIZE_MIN + sparkle.progress * (SPARKLE_SIZE_MAX - SPARKLE_SIZE_MIN);
            const armAx = Math.cos(finalAngle) * size;
            const armAy = Math.sin(finalAngle) * size;
            const crossAngle = finalAngle + (sparkle.crossAngleDeg * Math.PI) / 180;
            const armBx = Math.cos(crossAngle) * size;
            const armBy = Math.sin(crossAngle) * size;

            sparkle.element.setAttribute(
                'd',
                `M ${x - armAx} ${y - armAy} L ${x + armAx} ${y + armAy} ` +
                `M ${x - armBx} ${y - armBy} L ${x + armBx} ${y + armBy}`
            );

            const fadeIn = Math.min(1, sparkle.progress * 8);
            const fadeOut = Math.min(1, (1 - sparkle.progress) * 4);
            sparkle.element.setAttribute('opacity', String(sparkleMaxOpacity * fadeIn * fadeOut * sparkle.flicker));
        }
    }

    function frame(now: number) {
        if (startTime === null) startTime = now;
        const elapsedSec = (now - startTime) / 1000;
        const deltaSec = Math.min(elapsedSec - lastElapsedSec, MAX_FRAME_DELTA_SEC);
        lastElapsedSec = elapsedSec;

        for (const ray of rays) {
            const wave = 0.5 + 0.5 * Math.sin((elapsedSec / ray.periodSec) * Math.PI * 2 + ray.phase);
            ray.element.setAttribute('opacity', String(wave * RAY_MAX_OPACITY));
        }

        const pulse = 1 + 0.05 * Math.sin(elapsedSec * (Math.PI * 2) / 6);
        core.setAttribute('r', String(CORE_RADIUS * pulse));

        for (const sparkle of sparkles) {
            sparkle.progress += sparkle.speed * deltaSec;
            if (sparkle.progress > 1) {
                sparkle.progress = 0;
                sparkle.offsetRatio = (Math.random() - 0.5) * 2;
            }

            const flickerStep = SPARKLE_FLICKER_RATE * deltaSec;
            const diff = sparkle.flickerTarget - sparkle.flicker;
            if (Math.abs(diff) <= flickerStep) {
                sparkle.flicker = sparkle.flickerTarget;
                sparkle.flickerTarget = Math.random();
            } else {
                sparkle.flicker += Math.sign(diff) * flickerStep;
            }

            const angleStep = SPARKLE_CROSS_ANGLE_RATE_DEG_PER_SEC * deltaSec;
            const angleDiff = sparkle.crossAngleTargetDeg - sparkle.crossAngleDeg;
            if (Math.abs(angleDiff) <= angleStep) {
                sparkle.crossAngleDeg = sparkle.crossAngleTargetDeg;
                sparkle.crossAngleTargetDeg = randomBetween(SPARKLE_CROSS_ANGLE_MIN_DEG, SPARKLE_CROSS_ANGLE_MAX_DEG);
            } else {
                sparkle.crossAngleDeg += Math.sign(angleDiff) * angleStep;
            }
        }
        updateSparklePositions();

        rafId = requestAnimationFrame(frame);
    }

    if (!reduceMotion) {
        rafId = requestAnimationFrame(frame);
    } else {
        for (const ray of rays) {
            ray.element.setAttribute('opacity', String(RAY_MAX_OPACITY * 0.5));
        }
        for (const sparkle of sparkles) {
            sparkle.element.setAttribute('opacity', '0');
        }
    }

    return () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        window.removeEventListener('resize', onResize);
        container.innerHTML = '';
    };
}
