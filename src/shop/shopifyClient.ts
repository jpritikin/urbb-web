const GRAPHQL_URL = `https://${window.__SHOPIFY_DOMAIN__}/api/2024-01/graphql.json`;
const TOKEN = window.__SHOPIFY_STOREFRONT_TOKEN__;

async function query(q: string, variables?: Record<string, unknown>) {
    const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Storefront-Access-Token': TOKEN,
        },
        body: JSON.stringify({ query: q, variables }),
    });
    if (!res.ok) throw new Error(`Shopify API error: ${res.status}`);
    return res.json();
}

export async function fetchVariantPrices(variantIds: string[]): Promise<Map<string, number>> {
    const data = await query(`
        query getVariants($ids: [ID!]!) {
            nodes(ids: $ids) {
                ... on ProductVariant {
                    id
                    price { amount }
                }
            }
        }
    `, { ids: variantIds });
    const map = new Map<string, number>();
    for (const node of data.data?.nodes ?? []) {
        if (node?.id && node?.price?.amount) {
            map.set(node.id, parseFloat(node.price.amount));
        }
    }
    return map;
}

export interface CheckoutLineItem {
    variantId: string;
    quantity: number;
}

export async function createCheckout(lineItems: CheckoutLineItem[]): Promise<string> {
    const data = await query(`
        mutation cartCreate($input: CartInput!) {
            cartCreate(input: $input) {
                cart { checkoutUrl }
                userErrors { field message }
            }
        }
    `, {
        input: {
            lines: lineItems.map(({ variantId, quantity }) => ({
                merchandiseId: variantId,
                quantity,
            })),
        },
    });
    const errors = data.data?.cartCreate?.userErrors;
    if (errors?.length) throw new Error(errors[0].message);
    return data.data.cartCreate.cart.checkoutUrl;
}
