import { useEffect, useMemo, useState } from 'react';

type StorageSource = 'localStorage' | 'sessionStorage' | 'Cookies' | 'IndexedDB' | 'Cache Storage';
type Item = {
  id: string; source: StorageSource; location: string; key: string;
  value: string; size: number; shortened: boolean;
};
type ScanInfo = { name: string; detail: string; error?: boolean };
type ScanResult = { items: Item[]; info: ScanInfo[]; origin: string; parentAccess: string; quota: string };
const VALUE_LIMIT = 48000;
const GLOBAL_LIMIT = 12000;
function printable(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const result = JSON.stringify(value, (_key, val: unknown) => {
      if (typeof val === 'bigint') return String(val) + 'n';
      if (val instanceof ArrayBuffer) return '[ArrayBuffer ' + val.byteLength + ' bytes]';
      if (ArrayBuffer.isView(val)) return '[TypedArray ' + val.byteLength + ' bytes]';
      return val;
    }, 2);
    return result ?? String(value);
  } catch {
    return String(value);
  }
}
function errorText(error: unknown) {
  return error instanceof Error ? error.name + ': ' + error.message : String(error);
}
function safeAdd(items: Item[], source: StorageSource, location: string, key: string, value: unknown) {
  if (items.length >= GLOBAL_LIMIT) return;
  const original = printable(value);
  const shortened = original.length > VALUE_LIMIT;
  items.push({ id: String(items.length), source, location, key,
    value: shortened ? original.slice(0, VALUE_LIMIT) : original,
    size: original.length, shortened });
}
async function openExistingDatabase(name: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let finished = false;
    const req = indexedDB.open(name);
    const finishError = (reason: string) => {
      if (finished) return;
      finished = true;
      reject(new Error(reason));
    };
    const timer = window.setTimeout(() => finishError('Timed out opening database ' + name), 7000);
    req.onupgradeneeded = () => {
      req.transaction?.abort(); // A scan must never create a database.
    };
    req.onblocked = () => { window.clearTimeout(timer); finishError('Database blocked: ' + name); };
    req.onerror = () => { window.clearTimeout(timer); finishError('Database unavailable: ' + name); };
    req.onsuccess = () => {
      window.clearTimeout(timer);
      if (finished) { req.result.close(); return; }
      finished = true;
      resolve(req.result);
    };
  });
}
async function readObjectStore(db: IDBDatabase, store: string, cap: number, items: Item[]): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let count = 0;
    let finished = false;
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).openCursor();
    const done = (err?: unknown) => {
      if (finished) return;
      finished = true;
      if (err) reject(err); else resolve(count);
    };
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || count >= cap || items.length >= GLOBAL_LIMIT) { done(); return; }
      safeAdd(items, 'IndexedDB', db.name + ' / ' + store, printable(cursor.key), cursor.value);
      count += 1;
      cursor.continue();
    };
    request.onerror = () => done(request.error ?? new Error('Cursor failed'));
    tx.onerror = () => done(tx.error ?? new Error('Transaction failed'));
    tx.onabort = () => done(tx.error ?? new Error('Transaction aborted'));
    tx.oncomplete = () => done();
  });
}
async function scanAll(deep: boolean): Promise<ScanResult> {
  const items: Item[] = [];
  const info: ScanInfo[] = [];
  const origin = window.location.origin;
  let parentAccess = 'Not embedded in another page';
  if (window.parent !== window) {
    try { parentAccess = 'Parent origin: ' + window.parent.location.origin; }
    catch { parentAccess = 'Parent page is cross-origin. Its storage is not accessible.'; }
  }
  const cap = deep ? 2500 : 250;
  for (const [name, storage] of [
    ['localStorage', () => window.localStorage],
    ['sessionStorage', () => window.sessionStorage],
  ] as const) {
    try {
      const store = storage();
      let count = 0;
      for (let i = 0; i < store.length && items.length < GLOBAL_LIMIT; i++) {
        const key = store.key(i);
        if (key === null) continue;
        safeAdd(items, name, origin, key, store.getItem(key) ?? '');
        count++;
      }
      info.push({ name, detail: count + ' keys' });
    } catch (error) { info.push({ name, detail: errorText(error), error: true }); }
  }
  try {
    const cookies = document.cookie;
    const parts = cookies ? cookies.split(';') : [];
    for (const part of parts) {
      const eq = part.indexOf('=');
      const key = (eq < 0 ? part : part.slice(0, eq)).trim();
      const value = eq < 0 ? '' : part.slice(eq + 1).trim();
      if (key) safeAdd(items, 'Cookies', 'document.cookie (non-HttpOnly only)', key, value);
    }
    info.push({ name: 'Cookies', detail: parts.length + ' JavaScript-readable cookies (HttpOnly cannot be inspected)' });
  } catch (error) { info.push({ name: 'Cookies', detail: errorText(error), error: true }); }
  if (typeof indexedDB === 'undefined') {
    info.push({ name: 'IndexedDB', detail: 'Not supported in this WebView', error: true });
  } else if (typeof indexedDB.databases !== 'function') {
    info.push({ name: 'IndexedDB', detail: 'Database enumeration unsupported; existing database names cannot be discovered safely' });
  } else {
    try {
      const databases = await indexedDB.databases();
      info.push({ name: 'IndexedDB', detail: databases.length + ' databases found' });
      for (const descriptor of databases) {
        if (!descriptor.name || items.length >= GLOBAL_LIMIT) continue;
        let db: IDBDatabase | null = null;
        try {
          db = await openExistingDatabase(descriptor.name);
          for (const store of Array.from(db.objectStoreNames)) {
            const count = await readObjectStore(db, store, cap, items);
            info.push({ name: 'IndexedDB / ' + descriptor.name + ' / ' + store,
              detail: count + ' records scanned' + (count >= cap ? ' (depth limit)' : '') });
          }
        } catch (error) {
          info.push({ name: 'IndexedDB / ' + descriptor.name, detail: errorText(error), error: true });
        } finally { db?.close(); }
      }
    } catch (error) { info.push({ name: 'IndexedDB', detail: errorText(error), error: true }); }
  }
  if (typeof caches === 'undefined') {
    info.push({ name: 'Cache Storage', detail: 'Not available in this browser', error: true });
  } else {
    try {
      const cacheNames = await caches.keys();
      info.push({ name: 'Cache Storage', detail: cacheNames.length + ' caches found' });
      for (const cacheName of cacheNames) {
        if (items.length >= GLOBAL_LIMIT) break;
        try {
          const cache = await caches.open(cacheName);
          const requests = await cache.keys();
          const max = Math.min(requests.length, cap);
          for (const request of requests.slice(0, max)) {
            const response = await cache.match(request);
            const type = response?.headers.get('content-type') ?? '';
            const length = Number(response?.headers.get('content-length') ?? -1);
            let value = JSON.stringify({ status: response?.status ?? null, type, length });
            // Read only small textual cached bodies; binary assets may be very large.
            if (response && length >= 0 && length <= VALUE_LIMIT &&
              /json|text|javascript|xml|html|css/.test(type)) {
              try { value += '\n' + await response.clone().text(); } catch { /* metadata still works */ }
            }
            safeAdd(items, 'Cache Storage', cacheName, request.url, value);
          }
          info.push({ name: 'Cache / ' + cacheName,
            detail: max + ' of ' + requests.length + ' cached requests scanned' +
              (max < requests.length ? ' (depth limit)' : '') });
        } catch (error) { info.push({ name: 'Cache / ' + cacheName, detail: errorText(error), error: true }); }
      }
    } catch (error) { info.push({ name: 'Cache Storage', detail: errorText(error), error: true }); }
  }
  let quota = 'Unavailable';
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      const size = (n: number | undefined) => n === undefined ? '?' : (n / 1048576).toFixed(1) + ' MB';
      quota = size(estimate.usage) + ' used / ' + size(estimate.quota) + ' quota';
    }
  } catch (error) { quota = errorText(error); }
  if (items.length >= GLOBAL_LIMIT) info.push({name:'Scan limit',detail:GLOBAL_LIMIT+' entries reached; results may be incomplete',error:true});
  return { items, info, origin, parentAccess, quota };
}
async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return; } catch { /* fallback */ }
  }
  const field = document.createElement('textarea');
  field.value = value; field.style.position = 'fixed'; field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  try {
    if (!document.execCommand('copy')) throw new Error('Copy was refused');
  } finally { field.remove(); }
}
const buttonStyle = { border: '1px solid #587087', background: '#183147', color: '#eef5fc',
  borderRadius: 9, padding: '9px 11px', cursor: 'pointer', fontSize: 12 };
