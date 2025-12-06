import { CloudManager, CloudType } from './cloudAnimation.js';

const VERSION = '1.0.0';

document.addEventListener('DOMContentLoaded', () => {
  console.log(`IFS Page Version: ${VERSION}`);
  const cloudContainer = document.getElementById('cloud-container');
  if (!cloudContainer) return;

  const cloudManager = new CloudManager();
  cloudManager.init('cloud-container');

  const addButton = document.getElementById('cloud-add');
  const clearButton = document.getElementById('cloud-clear');
  const debugCheckbox = document.getElementById('cloud-debug') as HTMLInputElement;
  const wordInput = document.getElementById('cloud-word') as HTMLInputElement;
  const cloudTypeSelect = document.getElementById('cloud-type') as HTMLSelectElement;
  const zoomSlider = document.getElementById('cloud-zoom') as HTMLInputElement;

  if (addButton) {
    addButton.addEventListener('click', () => {
      const word = wordInput?.value || 'cloud';
      const cloudType = cloudTypeSelect?.value === 'cumulus' ? CloudType.CUMULUS : CloudType.STRATOCUMULUS;
      cloudManager.addCloud(word, undefined, undefined, cloudType);
    });
  }

  if (clearButton) {
    clearButton.addEventListener('click', () => {
      cloudManager.clear();
    });
  }

  if (debugCheckbox) {
    debugCheckbox.addEventListener('change', () => {
      cloudManager.setDebug(debugCheckbox.checked);
    });
  }

  if (zoomSlider) {
    const zoomValueSpan = document.getElementById('zoom-value');
    zoomSlider.addEventListener('input', () => {
      const zoomValue = parseFloat(zoomSlider.value);
      cloudManager.setZoom(zoomValue);
      if (zoomValueSpan) {
        zoomValueSpan.textContent = `${zoomValue.toFixed(1)}x`;
      }
    });
  }

  cloudManager.addCloud('parts', 50, 300, CloudType.STRATOCUMULUS);
  cloudManager.addCloud('protector', 250, 280, CloudType.CUMULUS);
  cloudManager.addCloud('exile', 450, 320, CloudType.CUMULUS);

  cloudManager.startAnimation();
});
