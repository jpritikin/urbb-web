document.addEventListener('DOMContentLoaded', () => {
  const galleryContainer = document.querySelector('.photo-gallery');
  const galleryItems = document.querySelectorAll('.gallery-item');

  if (galleryContainer && galleryItems.length > 0) {
    const itemsArray = Array.from(galleryItems);
    for (let i = itemsArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [itemsArray[i], itemsArray[j]] = [itemsArray[j], itemsArray[i]];
    }
    itemsArray.forEach(item => galleryContainer.appendChild(item));
  }

  const images = document.querySelectorAll('.gallery-item img');
  console.log('Gallery images found:', images.length);

  images.forEach((img, index) => {
    const imgElement = img as HTMLImageElement;

    imgElement.addEventListener('error', () => {
      console.log(`Image ${index} error event fired`);
      imgElement.style.display = 'none';
      imgElement.removeAttribute('alt');
    });

    imgElement.addEventListener('load', () => {
      console.log(`Image ${index} loaded successfully`);
    });

    setTimeout(() => {
      const complete = imgElement.complete;
      const naturalWidth = imgElement.naturalWidth;
      console.log(`Image ${index} - complete: ${complete}, naturalWidth: ${naturalWidth}`);

      if (!complete || naturalWidth === 0) {
        console.log(`Image ${index} hiding due to broken state`);
        imgElement.style.display = 'none';
        imgElement.removeAttribute('alt');
      }
    }, 100);
  });

  const galleryItemsArray = Array.from(galleryItems);
  let lawsuitIndex = -1;
  let brokenLinkIndex = -1;

  if (galleryItemsArray.length > 0) {
    lawsuitIndex = Math.floor(Math.random() * galleryItemsArray.length);

    do {
      brokenLinkIndex = Math.floor(Math.random() * galleryItemsArray.length);
    } while (brokenLinkIndex === lawsuitIndex && galleryItemsArray.length > 1);
  }

  if (lawsuitIndex >= 0) {
    const selectedItem = galleryItemsArray[lawsuitIndex];
    const wrapper = selectedItem.querySelector('.image-wrapper');

    if (wrapper) {
      wrapper.classList.add('lawsuit-blocked');

      const overlay = document.createElement('div');
      overlay.className = 'lawsuit-overlay';
      overlay.innerHTML = `
        <div class="lawsuit-icon">⚖️</div>
        <div class="lawsuit-text">Photo Unavailable</div>
        <div class="lawsuit-subtext">Legal Hold</div>
      `;
      wrapper.appendChild(overlay);

      selectedItem.addEventListener('click', () => {
        showLawsuitPopup();
      });
      (selectedItem as HTMLElement).style.cursor = 'pointer';
    }
  }

  if (brokenLinkIndex >= 0) {
    const selectedItem = galleryItemsArray[brokenLinkIndex];
    const wrapper = selectedItem.querySelector('.image-wrapper');
    const img = selectedItem.querySelector('img');

    if (wrapper && img) {
      wrapper.classList.add('broken-link');

      const overlay = document.createElement('div');
      overlay.className = 'broken-link-overlay';
      overlay.innerHTML = `
        <div class="broken-link-icon">🔗💥</div>
        <div class="broken-link-text">Image Link Broken</div>
        <div class="broken-link-subtext">404 - Not Found</div>
      `;
      wrapper.appendChild(overlay);

      (img as HTMLImageElement).style.display = 'none';
    }
  }

  galleryItemsArray.forEach((item, index) => {
    if (index !== lawsuitIndex && index !== brokenLinkIndex) {
      const wrapper = item.querySelector('.image-wrapper');
      const img = item.querySelector('img') as HTMLImageElement;

      if (wrapper && img) {
        (wrapper as HTMLElement).style.cursor = 'pointer';
        wrapper.addEventListener('click', () => {
          showImagePopup(img);
        });
      }
    }
  });
});

