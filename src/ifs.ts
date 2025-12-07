import { CloudManager, CloudType } from './cloudAnimation.js';

const VERSION = '2.0.0';

document.addEventListener('DOMContentLoaded', () => {
    console.log(`IFS Simulator Version: ${VERSION}`);
    const cloudContainer = document.getElementById('cloud-container');
    if (!cloudContainer) return;

    const cloudManager = new CloudManager();
    cloudManager.init('cloud-container');

    cloudManager.addCloud('Inner Critic', {
        id: 'inner_critic',
        trust: 0.3,
        needAttention: 0.15,
        agreedWaitDuration: 20
    });

    cloudManager.addCloud('3 year old');
    cloudManager.addCloud('ten year old');
    cloudManager.addCloud('teenager');
    cloudManager.addCloud('adult');

    cloudManager.startAnimation();
});
