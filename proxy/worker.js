// AI Meeting Room – Studio connection (Cloudflare Worker)
// Forwards Studio requests to Meshy and HeyGen, which don't accept calls straight from a web page.
// It only answers the app's own address, never stores keys, and only talks to the hosts listed below.

const ALLOWED_ORIGINS = ['https://rriv97-create.github.io'];

const APIS = {
  '/meshy/': 'https://api.meshy.ai/openapi/',
  '/heygen/': 'https://api.heygen.com/'
};

// Hosts the app may download finished files from (3D models, videos, thumbnails).
const FILE_HOSTS = [/(^|\.)meshy\.ai$/, /(^|\.)heygen\.(ai|com)$/, /\.amazonaws\.com$/, /\.cloudfront\.net$/];

const FORWARD_HEADERS = ['authorization', 'x-api-key', 'content-type', 'accept'];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-api-key, accept',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function reply(body, status, origin, extra) {
  const headers = new Headers(origin ? corsHeaders(origin) : {});
  headers.set('content-type', 'application/json');
  if (extra) for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return reply({ error: { message: 'This Studio connection only works from the AI Meeting Room app.' } }, 403, '');
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== 'GET' && request.method !== 'POST') return reply({ error: { message: 'Method not allowed' } }, 405, origin);

    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '/health') {
      return reply({ ok: true, service: 'ai-meeting-room-proxy' }, 200, origin);
    }

    if (url.pathname === '/fetch') {
      let target;
      try { target = new URL(url.searchParams.get('url') || ''); } catch (e) { return reply({ error: { message: 'Bad file address' } }, 400, origin); }
      if (target.protocol !== 'https:' || !FILE_HOSTS.some((re) => re.test(target.hostname))) {
        return reply({ error: { message: 'That file host is not allowed' } }, 400, origin);
      }
      const res = await fetch(target.toString());
      const headers = new Headers(corsHeaders(origin));
      for (const h of ['content-type', 'content-length']) { const v = res.headers.get(h); if (v) headers.set(h, v); }
      return new Response(res.body, { status: res.status, headers });
    }

    for (const prefix of Object.keys(APIS)) {
      if (url.pathname.startsWith(prefix)) {
        const target = APIS[prefix] + url.pathname.slice(prefix.length) + url.search;
        const headers = new Headers();
        for (const h of FORWARD_HEADERS) { const v = request.headers.get(h); if (v) headers.set(h, v); }
        const res = await fetch(target, {
          method: request.method,
          headers,
          body: request.method === 'POST' ? request.body : undefined
        });
        const out = new Headers(corsHeaders(origin));
        const type = res.headers.get('content-type');
        if (type) out.set('content-type', type);
        const retry = res.headers.get('retry-after');
        if (retry) out.set('retry-after', retry);
        return new Response(res.body, { status: res.status, headers: out });
      }
    }

    return reply({ error: { message: 'Not found' } }, 404, origin);
  }
};
