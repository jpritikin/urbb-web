const version = 'v1.1.0';
console.log(`IFS Simulator Entrance ${version}`);

document.addEventListener('DOMContentLoaded', () => {
  const enterBtn = document.getElementById('enter-simulator-btn');

  if (!enterBtn) return;

  enterBtn.addEventListener('click', () => {
    const direction = Math.random() < 0.5 ? 'cw' : 'ccw';
    enterBtn.style.animation = `enter-simulator-${direction} 2.5s ease-out forwards`;

    const colorWave = document.createElement('div');
    colorWave.className = 'color-wave-overlay';
    document.body.appendChild(colorWave);

    setTimeout(() => {
      const spiral = document.createElement('div');
      spiral.className = 'spiral-overlay';
      document.body.appendChild(spiral);
    }, 300);

    setTimeout(() => {
      const glitch = document.createElement('div');
      glitch.className = 'glitch-overlay';
      document.body.appendChild(glitch);
    }, 1800);

    setTimeout(() => {
      const finalGlitch = document.createElement('div');
      finalGlitch.className = 'glitch-overlay';
      document.body.appendChild(finalGlitch);
    }, 2400);

    setTimeout(() => {
      window.location.href = '/ifs/';
    }, 3200);
  });
});
