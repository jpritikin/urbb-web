import { CloudManager } from '../cloud/cloudManager.js';
import { sessionToJSON } from '../playback/testability/recorder.js';
import { SCENARIOS, Scenario, loadRecordedSession } from './scenarios.js';
import type { RecordedSession } from '../playback/testability/types.js';

function downloadSessionAsJson(session: RecordedSession): void {
    const json = sessionToJSON(session);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ifs-session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function getPageVersion(): string {
    return document.querySelector('meta[name="page-version"]')?.getAttribute('content') || 'unknown';
}

const MAX_RECORDING_MS = 60 * 60 * 1000; // 1 hour

function setupRecordingShortcuts(cloudManager: CloudManager): void {
    const downloadCurrentSession = () => {
        const session = cloudManager.getRecordingSession();
        if (!session) {
            console.warn('[IFS] No recording session available');
            return;
        }
        downloadSessionAsJson(session);
    };

    cloudManager.setDownloadSessionHandler(downloadCurrentSession);

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === ' ') {
            e.preventDefault();
            downloadCurrentSession();
        }
    });

    // Auto-start recording
    cloudManager.startRecording(getPageVersion());

    // Auto-stop after 1 hour
    setTimeout(() => {
        if (cloudManager.isRecording()) {
            cloudManager.stopRecording();
            console.log('[IFS] Recording auto-stopped after 1 hour');
        }
    }, MAX_RECORDING_MS);
}

function createScenarioSelector(container: HTMLElement, onSelect: (scenario: Scenario, playbackMode: boolean) => void): void {
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
            if (scenario.recordedSessionPath) {
                createModeSelector(container, scenario, onSelect);
            } else {
                onSelect(scenario, false);
            }
        });
        cardsContainer.appendChild(card);
    }

    container.appendChild(selector);
}

function createModeSelector(
    container: HTMLElement,
    scenario: Scenario,
    onSelect: (scenario: Scenario, playbackMode: boolean) => void
): void {
    const selector = document.createElement('div');
    selector.className = 'mode-selector';
    selector.innerHTML = `
        <h2>How would you like to proceed?</h2>
        <p class="scenario-name">${scenario.name} - ${scenario.difficulty}</p>
        <div class="mode-buttons"></div>
        <button class="back-btn">← Choose different scenario</button>
    `;

    const buttonsContainer = selector.querySelector('.mode-buttons')!;

    const exploreBtn = document.createElement('button');
    exploreBtn.className = 'mode-btn';
    exploreBtn.innerHTML = `
        <span class="icon">🔍</span>
        <span class="label">Explore</span>
        <span class="sublabel">Try it yourself</span>
    `;
    exploreBtn.addEventListener('click', () => {
        selector.remove();
        onSelect(scenario, false);
    });

    const playbackBtn = document.createElement('button');
    playbackBtn.className = 'mode-btn';
    playbackBtn.innerHTML = `
        <span class="icon">▶️</span>
        <span class="label">Watch Solution</span>
        <span class="sublabel">Recorded playback</span>
    `;
    playbackBtn.addEventListener('click', () => {
        selector.remove();
        onSelect(scenario, true);
    });

    buttonsContainer.appendChild(exploreBtn);
    buttonsContainer.appendChild(playbackBtn);

    const backBtn = selector.querySelector('.back-btn')!;
    backBtn.addEventListener('click', () => {
        selector.remove();
        createScenarioSelector(container, onSelect);
    });

    container.appendChild(selector);
}

async function startSimulation(scenario: Scenario, playbackMode: boolean = false): Promise<void> {
    const cloudContainer = document.getElementById('cloud-container');
    if (!cloudContainer) return;

    let recordedSession: RecordedSession | null = null;
    if (playbackMode && scenario.recordedSessionPath) {
        recordedSession = await loadRecordedSession(scenario.recordedSessionPath);
        if (!recordedSession) {
            console.warn(`[IFS] Failed to load recorded session from ${scenario.recordedSessionPath}`);
            playbackMode = false;
        } else if (recordedSession.codeVersion !== getPageVersion()) {
            console.warn(`[IFS] Recording version mismatch: ${recordedSession.codeVersion} vs current ${getPageVersion()}`);
        }
    }

    const cloudManager = new CloudManager();
    (window as any).cloudManager = cloudManager;
    console.log('[IFS] debugHelp() for console debug commands');
    (window as any).debugHelp = () => {
        console.log('IFS Simulator Debug Commands:');
        console.log('  cloudManager.setCarpetDebug(true)   - Show wind field visualization');
        console.log('  cloudManager.setSeatDebug(true)     - Show carpet-seat matching debug');
        console.log('  cloudManager.setPanoramaDebug(true) - Show panorama cloud target markers');
        console.log('  cloudManager.setDebug(true)         - Show cloud debug info');
        console.log('  star.testPulse(target?, dir?)       - Trigger pulse (target: inner|outer|tipAngle|outerAlternating)');
        console.log('  star.testTransition(type, armCount, sourceIdx, dir?)');
        console.log('                                      - Test arm transition (type: adding|removing)');
        console.log('  star.testSingleTransition(type, armCount, sourceIdx, dir?)');
        console.log('  star.testOverlappingTransition(type, armCount, src1, src2, delay, dir?)');
    };
    cloudManager.init('cloud-container');

    console.log(`[IFS] Starting scenario: ${scenario.name} (${scenario.difficulty})${playbackMode ? ' [PLAYBACK]' : ''}`);
    if (playbackMode && recordedSession) {
        cloudManager.setSeed(recordedSession.modelSeed);
        cloudManager.restoreFromSession(recordedSession.initialModel, recordedSession.initialRelationships);
    } else {
        scenario.setup(cloudManager);
    }
    cloudManager.finalizePanoramaSetup();

    cloudManager.applyAssessedNeedAttention();
    if (playbackMode && recordedSession) {
        cloudManager.setPauseTimeEffects(true);
    }
    cloudManager.startAnimation();
    cloudManager.setCarpetDebug(false);

    setupRecordingShortcuts(cloudManager);

    if (playbackMode && recordedSession) {
        setTimeout(() => {
            cloudManager.startPlayback(recordedSession!);
        }, 500);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('[IFS Simulator] Page version:', getPageVersion());

    const cloudContainer = document.getElementById('cloud-container');
    if (!cloudContainer) return;

    createScenarioSelector(cloudContainer, (scenario, playbackMode) => {
        startSimulation(scenario, playbackMode);
    });
});
