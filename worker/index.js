const MAX_BODY_BYTES = 4096;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function allowedOrigins(env) {
  return new Set((env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean));
}

function json(body, status, origin) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > MAX_BODY_BYTES) throw new Response('Payload too large', { status: 413 });
  if (!request.body) throw new Response('Missing request body', { status: 400 });

  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Response('Payload too large', { status: 413 });
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Response('Invalid JSON', { status: 400 });
  }
}

export default {
  async fetch(request, env) {
    const originHeader = request.headers.get('Origin');
    const origins = allowedOrigins(env);
    const origin = originHeader && origins.has(originHeader) ? originHeader : null;

    if (originHeader && !origin) return json({ error: 'Origin not allowed' }, 403);

    if (request.method === 'OPTIONS') {
      if (request.headers.get('Access-Control-Request-Method') !== 'POST') {
        return json({ error: 'Method not allowed' }, 405, origin);
      }
      const headers = new Headers({
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
      });
      if (origin) headers.set('Access-Control-Allow-Origin', origin);
      return new Response(null, { status: 204, headers });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/subscribe') return json({ error: 'Not found' }, 404, origin);
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
      return json({ error: 'Expected application/json' }, 415, origin);
    }

    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      if (error instanceof Response) {
        return json({ error: await error.text() }, error.status, origin);
      }
      return json({ error: 'Invalid request' }, 400, origin);
    }

    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return json({ error: 'Please provide a valid email address' }, 400, origin);
    }

    const source = typeof body.source === 'string'
      ? body.source.trim().slice(0, 100)
      : 'goodloamlabs-demo-request';
    try {
      await env.DB.prepare(
        'INSERT INTO email_signups (email, source) VALUES (?, ?) ON CONFLICT(email) DO NOTHING',
      ).bind(email, source || 'goodloamlabs-demo-request').run();
    } catch (error) {
      console.error('Failed to store email signup', error);
      return json({ error: 'Could not save your request' }, 500, origin);
    }

    // Return the same response for new and duplicate addresses to avoid exposing membership.
    return json({ ok: true }, 200, origin);
  },
};
