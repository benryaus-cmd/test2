/** Optional Cloudflare Worker relay: Aippy runtime Bearer -> Aippy API.
 * The game's host origin is *.aippy.live while api.aippy.ai returned CORS allow-origin aippy.ai.
 */
const API = 'https://api.aippy.ai';
const ROUTES = new Set(['/api/project', '/api/template/favorites/list', '/api/template/info', '/user/profile', '/user/account/info', '/user/uid']);
function permitted(origin) {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return (u.protocol === 'https:' && (u.hostname === 'aippy.ai' || u.hostname === 'aippy.live' || u.hostname.endsWith('.aippy.live')))
      || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname));
  } catch { return false; }
}
function cors(origin) {
  return origin && permitted(origin) ? {
    'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type',
    'Access-Control-Max-Age': '3600', Vary: 'Origin'
  } : { Vary: 'Origin' };
}
export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') ?? '';
    const headers = cors(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: permitted(origin) ? 204 : 403, headers });
    if (!permitted(origin)) return new Response('Origin not supported', { status: 403, headers });
    if (request.method !== 'GET') return new Response('Method not supported', { status: 405, headers });
    const url = new URL(request.url);
    if (!ROUTES.has(url.pathname) && !/^\/api\/share\/data\/[A-Za-z0-9_-]+$/.test(url.pathname))
      return new Response('Unknown Aippy API route', { status: 404, headers });
    const auth = request.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return new Response('Bearer token required', { status: 401, headers });
    const upstream = await fetch(API + url.pathname + url.search, {
      method: 'GET', redirect: 'manual',
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...headers, 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
};
