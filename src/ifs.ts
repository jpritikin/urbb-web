import { CloudManager } from './cloudAnimation.js';

document.addEventListener('DOMContentLoaded', () => {
    const pageVersion = document.querySelector('meta[name="page-version"]')?.getAttribute('content') || 'unknown';
    console.log('[IFS Simulator] Page version:', pageVersion);

    const cloudContainer = document.getElementById('cloud-container');
    if (!cloudContainer) return;

    const cloudManager = new CloudManager();
    cloudManager.init('cloud-container');

    const innerCritic = cloudManager.addCloud('Inner Critic', {
        trust: 0.3,
        needAttention: 0.15,
        agreedWaitDuration: 20,
        partAge: 8,
        dialogues: {
            burdenedProtector: [
                "You always make mistakes.",
                "Don't do anything risky.",
                "Be careful or you'll embarrass yourself.",
            ],
            burdenedGrievance: [
                "You got us criticized.",
                "This is why people don't respect us.",
                "You're the reason we feel this way.",
            ],
            unburdenedJob: "I help you foresee risks.",
        },
    });

    const criticized = cloudManager.addCloud('criticized', { partAge: 'child', trust: 0.2 });
    const threeYearOld = cloudManager.addCloud('3 year old', { partAge: 3 });
    const tenYearOld = cloudManager.addCloud('ten year old', { partAge: 10 });
    const teenager = cloudManager.addCloud('teenager', { partAge: 'teenager' });
    const adult = cloudManager.addCloud('adult', { partAge: 'adult' });

    const relationships = cloudManager.getRelationships();
    relationships.addProtection(innerCritic.id, criticized.id);
    relationships.setGrievance(innerCritic.id, threeYearOld.id, 0.6);
    relationships.setGrievance(innerCritic.id, tenYearOld.id, 0.5);
    relationships.setGrievance(innerCritic.id, teenager.id, 0.7);

    cloudManager.startAnimation();
});
