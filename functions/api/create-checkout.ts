import { PRODUCTS, Fulfillment, resolveStripeProductId } from '../config/products';
import { shippingCentsFor } from '../config/shippingRates';

interface Env {
  STRIPE_SECRET_KEY: string;
  STRIPE_SECRET_KEY_TEST: string;
  ENVIRONMENT?: string;
}

interface CartLineItem {
  productKey: string;
  variant?: string;
  quantity: number;
}

interface CheckoutRequest {
  items: CartLineItem[];
  country: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function stripeProductIdFor(productKey: string, variant: string | undefined, environment: string | undefined): string | null {
  const product = PRODUCTS[productKey];
  if (!product) return null;
  const ids = variant ? product.variants?.[variant]?.stripeProductId : product.stripeProductId;
  if (!ids) return null;
  return resolveStripeProductId(ids, environment) || null;
}

async function fetchDefaultPrice(stripeProductId: string, secretKey: string): Promise<string> {
  const res = await fetch(
    `https://api.stripe.com/v1/products/${stripeProductId}`,
    { headers: { Authorization: `Bearer ${secretKey}` } }
  );
  if (!res.ok) throw new Error(`Stripe API error ${res.status} for ${stripeProductId}`);
  const data: { default_price: string | null } = await res.json();
  if (!data.default_price) throw new Error(`No default price for ${stripeProductId}`);
  return data.default_price;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  let body: CheckoutRequest;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body', 400);
  }

  if (!body.items?.length || !body.country) {
    return jsonError('Missing items or country', 400);
  }

  const fulfillments = new Set<Fulfillment>();
  for (const item of body.items) {
    const product = PRODUCTS[item.productKey];
    if (!product) return jsonError(`Unknown product: ${item.productKey}`, 400);
    fulfillments.add(product.fulfillment);
  }

  let shippingCents = 0;
  for (const fulfillment of fulfillments) {
    const cents = shippingCentsFor(fulfillment, body.country);
    if (cents === null) {
      return jsonError("Sorry, we can't ship this order to your country.", 422);
    }
    shippingCents += cents;
  }

  const secretKey = env.ENVIRONMENT === 'production' ? env.STRIPE_SECRET_KEY : env.STRIPE_SECRET_KEY_TEST;

  const lineItems = await Promise.all(
    body.items.map(async (item) => {
      const stripeProductId = stripeProductIdFor(item.productKey, item.variant, env.ENVIRONMENT);
      if (!stripeProductId) throw new Error(`No Stripe product for ${item.productKey}/${item.variant ?? ''}`);
      const price = await fetchDefaultPrice(stripeProductId, secretKey);
      return { price, quantity: item.quantity };
    })
  );

  const origin = new URL(request.url).origin;

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${origin}/shop/?checkout=success`);
  params.set('cancel_url', `${origin}/shop/`);
  lineItems.forEach((li, i) => {
    params.set(`line_items[${i}][price]`, li.price);
    params.set(`line_items[${i}][quantity]`, String(li.quantity));
  });
  params.set('shipping_address_collection[allowed_countries][0]', body.country);
  params.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
  params.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(shippingCents));
  params.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'usd');
  params.set('shipping_options[0][shipping_rate_data][display_name]', 'Shipping');

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!res.ok) {
    const error = await res.text();
    console.error('Stripe checkout session error:', error);
    return jsonError('Could not create checkout session', 500);
  }

  const session: { url: string } = await res.json();
  return new Response(JSON.stringify({ url: session.url }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
};
