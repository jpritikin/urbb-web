import { initAddToCartButtons } from '../shop/addToCart.js';
import { initGoodreadsScrolls } from './goodreadsScrolls.js';
import { initPublisherTeasers } from './publisherTeasers.js';

interface Blurb {
    full: string;
    preview: string;
    name: string;
    role: string;
    works: string[];
    aprilFools?: boolean;
}

function formatAttr(blurb: Blurb): string {
    if (!blurb.role && blurb.works.length === 0) return blurb.name;
    if (!blurb.role && blurb.works.length === 1) return `${blurb.name}, ${blurb.works[0]}`;
    if (!blurb.role) return blurb.name;
    return `${blurb.name}, ${blurb.role} ${blurb.works.join(' and ')}`;
}

function formatAttrHTML(blurb: Blurb): string {
    const worksHTML = blurb.works.map(w => `<em>${w}</em>`).join(' and ');
    if (!blurb.role && blurb.works.length === 0) return `— <strong>${blurb.name}</strong>`;
    if (!blurb.role && blurb.works.length === 1) return `— <strong>${blurb.name}</strong>, ${worksHTML}`;
    if (!blurb.role) return `— <strong>${blurb.name}</strong>, ${worksHTML}`;
    return `— <strong>${blurb.name}</strong>, ${blurb.role} ${worksHTML}`;
}

function renderBlurbs(blurbs: Blurb[]): void {
    const grid = document.getElementById('blurbs-grid');
    if (!grid) return;

    grid.innerHTML = blurbs.map(b => `
        <div class="blurb-tile" data-full="${b.full.replace(/"/g, '&quot;')}" data-attr="${formatAttr(b).replace(/"/g, '&quot;')}">
            <p class="blurb-preview">${b.preview}</p>
            <p class="blurb-attr">${formatAttrHTML(b)}</p>
        </div>
    `).join('');

    document.querySelectorAll('.blurb-tile').forEach(tile => {
        tile.addEventListener('click', () => openModal(tile as HTMLElement));
    });
}

function openModal(tile: HTMLElement): void {
    const modal = document.getElementById('blurb-modal')!;
    const textEl = modal.querySelector('.blurb-modal-text')!;
    const paragraphs = (tile.dataset.full ?? '').split('\n\n');
    textEl.innerHTML = paragraphs.map(p => `<p>${p}</p>`).join('');
    modal.querySelector('.blurb-modal-attr')!.textContent = '— ' + (tile.dataset.attr ?? '');
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('is-open');
}

function closeModal(): void {
    const modal = document.getElementById('blurb-modal')!;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('is-open');
}

function initModal(): void {
    const modal = document.getElementById('blurb-modal');
    if (!modal) return;
    modal.querySelector('.blurb-modal-close')!.addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

function isAprilFools(): boolean {
    const now = new Date();
    return now.getMonth() === 3 && now.getDate() === 1;
}

async function initBlurbs(): Promise<void> {
    const response = await fetch('/data/blurbs.json');
    const blurbs: Blurb[] = await response.json();
    const showAprilFools = isAprilFools() || Math.random() < 0.5;
    renderBlurbs(blurbs.filter(b => !b.aprilFools || showAprilFools));
}


function initHardcoverInfoModal(): void {
    const modal = document.getElementById('hardcover-info-modal');
    const infoBtn = document.querySelector<HTMLButtonElement>('.hardcover-info-btn');
    const addToCartBtn = document.querySelector<HTMLButtonElement>(
        '[data-variant-id="gid://shopify/ProductVariant/48590233764083"]'
    );
    if (!modal || !infoBtn) return;

    let seen = false;

    const open = (thenAddToCart = false) => {
        modal.setAttribute('aria-hidden', 'false');
        modal.classList.add('is-open');
        if (thenAddToCart) modal.dataset.pendingAddToCart = '1';
        else delete modal.dataset.pendingAddToCart;
    };

    const close = () => {
        modal.setAttribute('aria-hidden', 'true');
        modal.classList.remove('is-open');
        seen = true;
        if (modal.dataset.pendingAddToCart) {
            delete modal.dataset.pendingAddToCart;
            addToCartBtn?.click();
        }
    };

    infoBtn.addEventListener('click', () => open(false));
    modal.querySelector('.blurb-modal-close')!.addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', e => {
            if (!seen) {
                e.stopImmediatePropagation();
                open(true);
            }
        }, true);
    }
}

interface MapPin {
    name: string;
    address: string;
    region: string;
    x: number;
    y: number;
}

interface MapRegion {
    id: string;
    label: string;
    image: string;
    width: number;
    height: number;
}

interface MapData {
    regions: MapRegion[];
    pins: MapPin[];
}

async function loadMapData(): Promise<MapData> {
    const res = await fetch('/data/bookstores-map.json');
    return res.json();
}

interface RegionPickerState {
    showPicker: () => void;
    isShowingMap: () => boolean;
}

