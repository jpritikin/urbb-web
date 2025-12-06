const version = 'v1.5.0';
console.log(`IFS Simulator Entrance ${version}`);

document.addEventListener('DOMContentLoaded', () => {
    const enterBtn = document.getElementById('enter-simulator-btn');

    if (!enterBtn) return;

    enterBtn.addEventListener('click', () => {
        const direction = Math.random() < 0.5 ? 1 : -1;
        const clockDir = direction === 1 ? 'cw' : 'ccw';
        enterBtn.style.setProperty('--button-direction', direction === 1 ? '-1' : '1');
        enterBtn.style.animation = 'enter-simulator 2.5s ease-out forwards';

        const colorWave = document.createElement('div');
        colorWave.className = 'color-wave-overlay';
        document.body.appendChild(colorWave);

        setTimeout(() => {
            const spiral = document.createElement('div');
            spiral.className = `spiral-overlay ${clockDir}`;

            // Create SVG spiral
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            svg.setAttribute('viewBox', '0 0 800 800');

            // Generate three spiral arms with tapering
            const turns = 6;
            const pointsPerTurn = 50;
            const totalPoints = turns * pointsPerTurn;
            const segmentCount = 20;
            const pointsPerSegment = Math.floor(totalPoints / segmentCount);
            const armCount = 3;

            const armColors = ['#4d8a99', '#c8752e', '#962329'];

            for (let arm = 0; arm < armCount; arm++) {
                const armOffset = (arm * 2 * Math.PI) / armCount;
                const armColor = armColors[arm];

                for (let seg = 0; seg < segmentCount; seg++) {
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    const startIdx = seg * pointsPerSegment;
                    const endIdx = Math.min((seg + 1) * pointsPerSegment, totalPoints);

                    let d = '';
                    for (let i = startIdx; i <= endIdx; i++) {
                        const angle = armOffset + direction * (i / pointsPerTurn) * 2 * Math.PI;
                        const minRadius = 5;
                        const maxRadius = 360;
                        const radius = minRadius + (i / totalPoints) * (maxRadius - minRadius);
                        const x = 400 + radius * Math.cos(angle);
                        const y = 400 + radius * Math.sin(angle);
                        d += (i === startIdx ? `M ${x} ${y} ` : `L ${x} ${y} `);
                    }

                    const progress = seg / segmentCount;
                    const strokeWidth = 1 + (progress * 30);

                    path.setAttribute('d', d);
                    path.setAttribute('fill', 'none');
                    path.setAttribute('stroke', armColor);
                    path.setAttribute('stroke-width', strokeWidth.toString());
                    path.setAttribute('stroke-linecap', 'round');

                    svg.appendChild(path);
                }
            }

            spiral.appendChild(svg);

            document.body.appendChild(spiral);
        }, 200);

        setTimeout(() => {
            const glitch = document.createElement('div');
            glitch.className = 'glitch-overlay';
            document.body.appendChild(glitch);
        }, 1500);

        setTimeout(() => {
            sessionStorage.setItem('ifs-entrance-glitch', 'true');
            window.location.href = '/ifs/';
        }, 2600);
    });
});
