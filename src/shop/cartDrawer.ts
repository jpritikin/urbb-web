import { getCart, removeItem, updateQuantity, totalItems, totalPrice, onCartChange, CartState } from './cart.js';
import { createCheckout } from './shopifyClient.js';

let drawer: HTMLElement | null = null;
let overlay: HTMLElement | null = null;

function formatPrice(cents: number): string {
    return `$${cents.toFixed(2)}`;
}

function renderItems(state: CartState): string {
    if (state.items.length === 0) {
        return '<p class="cart-empty">Your cart is empty. ✨</p>';
    }
    return state.items.map(item => `
        <div class="cart-item" data-variant-id="${item.variantId}">
            <div class="cart-item-info">
                <span class="cart-item-title">${item.title}</span>
                <span class="cart-item-price">${formatPrice(item.price)}</span>
            </div>
            <div class="cart-item-controls">
                <button class="cart-qty-btn" data-action="dec" data-variant="${item.variantId}">−</button>
                <span class="cart-qty">${item.quantity}</span>
                <button class="cart-qty-btn" data-action="inc" data-variant="${item.variantId}">+</button>
                <button class="cart-remove-btn" data-variant="${item.variantId}">🗑</button>
            </div>
        </div>
    `).join('');
}

function syncDrawer(state: CartState) {
    if (!drawer) return;
    const itemsEl = drawer.querySelector('.cart-items');
    const totalEl = drawer.querySelector('.cart-total-amount');
    const checkoutBtn = drawer.querySelector('.cart-checkout-btn') as HTMLButtonElement | null;
    if (itemsEl) itemsEl.innerHTML = renderItems(state);
    if (totalEl) totalEl.textContent = formatPrice(totalPrice(state));
    if (checkoutBtn) checkoutBtn.disabled = state.items.length === 0;
    syncBadge(state);
    bindItemControls();
}

function bindItemControls() {
    if (!drawer) return;
    drawer.querySelectorAll('.cart-qty-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const variantId = (btn as HTMLElement).dataset.variant!;
            const action = (btn as HTMLElement).dataset.action!;
            const state = getCart();
            const item = state.items.find(i => i.variantId === variantId);
            if (!item) return;
            updateQuantity(variantId, action === 'inc' ? item.quantity + 1 : item.quantity - 1);
        });
    });
    drawer.querySelectorAll('.cart-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            removeItem((btn as HTMLElement).dataset.variant!);
        });
    });
}

export function syncBadge(state: CartState) {
    const count = totalItems(state);
    document.querySelectorAll('.cart-badge').forEach(el => {
        el.textContent = count > 0 ? String(count) : '';
        (el as HTMLElement).style.display = count > 0 ? 'flex' : 'none';
    });
}

export function openCart() {
    if (!drawer) initCartDrawer();
    ensureDrawerInDom();
    syncDrawer(getCart());
    drawer!.classList.add('cart-open');
    overlay!.classList.add('cart-open');
    document.body.style.overflow = 'hidden';
}

function closeCart() {
    drawer?.classList.remove('cart-open');
    overlay?.classList.remove('cart-open');
    document.body.style.overflow = '';
}

export function initCartDrawer() {
    if (drawer) return;

    overlay = document.createElement('div');
    overlay.className = 'cart-overlay';
    overlay.addEventListener('click', closeCart);

    drawer = document.createElement('div');
    drawer.className = 'cart-drawer';
    drawer.innerHTML = `
        <div class="cart-header">
            <h2 class="cart-title">Your Cart 🛒</h2>
            <button class="cart-close-btn" aria-label="Close cart">×</button>
        </div>
        <div class="cart-items"></div>
        <div class="cart-footer">
            <div class="cart-total">
                <span>Total</span>
                <span class="cart-total-amount">$0.00</span>
            </div>
            <button class="cart-checkout-btn" disabled>Checkout →</button>
        </div>
    `;

    drawer.querySelector('.cart-close-btn')!.addEventListener('click', closeCart);

    drawer.querySelector('.cart-checkout-btn')!.addEventListener('click', async () => {
        const state = getCart();
        if (state.items.length === 0) return;
        const btn = drawer!.querySelector('.cart-checkout-btn') as HTMLButtonElement;
        btn.textContent = 'Loading...';
        btn.disabled = true;
        try {
            const url = await createCheckout(state.items.map(i => ({
                variantId: i.variantId,
                quantity: i.quantity,
            })));
            window.location.href = url;
        } catch (e) {
            btn.textContent = 'Error — try again';
            btn.disabled = false;
            setTimeout(() => { btn.textContent = 'Checkout →'; btn.disabled = false; }, 3000);
        }
    });

    onCartChange(state => syncDrawer(state));
    syncBadge(getCart());
}

function ensureDrawerInDom() {
    if (!overlay!.parentNode) {
        document.body.appendChild(overlay!);
        document.body.appendChild(drawer!);
    }
}
