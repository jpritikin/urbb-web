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

interface Bookstore {
    name: string;
    city: string;
    address: string;
    url?: string;
}

async function loadBookstores(): Promise<Bookstore[]> {
    const res = await fetch('/data/bookstores.yaml');
    const text = await res.text();
    // Minimal YAML parser for a flat list of simple string-valued objects
    const stores: Bookstore[] = [];
    let current: Partial<Bookstore> | null = null;
    for (const raw of text.split('\n')) {
        const line = raw.trimEnd();
        if (line.startsWith('- ')) {
            if (current) stores.push(current as Bookstore);
            current = {};
            const rest = line.slice(2);
            const colon = rest.indexOf(':');
            if (colon !== -1) (current as Record<string,string>)[rest.slice(0,colon).trim()] = rest.slice(colon+1).trim();
        } else if (current && line.match(/^\s+\w/)) {
            const colon = line.indexOf(':');
            if (colon !== -1) (current as Record<string,string>)[line.slice(0,colon).trim()] = line.slice(colon+1).trim();
        }
    }
    if (current) stores.push(current as Bookstore);
    return stores;
}

function renderBookstores(stores: Bookstore[], list: HTMLUListElement): void {
    list.innerHTML = stores.map(s => {
        const link = s.url
            ? `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`
            : s.name;
        return `<li><strong>${link}</strong><br><small>${s.address}</small></li>`;
    }).join('');
}

function initPaperbackLocalModal(): void {
    const modal = document.getElementById('paperback-local-modal');
    const paperbackBtn = document.querySelector<HTMLButtonElement>('.paperback-order-btn');
    if (!modal || !paperbackBtn) return;

    const questionView = modal.querySelector<HTMLElement>('.local-question-view')!;
    const storesView = modal.querySelector<HTMLElement>('.local-stores-view')!;
    const list = modal.querySelector<HTMLUListElement>('.bookstore-list')!;

    const SESSION_KEY = 'paperback-local-asked';
    let storesLoaded = false;

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
        if (!storesLoaded) {
            const stores = await loadBookstores();
            renderBookstores(stores, list);
            storesLoaded = true;
        }
        questionView.hidden = true;
        storesView.hidden = false;
    };

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
        questionView.hidden = false;
        storesView.hidden = true;
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
});
