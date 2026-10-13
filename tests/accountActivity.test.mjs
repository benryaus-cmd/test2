import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountClient } from '../src/lib/accountActivityClient.mjs';
import worker from '../relay/worker.mjs';
function mockApi(pages) {
  return async (url, options) => {
    assert.match(options.headers.Authorization, /^Bearer /);
    const u = new URL(url);
    return Response.json(pages[u.pathname + ':' + u.searchParams.get('page')] ?? {code:0,data:{list:[],total:0}});
  };
}
test('all favourites pages are checked by projectId, not template ID', async () => {
  const first = Array.from({length:12}, (_,i)=>({projectId:1000+i,id:i+1}));
  const c=createAccountClient({getToken:async()=>'runtime-token',fetchImpl:mockApi({
    '/api/template/favorites/list:1':{code:0,data:{list:first,total:13}},
    '/api/template/favorites/list:2':{code:0,data:{list:[{projectId:7102340,id:2647174,name:'Dead City'}],total:13}}
  })});
  const r=await c.favourites('8243796','7102340');
  assert.equal(r.liked,'YES'); assert.equal(r.match.templateId,'2647174'); assert.equal(r.pagesLoaded,2);
});
test('full list absence means NO, not UNKNOWN',async()=>{
  const c=createAccountClient({getToken:async()=>'a',fetchImpl:mockApi({'/api/template/favorites/list:1':{code:0,data:{list:[],total:0}}})});
  assert.equal((await c.favourites('8243796','7102340')).liked,'NO');
});
test('projects owned include unpublished drafts (id is projectId)',async()=>{
  const c=createAccountClient({getToken:async()=>'a',fetchImpl:mockApi({'/api/project:1':{code:0,data:{list:[{id:7227296,template_id:0,publishStatus:0,name:'Aippy Engagement Tester'}],total:1}}})});
  const r=await c.ownedProjects('8243796');
  assert.equal(r.items[0].projectId,'7227296'); assert.equal(r.items[0].publishStatus,0);
});
test('expired runtime token refreshes on API code 4011',async()=>{
  let calls=0, tokens=0;
  const c=createAccountClient({getToken:async()=>String(++tokens),fetchImpl:async()=>{
    calls++;return Response.json(calls===1?{code:4011,msg:'Token expired'}:{code:0,data:{list:[],total:0}});
  }});
  await c.favourites('8243796','7102340');assert.equal(calls,2);assert.equal(tokens,2);
});
test('worker responds to aippy.live CORS preflight',async()=>{
  const r=await worker.fetch(new Request('https://relay.example/api/project',{method:'OPTIONS',headers:{Origin:'https://preview--test.aippy.live'}}));
  assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://preview--test.aippy.live');
});

test('parallel favourites and owned-project reads reuse one runtime token request', async () => {
  let tokenCalls = 0;
  const c = createAccountClient({
    getToken: async () => { tokenCalls++; await new Promise(r => setTimeout(r, 5)); return 'token'; },
    fetchImpl: async () => Response.json({code:0,data:{list:[],total:0}})
  });
  await Promise.all([c.favourites('8243796','7102340'),c.ownedProjects('8243796')]);
  assert.equal(tokenCalls,1);
});

test('pasted Chrome Authorization header normalizes to plain JWT', async () => {
  const { normalizeBearerToken, credentialKind } = await import('../src/lib/accountActivityClient.mjs');
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjgyNDM3OTZ9.signature';
  assert.equal(normalizeBearerToken('  Bearer ' + jwt + '  '), jwt);
  assert.equal(credentialKind(jwt), 'JWT');
  assert.equal(credentialKind('ofpb3WshW3tmSZQW1LPLYzskZ1D'), 'OPAQUE');
});
test('manually provided Chrome Bearer is sent unchanged and 4011 is not retried', async () => {
  let calls = 0;
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjgyNDM3OTZ9.signature';
  const client = createAccountClient({
    getToken: async () => 'Bearer ' + jwt,
    refreshOnAuthFailure: false,
    fetchImpl: async (_url, options) => {
      calls++;
      assert.equal(options.headers.Authorization, 'Bearer ' + jwt);
      return Response.json({code:4011,msg:'Token expired, please refresh.'});
    }
  });
  await assert.rejects(client.ownedProjects('8243796'), /API code 4011/);
  assert.equal(calls, 1);
});
test('manual Chrome Bearer returns liked and draft information using real API response shapes', async () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjgyNDM3OTZ9.signature';
  const fetchImpl = mockApi({
    '/api/template/favorites/list:1': {code:0,msg:'ok',data:{list:[{id:2647174,projectId:7102340,name:'Dead City',favorite:true}],total:1,page:1,size:12}},
    '/api/project:1': {code:0,msg:'ok',data:{list:[{id:7227296,uid:8243796,name:'Aippy Engagement Tester',publishStatus:0}],total:1,page:1,size:500}}
  });
  const client = createAccountClient({getToken:async()=>jwt,refreshOnAuthFailure:false,fetchImpl});
  const [favourites,owned] = await Promise.all([client.favourites('8243796','7102340'),client.ownedProjects('8243796')]);
  assert.equal(favourites.liked,'YES'); assert.equal(favourites.match.name,'Dead City');
  assert.equal(owned.items[0].publishStatus,0);
});
