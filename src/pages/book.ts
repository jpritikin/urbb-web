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
    if (!blurb.role && blurb.works.length === 1) return `${blurb.name}, ${blurb.works[0]}`;
    if (!blurb.role) return blurb.name;
    return `${blurb.name}, ${blurb.role} ${blurb.works.join(' and ')}`;
}

function formatAttrHTML(blurb: Blurb): string {
    const worksHTML = blurb.works.map(w => `<em>${w}</em>`).join(' and ');
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

document.addEventListener('DOMContentLoaded', () => {
    initAddToCartButtons();
    initModal();
    initBlurbs();
});
