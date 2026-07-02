import type { CheckoutLineItem } from './checkoutClient.js';

export async function fetchVariantPrices(variantIds: string[]): Promise<Map<string, number>> {
    const res = await fetch('/api/prices');
    if (!res.ok) throw new Error(`Prices API error: ${res.status}`);
    const { prices } = await res.json() as { prices: Record<string, number | null> };

    const map = new Map<string, number>();
    for (const id of variantIds) {
        const price = prices[id];
        if (price != null) map.set(id, price);
    }
    return map;
}

export async function createCheckout(lineItems: CheckoutLineItem[], country: string): Promise<string> {
    const items = lineItems.map(({ productKey, quantity }) => {
        const [key, variant] = (productKey ?? '').split(':');
        return variant ? { productKey: key, variant, quantity } : { productKey: key, quantity };
    });

    const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, country }),
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(data.message ?? `Checkout API error: ${res.status}`);
    }

    const { url } = await res.json() as { url: string };
    return url;
}
