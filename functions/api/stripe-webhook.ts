import { PRODUCTS, resolveStripeProductId } from '../config/products';

interface Env {
  STRIPE_SECRET_KEY: string;
  STRIPE_SECRET_KEY_TEST: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_WEBHOOK_SECRET_TEST: string;
  PRINTFUL_API_KEY: string;
  META_ACCESS_TOKEN: string;
  ENVIRONMENT?: string;
}

const META_PIXEL_ID = '1258922096144419';
const META_API_VERSION = 'v21.0';

interface StripeLineItem {
  quantity: number;
  price: { product: string };
}

interface StripeAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

interface StripeSession {
  id: string;
  amount_total: number;
  currency: string;
  customer_details: {
    name: string;
    email: string;
    phone?: string;
    address: StripeAddress;
  };
  shipping_details?: { address: StripeAddress; name: string };
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: StripeSession };
}

// stripeProductId -> { productKey, variant? }, resolved for the active environment
function buildStripeProductLookup(environment: string | undefined): Map<string, { productKey: string; variant?: string }> {
  const lookup = new Map<string, { productKey: string; variant?: string }>();
  for (const [productKey, product] of Object.entries(PRODUCTS)) {
    const id = resolveStripeProductId(product.stripeProductId, environment);
    if (id) lookup.set(id, { productKey });
    for (const [variant, v] of Object.entries(product.variants ?? {})) {
      lookup.set(resolveStripeProductId(v.stripeProductId, environment), { productKey, variant });
    }
  }
  return lookup;
}

function getPrintfulVariantId(productKey: string, variant?: string): number | null {
  const product = PRODUCTS[productKey];
  if (!product) return null;
  if (variant) return product.variants?.[variant]?.printfulVariantId ?? null;
  return product.printfulVariantId ?? null;
}

async function sha256(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str.toLowerCase().trim());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function computeSignature(secret: string, signedPayload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Live and test webhook endpoints have distinct signing secrets, and we can't
// tell which mode an event came from until after verifying it, so try both.
async function verifyStripeSignature(
  request: Request,
  secrets: { live: string; test: string }
): Promise<{ valid: boolean; environment: 'production' | 'test'; body: string }> {
  const body = await request.text();
  const sigHeader = request.headers.get('stripe-signature') ?? '';
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=')));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return { valid: false, environment: 'test', body };

  const signedPayload = `${timestamp}.${body}`;
  const liveExpected = await computeSignature(secrets.live, signedPayload);
  if (liveExpected === signature) return { valid: true, environment: 'production', body };

  const testExpected = await computeSignature(secrets.test, signedPayload);
  if (testExpected === signature) return { valid: true, environment: 'test', body };

  return { valid: false, environment: 'test', body };
}

async function fetchLineItems(sessionId: string, secretKey: string): Promise<StripeLineItem[]> {
  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items?expand[]=data.price.product&limit=100`,
    { headers: { Authorization: `Bearer ${secretKey}` } }
  );
  if (!res.ok) throw new Error(`Failed to fetch line items: ${res.status}`);
  const data: { data: Array<{ quantity: number; price: { product: { id: string } } }> } = await res.json();
  return data.data.map((li) => ({ quantity: li.quantity, price: { product: li.price.product.id } }));
}

async function sendMetaConversionEvent(session: StripeSession, env: Env): Promise<void> {
  const eventTime = Math.floor(Date.now() / 1000);
  const address = session.shipping_details?.address ?? session.customer_details.address;
  const name = session.shipping_details?.name ?? session.customer_details.name;
  const nameParts = (name || '').split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  const userData: Record<string, string> = {};
  if (session.customer_details.email) userData.em = await sha256(session.customer_details.email);
  if (session.customer_details.phone) userData.ph = await sha256(session.customer_details.phone.replace(/\D/g, ''));
  if (firstName) userData.fn = await sha256(firstName);
  if (lastName) userData.ln = await sha256(lastName);
  if (address?.city) userData.ct = await sha256(address.city);
  if (address?.state) userData.st = await sha256(address.state);
  if (address?.postal_code) userData.zp = await sha256(address.postal_code);
  if (address?.country) userData.country = await sha256(address.country);

  const eventData = {
    data: [
      {
        event_name: 'Purchase',
        event_time: eventTime,
        event_id: session.id,
        event_source_url: 'https://unburdened.org/shop/',
        action_source: 'website',
        user_data: userData,
        custom_data: {
          value: session.amount_total / 100,
          currency: session.currency.toUpperCase(),
        },
      },
    ],
  };

  const url = `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events?access_token=${env.META_ACCESS_TOKEN}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(eventData),
  });

  if (!response.ok) {
    console.error('Meta CAPI error:', await response.text());
  } else {
    console.log('Meta CAPI Purchase event sent for session:', session.id);
  }
}

async function createPrintfulOrder(session: StripeSession, lineItems: StripeLineItem[], env: Env): Promise<void> {
  const isTestMode = env.ENVIRONMENT !== 'production';
  const productLookup = buildStripeProductLookup(env.ENVIRONMENT);
  console.log('Printful lookup: environment =', env.ENVIRONMENT, 'lineItems =', JSON.stringify(lineItems), 'lookup keys =', JSON.stringify(Array.from(productLookup.keys())));

  const printfulItems = lineItems
    .map((li) => {
      const match = productLookup.get(li.price.product);
      if (!match) return null;
      const product = PRODUCTS[match.productKey];
      if (product.fulfillment !== 'printful') return null;
      const variantId = getPrintfulVariantId(match.productKey, match.variant);
      if (!variantId) return null;
      return { sync_variant_id: variantId, quantity: li.quantity };
    })
    .filter((item): item is { sync_variant_id: number; quantity: number } => item !== null);

  if (printfulItems.length === 0) {
    console.log('No Printful items found in this order; skipping Printful order creation.');
    return;
  }

  const address = session.shipping_details?.address ?? session.customer_details.address;
  const name = session.shipping_details?.name ?? session.customer_details.name;

  const printfulOrder = {
    external_id: (await sha256(session.id)).slice(0, 32),
    recipient: {
      name,
      address1: address.line1,
      address2: address.line2 || '',
      city: address.city,
      state_code: address.state,
      zip: address.postal_code,
      country_code: address.country,
      phone: session.customer_details.phone || '',
      email: session.customer_details.email,
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

  if (!response.ok) {
    console.error('Printful order error:', await response.text());
  } else {
    console.log('Printful order created for session:', session.id);
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  const { valid, environment, body } = await verifyStripeSignature(request, {
    live: env.STRIPE_WEBHOOK_SECRET,
    test: env.STRIPE_WEBHOOK_SECRET_TEST,
  });
  if (!valid) {
    return new Response(JSON.stringify({ error: 'Invalid webhook signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const event: StripeEvent = JSON.parse(body);

  if (event.type === 'checkout.session.completed') {
    const secretKey = environment === 'production' ? env.STRIPE_SECRET_KEY : env.STRIPE_SECRET_KEY_TEST;
    const session = event.data.object;
    const lineItems = await fetchLineItems(session.id, secretKey);
    await sendMetaConversionEvent(session, env);
    await createPrintfulOrder(session, lineItems, { ...env, ENVIRONMENT: environment });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
