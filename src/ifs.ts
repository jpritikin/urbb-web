import { CloudManager } from './cloudAnimation.js';

document.addEventListener('DOMContentLoaded', () => {
    const pageVersion = document.querySelector('meta[name="page-version"]')?.getAttribute('content') || 'unknown';
    console.log('[IFS Simulator] Page version:', pageVersion);

    const cloudContainer = document.getElementById('cloud-container');
    if (!cloudContainer) return;

    const cloudManager = new CloudManager();
    (window as any).cloudManager = cloudManager;
    console.log('[Debug] cloudManager.setCarpetDebug(true) to show wind field');
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

    const criticized = cloudManager.addCloud('criticized', { partAge: 'child', trust: 0.2 });
    const threeYearOld = cloudManager.addCloud('toddler', { partAge: 3 });
    const tenYearOld = cloudManager.addCloud('child', { partAge: 10 });
    const teenager = cloudManager.addCloud('teenager', { partAge: 14 });
    const adult = cloudManager.addCloud('self-image', { partAge: 'adult' });

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
    relationships.addProxy(teenager.id, adult.id);
    relationships.addProxy(adult.id, adult.id);

    cloudManager.applyAssessedNeedAttention();

    cloudManager.startAnimation();
    cloudManager.setCarpetDebug(false);
});
