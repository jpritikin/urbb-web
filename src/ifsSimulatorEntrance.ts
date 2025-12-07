const version = 'v1.5.4';
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

            const turns = 6;
            const pointsPerTurn = 50;
            const totalPoints = turns * pointsPerTurn;
            const armCount = 3;

            const armColors = ['#4d8a99', '#c8752e', '#962329'];

            for (let arm = 0; arm < armCount; arm++) {
                const armOffset = (arm * 2 * Math.PI) / armCount;
                const armColor = armColors[arm];

                const leftEdge: Array<{ x: number, y: number }> = [];
                const rightEdge: Array<{ x: number, y: number }> = [];

                for (let i = 0; i <= totalPoints; i++) {
                    const angle = armOffset + direction * (i / pointsPerTurn) * 2 * Math.PI;
                    const minRadius = 5;
                    const maxRadius = 360;
                    const radius = minRadius + (i / totalPoints) * (maxRadius - minRadius);
                    const x = 400 + radius * Math.cos(angle);
                    const y = 400 + radius * Math.sin(angle);

                    const progress = i / totalPoints;
                    const halfWidth = progress * progress * 250;

                    const perpAngle = angle + Math.PI / 2;
                    leftEdge.push({
                        x: x + halfWidth * Math.cos(perpAngle),
                        y: y + halfWidth * Math.sin(perpAngle)
                    });
                    rightEdge.push({
                        x: x - halfWidth * Math.cos(perpAngle),
                        y: y - halfWidth * Math.sin(perpAngle)
                    });
                }

                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

                const catmullRomToPath = (points: Array<{ x: number, y: number }>, closed = false) => {
                    if (points.length < 2) return '';

                    let d = `M ${points[0].x} ${points[0].y}`;

                    for (let i = 0; i < points.length - 1; i++) {
                        const p0 = points[Math.max(0, i - 1)];
                        const p1 = points[i];
                        const p2 = points[i + 1];
                        const p3 = points[Math.min(points.length - 1, i + 2)];

                        const cp1x = p1.x + (p2.x - p0.x) / 6;
                        const cp1y = p1.y + (p2.y - p0.y) / 6;
                        const cp2x = p2.x - (p3.x - p1.x) / 6;
                        const cp2y = p2.y - (p3.y - p1.y) / 6;

                        d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
                    }

                    return d;
                };

                let d = catmullRomToPath(leftEdge);
                d += ' L ' + rightEdge[rightEdge.length - 1].x + ' ' + rightEdge[rightEdge.length - 1].y;
                d += ' ' + catmullRomToPath([...rightEdge].reverse()).substring(1);
                d += ' Z';

                path.setAttribute('d', d);
                path.setAttribute('fill', armColor);
                path.setAttribute('stroke', 'none');

                svg.appendChild(path);
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