const sensitive = (entry: Item) => /token|auth|bearer|secret|password|credential|cookie|session|jwt|key/i.test(entry.key + ' ' + entry.location);

export default function StorageExplorer({open, onClose}: {open: boolean; onClose: () => void}) {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('All');
  const [chosen, setChosen] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!open) { setReveal(false); setChosen(null); return; }
    if (!result && !busy) { void scan(); }
    // Scan only on initial opening; manual RESCAN refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  async function scan() {
    setBusy(true); setMessage('Scanning JavaScript-accessible storage…');
    setChosen(null); setReveal(false);
    try {
      const found = await scanAll(deep);
      setResult(found);
      setMessage('Scanned ' + found.items.length + ' entries. Searches include values even when hidden.');
    } catch (error) { setMessage('Scan failed: ' + errorText(error)); }
    finally { setBusy(false); }
  }
  const matches = useMemo(() => {
    if (!result) return [];
    const needle = query.toLowerCase().trim();
    return result.items.filter(item =>
      (source === 'All' || item.source === source) &&
      (!needle || (item.key + '\n' + item.value + '\n' + item.location + '\n' + item.source).toLowerCase().includes(needle)));
  }, [result, source, query]);
  const selected = result?.items.find(item => item.id === chosen);
  const copyDiagnostic = async () => {
    if (!result) return;
    const summary = {
      origin: result.origin, parentAccess: result.parentAccess, quota: result.quota,
      searched: query, filter: source, matchCount: matches.length,
      sources: result.info, matchingKeys: matches.slice(0, 350).map(row => ({
        source: row.source, location: row.location, key: row.key,
        size: row.size, truncated: row.shortened
      }))
    };
    try { await copyText(JSON.stringify(summary, null, 2)); setMessage('Copied diagnostic (key names and sizes only; no values).'); }
    catch (error) { setMessage('Copy failed: ' + errorText(error)); }
  };
  if (!open) return null;
  return <div role="dialog" aria-modal="true" aria-label="Browser Storage Explorer" style={{
    position:'fixed', inset:0, zIndex:300, background:'#091724', color:'#eaf2fc',
    display:'flex', flexDirection:'column', fontFamily:'system-ui, sans-serif',
    paddingTop:'env(safe-area-inset-top)', paddingBottom:'env(safe-area-inset-bottom)'
  }}>
    <header style={{padding:'12px 13px',background:'#12263a',borderBottom:'1px solid #30475e',flexShrink:0}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
        <div>
          <strong style={{fontSize:17}}>STORAGE EXPLORER</strong>
          <div style={{fontSize:11,color:'#b0cce2'}}>Local · Session · Cookies · IndexedDB · Cache</div>
        </div>
        <div style={{display:'flex',gap:6}}>
          <button type="button" style={buttonStyle} onClick={() => void scan()} disabled={busy}>{busy ? 'SCANNING…' : 'RESCAN'}</button>
          <button type="button" style={buttonStyle} onClick={onClose}>CLOSE ✕</button>
        </div>
      </div>
      <p style={{fontSize:11,margin:'8px 0 3px',overflowWrap:'anywhere'}}>Game origin: <b>{result?.origin ?? window.location.origin}</b></p>
      <p style={{fontSize:11,margin:'3px 0',color:'#bacbdc'}}>{result?.parentAccess ?? 'Checking parent page…'}</p>
      <p style={{fontSize:11,margin:'3px 0',color:'#bacbdc'}}>Storage estimate: {result?.quota ?? '—'}</p>
      <p style={{fontSize:11,margin:'7px 0',color:'#bad7eb'}}>{message}</p>
      <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,margin:'8px 0'}}>
        <input type="checkbox" checked={deep} onChange={e => setDeep(e.target.checked)}/> Deep scan (up to 2,500 records per database store/cache; rescan to apply)
      </label>
      <div style={{display:'flex',gap:7}}>
        <input aria-label="Search stored keys and values" placeholder="Search keys AND stored values…" value={query}
          onChange={e => {setQuery(e.target.value);setChosen(null);setReveal(false);}}
          style={{minWidth:0,flex:1,border:'1px solid #506a80',borderRadius:8,background:'#f7fbff',color:'#102536',padding:10,fontSize:14}}/>
        <select aria-label="Storage type" value={source}
          onChange={e => {setSource(e.target.value);setChosen(null);setReveal(false);}}
          style={{maxWidth:'37%',border:'1px solid #506a80',borderRadius:8,background:'#f7fbff',color:'#102536',padding:8,fontSize:12}}>
          {['All','localStorage','sessionStorage','Cookies','IndexedDB','Cache Storage'].map(name=><option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:8,gap:8}}>
        <span style={{fontSize:12}}><b>{matches.length}</b> matches / {result?.items.length ?? 0} entries</span>
        <button type="button" style={buttonStyle} onClick={() => void copyDiagnostic()} disabled={!result}>COPY KEY REPORT</button>
      </div>
    </header>
    <main style={{overflowY:'auto',flex:1,padding:'10px 12px',WebkitOverflowScrolling:'touch'}}>
      {selected && <section style={{border:'1px solid #4d8aa9',background:'#112c3d',borderRadius:10,padding:12,marginBottom:12}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:10}}>
          <strong>SELECTED VALUE</strong>
          <button type="button" style={buttonStyle} onClick={() => {setChosen(null);setReveal(false);}}>DISMISS</button>
        </div>
        <p style={{fontSize:12,overflowWrap:'anywhere',margin:'7px 0'}}><b>{selected.source}</b> · {selected.location}</p>
        <p style={{fontSize:12,overflowWrap:'anywhere',margin:'7px 0'}}>Key: <b>{selected.key}</b></p>
        <p style={{fontSize:11,margin:'7px 0',color:'#b5cddc'}}>Length: {selected.size.toLocaleString()} characters {selected.shortened && '· value truncated for inspection'}</p>
        <div style={{display:'flex',gap:8,marginBottom:9}}>
          <button type="button" style={buttonStyle} onClick={() => setReveal(val=>!val)}>{reveal?'HIDE VALUE':'REVEAL VALUE'}</button>
          {reveal && <button type="button" style={buttonStyle} onClick={async()=>{
            try {await copyText(selected.value);setMessage('Selected value copied (truncated values copy only the scanned portion).');}
            catch(error){setMessage('Copy failed: '+errorText(error));}
          }}>COPY VALUE</button>}
        </div>
        {reveal ? <textarea aria-label="Selected stored value" readOnly value={selected.value} spellCheck={false}
          style={{boxSizing:'border-box',width:'100%',minHeight:130,maxHeight:300,borderRadius:8,padding:10,background:'#eaf2fa',
            color:'#102536',fontSize:12,fontFamily:'monospace',overflowWrap:'anywhere',resize:'vertical'}}/>
          : <p style={{fontSize:12,opacity:.75}}>Value hidden until you press Reveal. Search still examines its contents.</p>}
      </section>}
      {matches.slice(0,650).map(item=><button type="button" key={item.id}
        onClick={()=>{setChosen(item.id);setReveal(false);}}
        style={{display:'block',width:'100%',textAlign:'left',padding:'10px 11px',marginBottom:6,borderRadius:9,
          border:item.id===chosen?'1px solid #82c5e7':'1px solid #2b435a',
          background:item.id===chosen?'#23475d':'#14283b',color:'#eaf2fc',cursor:'pointer'}}>
        <span style={{fontSize:10,color:'#94d5ee'}}>{item.source} · {item.location}</span>
        <span style={{fontSize:13,fontWeight:650,display:'block',overflowWrap:'anywhere',marginTop:3}}>{item.key}</span>
        <span style={{fontSize:10,color:'#b5c8d8'}}>
          {sensitive(item) ? 'Sensitive-looking key · value hidden' : item.value.length ? item.value.slice(0,70).replace(/\s+/g,' ') : '(empty value)'}
          {' · '}{item.size.toLocaleString()} chars
        </span>
      </button>)}
      {matches.length > 650 && <p style={{fontSize:12,color:'#efcc91'}}>Showing first 650 matches. Narrow your search to view more.</p>}
      {result && matches.length === 0 && <p style={{fontSize:13}}>No matching entries in scanned JavaScript-accessible storage.</p>}
      <details style={{border:'1px solid #2b435a',borderRadius:9,padding:10,margin:'15px 0'}}>
        <summary style={{fontWeight:700,fontSize:13}}>SCAN COVERAGE / ERRORS</summary>
        {(result?.info ?? []).map((info,index)=><p key={index} style={{fontSize:11,color:info.error?'#ffc49e':'#bbd4e2',overflowWrap:'anywhere'}}>
          <b>{info.name}:</b> {info.detail}
        </p>)}
        <p style={{fontSize:11,color:'#bbd4e2'}}>Scans the current JavaScript origin only. Cross-origin parent storage, native Android MMKV data and HttpOnly cookies are not readable from this page. No storage is edited and nothing is uploaded.</p>
      </details>
    </main>
  </div>;
}
