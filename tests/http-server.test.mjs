import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { randomUUID,createHash } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { database } from '../scripts/database.mjs';
import { createRigServer } from '../scripts/http-server.mjs';
const origin='https://rig.external.test',token='test-only-bootstrap-key-at-least-32-characters',password='Production-test-only-2026!';
async function host(db,options={}){
  const server=createRigServer({db,publicOrigin:origin,setupToken:token,...options});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return {server,port:server.address().port,async stop(){await new Promise(resolve=>server.close(resolve));}};
}
function client(port){let cookie='',csrf='';return {async call(path,method='GET',data,extra={}){
  const payload=data===undefined?undefined:JSON.stringify(data);
  return new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path,method,agent:false,headers:{Host:'rig.external.test',Origin:origin,...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{}),...extra}},res=>{
      let body='';res.setEncoding('utf8');res.on('data',x=>body+=x);res.on('end',()=>{if(res.headers['set-cookie'])cookie=res.headers['set-cookie'][0].split(';')[0];let value;try{value=JSON.parse(body);}catch{value=body;}if(path==='/api/session'&&res.statusCode===200)csrf=value.csrf;resolve({status:res.statusCode,headers:res.headers,value});});
    });req.on('error',reject);req.end(payload);
  });
},async setup(){const r=await this.call('/api/setup','POST',{username:'engineer',password,setupToken:token});assert.equal(r.status,200);await this.call('/api/session');return r;},async login(){assert.equal((await this.call('/api/login','POST',{username:'engineer',password})).status,200);await this.call('/api/session');}};}
test('ordinary HTTP hosting exposes a login page and health endpoint without a ChatGPT account',async()=>{
  const db=database(),h=await host(db);try{const c=client(h.port);
    assert.equal((await c.call('/')).status,200);assert.match((await c.call('/')).value,/登录工作台/);
    const status=(await c.call('/api/status')).value;assert.equal(status.setupRequired,true);assert.equal(status.ownerSignInRequired,false);assert.equal(status.setupAvailable,true);
    assert.equal((await c.call('/api/state')).status,401);
    assert.equal((await c.call('/healthz','GET',undefined,{Host:'healthcheck.railway.app'})).status,200);
  }finally{await h.stop();db.close();}
});
test('HTTPS router preserves secure cookies, origin validation and login session',async()=>{
  const db=database(),h=await host(db);try{const c=client(h.port),setup=await c.setup();
    assert.match(setup.headers['set-cookie'][0],/^__Host-rig_session=.*; HttpOnly; SameSite=Strict;.*Secure/);
    assert.equal((await c.call('/workspace')).status,200);
    assert.equal((await c.call('/api/logout','POST',{}, {Origin:'https://elsewhere.test'})).status,403);
    assert.equal((await c.call('/api/logout','POST',{})).status,200);assert.equal((await c.call('/api/state')).status,401);
  }finally{await h.stop();db.close();}
});
test('independent host ignores forged Sites identities and client CF IP headers',async()=>{
  const db=database(),h=await host(db,{trustProxy:true});try{const c=client(h.port);
    assert.equal((await c.call('/api/setup','POST',{username:'engineer',password},{'oai-authenticated-user-id':'fake','oai-authenticated-user-email':'owner@example.test','cf-connecting-ip':'1.1.1.1','x-real-ip':'203.0.113.10'})).status,403);
    const bucket='ip:'+createHash('sha256').update('203.0.113.10').digest('hex');assert.ok(db.raw.prepare('SELECT * FROM login_limits WHERE bucket=?').get(bucket));
    assert.equal((await c.call('/','GET',undefined,{Host:'evil.test','x-forwarded-host':'evil.test'})).status,421);
  }finally{await h.stop();db.close();}
});
test('saved shared data and update log survive a complete standalone server restart',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'rig-host-')),file=join(folder,'rig.sqlite');let db=database(file),h=await host(db);
  try{let c=client(h.port);await c.setup();const state=(await c.call('/api/state')).value;
    state.snapshot.parameters.H=2760;state.snapshot.parameters.maxAngle=12.5;state.snapshot.tilt=true;
    const result=await c.call('/api/state','POST',{baseVersion:state.version,snapshot:state.snapshot,updater:'台架工程师',content:'普通浏览器版修改参数并保存',requestId:randomUUID()});assert.equal(result.status,200);
    await h.stop();db.close();db=database(file);h=await host(db,{setupToken:undefined});c=client(h.port);await c.login();
    assert.deepEqual((await c.call('/api/state')).value.snapshot,state.snapshot);
    const logs=(await c.call('/api/history')).value.items;assert.equal(logs.length,1);assert.equal(logs[0].updater,'台架工程师');assert.equal(logs[0].content,'普通浏览器版修改参数并保存');
  }finally{await h.stop();db.close();rmSync(folder,{recursive:true,force:true});}
});
test('first production start refuses to expose an unprotected administrator setup',()=>{
  const folder=mkdtempSync(join(tmpdir(),'rig-start-'));
  try{const r=spawnSync(process.execPath,['scripts/serve.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8',env:{...process.env,PUBLIC_ORIGIN:origin,DATA_DIR:folder,RIG_SETUP_TOKEN:'',PORT:'3000'}});
    assert.notEqual(r.status,0);assert.match(r.stderr,/Set a secret RIG_SETUP_TOKEN/);
  }finally{rmSync(folder,{recursive:true,force:true});}
});
test('standalone origin rejects embedded credentials and paths',()=>{
  const db=database();try{assert.throws(()=>createRigServer({db,publicOrigin:'https://user:password@rig.external.test'}),/plain HTTP/);assert.throws(()=>createRigServer({db,publicOrigin:origin+'/some-path'}),/plain HTTP/);}finally{db.close();}
});
