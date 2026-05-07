import { initAddToCartButtons } from '../shop/addToCart.js';

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

    const markSeen = () => {
        if (seen) return;
        seen = true;
        infoBtn.textContent = '☑️ Print run info';
    };

    const open = (thenAddToCart = false) => {
        modal.setAttribute('aria-hidden', 'false');
        modal.classList.add('is-open');
        if (thenAddToCart) modal.dataset.pendingAddToCart = '1';
        else delete modal.dataset.pendingAddToCart;
    };

    const close = () => {
        modal.setAttribute('aria-hidden', 'true');
        modal.classList.remove('is-open');
        markSeen();
        if (modal.dataset.pendingAddToCart) {
            delete modal.dataset.pendingAddToCart;
            addToCartBtn?.click();
        }
    };

    infoBtn.textContent = '☐ Print run info';
    infoBtn.addEventListener('click', () => open(false));
    modal.querySelector('.blurb-modal-close')!.addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });

    if (addToCartBtn) {
        addToCartBtn.addEventListener('click', e => {
            if (!seen) {
                e.stopImmediatePropagation();
                open(true);
            }
        }, true); // capturing phase — runs before addToCart.ts bubble listener
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initAddToCartButtons();
    initModal();
    initBlurbs();
    initHardcoverInfoModal();
});
