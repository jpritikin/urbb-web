import { addItem, clearCart } from './cart.js';
import { openCart, initCartDrawer, syncBadge } from './cartDrawer.js';
import { getCart } from './cart.js';
import { fetchVariantPrices } from './activeClient.js';

export async function initAddToCartButtons() {
    initCartDrawer();

    if (new URLSearchParams(window.location.search).get('checkout') === 'success') {
        clearCart();
        const url = new URL(window.location.href);
        url.searchParams.delete('checkout');
        window.history.replaceState({}, '', url);
    }

    syncBadge(getCart());

    const btns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-variant-id]'));
    // priceKey is backend-specific: the Shopify GID in shopify mode, or the
    // app-level product key (+variant) in stripe mode. See activeClient.ts.
    const priceKey = (btn: HTMLButtonElement): string => {
        if (window.__CHECKOUT_BACKEND__ !== 'stripe') return btn.dataset.variantId!;
        const productKey = btn.dataset.productKey;
        if (!productKey) return btn.dataset.variantId!;
        return btn.dataset.variant ? `${productKey}:${btn.dataset.variant}` : productKey;
    };
    const ids = btns.map(priceKey);
    const setPriceEl = (btn: HTMLButtonElement, text: string) => {
        const priceEl = btn.closest('p')?.previousElementSibling ?? btn.previousElementSibling;
        if (priceEl?.classList.contains('shop-item-price')) {
            priceEl.textContent = text;
        }
    };

    try {
        const prices = await fetchVariantPrices(ids);
        btns.forEach(btn => {
            const price = prices.get(priceKey(btn));
            if (price === undefined) return;
            btn.dataset.price = String(price);
            setPriceEl(btn, `$${price.toFixed(2)}`);
        });
    } catch (e) {
        console.warn('[shop] Could not fetch prices:', e);
        btns.forEach(btn => {
            btn.dataset.price = 'NaN';
            setPriceEl(btn, 'Price unavailable');
            btn.disabled = true;
        });
    }

    btns.forEach(btn => {
        if (btn.dataset.cartBound) return;
        btn.dataset.cartBound = '1';

        btn.addEventListener('click', () => {
            const variantId = btn.dataset.variantId!;
            const productKey = btn.dataset.productKey;
            const title = btn.dataset.title ?? 'Item';
            const price = parseFloat(btn.dataset.price ?? '0');

            const originalText = btn.textContent;
            btn.textContent = 'Added! ✨';
            btn.disabled = true;
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 1200);

            addItem({
                variantId,
                productKey: btn.dataset.variant ? `${productKey}:${btn.dataset.variant}` : productKey,
                title,
                price,
                quantity: 1,
            });
            openCart();
        });
    });
}
