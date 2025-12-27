import { CloudManager } from './cloudManager.js';
import { sessionToJSON } from './testability/recorder.js';
import { SCENARIOS, Scenario } from './scenarios.js';

function downloadSession(cloudManager: CloudManager): void {
    const session = cloudManager.stopRecording();
    if (!session) {
        console.warn('[IFS] No recording in progress');
        return;
    }
    const json = sessionToJSON(session);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ifs-session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    console.log('[IFS] Recording saved:', a.download);
}

function getPageVersion(): string {
    return document.querySelector('meta[name="page-version"]')?.getAttribute('content') || 'unknown';
}

function setupRecordingShortcuts(cloudManager: CloudManager): void {
    const toggleRecording = () => {
        if (cloudManager.isRecording()) {
            downloadSession(cloudManager);
            console.log('[IFS] Recording stopped and downloaded');
        } else {
            cloudManager.startRecording(getPageVersion());
            console.log('[IFS] Recording started');
        }
    };

    cloudManager.setRecordingToggleHandler(toggleRecording);

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === ' ') {
            e.preventDefault();
            toggleRecording();
        }
    });
}

function createScenarioSelector(container: HTMLElement, onSelect: (scenario: Scenario) => void): void {
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
        card.addEventListener('click', () => {
            selector.remove();
            onSelect(scenario);
        });
        cardsContainer.appendChild(card);
    }

    container.appendChild(selector);
}

function startSimulation(scenario: Scenario): void {
    const cloudContainer = document.getElementById('cloud-container');
    if (!cloudContainer) return;

    const cloudManager = new CloudManager();
    (window as any).cloudManager = cloudManager;
    console.log('[IFS] debugHelp() for console debug commands');
    (window as any).debugHelp = () => {
        console.log('IFS Simulator Debug Commands:');
        console.log('  cloudManager.setCarpetDebug(true)   - Show wind field visualization');
        console.log('  cloudManager.setDebug(true)         - Show cloud debug info');
        console.log('  star.testPulse(target?, dir?)       - Trigger pulse (target: inner|outer|tipAngle|outerAlternating)');
        console.log('  star.testTransition(type, armCount, sourceIdx, dir?)');
        console.log('                                      - Test arm transition (type: adding|removing)');
        console.log('  star.testSingleTransition(type, armCount, sourceIdx, dir?)');
        console.log('  star.testOverlappingTransition(type, armCount, src1, src2, delay, dir?)');
    };
    cloudManager.init('cloud-container');

    console.log(`[IFS] Starting scenario: ${scenario.name} (${scenario.difficulty})`);
    scenario.setup(cloudManager);

    cloudManager.applyAssessedNeedAttention();
    cloudManager.startAnimation();
    cloudManager.setCarpetDebug(false);

    setupRecordingShortcuts(cloudManager);
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('[IFS Simulator] Page version:', getPageVersion());

    const cloudContainer = document.getElementById('cloud-container');
    if (!cloudContainer) return;

    createScenarioSelector(cloudContainer, startSimulation);
});
