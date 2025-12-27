export interface HelpData {
    lowestTrust: { name: string; trust: number } | null;
    highestNeedAttention: { name: string; needAttention: number } | null;
    victoryAchieved?: boolean;
}

export class HelpPanel {
    private container: HTMLElement | null = null;
    private helpButton: HTMLButtonElement | null = null;
    private panel: HTMLElement | null = null;
    private expanded: boolean = false;

    show(parentContainer: HTMLElement): void {
        if (this.container) return;

        this.container = document.createElement('div');
        this.container.className = 'help-panel-container';

        this.helpButton = document.createElement('button');
        this.helpButton.className = 'help-button';
        this.helpButton.textContent = '?';
        this.helpButton.title = 'Show part status';
        this.helpButton.addEventListener('click', () => this.toggle());

        this.panel = document.createElement('div');
        this.panel.className = 'help-panel';
        this.panel.style.display = 'none';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'help-close-btn';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => this.collapse());

        this.panel.appendChild(closeBtn);

        const content = document.createElement('div');
        content.className = 'help-content';
        this.panel.appendChild(content);

        this.container.appendChild(this.helpButton);
        this.container.appendChild(this.panel);
        parentContainer.appendChild(this.container);
    }

    hide(): void {
        if (this.container?.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.container = null;
        this.helpButton = null;
        this.panel = null;
        this.expanded = false;
    }

    update(data: HelpData): void {
        if (!this.panel) return;

        const content = this.panel.querySelector('.help-content');
        if (!content) return;

        let html = '';

        if (data.lowestTrust) {
            const trustPct = Math.round(data.lowestTrust.trust * 100);
            html += `<div class="help-row">
                <span class="help-label">Lowest trust:</span>
                <span class="help-value">${data.lowestTrust.name} (${trustPct}%)</span>
            </div>`;
        }

        if (data.highestNeedAttention) {
            const na = data.highestNeedAttention.needAttention;
            const naDisplay = na.toFixed(1);
            const naColor = na < 1 ? 'green' : na < 2 ? 'orange' : 'red';
            html += `<div class="help-row">
                <span class="help-label">Needs attention:</span>
                <span class="help-value">${data.highestNeedAttention.name} (<span style="color:${naColor}">${naDisplay}</span>)</span>
            </div>`;
        }

        if (!data.lowestTrust && !data.highestNeedAttention) {
            html = '<div class="help-row"><span class="help-value">No parts registered</span></div>';
        }

        if (data.victoryAchieved) {
            html += `<div class="help-row victory-row">
                <span class="help-value">✨ Self-Leadership Achieved! 🌟</span>
            </div>`;
        }

        content.innerHTML = html;
    }

    private toggle(): void {
        if (this.expanded) {
            this.collapse();
        } else {
            this.expand();
        }
    }

    private expand(): void {
        if (!this.panel || !this.helpButton) return;
        this.expanded = true;
        this.panel.style.display = 'block';
        this.helpButton.style.display = 'none';
    }

    private collapse(): void {
        if (!this.panel || !this.helpButton) return;
        this.expanded = false;
        this.panel.style.display = 'none';
        this.helpButton.style.display = 'flex';
    }

    isExpanded(): boolean {
        return this.expanded;
    }
}
