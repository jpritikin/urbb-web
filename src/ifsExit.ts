const version = 'v1.2.0';
console.log(`IFS Exit Handler ${version}`);

let hasUnsavedWork = false;
let isExitingThroughButton = false;

document.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem('ifs-entrance-glitch') === 'true') {
    sessionStorage.removeItem('ifs-entrance-glitch');

    const glitch = document.createElement('div');
    glitch.className = 'glitch-overlay';
    document.body.appendChild(glitch);

    setTimeout(() => {
      glitch.remove();
    }, 1200);
  }

  const exitBtn = document.getElementById('exit-simulator-btn');

  if (!exitBtn) return;

  const anyInput = document.querySelectorAll('input, textarea');
  anyInput.forEach(input => {
    input.addEventListener('input', () => {
      hasUnsavedWork = true;
    });
  });

  const handleExit = () => {
    if (hasUnsavedWork) {
      const confirmed = confirm('You have unsaved work. Are you sure you want to exit the simulator?');
      if (!confirmed) {
        return;
      }
    }
    isExitingThroughButton = true;
    window.location.href = '/supplement/';
  };

  exitBtn.addEventListener('click', handleExit);

  window.addEventListener('beforeunload', (e) => {
    if (isExitingThroughButton || !hasUnsavedWork) {
      return;
    }
    e.preventDefault();
    e.returnValue = '';
    return '';
  });
});

export { hasUnsavedWork };
