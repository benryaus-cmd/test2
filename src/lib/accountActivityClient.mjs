/** Aippy account APIs observed in signed-in Chrome. */
const API_ORIGIN = 'https://api.aippy.ai';
const FAVOURITES_PAGE_SIZE = 12, OWN_PAGE_SIZE = 500;
function tokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch { return 0; }
}
function safeRow(item, own) {
  return {
    projectId: String(own ? item.id ?? item.projectId ?? '' : item.projectId ?? ''),
    templateId: String(own ? item.template_id ?? item.templateId ?? '' : item.id ?? item.templateId ?? ''),
    name: String(item.name ?? ''),
    ownerUid: String(item.uid ?? ''),
    snapshot: typeof item.snapshot === 'string' ? item.snapshot : '',
    favorite: item.favorite === true, collected: item.collected === true,
    publishStatus: item.publishStatus ?? null, status: item.status ?? null,
    likes: typeof item.likes === 'number' ? item.likes : 0,
  };
}
export function createAccountClient({ getToken, relayBase = '', fetchImpl = fetch, onRequest = () => {} }) {
  let token = '', expiry = 0;
  const base = relayBase.trim().replace(/\/+$/, '') || API_ORIGIN;
  const via = relayBase.trim() ? 'relay' : 'direct';
  async function currentToken(force = false) {
    if (!force && token && (!expiry || Date.now() + 60000 < expiry)) return token;
    const received = await getToken();
    token = typeof received === 'string' ? received.trim() : String(received?.token ?? '');
    if (!token) throw new Error('Aippy runtime token not available');
    expiry = tokenExpiry(token);
    return token;
  }
  async function request(path) {
    const send = async (refresh) => {
      const bearer = await currentToken(refresh);
      onRequest({ path, via, phase: 'request' });
      let response;
      try {
        response = await fetchImpl(base + path, {
          method: 'GET', cache: 'no-store', credentials: 'omit',
          headers: { Accept: 'application/json', Authorization: 'Bearer ' + bearer }
        });
      } catch (error) {
        throw new Error('Authenticated ' + via + ' fetch failed: ' + String(error?.message ?? error));
      }
      const data = await response.json();
      onRequest({ path, via, phase: 'response', httpStatus: response.status, appCode: data?.code });
      return { response, data };
    };
    let { response, data } = await send(false);
    if (response.status === 401 || String(data?.code) === '4011') ({ response, data } = await send(true));
    if (!response.ok || data?.code !== 0) throw new Error(path + ': HTTP ' + response.status + ', API code ' + String(data?.code) + ' ' + String(data?.msg ?? ''));
    return data.data ?? {};
  }
  async function list(endpoint, size, uid, own, onProgress) {
    const items = [], seen = new Set();
    let page = 1, total = null, completed = false;
    while (page <= 100) {
      const query = new URLSearchParams(own
        ? { page: String(page), size: String(size), uid }
        : { targetUid: uid, page: String(page), size: String(size) });
      const result = await request(endpoint + '?' + query);
      if (!Array.isArray(result.list)) throw new Error(endpoint + ' did not return data.list');
      if (typeof result.total === 'number') total = result.total;
      for (const raw of result.list) {
        const row = safeRow(raw, own);
        if (row.projectId && !seen.has(row.projectId)) { items.push(row); seen.add(row.projectId); }
      }
      onProgress?.({ pagesLoaded: page, entriesLoaded: items.length, total });
      if (result.list.length === 0 || (total !== null && items.length >= total) || (total === null && result.list.length < size)) {
        completed = true; break;
      }
      page++;
    }
    return { items, total: total ?? items.length, pagesLoaded: page, completed };
  }
  async function favourites(uid, projectId, onProgress) {
    const result = await list('/api/template/favorites/list', FAVOURITES_PAGE_SIZE, uid, false, onProgress);
    const match = result.items.find(item => item.projectId === String(projectId)) ?? null;
    return { ...result, match, liked: match ? 'YES' : result.completed ? 'NO' : 'UNKNOWN' };
  }
  async function ownedProjects(uid, onProgress) {
    return list('/api/project', OWN_PAGE_SIZE, uid, true, onProgress);
  }
  return { request, currentToken, favourites, ownedProjects };
}
