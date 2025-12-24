export class VictoryBanner {
    private container: HTMLElement | null = null;
    private shown: boolean = false;

    show(parentContainer: HTMLElement): void {
        if (this.shown) return;
        this.shown = true;

        this.container = document.createElement('div');
        this.container.className = 'victory-banner';
        this.container.innerHTML = `
            <div class="victory-content">
                <span class="victory-text">✨ Self-Leadership Achieved! 🌟</span>
                <button class="victory-dismiss">Dismiss</button>
            </div>
        `;

        const dismissBtn = this.container.querySelector('.victory-dismiss');
        dismissBtn?.addEventListener('click', () => this.hide());

        parentContainer.appendChild(this.container);
    }

    hide(): void {
        if (this.container?.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.container = null;
    }

    isShown(): boolean {
        return this.shown;
    }

    reset(): void {
        this.hide();
        this.shown = false;
    }
}
