interface Ghost {
    element: HTMLSpanElement;
    startX: number;
    startY: number;
    driftX: number;
    driftY: number;
    wobbleX: number;
    wobbleY: number;
    delay: number;
    startTime: number | null;
}

const DURATION = 10000;

function easeOut(t: number): number {
    return 1 - Math.pow(1 - t, 2);
}

function animateGhosts(ghosts: Ghost[], container: HTMLElement) {
    let animationId: number;

    function update(timestamp: number) {
        let allDone = true;

        for (const ghost of ghosts) {
            if (ghost.startTime === null) {
                ghost.startTime = timestamp + ghost.delay;
            }

            const elapsed = timestamp - ghost.startTime;
            if (elapsed < 0) {
                allDone = false;
                continue;
            }

            const t = Math.min(elapsed / DURATION, 1);
            const eased = easeOut(t);

            // Scale: 0.3 -> 1 (at 10%) -> 1.7 (at 100%)
            let scale: number;
            if (t < 0.1) {
                scale = 0.3 + (0.7 * (t / 0.1));
            } else {
                scale = 1 + (0.7 * ((t - 0.1) / 0.9));
            }

            // Wobble factor oscillates and diminishes over time
            const wobbleFactor = Math.sin(t * Math.PI * 3);

            const x = ghost.startX + ghost.driftX * eased + ghost.wobbleX * wobbleFactor;
            const y = ghost.startY + ghost.driftY * eased + ghost.wobbleY * wobbleFactor;

            // Opacity: 0.5 until 30%, then fade to 0
            let opacity: number;
            if (t < 0.3) {
                opacity = 0.5;
            } else {
                opacity = 0.5 * (1 - ((t - 0.3) / 0.7));
            }

            ghost.element.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
            ghost.element.style.opacity = `${opacity}`;

            if (t < 1) {
                allDone = false;
            }
        }

        if (!allDone) {
            animationId = requestAnimationFrame(update);
        } else {
            container.innerHTML = '';
        }
    }

    animationId = requestAnimationFrame(update);

    return () => cancelAnimationFrame(animationId);
}

document.addEventListener('DOMContentLoaded', () => {
    const spiritGuideBtn = document.querySelector('.spirit-guide-btn');
    const spiritGuideMessage = document.querySelector('.spirit-guide-message');
    const ghostContainer = document.querySelector('.ghost-container') as HTMLElement | null;
    const dismissBtn = document.querySelector('.spirit-guide-dismiss');

    if (!spiritGuideBtn || !spiritGuideMessage || !ghostContainer || !dismissBtn) return;

    let cancelAnimation: (() => void) | null = null;

    spiritGuideBtn.addEventListener('click', () => {
        (spiritGuideBtn as HTMLElement).style.display = 'none';
        (spiritGuideMessage as HTMLElement).style.display = 'block';
        spiritGuideMessage.classList.add('revealing');

        ghostContainer.innerHTML = '';
        const numGhosts = 1 + Math.floor(Math.random() * 3);
        const ghosts: Ghost[] = [];

        for (let i = 0; i < numGhosts; i++) {
            const ghost = document.createElement('span');
            ghost.className = 'ghost';
            ghost.textContent = '👻';
            ghost.style.opacity = '0';
            ghostContainer.appendChild(ghost);

            const startAngle = Math.random() * 2 * Math.PI;
            const startRadius = Math.random() * 25;
            const driftAngle = Math.random() * 2 * Math.PI;
            const distance = 100 + Math.random() * 60;

            ghosts.push({
                element: ghost,
                startX: Math.cos(startAngle) * startRadius,
                startY: Math.sin(startAngle) * startRadius,
                driftX: Math.cos(driftAngle) * distance,
                driftY: Math.sin(driftAngle) * distance,
                wobbleX: (Math.random() - 0.5) * 60,
                wobbleY: (Math.random() - 0.5) * 60,
                delay: i * 300,
                startTime: null,
            });
        }

        cancelAnimation = animateGhosts(ghosts, ghostContainer);
    });

    dismissBtn.addEventListener('click', () => {
        if (cancelAnimation) {
            cancelAnimation();
            cancelAnimation = null;
        }
        ghostContainer.innerHTML = '';
        (spiritGuideMessage as HTMLElement).style.display = 'none';
        spiritGuideMessage.classList.remove('revealing');
        (spiritGuideBtn as HTMLElement).style.display = '';
    });
});
