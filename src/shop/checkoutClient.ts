export interface CheckoutLineItem {
    variantId: string; // Shopify GID, used by shopifyClient.ts
    productKey?: string; // backend-agnostic key, used by stripeClient.ts
    quantity: number;
}

export interface CheckoutClient {
    fetchVariantPrices(variantIds: string[]): Promise<Map<string, number>>;
    createCheckout(lineItems: CheckoutLineItem[], country: string): Promise<string>;
}
