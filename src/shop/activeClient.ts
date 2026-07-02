import * as shopify from './shopifyClient.js';
import * as stripe from './stripeClient.js';

const client = window.__CHECKOUT_BACKEND__ === 'shopify' ? shopify : stripe;

export const fetchVariantPrices = client.fetchVariantPrices;
export const createCheckout = client.createCheckout;
