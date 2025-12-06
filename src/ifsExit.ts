const version = 'v1.0.0';
console.log(`IFS Exit Handler ${version}`);

let hasUnsavedWork = false;
let isExitingThroughButton = false;

document.addEventListener('DOMContentLoaded', () => {
  const exitBtn = document.getElementById('exit-simulator-btn');

  if (!exitBtn) return;

  const anyInput = document.querySelectorAll('input, textarea');
  anyInput.forEach(input => {
    input.addEventListener('input', () => {
      hasUnsavedWork = true;
    });
  });

  const handleExit = () => {
    const message = hasUnsavedWork
      ? 'You have unsaved work. Are you sure you want to exit the simulator?'
      : 'Are you sure you want to exit the simulator?';

    const confirmed = confirm(message);
    if (!confirmed) {
      return;
    }
    isExitingThroughButton = true;
    window.location.href = '/supplement/';
  };

  exitBtn.addEventListener('click', handleExit);

  window.addEventListener('beforeunload', (e) => {
    if (isExitingThroughButton) {
      return;
    }
    e.preventDefault();
    e.returnValue = '';
    return '';
  });
});

export { hasUnsavedWork };
