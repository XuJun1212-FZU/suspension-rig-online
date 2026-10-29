import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,pbkdf2Sync,createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from '../scripts/database.mjs';
import worker from '../dist/server/index.js';
const origin='https://rig.password.test',oldPassword='Test-original-password-2026!',newPassword='Test-changed-password-2026!';
function client(env){let cookie='',csrf='';return {async call(path,method='GET',data,extra={}){
  const r=await worker.fetch(new Request(origin+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(data===undefined?{}:{'Content-Type':'application/json'}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
  if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
  const t=await r.text();let value;try{value=JSON.parse(t);}catch{value=t;}if(path==='/api/session'&&r.ok)csrf=value.csrf;
  return {status:r.status,value,headers:r.headers};
},async login(username='owner',password=oldPassword){return this.call('/api/login','POST',{username,password});}};}
async function fixture(){const db=database(),env={DB:db,SETUP_TOKEN:'test-only-bootstrap'};const c=client(env);assert.equal((await c.call('/api/setup','POST',{username:'owner',password:oldPassword,setupToken:env.SETUP_TOKEN})).status,200);return {db,env,c};}
const change=(extra={})=>({username:'owner',currentPassword:oldPassword,newPassword,confirmPassword:newPassword,...extra});
function record(username,password=oldPassword){const salt=randomBytes(32).toString('hex');return {username,salt,passwordHash:pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex')};}
test('login and direct account pages include the change-password window',async()=>{
  const {db,env,c}=await fixture();try{const anonymous=client(env);const page=await anonymous.call('/');assert.equal(page.status,200);assert.match(page.value,/rigPasswordForm/);assert.match(page.value,/确认新密码/);assert.match(page.value,/openPasswordChange/);
    assert.equal((await c.call('/change-password')).status,200);assert.equal((await c.call('/password.js')).status,200);
  }finally{db.close();}
});
test('password change verifies original password, accepts the new password and revokes all old sessions',async()=>{
  const {db,env,c}=await fixture();try{const second=client(env);assert.equal((await second.login()).status,200);const session=(await second.call('/api/session')).value;
    const saved=db.raw.prepare('SELECT * FROM sessions WHERE csrf=?').get(session.csrf);
    assert.equal((await c.call('/api/change-password','POST',change({currentPassword:'wrong'}))).status,401);
    const r=await c.call('/api/change-password','POST',change());assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
    assert.equal((await second.call('/api/state')).status,401);assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
    // A login that had observed the old credential generation cannot restore access.
    db.raw.prepare('INSERT INTO sessions (token_hash,username,csrf,expires_at,password_version) VALUES (?,?,?,?,?)').run(saved.token_hash,saved.username,saved.csrf,saved.expires_at,saved.password_version);
    assert.equal((await second.call('/api/state')).status,401);
    const fresh=client(env);assert.equal((await fresh.login()).status,401);assert.equal((await fresh.login('owner',newPassword)).status,200);
    const user=db.raw.prepare('SELECT * FROM users WHERE username=?').get('owner');assert.equal(user.password_version,1);assert.notEqual(user.password_hash,newPassword);
  }finally{db.close();}
});
test('invalid confirmation, short password and cross-origin requests do not change the account',async()=>{
  const {db,c}=await fixture();try{
    assert.equal((await c.call('/api/change-password','POST',change({confirmPassword:'does-not-match'}))).status,400);
    assert.equal((await c.call('/api/change-password','POST',change({newPassword:'short',confirmPassword:'short'}))).status,400);
    assert.equal((await c.call('/api/change-password','POST',change(),{Origin:'https://elsewhere.test'})).status,403);
    assert.equal(db.raw.prepare('SELECT password_version FROM users').get().password_version,0);
  }finally{db.close();}
});
test('concurrent password changes accept only one verified credential generation',async()=>{
  const {db,env}=await fixture();try{const a=client(env),b=client(env),otherPassword='Another-test-password-2026!';
    const results=await Promise.all([a.call('/api/change-password','POST',change()),b.call('/api/change-password','POST',change({newPassword:otherPassword,confirmPassword:otherPassword}))]);
    assert.equal(results.filter(r=>r.status===200).length,1);assert.ok(results.every(r=>[200,401,409].includes(r.status)));
    assert.equal((await client(env).login('owner',results[0].status===200?newPassword:otherPassword)).status,200);
    assert.equal(db.raw.prepare('SELECT password_version FROM users').get().password_version,1);
  }finally{db.close();}
});
test('bulk account provisioning creates seven users and never resets existing or changed passwords',async()=>{
  const {db,env}=await fixture();try{
    const users=Array.from({length:7},(_,i)=>record('test-user-'+i));users.push(record('owner','Different-test-default-2026!'));env.PROVISION_USERS_JSON=JSON.stringify(users);
    assert.equal((await client(env).call('/api/status')).status,200);assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n,8);
    assert.equal(new Set(users.slice(0,7).map(u=>u.passwordHash)).size,7);
    for(const user of users.slice(0,7))assert.equal((await client(env).login(user.username)).status,200);
    assert.equal((await client(env).login('owner')).status,200);
    assert.equal((await client(env).call('/api/change-password','POST',change({username:'test-user-0'}))).status,200);
    // Simulate a fresh Worker isolate while keeping the same production database.
    const freshEnv={...env,DB:{prepare:sql=>db.prepare(sql),batch:items=>db.batch(items)}};
    assert.equal((await client(freshEnv).call('/api/status')).status,200);
    assert.equal((await client(freshEnv).login('test-user-0',newPassword)).status,200);
    assert.equal((await client(freshEnv).login('test-user-0',oldPassword)).status,401);
  }finally{db.close();}
});
test('invalid bulk provisioning is rejected before inserting any account',async()=>{
  const db=database(),env={DB:db,PROVISION_USERS_JSON:JSON.stringify([record('valid-account'),{username:'invalid',salt:'bad',passwordHash:'bad'}])};
  try{assert.equal((await client(env).call('/api/status')).status,503);assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n,0);}finally{db.close();}
});
test('password generation migration preserves legacy users and sessions',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'rig-password-migration-')),filename=join(dir,'legacy.sqlite');let db;
  try{
    const legacy=new DatabaseSync(filename);legacy.exec(readFileSync(new URL('../drizzle/0000_rig.sql',import.meta.url),'utf8'));legacy.exec('CREATE TABLE _migrations (name TEXT PRIMARY KEY)');legacy.prepare('INSERT INTO _migrations VALUES (?)').run('0000_rig');
    const user=record('legacy-user'),token=randomBytes(32).toString('hex');legacy.prepare('INSERT INTO users VALUES (?,?,?,?)').run(user.username,user.passwordHash,user.salt,new Date().toISOString());
    legacy.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),user.username,'test-csrf',Date.now()+60000);legacy.close();
    db=database(filename);assert.equal(db.raw.prepare('SELECT password_version FROM users').get().password_version,0);assert.equal(db.raw.prepare('SELECT password_version FROM sessions').get().password_version,0);
    const r=await worker.fetch(new Request(origin+'/api/session',{headers:{Cookie:'__Host-rig_session='+token}}),{DB:db});assert.equal(r.status,200);assert.equal((await r.json()).username,user.username);
  }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});
