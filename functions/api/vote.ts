interface Env {
  STORE: KVNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;
  const url = new URL(context.request.url);
  const key = url.searchParams.get('key') || 'podcast-interest';

  const count = await env.STORE.get(key);

  return new Response(JSON.stringify({ count: parseInt(count || '0', 10) }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  let key = 'podcast-interest';
  try {
    const body = await request.json() as { key?: string };
    if (body.key) key = body.key;
  } catch {
    // Use default key
  }

  const current = await env.STORE.get(key);
  const newCount = parseInt(current || '0', 10) + 1;
  await env.STORE.put(key, newCount.toString());

  return new Response(JSON.stringify({ count: newCount }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
