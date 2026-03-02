declare global {
    interface Window {
        __SHOPIFY_DOMAIN__: string;
        __SHOPIFY_STOREFRONT_TOKEN__: string;
    }
}
export {};
