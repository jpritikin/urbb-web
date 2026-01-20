interface Env {
  SNIPCART_SECRET_API_KEY: string;
  PRINTFUL_API_KEY: string;
  WEBHOOK_SECRET: string;
  ENVIRONMENT?: string;
}

interface SnipcartItem {
  id: string;
  uniqueId: string;
  name: string;
  price: number;
  quantity: number;
  shippable: boolean;
  customFields?: Array<{ name: string; value: string }>;
}

interface SnipcartOrder {
  token: string;
  invoiceNumber: string;
  email: string;
  status: string;
  paymentStatus: string;
  items: SnipcartItem[];
  shippingAddress?: {
    fullName: string;
    address1: string;
    address2?: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
    phone?: string;
  };
  billingAddress?: {
    fullName: string;
    address1: string;
    address2?: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
  };
  finalGrandTotal: number;
}

interface SnipcartWebhookPayload {
  eventName: string;
  mode: string;
  createdOn: string;
  content: SnipcartOrder;
}

import { PRODUCTS, ProductConfig } from '../config/products';

function getVariantId(item: SnipcartItem): number | null {
  const product = PRODUCTS[item.id];
  if (!product) return null;

  if (product.variants && item.customFields) {
    for (const field of item.customFields) {
      const variantId = product.variants[field.value];
      if (variantId) return variantId;
    }
  }

  return product.printfulVariantId;
}

async function verifyWebhook(request: Request, env: Env): Promise<boolean> {
  const token = request.headers.get('X-Snipcart-RequestToken');
  if (!token) return false;

  const verifyUrl = `https://app.snipcart.com/api/requestvalidation/${token}`;
  const response = await fetch(verifyUrl, {
    headers: {
      Authorization: `Basic ${btoa(env.SNIPCART_SECRET_API_KEY + ':')}`,
      Accept: 'application/json',
    },
  });

  return response.ok;
}

async function createPrintfulOrder(
  order: SnipcartOrder,
  env: Env
): Promise<Response> {
  const isTestMode = env.ENVIRONMENT !== 'production';

  const printfulItems = order.items
    .filter((item) => {
      const product = PRODUCTS[item.id];
      return product?.shippable && getVariantId(item);
    })
    .map((item) => ({
      sync_variant_id: getVariantId(item),
      quantity: item.quantity,
    }));

  if (printfulItems.length === 0) {
    return new Response(JSON.stringify({ message: 'No Printful items to fulfill' }), {
      status: 200,
    });
  }

  if (!order.shippingAddress) {
    return new Response(JSON.stringify({ error: 'No shipping address' }), {
      status: 400,
    });
  }

  const printfulOrder = {
    external_id: order.invoiceNumber,
    recipient: {
      name: order.shippingAddress.fullName,
      address1: order.shippingAddress.address1,
      address2: order.shippingAddress.address2 || '',
      city: order.shippingAddress.city,
      state_code: order.shippingAddress.province,
      zip: order.shippingAddress.postalCode,
      country_code: order.shippingAddress.country,
      phone: order.shippingAddress.phone || '',
      email: order.email,
    },
    items: printfulItems,
    ...(isTestMode && { confirm: false }),
  };

  const response = await fetch('https://api.printful.com/orders', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PRINTFUL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(printfulOrder),
  });

  const result = await response.json();
  return new Response(JSON.stringify(result), {
    status: response.ok ? 200 : 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const isValid = await verifyWebhook(request, env);
  if (!isValid) {
    return new Response(JSON.stringify({ error: 'Invalid webhook signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const payload: SnipcartWebhookPayload = await request.json();
  console.log(`Received Snipcart event: ${payload.eventName}`);

  switch (payload.eventName) {
    case 'order.completed':
      return createPrintfulOrder(payload.content, env);

    case 'order.status.changed':
      console.log(`Order ${payload.content.token} status: ${payload.content.status}`);
      return new Response(JSON.stringify({ received: true }), { status: 200 });

    case 'order.refund.created':
      console.log(`Refund for order ${payload.content.token}`);
      return new Response(JSON.stringify({ received: true }), { status: 200 });

    default:
      return new Response(JSON.stringify({ received: true, event: payload.eventName }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
  }
};
