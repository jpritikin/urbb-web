interface Env {
  PRINTFUL_API_KEY: string;
}

interface SnipcartShippingItem {
  id: string;
  name: string;
  quantity: number;
  weight: number;
  shippable: boolean;
  customFields?: Array<{ name: string; value: string }>;
}

interface SnipcartShippingRequest {
  eventName: string;
  content: {
    items: SnipcartShippingItem[];
    shippingAddress: {
      fullName: string;
      address1: string;
      address2?: string;
      city: string;
      province: string;
      postalCode: string;
      country: string;
      phone?: string;
    };
  };
}

interface PrintfulShippingItem {
  variant_id: number;
  quantity: number;
}

import { PRODUCTS } from '../config/products';

function getSyncVariantId(itemId: string, customFields?: Array<{ name: string; value: string }>): number | null {
  const product = PRODUCTS[itemId];
  if (!product) return null;

  if (product.variants && customFields) {
    for (const field of customFields) {
      const variantId = product.variants[field.value];
      if (variantId) return variantId;
    }
  }

  return product.printfulVariantId ?? null;
}

async function getCatalogVariantId(syncVariantId: number, env: Env): Promise<number | null> {
  const response = await fetch(`https://api.printful.com/store/variants/${syncVariantId}`, {
    headers: {
      Authorization: `Bearer ${env.PRINTFUL_API_KEY}`,
    },
  });
  if (!response.ok) {
    console.error('Failed to get store variant:', await response.text());
    return null;
  }
  const data = await response.json();
  return data.result?.product?.variant_id ?? data.result?.variant_id ?? null;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const payload: SnipcartShippingRequest = await request.json();

  if (payload.eventName !== 'shippingrates.fetch') {
    return new Response(JSON.stringify({ rates: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const { items, shippingAddress } = payload.content;

  const printfulItems: PrintfulShippingItem[] = [];
  for (const item of items) {
    if (!item.shippable) continue;
    const syncVariantId = getSyncVariantId(item.id, item.customFields);
    if (syncVariantId) {
      const catalogVariantId = await getCatalogVariantId(syncVariantId, env);
      if (catalogVariantId) {
        printfulItems.push({ variant_id: catalogVariantId, quantity: item.quantity });
      }
    }
  }

  if (printfulItems.length === 0) {
    return new Response(
      JSON.stringify({
        rates: [
          {
            cost: 0,
            description: 'Digital delivery - no shipping required',
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  const printfulRequest = {
    recipient: {
      address1: shippingAddress.address1,
      address2: shippingAddress.address2 || '',
      city: shippingAddress.city,
      state_code: shippingAddress.province,
      zip: shippingAddress.postalCode,
      country_code: shippingAddress.country,
      phone: shippingAddress.phone || '',
    },
    items: printfulItems,
  };

  const response = await fetch('https://api.printful.com/shipping/rates', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PRINTFUL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(printfulRequest),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('Printful shipping error:', response.status, error);
    console.error('Request was:', JSON.stringify(printfulRequest));
    return new Response(
      JSON.stringify({
        errors: [{ key: 'shipping_error', message: `Printful error: ${error}` }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }

  const printfulResponse = await response.json();

  const rates = printfulResponse.result.map(
    (rate: { id: string; name: string; rate: string; minDeliveryDays: number; maxDeliveryDays: number }) => ({
      cost: parseFloat(rate.rate),
      description: `${rate.name} (${rate.minDeliveryDays}-${rate.maxDeliveryDays} business days)`,
      guaranteedDaysToDelivery: rate.maxDeliveryDays,
    })
  );

  return new Response(JSON.stringify({ rates }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
};
