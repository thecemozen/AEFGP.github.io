// Optional Cloudflare Worker proxy for Model Stüdyo.
// Use it only if the browser can't reach the Meshy API directly (CORS error).
// Deploy: dash.cloudflare.com → Workers → Create → paste this file → Deploy,
// then put the worker URL into "Proxy adresi" in the app.
// Your API key is still sent by the app in the Authorization header; the worker does not store it.

const API = 'https://api.meshy.ai';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);

    // Model file download: /fetch?url=https://assets.meshy.ai/...
    if (url.pathname === '/fetch') {
      const target = new URL(url.searchParams.get('url') || '');
      if (!target.hostname.endsWith('meshy.ai')) return new Response('forbidden', { status: 403, headers: CORS });
      const r = await fetch(target);
      return new Response(r.body, { status: r.status, headers: { ...CORS, 'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream' } });
    }

    // API calls: only /openapi/* is forwarded
    if (!url.pathname.startsWith('/openapi/')) return new Response('not found', { status: 404, headers: CORS });
    const r = await fetch(API + url.pathname + url.search, {
      method: req.method,
      headers: { Authorization: req.headers.get('Authorization') || '', 'Content-Type': 'application/json' },
      body: req.method === 'POST' ? await req.text() : undefined,
    });
    return new Response(r.body, { status: r.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
  },
};
