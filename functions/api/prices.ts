import { PRODUCTS, resolveStripeProductId } from '../config/products';

interface Env {
  STRIPE_SECRET_KEY: string;
  STRIPE_SECRET_KEY_TEST: string;
  ENVIRONMENT?: string;
}

interface StripePrice {
  id: string;
  unit_amount: number | null;
  currency: string;
}

interface StripeProduct {
  id: string;
  default_price: StripePrice | null;
}

async function fetchProduct(stripeProductId: string, secretKey: string): Promise<StripeProduct> {
  const res = await fetch(
    `https://api.stripe.com/v1/products/${stripeProductId}?expand[]=default_price`,
    { headers: { Authorization: `Bearer ${secretKey}` } }
  );
  if (!res.ok) throw new Error(`Stripe API error ${res.status} for ${stripeProductId}`);
  return res.json();
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;
  const secretKey = env.ENVIRONMENT === 'production' ? env.STRIPE_SECRET_KEY : env.STRIPE_SECRET_KEY_TEST;

  // key -> stripeProductId, where key is either a product key (e.g. 'paperback')
  // or `${productKey}:${variantName}` (e.g. 'ceremonial-water-bottle:32oz')
  const lookups: [string, string][] = [];
  for (const [key, product] of Object.entries(PRODUCTS)) {
    const id = resolveStripeProductId(product.stripeProductId, env.ENVIRONMENT);
    if (id) lookups.push([key, id]);
    for (const [variantName, variant] of Object.entries(product.variants ?? {})) {
      lookups.push([`${key}:${variantName}`, resolveStripeProductId(variant.stripeProductId, env.ENVIRONMENT)]);
    }
  }

  const stripeProductIds = Array.from(new Set(lookups.map(([, id]) => id)));
  const priceByStripeId = new Map<string, number | null>(
    await Promise.all(
      stripeProductIds.map(async (id) => {
        const product = await fetchProduct(id, secretKey);
        const amount = product.default_price?.unit_amount;
        return [id, amount != null ? amount / 100 : null] as const;
      })
    )
  );

  const prices = Object.fromEntries(
    lookups.map(([key, stripeProductId]) => [key, priceByStripeId.get(stripeProductId) ?? null])
  );

  return new Response(JSON.stringify({ prices }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
};
