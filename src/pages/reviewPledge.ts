const REVIEW_PLEDGE_VERSION = 'v1.0.0';
console.log(`Review Pledge ${REVIEW_PLEDGE_VERSION}`);

const STORAGE_KEY = 'review-pledge-checked';

document.addEventListener('DOMContentLoaded', () => {
    const checkbox = document.getElementById('review-pledge-checkbox') as HTMLInputElement;
    const rest = document.getElementById('rest-of-page');
    const pledgeContainer = document.getElementById('review-pledge-container');

    if (!checkbox || !rest || !pledgeContainer) return;

    const applyState = (checked: boolean) => {
        rest.classList.toggle('review-gate-locked', !checked);
    };

    checkbox.checked = localStorage.getItem(STORAGE_KEY) === 'true';
    applyState(checkbox.checked);

    checkbox.addEventListener('change', () => {
        localStorage.setItem(STORAGE_KEY, String(checkbox.checked));
        applyState(checkbox.checked);
    });

    rest.addEventListener('click', (event) => {
        if (checkbox.checked) return;
        event.preventDefault();
        event.stopPropagation();
        pledgeContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, { capture: true });
});
