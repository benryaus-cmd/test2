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
