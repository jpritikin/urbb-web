import { SCENARIOS, Scenario } from './scenarios.js';

type State =
    | { phase: 'selectScenario' }
    | { phase: 'selectMode'; scenario: Scenario }
    | { phase: 'done'; scenario: Scenario; playbackMode: boolean };

export class ScenarioSelector {
    private state: State = { phase: 'selectScenario' };
    private element: HTMLElement | null = null;

    constructor(
        private container: HTMLElement,
        private onComplete: (scenario: Scenario, playbackMode: boolean) => void
    ) {}

    start(): void {
        this.transition({ phase: 'selectScenario' });
    }

    private transition(newState: State): void {
        this.state = newState;
        this.render();

        if (this.state.phase === 'done') {
            this.onComplete(this.state.scenario, this.state.playbackMode);
        }
    }

    private render(): void {
        this.element?.remove();

        switch (this.state.phase) {
            case 'selectScenario':
                this.element = this.renderScenarioSelector();
                break;
            case 'selectMode':
                this.element = this.renderModeSelector(this.state.scenario);
                break;
            case 'done':
                return;
        }

        this.container.appendChild(this.element);
    }

    private renderScenarioSelector(): HTMLElement {
        const selector = document.createElement('div');
        selector.className = 'scenario-selector';
        selector.innerHTML = `
            <h2>Select your next client</h2>
            <div class="scenario-cards"></div>
        `;

        const cardsContainer = selector.querySelector('.scenario-cards')!;

        for (const scenario of SCENARIOS) {
            const card = document.createElement('div');
            card.className = 'scenario-card';
            card.innerHTML = `
                <span class="scenario-difficulty ${scenario.difficulty.toLowerCase()}">${scenario.difficulty} (~${scenario.estimatedMinutes} min)</span>
                <h3>${scenario.name}</h3>
                <p class="scenario-description">${scenario.description}</p>
            `;
            card.addEventListener('click', () => this.selectScenario(scenario));
            cardsContainer.appendChild(card);
        }

        return selector;
    }

    private selectScenario(scenario: Scenario): void {
        if (scenario.recordedSessionPath) {
            this.transition({ phase: 'selectMode', scenario });
        } else {
            this.transition({ phase: 'done', scenario, playbackMode: false });
        }
    }

    private renderModeSelector(scenario: Scenario): HTMLElement {
        const selector = document.createElement('div');
        selector.className = 'mode-selector';
        selector.innerHTML = `
            <h2>How would you like to proceed?</h2>
            <p class="scenario-name">${scenario.name} - ${scenario.difficulty}</p>
            <div class="mode-buttons"></div>
            <button class="back-btn">\u2190 Choose different scenario</button>
        `;

        const buttonsContainer = selector.querySelector('.mode-buttons')!;

        const exploreBtn = document.createElement('button');
        exploreBtn.className = 'mode-btn';
        exploreBtn.innerHTML = `
            <span class="icon">\ud83d\udd0d</span>
            <span class="label">Explore</span>
            <span class="sublabel">Try it yourself</span>
        `;
        exploreBtn.addEventListener('click', () => {
            this.transition({ phase: 'done', scenario, playbackMode: false });
        });

        const playbackBtn = document.createElement('button');
        playbackBtn.className = 'mode-btn';
        playbackBtn.innerHTML = `
            <span class="icon">\u25b6\ufe0f</span>
            <span class="label">Watch Solution</span>
            <span class="sublabel">Recorded playback</span>
        `;
        playbackBtn.addEventListener('click', () => {
            this.transition({ phase: 'done', scenario, playbackMode: true });
        });

        buttonsContainer.appendChild(exploreBtn);
        buttonsContainer.appendChild(playbackBtn);

        selector.querySelector('.back-btn')!.addEventListener('click', () => {
            this.transition({ phase: 'selectScenario' });
        });

        return selector;
    }
}
