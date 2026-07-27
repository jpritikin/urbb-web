const LEAVE_DELAY_MS = 1000;

export function initHoverSwap(): void {
    document.querySelectorAll<HTMLElement>('.hover-swap').forEach(el => {
        let leaveTimer: number | undefined;

        const swapIn = () => {
            window.clearTimeout(leaveTimer);
            el.classList.add('is-swapped');
        };

        const swapOut = () => {
            window.clearTimeout(leaveTimer);
            leaveTimer = window.setTimeout(() => el.classList.remove('is-swapped'), LEAVE_DELAY_MS);
        };

        el.addEventListener('mouseenter', swapIn);
        el.addEventListener('mouseleave', swapOut);
        el.addEventListener('focus', swapIn);
        el.addEventListener('blur', swapOut);
    });
}
