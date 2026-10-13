import { useCallback, useEffect, useState } from 'react';
import { getAuthTokenAsync, useUserInfo } from '@aippy/runtime/user';
import { createAippyHeadersAsync } from '@aippy/runtime/core';
import { createAccountClient, normalizeBearerToken, credentialKind } from '@/lib/accountActivityClient.mjs';

type Entry = { projectId: string; name: string; templateId: string; publishStatus: number | null; collected: boolean };
type Listing = { items: Entry[]; total: number; pagesLoaded: number; completed: boolean };
type Outcome = { liked: 'YES' | 'NO' | 'UNKNOWN'; favorites?: Listing & { match: Entry | null }; owned?: Listing; errors: string[]; requests: unknown[] };
type RuntimeHeaderResult = { endpoint: string; headersSent: string[]; httpStatus: number | null; appCode: string | number | null; message: string; listLength: number | null; error?: string };
function savedRelay() { try { return localStorage.getItem('aippy-account-relay') ?? ''; } catch { return ''; } }
function resolveInput(value: string) {
  const v = value.trim();
  if (/^\d+$/.test(v)) return v;
  const path = v.match(/\/project\/(\d+)/);
  return path?.[1] ?? '';
}
export default function AccountActivityPanel() {
  const user = useUserInfo();
  const [input, setInput] = useState('7102340');
  const [relay, setRelay] = useState(savedRelay);
  const [relayInput, setRelayInput] = useState(savedRelay);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [progress, setProgress] = useState('');
  const [showOwned, setShowOwned] = useState(false);
  const [showLikes, setShowLikes] = useState(false);
  const [revealedToken, setRevealedToken] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenMessage, setTokenMessage] = useState('');
  const [tokenClaims, setTokenClaims] = useState<Record<string, unknown> | null>(null);
  const [runtimeHeaderBusy, setRuntimeHeaderBusy] = useState(false);
  const [runtimeHeaderResults, setRuntimeHeaderResults] = useState<RuntimeHeaderResult[] | null>(null);
  const [runtimeHeaderStatus, setRuntimeHeaderStatus] = useState('');
  const runRuntimeHeaderTest = async () => {
    if (!user.uid) { setRuntimeHeaderStatus('Wait for your Aippy account UID to load.'); return; }
    setRuntimeHeaderBusy(true);
    setRuntimeHeaderResults(null);
    setRuntimeHeaderStatus('Requesting Aippy runtime headers from the SDK…');
    const endpoints = [
      { label: 'Owned projects', path: '/api/project?page=1&size=1&uid=' + encodeURIComponent(String(user.uid)) },
      { label: 'Favourites', path: '/api/template/favorites/list?targetUid=' + encodeURIComponent(String(user.uid)) + '&page=1&size=1' }
    ];
    try {
      const results: RuntimeHeaderResult[] = [];
      for (const endpoint of endpoints) {
        const result: RuntimeHeaderResult = {
          endpoint: endpoint.label, headersSent: [], httpStatus: null,
          appCode: null, message: '', listLength: null
        };
        try {
          const headers = await createAippyHeadersAsync({ Accept: 'application/json' });
          result.headersSent = [...headers.keys()];
          if (!headers.has('Aippy-Runtime-Authorization')) throw new Error('SDK did not provide Aippy-Runtime-Authorization');
          setRuntimeHeaderStatus('Calling ' + endpoint.label + ' with the SDK runtime header…');
          const response = await fetch('https://api.aippy.ai' + endpoint.path, {
            method: 'GET', cache: 'no-store', credentials: 'omit', headers
          });
          result.httpStatus = response.status;
          const body: unknown = await response.json();
          if (body && typeof body === 'object') {
            const data = body as {code?: number | string; msg?: string; message?: string; data?: {list?: unknown[]}};
            result.appCode = data.code ?? null;
            result.message = String(data.msg ?? data.message ?? '');
            result.listLength = Array.isArray(data.data?.list) ? data.data.list.length : null;
          } else {
            result.message = 'Response was not a JSON object';
          }
        } catch (error) {
          result.error = String(error instanceof Error ? error.message : error);
        }
        results.push(result);
      }
      setRuntimeHeaderResults(results);
      setRuntimeHeaderStatus('Runtime-header test finished. Compare the HTTP and API codes below.');
    } catch (error) {
      setRuntimeHeaderStatus('Could not obtain runtime headers: ' + String(error instanceof Error ? error.message : error));
    } finally {
      setRuntimeHeaderBusy(false);
    }
  };
  const [manualBearerInput, setManualBearerInput] = useState('');
  const [manualVisible, setManualVisible] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualOutcome, setManualOutcome] = useState<Outcome | null>(null);
  const [manualProgress, setManualProgress] = useState('');
  const manualToken = normalizeBearerToken(manualBearerInput);
  const manualCredentialKind = credentialKind(manualToken);
  const manualJwtInfo = (() => {
    if (manualCredentialKind !== 'JWT') return null;
    try {
      const payload = JSON.parse(atob(manualToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return {
        uid: String(payload.userId ?? payload.uid ?? ''),
        issuer: String(payload.iss ?? ''),
        expires: typeof payload.exp === 'number' ? new Date(payload.exp * 1000).toLocaleString() : 'not supplied',
        expired: typeof payload.exp === 'number' ? Date.now() >= payload.exp * 1000 : null
      };
    } catch { return null; }
  })();
  const revealBearerToken = async () => {
    setTokenBusy(true);
    setTokenMessage('');
    try {
      const value: unknown = await getAuthTokenAsync();
      const token = typeof value === 'string' ? value : (
        value !== null && typeof value === 'object' && 'token' in value && typeof value.token === 'string'
          ? value.token : ''
      );
      if (!token) throw new Error('Aippy returned no Bearer token');
      setRevealedToken(token);
      try {
        const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        setTokenClaims({
          issuer: claims.iss ?? null,
          type: claims.type ?? null,
          uid: claims.userId ?? claims.uid ?? null,
          expires: typeof claims.exp === 'number' ? new Date(claims.exp * 1000).toLocaleString() : null,
          expired: typeof claims.exp === 'number' ? Date.now() >= claims.exp * 1000 : null
        });
      } catch { setTokenClaims(null); }
      setTokenMessage('Current Aippy credential retrieved. Select or copy the field below.');
    } catch (error) {
      setTokenClaims(null);
      setRevealedToken('');
      setTokenMessage('Token request failed: ' + String(error instanceof Error ? error.message : error));
    } finally {
      setTokenBusy(false);
    }
  };
  const copyBearerToken = async () => {
    if (!revealedToken) return;
    try {
      await navigator.clipboard.writeText(revealedToken);
      setTokenMessage('Bearer token copied.');
    } catch {
      setTokenMessage('Select the token text and use Copy.');
    }
  };
  const runManualCheck = async () => {
    const projectId = resolveInput(input);
    const token = normalizeBearerToken(manualBearerInput);
    if (!token || !user.uid || !projectId) {
      setManualProgress('Enter a Chrome Bearer token, a target project ID and load your Aippy identity first.');
      return;
    }
    setManualBusy(true);
    setManualProgress('Testing pasted Chrome Bearer against the real Aippy API');
    setManualOutcome(null);
    const logs: unknown[] = [], errors: string[] = [];
    const client = createAccountClient({
      getToken: async () => token,
      relayBase: relay,
      refreshOnAuthFailure: false,
      onRequest: (record: unknown) => logs.push(record)
    });
    try {
      const results = await Promise.allSettled([
        client.favourites(user.uid, projectId, (page: { pagesLoaded: number; entriesLoaded: number }) =>
          setManualProgress('Chrome Bearer: favourites page ' + page.pagesLoaded + ', ' + page.entriesLoaded + ' loaded')),
        client.ownedProjects(user.uid, (page: { entriesLoaded: number }) =>
          setManualProgress('Chrome Bearer: owned projects ' + page.entriesLoaded + ' loaded'))
      ]);
      const next: Outcome = { liked: 'UNKNOWN', requests: logs, errors };
      if (results[0].status === 'fulfilled') {
        next.favorites = results[0].value;
        next.liked = results[0].value.liked;
      } else errors.push('Favourites: ' + String(results[0].reason instanceof Error ? results[0].reason.message : results[0].reason));
      if (results[1].status === 'fulfilled') next.owned = results[1].value;
      else errors.push('Owned projects: ' + String(results[1].reason instanceof Error ? results[1].reason.message : results[1].reason));
      setManualOutcome(next);
      setManualProgress(errors.length ? 'Manual Bearer test returned errors; inspect the API responses below.' : 'Chrome Bearer test completed.');
    } catch {
      setManualOutcome({ liked: 'UNKNOWN', requests: logs, errors: ['Unexpected account test failure'] });
      setManualProgress('Manual request failed.');
    } finally {
      setManualBusy(false);
    }
  };
  const check = useCallback(async () => {
    const projectId = resolveInput(input);
    if (!user.uid || !projectId) { setProgress('Provide a numeric project ID or /project/ID link and wait for your Aippy user profile.'); return; }
    setBusy(true); setProgress('Getting current Aippy session');
    const logs: unknown[] = [], errors: string[] = [];
    const client = createAccountClient({ getToken: getAuthTokenAsync, relayBase: relay,
      onRequest: (r: unknown) => logs.push(r) });
    const results = await Promise.allSettled([
      client.favourites(user.uid, projectId, (p: { pagesLoaded: number; entriesLoaded: number }) => setProgress('Reading favourites page ' + p.pagesLoaded + ' (' + p.entriesLoaded + ' loaded)')),
      client.ownedProjects(user.uid, (p: { entriesLoaded: number }) => setProgress('Reading my projects (' + p.entriesLoaded + ' loaded)'))
    ]);
    const next: Outcome = { liked: 'UNKNOWN', errors, requests: logs };
    if (results[0].status === 'fulfilled') { next.favorites = results[0].value; next.liked = results[0].value.liked; }
    else errors.push('Favourites: ' + String(results[0].reason?.message ?? results[0].reason));
    if (results[1].status === 'fulfilled') next.owned = results[1].value;
    else errors.push('Owned projects: ' + String(results[1].reason?.message ?? results[1].reason));
    setOutcome(next); setBusy(false); setProgress('Account check complete');
  }, [input, relay, user.uid]);
  useEffect(() => { if (user.uid) void check(); }, [user.uid]);
  const saveRelay = () => {
    const value = relayInput.trim().replace(/\/+$/, '');
    try { if (value) localStorage.setItem('aippy-account-relay', value); else localStorage.removeItem('aippy-account-relay'); } catch {}
    setRelay(value); setProgress('Request route updated. Run account check again.');
  };
  const owned = outcome?.owned?.items ?? [], favorites = outcome?.favorites?.items ?? [];
  const published = owned.filter(item => item.publishStatus === 1).length;
  const metrics = [
    ['LIKED BY ME', outcome?.liked ?? 'UNKNOWN'],
    ['LIKED PROJECTS', outcome?.favorites?.total ?? '—'],
    ['MY CREATED PROJECTS', outcome?.owned?.total ?? '—'],
    ['PUBLISHED / OTHER', outcome?.owned ? published + ' / ' + (owned.length - published) : '—']
  ];
  return <section className="panel" style={{ margin: '14px 20px', padding: 16, maxWidth: 780 }} aria-label="Authenticated Aippy account">
    <p className="eyebrow">AIPPY ACCOUNT API</p>
    <h2 style={{fontSize:20,fontWeight:750,marginBottom:8}}>My likes and projects</h2>
    <p style={{fontSize:12,opacity:.75}}>Signed in as {user.username || 'Loading profile'} (UID {user.uid || '…'}). Uses your Aippy Bearer session to fetch liked games and every project you own, including unpublished drafts.</p>
    <label style={{display:'block',marginTop:12,fontSize:12}}>Project to check</label>
    <input value={input} onChange={e => setInput(e.target.value)} placeholder="7102340" style={{width:'100%',padding:10,borderRadius:10,border:'1px solid #ccd7e1',background:'#fff',color:'#243947'}}/>
    <button type="button" onClick={() => void check()} disabled={busy || !user.uid} style={{width:'100%',padding:14,margin:'12px 0',borderRadius:12,background:'#426c89',color:'white',fontWeight:700}}>
      {busy ? 'CHECKING ACCOUNT…' : 'CHECK MY LIKES & PROJECTS'}
    </button>
    <p style={{fontSize:12}}>{progress}</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:9,margin:'12px 0'}}>{metrics.map(([key,value]) => <div key={String(key)} style={{border:'1px solid #d9e2e9',borderRadius:11,padding:10,minWidth:0}}><small style={{display:'block',color:'#6a7d8b'}}>{key}</small><strong style={{fontSize:20}}>{value}</strong></div>)}</div>
    {outcome?.favorites?.match && <p style={{color:'#136c41'}}>Confirmed liked: {outcome.favorites.match.name} (project #{outcome.favorites.match.projectId}, template #{outcome.favorites.match.templateId})</p>}
    {outcome?.errors.map((e,i) => <p key={i} style={{color:'#a3342b',fontSize:12,overflowWrap:'anywhere'}}>{e}</p>)}
    <section style={{marginTop:14,padding:12,border:'1px solid #d9e2e9',borderRadius:12}}>
      <strong style={{display:'block',marginBottom:5}}>Native Aippy Runtime Header Test</strong>
      <p style={{fontSize:12,opacity:.8,marginBottom:9}}>Test the SDK's real <code>createAippyHeadersAsync()</code> headers against Aippy account endpoints. Uses your current Aippy session automatically, with no Chrome JWT or PowerShell.</p>
      <button type="button" disabled={!user.uid || runtimeHeaderBusy} onClick={() => { void runRuntimeHeaderTest(); }}
        style={{width:'100%',padding:'13px 10px',borderRadius:9,background:'#426c89',color:'white',fontWeight:700}}>
        {runtimeHeaderBusy ? 'TESTING RUNTIME HEADER…' : 'TEST RUNTIME AUTH HEADER'}
      </button>
      <p style={{fontSize:12,marginTop:8}}>{runtimeHeaderStatus}</p>
      {runtimeHeaderResults && <div style={{display:'grid',gap:9}}>
        {runtimeHeaderResults.map(item => <div key={item.endpoint} style={{padding:10,border:'1px solid #d9e2e9',borderRadius:9}}>
          <strong style={{fontSize:13}}>{item.endpoint}</strong>
          <div style={{display:'flex',gap:15,flexWrap:'wrap',marginTop:5}}>
            <span>HTTP: <strong>{item.httpStatus ?? '—'}</strong></span>
            <span>API code: <strong>{item.appCode ?? '—'}</strong></span>
            <span>Items: <strong>{item.listLength ?? '—'}</strong></span>
          </div>
          {item.message && <p style={{fontSize:12,overflowWrap:'anywhere'}}>Message: {item.message}</p>}
          {item.error && <p style={{fontSize:12,color:'#a3342b',overflowWrap:'anywhere'}}>Transport / SDK error: {item.error}</p>}
          <p style={{fontSize:11,opacity:.7,overflowWrap:'anywhere'}}>Header names: {item.headersSent.join(', ') || 'unavailable'}</p>
        </div>)}
        <details>
          <summary style={{fontSize:12}}>Copyable runtime-header evidence (credentials excluded)</summary>
          <pre style={{fontSize:10,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify({
            transport: 'direct browser',
            SDK: '@aippy/runtime@0.4.1',
            method: 'GET',
            results: runtimeHeaderResults
          }, null, 2)}</pre>
        </details>
      </div>}
    </section>
    <details open style={{marginTop:14,padding:'12px',border:'1px solid #d9e2e9',borderRadius:12}}>
      <summary style={{fontWeight:700}}>Developer: test a Chrome website Bearer token</summary>
      <p style={{fontSize:12}}>Paste the token you used successfully in PowerShell. Both raw JWT and `Bearer eyJ...` input are accepted. The test uses this credential rather than the native Aippy runtime token.</p>
      <label htmlFor="aippy-manual-bearer" style={{display:'block',fontSize:12,marginBottom:5}}>Chrome Authorization Bearer token</label>
      <input id="aippy-manual-bearer" type={manualVisible ? 'text' : 'password'} value={manualBearerInput}
        onChange={e => { setManualBearerInput(e.target.value); setManualOutcome(null); }}
        autoComplete="off" spellCheck={false} autoCapitalize="none"
        placeholder="Paste Chrome Bearer token here"
        style={{display:'block',boxSizing:'border-box',width:'100%',padding:11,borderRadius:9,border:'1px solid #b8c8d5',background:'#fff',color:'#193447',fontFamily:'monospace',fontSize:12}}/>
      <div style={{fontSize:12,margin:'8px 0'}}>
        Format: <strong>{manualCredentialKind}</strong>
        {manualJwtInfo && <> · Token UID: <strong>{manualJwtInfo.uid || 'not present'}</strong> · Expires: {manualJwtInfo.expires}
          {manualJwtInfo.expired && <strong style={{color:'#9c2828'}}> · EXPIRED</strong>}
          {manualJwtInfo.uid && String(user.uid) !== manualJwtInfo.uid && <strong style={{color:'#9c2828'}}> · DIFFERENT UID FROM AIPPY APP</strong>}
        </>}
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <button type="button" onClick={() => { void runManualCheck(); }} disabled={manualBusy || !manualToken || !user.uid}
          style={{padding:'11px 14px',borderRadius:8,background:'#426c89',color:'#fff',fontWeight:700}}>
          {manualBusy ? 'TESTING…' : 'TEST CHROME BEARER'}
        </button>
        <button type="button" onClick={() => setManualVisible(value => !value)}
          style={{padding:'9px 12px',borderRadius:8,border:'1px solid #b9c6d0'}}>
          {manualVisible ? 'MASK TOKEN' : 'SHOW TOKEN'}
        </button>
        <button type="button" onClick={() => {
          setManualBearerInput(''); setManualOutcome(null); setManualVisible(false); setManualProgress('Chrome token cleared.');
        }} style={{padding:'9px 12px',borderRadius:8,border:'1px solid #b9c6d0'}}>CLEAR</button>
      </div>
      <p style={{fontSize:12,marginTop:9}}>{manualProgress}</p>
      {manualOutcome && <>
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:9,margin:'12px 0'}}>
          {[
            ['CHROME TOKEN LIKED',manualOutcome.liked],
            ['CHROME FAVOURITES',manualOutcome.favorites?.total ?? '—'],
            ['CHROME OWNED PROJECTS',manualOutcome.owned?.total ?? '—'],
            ['FAVOURITE PAGES',manualOutcome.favorites?.pagesLoaded ?? '—']
          ].map(([key,value])=><div key={String(key)} style={{border:'1px solid #d9e2e9',borderRadius:9,padding:9,minWidth:0}}>
            <small style={{display:'block',fontSize:10}}>{key}</small><strong style={{fontSize:17}}>{value}</strong></div>)}
        </div>
        <p style={{fontSize:12}}>Comparison: Runtime token liked = <strong>{outcome?.liked ?? 'UNKNOWN'}</strong>, Chrome token liked = <strong>{manualOutcome.liked}</strong>.</p>
        {manualOutcome.favorites?.match && <p style={{fontSize:12,color:'#136c41'}}>Match: {manualOutcome.favorites.match.name} (project #{manualOutcome.favorites.match.projectId})</p>}
        {manualOutcome.errors.map((error,index)=><p key={index} style={{fontSize:12,color:'#a3342b',overflowWrap:'anywhere'}}>{error}</p>)}
        {manualOutcome.owned && <details><summary>Owned projects ({manualOutcome.owned.items.length})</summary>
          {manualOutcome.owned.items.map(item=><p key={item.projectId} style={{fontSize:12,margin:'5px 0'}}>{item.name} · #{item.projectId} · {item.publishStatus === 1 ? 'Published' : 'Unpublished'}</p>)}
        </details>}
        {manualOutcome.favorites && <details><summary>Liked projects ({manualOutcome.favorites.items.length})</summary>
          {manualOutcome.favorites.items.map(item=><p key={item.projectId} style={{fontSize:12,margin:'5px 0'}}>{item.name} · #{item.projectId}</p>)}
        </details>}
        <details><summary>Manual API diagnostic (credential excluded)</summary>
          <pre style={{fontSize:10,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify({
            transport: relay || 'direct browser',
            credentialFormat: manualCredentialKind,
            requests: manualOutcome.requests,
            errors: manualOutcome.errors,
            liked: manualOutcome.liked,
            favourites: manualOutcome.favorites ? { total:manualOutcome.favorites.total,pagesLoaded:manualOutcome.favorites.pagesLoaded,completed:manualOutcome.favorites.completed } : null,
            owned: manualOutcome.owned ? { total:manualOutcome.owned.total,pagesLoaded:manualOutcome.owned.pagesLoaded,completed:manualOutcome.owned.completed } : null
          },null,2)}</pre>
        </details>
      </>}
      <p style={{fontSize:11,opacity:.7}}>The pasted credential stays in this page's memory, is used in the Authorization header for these two account GET requests, and is excluded from reports. Closing or refreshing the app clears it.</p>
    </details>
    <details style={{marginTop:13}}><summary>Authenticated request route</summary>
      <p style={{fontSize:12}}>Aippy's browser API allows the aippy.ai origin. Published games on aippy.live can use the accompanying server relay (relay/worker.mjs).</p>
      <input aria-label="Relay origin" value={relayInput} onChange={e => setRelayInput(e.target.value)} placeholder="Relay endpoint (optional)" style={{width:'100%',padding:9,border:'1px solid #ccd7e1',borderRadius:8,color:'#243947',background:'#fff'}} />
      <button type="button" onClick={saveRelay} style={{marginTop:8,padding:'9px 16px',borderRadius:8,background:'#426c89',color:'#fff'}}>USE ROUTE</button>
      <p style={{fontSize:12}}>Transport: {relay || 'direct browser'}</p>
    </details>
    {outcome?.owned && <details open={showOwned} onToggle={e=>setShowOwned(e.currentTarget.open)} style={{marginTop:13}}>
      <summary>My projects ({owned.length}{outcome.owned.completed ? '' : '+'}), including drafts</summary>
      {(showOwned ? owned : owned.slice(0,12)).map(row=><div key={row.projectId} style={{display:'flex',justifyContent:'space-between',padding:7,borderBottom:'1px solid #e4eaf0',fontSize:12}}><b>{row.name}</b><span>#{row.projectId} · {row.publishStatus === 1 ? 'Published' : 'Draft/unpublished'}</span></div>)}
    </details>}
    {outcome?.favorites && <details open={showLikes} onToggle={e=>setShowLikes(e.currentTarget.open)} style={{marginTop:13}}>
      <summary>My liked games ({favorites.length}{outcome.favorites.completed ? '' : '+'})</summary>
      {(showLikes ? favorites : favorites.slice(0,12)).map(row=><div key={row.projectId} style={{display:'flex',justifyContent:'space-between',padding:7,borderBottom:'1px solid #e4eaf0',fontSize:12}}><b>{row.name}</b><span>#{row.projectId}</span></div>)}
    </details>}
    <details style={{marginTop:14,padding:'12px',border:'1px solid #d9e2e9',borderRadius:12}}>
      <summary style={{fontWeight:700}}>Developer: view current Aippy Bearer token</summary>
      <p style={{fontSize:12}}>Fetch the current signed-in account credential from the Aippy runtime. The value is shown only when requested and stays in this page's memory.</p>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'10px 0'}}>
        <button type="button" onClick={() => { void revealBearerToken(); }} disabled={tokenBusy} style={{padding:'10px 14px',borderRadius:8,background:'#426c89',color:'#fff'}}>
          {tokenBusy ? 'REQUESTING…' : 'REVEAL CURRENT BEARER TOKEN'}
        </button>
        {revealedToken && <button type="button" onClick={() => { void copyBearerToken(); }} style={{padding:'10px 14px',borderRadius:8,background:'#426c89',color:'#fff'}}>COPY TOKEN</button>}
        {revealedToken && <button type="button" onClick={() => { setRevealedToken(''); setTokenClaims(null); setTokenMessage('Token hidden.'); }} style={{padding:'10px 14px',borderRadius:8,border:'1px solid #b9c6d0'}}>HIDE TOKEN</button>}
      </div>
      {tokenMessage && <p style={{fontSize:12,overflowWrap:'anywhere'}}>{tokenMessage}</p>}
      {revealedToken && <>
        <label htmlFor="aippy-bearer-token" style={{display:'block',margin:'8px 0',fontSize:12,fontWeight:700}}>Bearer token (copy the entire value, without the word Bearer)</label>
        <textarea id="aippy-bearer-token" aria-label="Current Aippy Bearer token" readOnly spellCheck={false} value={revealedToken}
          onFocus={e => e.currentTarget.select()}
          style={{display:'block',width:'100%',minHeight:115,resize:'vertical',boxSizing:'border-box',fontFamily:'monospace',fontSize:12,color:'#172f43',background:'#f3f7fa',border:'1px solid #b9c6d0',borderRadius:8,padding:10,overflowWrap:'anywhere'}}/>
        {tokenClaims && <pre style={{fontSize:11,overflowWrap:'anywhere',whiteSpace:'pre-wrap'}}>{JSON.stringify(tokenClaims,null,2)}</pre>}
      </>}
    </details>
    {outcome && <details style={{marginTop:14}}><summary>Request evidence</summary><pre style={{whiteSpace:'pre-wrap',fontSize:10}}>{JSON.stringify({requests:outcome.requests,errors:outcome.errors,liked:outcome.liked,favourites:{total:outcome.favorites?.total,pages:outcome.favorites?.pagesLoaded,complete:outcome.favorites?.completed},owned:{total:outcome.owned?.total,pages:outcome.owned?.pagesLoaded,complete:outcome.owned?.completed}},null,2)}</pre></details>}
  </section>;
}
