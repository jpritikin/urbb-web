import { CloudManager } from './cloudManager.js';
import { sessionToJSON } from './testability/recorder.js';

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

function setupRecordingShortcuts(cloudManager: CloudManager): void {
    let isRecording = false;

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === ' ') {
            e.preventDefault();
            if (isRecording) {
                downloadSession(cloudManager);
                isRecording = false;
                console.log('[IFS] Recording stopped and downloaded');
            } else {
                cloudManager.startRecording();
                isRecording = true;
                console.log('[IFS] Recording started (Ctrl+Space to stop and download)');
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const pageVersion = document.querySelector('meta[name="page-version"]')?.getAttribute('content') || 'unknown';
    console.log('[IFS Simulator] Page version:', pageVersion);

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

    const innerCritic = cloudManager.addCloud('Inner Critic', {
        trust: 0.3,
        partAge: 8,
        dialogues: {
            burdenedJobAppraisal: [
                "I'm exhausted with my job.",
                "I don't want to criticize, but I have to.",
            ],
            burdenedJobImpact: [
                "I am harsh, but I help avoid critiques from outside.",
            ],
            unburdenedJob: "I help you foresee risks.",
        },
    });

    const criticized = cloudManager.addCloud('criticized', {
        partAge: 'child',
        trust: 0.2,
        dialogues: {
            genericBlendedDialogues: [
                "Please don't look at me.",
                "I'm trying to hide.",
                "Is it safe?",
            ],
        },
    });
    const threeYearOld = cloudManager.addCloud('toddler', {
        partAge: 3,
        dialogues: {
            genericBlendedDialogues: [
                "Play with me!",
                "I want attention!",
                "Why?",
            ],
        },
    });
    const tenYearOld = cloudManager.addCloud('child', {
        partAge: 10,
        dialogues: {
            genericBlendedDialogues: [
                "That's not fair.",
                "I can do it myself!",
                "Nobody understands.",
            ],
        },
    });
    const teenager = cloudManager.addCloud('teenager', {
        partAge: 14,
        dialogues: {
            genericBlendedDialogues: [
                "Whatever.",
                "You wouldn't understand.",
                "Leave me alone.",
            ],
        },
    });
    const adult = cloudManager.addCloud('self-image', {
        partAge: 'adult',
        dialogues: {
            genericBlendedDialogues: [
                "I need to maintain appearances.",
                "What will people think?",
                "I should have it together by now.",
            ],
        },
    });

    const relationships = cloudManager.getRelationships();
    relationships.addProtection(innerCritic.id, criticized.id);
    relationships.setGrievance(innerCritic.id, [threeYearOld.id, tenYearOld.id, teenager.id], [
        "You got us criticized.",
        "You always make mistakes.",
        "Don't do anything risky.",
        "Be careful or you'll embarrass yourself.",
    ]);
    relationships.setGrievance(innerCritic.id, [innerCritic.id], [
        "I'm a terrible person.",
        "I hate myself."
    ]);

    relationships.addProxy(innerCritic.id, adult.id);
    relationships.addProxy(criticized.id, adult.id);
    relationships.addProxy(threeYearOld.id, adult.id);
    relationships.addProxy(tenYearOld.id, adult.id);

    cloudManager.applyAssessedNeedAttention();

    cloudManager.startAnimation();
    cloudManager.setCarpetDebug(false);

    setupRecordingShortcuts(cloudManager);
});
