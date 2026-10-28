import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from '../scripts/database.mjs';
import worker from '../dist/server/index.js';
const origin='https://rig.example.test',password='A-test-password-only-2026';
function client(env){let cookie='',csrf='';return {async call(path,method='GET',data,headers={}){
  const r=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers},...(data!==undefined?{body:JSON.stringify(data)}:{})}),env);
  if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  const text=await r.text();let value;try{value=JSON.parse(text);}catch{value=text;}if(path==='/api/session'&&r.ok)csrf=value.csrf;
  return {status:r.status,value,headers:r.headers};
},async login(){assert.equal((await this.call('/api/login','POST',{username:'engineer',password})).status,200);await this.call('/api/session');}};}
async function fixture(filename){const env={DB:database(filename),SETUP_TOKEN:'test-only-setup-key'};const c=client(env);assert.equal((await c.call('/api/setup','POST',{username:'engineer',password,setupToken:env.SETUP_TOKEN})).status,200);await c.call('/api/session');return {env,c};}
const save=(state,extra={})=>({baseVersion:state.version,snapshot:structuredClone(state.snapshot),updater:'测试工程师',content:'调整台架参数',requestId:randomUUID(),...extra});
test('anonymous access cannot read workspace, state, revisions or logs',async()=>{
  const env={DB:database()};try{const c=client(env);const login=await c.call('/');assert.equal(login.status,200);assert.match(login.value,/登录工作台/);assert.doesNotMatch(login.value,/const initial=/);
    for(const path of ['/api/state','/api/history','/api/revision?id=1','/api/session'])assert.equal((await c.call(path)).status,401);
    assert.equal((await c.call('/app.js')).status,303);assert.equal((await c.call('/workspace')).status,303);
  }finally{env.DB.close();}
});
test('setup is token protected, single use and stores only salted password hash',async()=>{
  const env={DB:database(),SETUP_TOKEN:'one-time-key'};try{const c=client(env);
    assert.equal((await c.call('/api/setup','POST',{username:'engineer',password,setupToken:'wrong'})).status,403);
    assert.equal((await c.call('/api/setup','POST',{username:'engineer',password:'short',setupToken:env.SETUP_TOKEN})).status,400);
    const created=await c.call('/api/setup','POST',{username:'engineer',password,setupToken:env.SETUP_TOKEN});assert.equal(created.status,200);assert.match(created.headers.get('set-cookie'),/HttpOnly; SameSite=Strict.*Secure/);
    const user=env.DB.raw.prepare('SELECT * FROM users').get();assert.notEqual(user.password_hash,password);assert.equal(user.password_hash.length,64);assert.equal(user.salt.length,64);
    assert.equal((await c.call('/api/setup','POST',{username:'another',password,setupToken:env.SETUP_TOKEN})).status,409);
  }finally{env.DB.close();}
});
test('login, logout and server-side session expiry are enforced',async()=>{
  const {env,c}=await fixture();try{const second=client(env);
    assert.equal((await second.call('/api/login','POST',{username:'engineer',password:'incorrect'})).status,401);
    await second.login();assert.equal((await second.call('/api/state')).status,200);
    assert.equal((await second.call('/api/logout','POST',{})).status,200);assert.equal((await second.call('/api/state')).status,401);
    env.DB.raw.prepare('UPDATE sessions SET expires_at=0').run();assert.equal((await c.call('/api/state')).status,401);
  }finally{env.DB.close();}
});
test('shared parameters and log commit atomically, load on another login and persist after restart',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'rig-test-')),file=join(folder,'rig.sqlite');let env;
  try{const f=await fixture(file);env=f.env;const c=f.c;const state=(await c.call('/api/state')).value;assert.equal(Object.keys(state.snapshot.parameters).length,30);
    const data=save(state);data.snapshot.parameters.H=2700;data.snapshot.parameters.maxAngle=12.5;data.snapshot.mode='both';data.snapshot.tilt=true;
    const result=await c.call('/api/state','POST',data);assert.equal(result.status,200);assert.equal(result.value.version,1);
    const other=client(env);await other.login();const shared=(await other.call('/api/state')).value;assert.deepEqual(shared.snapshot,data.snapshot);assert.equal(shared.updater,data.updater);
    const logs=(await other.call('/api/history')).value.items;assert.equal(logs.length,1);assert.equal(logs[0].content,data.content);assert.equal(logs[0].account,'engineer');
    env.DB.close();env.DB=database(file);assert.deepEqual((await other.call('/api/state')).value.snapshot,data.snapshot);
  }finally{env?.DB.close();rmSync(folder,{recursive:true,force:true});}
});
test('required update metadata, invalid parameters, origin and CSRF checks do not create revisions',async()=>{
  const {env,c}=await fixture();try{const state=(await c.call('/api/state')).value;
    assert.equal((await c.call('/api/state','POST',save(state,{updater:' '}))).status,400);
    assert.equal((await c.call('/api/state','POST',save(state,{content:''}))).status,400);
    const missing=save(state);delete missing.snapshot.parameters.H;assert.equal((await c.call('/api/state','POST',missing)).status,400);
    const zero=save(state);zero.snapshot.parameters.H=0;assert.equal((await c.call('/api/state','POST',zero)).status,400);
    const nan=save(state);nan.snapshot.parameters.H=null;assert.equal((await c.call('/api/state','POST',nan)).status,400);
    assert.equal((await c.call('/api/state','POST',save(state),{Origin:'https://evil.test'})).status,403);
    assert.equal((await c.call('/api/state','POST',save(state),{'X-CSRF-Token':'wrong'})).status,403);
    assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM revisions').get().n,0);
  }finally{env.DB.close();}
});
test('concurrent saves reject stale versions and repeated requests are idempotent',async()=>{
  const {env,c}=await fixture();try{const state=(await c.call('/api/state')).value,a=save(state),b=save(state);a.snapshot.parameters.H=2600;b.snapshot.parameters.H=2800;
    const results=await Promise.all([c.call('/api/state','POST',a),c.call('/api/state','POST',b)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const winner=results[0].status===200?a:b;assert.equal((await c.call('/api/state','POST',winner)).status,200);assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM revisions').get().n,1);
    assert.deepEqual((await c.call('/api/state')).value.snapshot,winner.snapshot);
  }finally{env.DB.close();}
});
test('login attempts are throttled',async()=>{
  const {env}=await fixture();try{const c=client(env);for(let i=0;i<10;i++)assert.equal((await c.call('/api/login','POST',{username:'engineer',password:'wrong'})).status,401);
    assert.equal((await c.call('/api/login','POST',{username:'engineer',password:'wrong'})).status,429);
  }finally{env.DB.close();}
});
test('history pagination and authenticated version export preserve saved snapshots',async()=>{
  const {env,c}=await fixture();try{let state=(await c.call('/api/state')).value;
    for(let i=1;i<=32;i++){const d=save(state);d.snapshot.parameters.H=2584+i;const r=await c.call('/api/state','POST',d);assert.equal(r.status,200);state={version:r.value.version,snapshot:d.snapshot};}
    const page=(await c.call('/api/history')).value;assert.equal(page.items.length,30);assert.equal(page.items[0].id,32);assert.equal(page.nextBefore,3);
    const older=(await c.call('/api/history?before='+page.nextBefore)).value;assert.deepEqual(older.items.map(x=>x.id),[2,1]);assert.equal(older.nextBefore,null);
    assert.equal((await c.call('/api/revision?id=1')).value.snapshot.parameters.H,2585);
  }finally{env.DB.close();}
});
test('malformed payload and oversized body return bounded errors',async()=>{
  const {env,c}=await fixture();try{assert.equal((await c.call('/api/state','POST',null)).status,400);assert.equal((await c.call('/api/state','POST',{content:'x'.repeat(40000)})).status,413);
  }finally{env.DB.close();}
});
test('Sites first setup requires the configured owner identity and closes after initialization',async()=>{
  const env={DB:database(),SETUP_OWNER_EMAIL:'owner@example.test'};try{const c=client(env),payload={username:'engineer',password};
    assert.equal((await c.call('/api/status')).value.ownerSignInRequired,true);
    assert.equal((await c.call('/api/setup','POST',payload)).status,403);
    assert.equal((await c.call('/api/setup','POST',payload,{'oai-authenticated-user-id':'someone','oai-authenticated-user-email':'other@example.test'})).status,403);
    const headers={'oai-authenticated-user-id':'site-specific-owner-id','oai-authenticated-user-email':env.SETUP_OWNER_EMAIL};
    assert.equal((await c.call('/api/status','GET',undefined,headers)).value.ownerSetup,true);
    assert.equal((await c.call('/api/setup','POST',payload,headers)).status,200);
    assert.equal((await c.call('/api/setup','POST',payload,headers)).status,409);
  }finally{env.DB.close();}
});