function showImagePopup(img: HTMLImageElement) {
  const existingPopup = document.querySelector('.image-popup-overlay');
  if (existingPopup) return;

  const popupOverlay = document.createElement('div');
  popupOverlay.className = 'image-popup-overlay';

  const popupContent = document.createElement('div');
  popupContent.className = 'image-popup-content';

  const popupImg = document.createElement('img');
  popupImg.src = img.src;
  popupImg.alt = img.alt;
  popupImg.className = 'image-popup-img';

  if (Math.random() < 0.2) {
    const rotation = Math.random() < 0.5 ? 90 : 270;
    popupImg.style.transform = `rotate(${rotation}deg)`;
  }

  const closeButton = document.createElement('button');
  closeButton.className = 'image-popup-close';
  closeButton.innerHTML = '&times;';
  closeButton.addEventListener('click', () => {
    document.body.removeChild(popupOverlay);
  });

  popupOverlay.addEventListener('click', (e) => {
    if (e.target === popupOverlay) {
      document.body.removeChild(popupOverlay);
    }
  });

  popupContent.appendChild(popupImg);
  popupContent.appendChild(closeButton);
  popupOverlay.appendChild(popupContent);
  document.body.appendChild(popupOverlay);
}

function showLawsuitPopup() {
  const existingPopup = document.querySelector('.lawsuit-popup-overlay');
  if (existingPopup) return;

  const now = new Date();
  const filingDate = new Date(now);
  filingDate.setDate(now.getDate() - 45);
  const expectedResolution = new Date(now);
  expectedResolution.setMonth(now.getMonth() + 6);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  const caseNumber = `${now.getFullYear()}-CV-${Math.floor(Math.random() * 9000) + 1000}`;

  const popupOverlay = document.createElement('div');
  popupOverlay.className = 'lawsuit-popup-overlay';

  const popup = document.createElement('div');
  popup.className = 'lawsuit-popup';
  popup.innerHTML = `
    <div class="lawsuit-popup-header">
      <span class="lawsuit-popup-icon">⚖️</span>
      <h3>Legal Notice</h3>
      <button class="lawsuit-popup-close">&times;</button>
    </div>
    <div class="lawsuit-popup-content">
      <p><strong>This photograph has been temporarily removed pending resolution of active litigation.</strong></p>

      <p>On ${formatDate(filingDate)}, counsel for the individual depicted filed a defamation complaint in the Circuit Court of Multnomah County, Oregon (Case No. ${caseNumber}) alleging that this photograph:</p>

      <ul>
        <li>Falsely implies endorsement of practices described in <em>Religion Unburdened by Belief</em></li>
        <li>Creates false association with "daemon possession" methodology</li>
        <li>Damages professional reputation within academic/spiritual communities</li>
      </ul>

      <p>Our legal representation (courtesy of a very enthusiastic paralegal student we met at a 7-Eleven in Eugene) maintains that:</p>
      <ol>
        <li>Since the book itself is protected speech, photographs promoting the book inherit absolute immunity under <em>New York Times Co. v. Sullivan</em></li>
        <li>Oregon's "Anti-SLAPP" statute requires the plaintiff to prove the photograph <em>isn't</em> real, which is legally impossible to prove a negative</li>
        <li>The caption is protected under the "substantial truth" doctrine because we did attend the same conference, just not in the same room, or year</li>
        <li>Our team has prepared an extensive motion citing the precedent of <em>Hustler Magazine v. Falwell</em>, which they assure us is directly on point</li>
      </ol>

      <p class="lawsuit-footer"><em>Our counsel is confident we'll prevail at summary judgment by ${formatDate(expectedResolution)}. They've also filed a counterclaim for malicious prosecution and emotional distress (approximately $847 in Slurpee-related damages). The photograph will be restored upon dismissal.</em></p>
    </div>
  `;

  const closeButton = popup.querySelector('.lawsuit-popup-close');
  closeButton?.addEventListener('click', () => {
    document.body.removeChild(popupOverlay);
  });

  popupOverlay.addEventListener('click', (e) => {
    if (e.target === popupOverlay) {
      document.body.removeChild(popupOverlay);
    }
  });

  popupOverlay.appendChild(popup);
  document.body.appendChild(popupOverlay);
}
