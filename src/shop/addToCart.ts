import { addItem } from './cart.js';
import { openCart, initCartDrawer, syncBadge } from './cartDrawer.js';
import { getCart } from './cart.js';
import { fetchVariantPrices } from './shopifyClient.js';

export async function initAddToCartButtons() {
    initCartDrawer();
    syncBadge(getCart());

    const btns = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-variant-id]'));
    const ids = btns.map(btn => btn.dataset.variantId!);
    const setPriceEl = (btn: HTMLButtonElement, text: string) => {
        const priceEl = btn.closest('p')?.previousElementSibling ?? btn.previousElementSibling;
        if (priceEl?.classList.contains('shop-item-price')) {
            priceEl.textContent = text;
        }
    };

    try {
        const prices = await fetchVariantPrices(ids);
        btns.forEach(btn => {
            const price = prices.get(btn.dataset.variantId!);
            if (price === undefined) return;
            btn.dataset.price = String(price);
            setPriceEl(btn, `$${price.toFixed(2)}`);
        });
    } catch (e) {
        console.warn('[shop] Could not fetch prices from Shopify:', e);
        btns.forEach(btn => {
            btn.dataset.price = 'NaN';
            setPriceEl(btn, 'Price unavailable');
            btn.disabled = true;
        });
    }

    btns.forEach(btn => {
        if (btn.dataset.shopifyBound) return;
        btn.dataset.shopifyBound = '1';

        btn.addEventListener('click', () => {
            const variantId = btn.dataset.variantId!;
            const title = btn.dataset.title ?? 'Item';
            const price = parseFloat(btn.dataset.price ?? '0');

            const originalText = btn.textContent;
            btn.textContent = 'Added! ✨';
            btn.disabled = true;
            setTimeout(() => {
                btn.textContent = originalText;
                btn.disabled = false;
            }, 1200);

            addItem({ variantId, title, price, quantity: 1 });
            openCart();
        });
    });
}
