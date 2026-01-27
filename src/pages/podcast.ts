const VOTED_KEY = 'podcast-interest-voted';

function init(): void {
  const button = document.getElementById('vote-btn') as HTMLButtonElement;
  const countSpan = document.querySelector('.vote-count') as HTMLSpanElement;
  if (!button || !countSpan) return;

  const hasVoted = localStorage.getItem(VOTED_KEY) === 'true';

  fetch('/api/vote?key=podcast-interest')
    .then((res) => res.json())
    .then((data: { count: number }) => {
      countSpan.textContent = data.count.toString();
    })
    .catch(() => {
      countSpan.textContent = '?';
    });

  if (hasVoted) {
    button.disabled = true;
    button.textContent = "You've voted ✓";
    button.classList.add('voted');
  }

  button.addEventListener('click', () => {
    if (hasVoted) return;

    button.disabled = true;
    button.textContent = 'Voting...';

    fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'podcast-interest' }),
    })
      .then((res) => res.json())
      .then((data: { count: number }) => {
        countSpan.textContent = data.count.toString();
        localStorage.setItem(VOTED_KEY, 'true');
        button.textContent = "You've voted ✓";
        button.classList.add('voted');
      })
      .catch(() => {
        button.disabled = false;
        button.textContent = "I'd listen 👂";
      });
  });
}

document.addEventListener('DOMContentLoaded', init);
