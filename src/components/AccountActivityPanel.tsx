import { useCallback, useEffect, useState } from 'react';
import { getAuthTokenAsync, useUserInfo } from '@aippy/runtime/user';
import { createAccountClient } from '@/lib/accountActivityClient.mjs';

type Entry = { projectId: string; name: string; templateId: string; publishStatus: number | null; collected: boolean };
type Listing = { items: Entry[]; total: number; pagesLoaded: number; completed: boolean };
type Outcome = { liked: 'YES' | 'NO' | 'UNKNOWN'; favorites?: Listing & { match: Entry | null }; owned?: Listing; errors: string[]; requests: unknown[] };
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