function renderRegionPicker(mapData: MapData, container: HTMLElement, infoCard: HTMLElement): RegionPickerState {
    const pickerEl = container.querySelector<HTMLElement>('.region-picker')!;
    const mapImg = container.querySelector<HTMLImageElement>('.bookstore-map-img')!;
    const pinsEl = container.querySelector<HTMLElement>('.bookstore-pins')!;
    let showingMap = false;

    pickerEl.innerHTML = '';
    for (const region of mapData.regions) {
        const btn = document.createElement('button');
        btn.className = 'order-button region-btn';
        btn.textContent = region.label;
        btn.addEventListener('click', () => showRegion(region));
        pickerEl.appendChild(btn);
    }

    const showPicker = () => {
        pickerEl.hidden = false;
        mapImg.hidden = true;
        pinsEl.hidden = true;
        infoCard.hidden = true;
        showingMap = false;
    };

    const showRegion = (region: MapRegion) => {
        pickerEl.hidden = true;
        mapImg.src = region.image;
        mapImg.hidden = false;
        pinsEl.hidden = false;
        infoCard.hidden = true;
        showingMap = true;
        renderMapPins(mapData, region, container, infoCard);
    };

    showPicker();
    return { showPicker, isShowingMap: () => showingMap };
}

function renderMapPins(mapData: MapData, region: MapRegion, container: HTMLElement, infoCard: HTMLElement): void {
    const pinsEl = container.querySelector<HTMLElement>('.bookstore-pins')!;
    pinsEl.innerHTML = '';

    for (const pin of mapData.pins.filter(p => p.region === region.id)) {
        const el = document.createElement('button');
        el.className = 'map-pin';
        el.setAttribute('aria-label', pin.name);
        el.style.left = `${(pin.x / region.width) * 100}%`;
        el.style.top = `${(pin.y / region.height) * 100}%`;
        el.addEventListener('click', () => {
            pinsEl.querySelectorAll('.map-pin').forEach(p => p.classList.remove('active'));
            el.classList.add('active');
            const query = encodeURIComponent(pin.name + ', ' + pin.address);
            infoCard.innerHTML = `<strong>${pin.name}</strong><br>` +
                `<small>${pin.address}</small><br>` +
                `<a href="https://www.google.com/maps/search/?api=1&query=${query}" ` +
                `target="_blank" rel="noopener" class="map-directions-link">📍 Directions</a>`;
            infoCard.hidden = false;
        });
        pinsEl.appendChild(el);
    }
}

function initPaperbackLocalModal(): void {
    const modal = document.getElementById('paperback-local-modal');
    const paperbackBtn = document.querySelector<HTMLButtonElement>('.paperback-order-btn');
    if (!modal || !paperbackBtn) return;

    const questionView = modal.querySelector<HTMLElement>('.local-question-view')!;
    const storesView = modal.querySelector<HTMLElement>('.local-stores-view')!;
    const mapContainer = modal.querySelector<HTMLElement>('.bookstore-map-container')!;
    const infoCard = modal.querySelector<HTMLElement>('.bookstore-info-card')!;

    const SESSION_KEY = 'paperback-local-asked';
    let regionState: RegionPickerState | null = null;

    const open = () => {
        questionView.hidden = false;
        storesView.hidden = true;
        modal.setAttribute('aria-hidden', 'false');
        modal.classList.add('is-open');
    };

    const close = () => {
        modal.setAttribute('aria-hidden', 'true');
        modal.classList.remove('is-open');
    };

    const showStores = async () => {
        if (!regionState) {
            const mapData = await loadMapData();
            regionState = renderRegionPicker(mapData, mapContainer, infoCard);
        }
        regionState.showPicker();
        questionView.hidden = true;
        storesView.hidden = false;
    };

    const localLink = document.querySelector<HTMLButtonElement>('.local-stores-link');
    localLink?.addEventListener('click', () => {
        modal.setAttribute('aria-hidden', 'false');
        modal.classList.add('is-open');
        showStores();
    });

    paperbackBtn.addEventListener('click', e => {
        if (sessionStorage.getItem(SESSION_KEY)) return;
        e.stopImmediatePropagation();
        open();
    }, true);

    modal.querySelector('.local-yes-btn')!.addEventListener('click', () => showStores());
    modal.querySelector('.local-no-btn')!.addEventListener('click', () => {
        sessionStorage.setItem(SESSION_KEY, '1');
        close();
        paperbackBtn.click();
    });
    modal.querySelector('.local-back-btn')!.addEventListener('click', () => {
        if (regionState?.isShowingMap()) {
            regionState.showPicker();
        } else {
            questionView.hidden = false;
            storesView.hidden = true;
        }
    });
    modal.querySelector('.blurb-modal-close')!.addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

document.addEventListener('DOMContentLoaded', () => {
    initAddToCartButtons();
    initModal();
    initBlurbs();
    initHardcoverInfoModal();
    initPaperbackLocalModal();
    const scrollAnchor = document.getElementById('goodreads-scrolls-anchor');
    if (scrollAnchor) initGoodreadsScrolls(scrollAnchor);
    const teaserAnchor = document.getElementById('publisher-teasers-anchor');
    if (teaserAnchor) initPublisherTeasers(teaserAnchor);
});
