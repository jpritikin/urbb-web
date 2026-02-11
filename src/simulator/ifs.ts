import { CloudManager } from '../cloud/cloudManager.js';
import { sessionToJSON } from '../playback/testability/recorder.js';
import { loadRecordedSession, Scenario } from './scenarios.js';
import { ScenarioSelector } from './scenarioSelector.js';
import type { RecordedSession } from '../playback/testability/types.js';
import type { PlaybackSpeed } from '../playback/playback.js';

function downloadSessionAsJson(session: RecordedSession): void {
    const json = sessionToJSON(session);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ifs-session-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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


    cloudManager.startRecording(getPageVersion());

    setTimeout(() => {
        if (cloudManager.isRecording()) {
            cloudManager.stopRecording();
            console.log('[IFS] Recording auto-stopped after 1 hour');
        }
    }, MAX_RECORDING_MS);
}

async function startSimulation(scenario: Scenario, playbackMode: boolean = false, speed?: PlaybackSpeed): Promise<void> {
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
        cloudManager.restoreFromSession(recordedSession.initialModel);
    } else {
        scenario.setup(cloudManager);
    }
    cloudManager.finalizePanoramaSetup();

    cloudManager.applyAssessedNeedAttention();
    if (playbackMode && recordedSession) {
        cloudManager.pausePlayback();
    }
    cloudManager.startAnimation();
    cloudManager.setCarpetDebug(false);

    setupRecordingShortcuts(cloudManager);

    if (playbackMode && recordedSession) {
        setTimeout(() => {
            cloudManager.startPlayback(recordedSession!, speed);
        }, 500);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('[IFS Simulator] Page version:', getPageVersion());

    const cloudContainer = document.getElementById('cloud-container');
    if (!cloudContainer) return;

    const selector = new ScenarioSelector(cloudContainer, (scenario, playbackMode, speed) => {
        startSimulation(scenario, playbackMode, speed);
    });
    selector.start();
});
