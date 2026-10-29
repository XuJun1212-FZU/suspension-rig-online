// ASSETS and DEFAULT_PARAMETERS are embedded by scripts/build.mjs.
const SESSION_SECONDS=12*60*60;
const encoder=new TextEncoder();
const random=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
const digest=async s=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(s)));
async function passwordHash(password,salt){
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:100000},key,256));
}
function equal(a,b){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
class ApiError extends Error{constructor(status,message,extra={}){super(message);this.status=status;this.extra=extra;}}
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8',...headers}});
const defaultSnapshot=()=>({parameters:{...DEFAULT_PARAMETERS},mode:'three',tilt:false});
// Only configure this binding behind Sites' trusted identity gateway, never on a raw public Worker.
const isSetupOwner=(request,env)=>!!env.SETUP_OWNER_EMAIL&&!!request.headers.get('oai-authenticated-user-id')&&request.headers.get('oai-authenticated-user-email')?.toLowerCase()===env.SETUP_OWNER_EMAIL.toLowerCase();
const provisionedBindings=new WeakMap();
async function provisionConfiguredUsers(env){
  const config=env.PROVISION_USERS_JSON;if(!config)return;
  const previous=provisionedBindings.get(env.DB);if(previous?.config===config)return previous.promise;
  const promise=(async()=>{
    let users;try{users=JSON.parse(config);}catch{throw new ApiError(503,'账号初始化配置无效，请联系管理员。');}
    if(!Array.isArray(users)||users.length<1||users.length>50||new Set(users.map(u=>u?.username)).size!==users.length)throw new ApiError(503,'账号初始化配置无效，请联系管理员。');
    for(const u of users)if(typeof u?.username!=='string'||!/^[A-Za-z0-9_.-]{3,40}$/.test(u.username)||typeof u.passwordHash!=='string'||!/^[a-f0-9]{64}$/.test(u.passwordHash)||typeof u.salt!=='string'||!/^[a-f0-9]{64}$/.test(u.salt))throw new ApiError(503,'账号初始化配置无效，请联系管理员。');
    const createdAt=new Date().toISOString();
    await env.DB.batch(users.map(u=>env.DB.prepare('INSERT INTO users (username,password_hash,salt,created_at) VALUES (?,?,?,?) ON CONFLICT(username) DO NOTHING').bind(u.username,u.passwordHash,u.salt,createdAt)));
  })();
  provisionedBindings.set(env.DB,{config,promise});
  try{await promise;}catch(e){if(provisionedBindings.get(env.DB)?.promise===promise)provisionedBindings.delete(env.DB);throw e;}
}
function validateSnapshot(s){
  if(!s||typeof s!=='object'||!s.parameters||Object.keys(s.parameters).length!==Object.keys(DEFAULT_PARAMETERS).length)throw new ApiError(400,'参数不完整，请重新读取最新数据。');
  const p=s.parameters;
  for(const key of Object.keys(DEFAULT_PARAMETERS))if(typeof p[key]!=='number'||!Number.isFinite(p[key])||Math.abs(p[key])>100000)throw new ApiError(400,`参数 ${key} 必须是有效数值（绝对值不大于 100000）。`);
  for(const key of ['H','loadMin','loadStroke','susStroke','roadMin','roadStroke','road5Min','sus3Min','sus5Min'])if(p[key]<=0)throw new ApiError(400,`${key} 必须大于 0。`);
  if(!['three','five','both'].includes(s.mode)||typeof s.tilt!=='boolean')throw new ApiError(400,'方案视图或倾转设置无效。');
  return {parameters:Object.fromEntries(Object.keys(DEFAULT_PARAMETERS).map(k=>[k,p[k]])),mode:s.mode,tilt:s.tilt};
}
async function body(request){
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new ApiError(415,'需要 JSON 请求。');
  const reader=request.body?.getReader();if(!reader)throw new ApiError(400,'请求为空。');
  let size=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();throw new ApiError(413,'提交内容过长。');}chunks.push(value);}
  const bytes=new Uint8Array(size);let i=0;for(const c of chunks){bytes.set(c,i);i+=c.length;}
  try{const data=JSON.parse(new TextDecoder().decode(bytes));if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();return data;}catch{throw new ApiError(400,'JSON 格式无效。');}
}
const cookieName=request=>new URL(request.url).protocol==='https:'?'__Host-rig_session':'rig_session';
function sessionCookie(request,token,age=SESSION_SECONDS){return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
async function getSession(request,env){
  const name=cookieName(request),token=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
  if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  return env.DB.prepare('SELECT s.token_hash, s.username, s.csrf, s.expires_at FROM sessions s JOIN users u ON u.username = s.username AND u.password_version = s.password_version WHERE s.token_hash = ? AND s.expires_at > ?').bind(await digest(token),Date.now()).first();
}
async function limited(env,bucket,max){
  const now=Date.now();
  const result=await env.DB.prepare('INSERT INTO login_limits (bucket,count,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count = CASE WHEN expires_at < ? THEN 1 ELSE count + 1 END, expires_at = CASE WHEN expires_at < ? THEN excluded.expires_at ELSE expires_at END RETURNING count').bind(bucket,now+15*60*1000,now,now).first();
  if(result.count>max)throw new ApiError(429,'尝试次数过多，请 15 分钟后重试。');
}
async function current(env){
  const row=await env.DB.prepare('SELECT * FROM revisions ORDER BY id DESC LIMIT 1').first();
  return row?{version:row.id,snapshot:JSON.parse(row.snapshot),updatedAt:row.created_at,updater:row.updater,content:row.content,account:row.account}:{version:0,snapshot:defaultSnapshot(),updatedAt:null,updater:null};
}
function credentials(data){
  if(typeof data.username!=='string'||!/^[A-Za-z0-9_.-]{3,40}$/.test(data.username))throw new ApiError(400,'账号需要 3–40 位字母、数字、点、下划线或短横线。');
  if(typeof data.password!=='string'||data.password.length<12||data.password.length>128)throw new ApiError(400,'密码需要 12–128 个字符。');
}
async function route(request,env){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(!['GET','POST'].includes(method))return json({error:'不支持此请求方法。'},405,{'Allow':'GET, POST'});
  if(!env.DB)throw new ApiError(503,'数据库尚未连接，请联系站点管理员。');
  await provisionConfiguredUsers(env);
  if(method==='POST'&&(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site'))throw new ApiError(403,'请求来源无效。');
  if(path==='/api/status'&&method==='GET'){
    const user=await env.DB.prepare('SELECT username FROM users LIMIT 1').first();
    const ownerSetup=!user&&isSetupOwner(request,env);
    return json({setupRequired:!user,setupAvailable:!user&&(!!env.SETUP_TOKEN||ownerSetup),ownerSetup,ownerSignInRequired:!user&&!!env.SETUP_OWNER_EMAIL&&!ownerSetup});
  }
  if(path==='/api/change-password'&&method==='POST'){
    const data=await body(request),ip=request.headers.get('cf-connecting-ip')||'local';
    await limited(env,'password-ip:'+await digest(ip),40);
    if(typeof data.username!=='string'||!/^[A-Za-z0-9_.-]{3,40}$/.test(data.username)||typeof data.currentPassword!=='string'||data.currentPassword.length>128)throw new ApiError(401,'账号或原密码不正确。');
    const accountBucket='password-user:'+await digest(data.username.toLowerCase());
    await limited(env,accountBucket,10);
    credentials({username:data.username,password:data.newPassword});
    if(data.confirmPassword!==data.newPassword)throw new ApiError(400,'两次输入的新密码不一致。');
    if(data.currentPassword===data.newPassword)throw new ApiError(400,'新密码不能与原密码相同。');
    const user=await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(data.username).first();
    const actual=await passwordHash(data.currentPassword,user?.salt||'missing-user-dummy-salt');
    if(!user||!equal(actual,user.password_hash))throw new ApiError(401,'账号或原密码不正确。');
    const salt=random(),hash=await passwordHash(data.newPassword,salt);
    const result=await env.DB.batch([
      env.DB.prepare('UPDATE users SET password_hash = ?, salt = ?, password_version = password_version + 1 WHERE username = ? AND password_hash = ? AND password_version = ?').bind(hash,salt,user.username,user.password_hash,user.password_version),
      env.DB.prepare('DELETE FROM sessions WHERE username = ? AND EXISTS (SELECT 1 FROM users WHERE username = ? AND password_hash = ?)').bind(user.username,user.username,hash),
      env.DB.prepare('DELETE FROM login_limits WHERE bucket IN (?,?) AND EXISTS (SELECT 1 FROM users WHERE username = ? AND password_hash = ?)').bind(accountBucket,'user:'+await digest(user.username.toLowerCase()),user.username,hash)
    ]);
    if(!result[0].meta.changes)throw new ApiError(409,'密码已被修改，请使用最新密码重试。');
    return json({ok:true,message:'密码已修改，请使用新密码重新登录。'},200,{'Set-Cookie':sessionCookie(request,'',0)});
  }
  if((path==='/api/setup'||path==='/api/login')&&method==='POST'){
    const data=await body(request),ip=request.headers.get('cf-connecting-ip')||'local';
    let verifiedHash,verifiedVersion;
    await limited(env,'ip:'+await digest(ip),40);
    if(path==='/api/setup'){
      if(await env.DB.prepare('SELECT username FROM users LIMIT 1').first())throw new ApiError(409,'管理员已经创建，请直接登录。');
      await limited(env,'setup',10);
      const tokenValid=env.SETUP_TOKEN&&typeof data.setupToken==='string'&&equal(await digest(data.setupToken),await digest(env.SETUP_TOKEN));
      if(!isSetupOwner(request,env)&&!tokenValid)throw new ApiError(403,'请使用站点所有者身份登录，或填写正确的初始化密钥。');
      credentials(data);const salt=random();
      verifiedHash=await passwordHash(data.password,salt);verifiedVersion=0;
      const result=await env.DB.prepare('INSERT INTO users (username,password_hash,salt,created_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM users)').bind(data.username,verifiedHash,salt,new Date().toISOString()).run();
      if(!result.meta.changes)throw new ApiError(409,'管理员已经创建，请直接登录。');
    }else{
      if(typeof data.username!=='string'||typeof data.password!=='string'||data.username.length>40||data.password.length>128)throw new ApiError(401,'账号或密码不正确。');
      await limited(env,'user:'+await digest(data.username.toLowerCase()),10);
      const user=await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(data.username).first();
      const actual=await passwordHash(data.password,user?.salt||'missing-user-dummy-salt');
      if(!user||!equal(actual,user.password_hash))throw new ApiError(401,'账号或密码不正确。');
      verifiedHash=user.password_hash;verifiedVersion=user.password_version;
      await env.DB.prepare('DELETE FROM login_limits WHERE bucket = ?').bind('user:'+await digest(data.username.toLowerCase())).run();
    }
    const token=random(),csrf=random();
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()).run();
    await env.DB.prepare('DELETE FROM login_limits WHERE expires_at < ?').bind(Date.now()).run();
    const loggedIn=await env.DB.prepare('INSERT INTO sessions (token_hash,username,csrf,expires_at,password_version) SELECT ?,username,?,?,password_version FROM users WHERE username = ? AND password_version = ? AND password_hash = ?').bind(await digest(token),csrf,Date.now()+SESSION_SECONDS*1000,data.username,verifiedVersion,verifiedHash).run();
    if(!loggedIn.meta.changes)throw new ApiError(401,'密码已发生变化，请使用最新密码重新登录。');
    return json({ok:true},200,{'Set-Cookie':sessionCookie(request,token)});
  }
  if(path==='/change-password'&&method==='GET')return new Response(ASSETS.login,{headers:{'Content-Type':'text/html; charset=utf-8'}});
  const session=await getSession(request,env);
  if(!session){
    if(path.startsWith('/api/'))throw new ApiError(401,'登录已过期，请重新登录。');
    if(path==='/'||path==='/login')return new Response(ASSETS.login,{headers:{'Content-Type':'text/html; charset=utf-8'}});
    return new Response(null,{status:303,headers:{Location:'/'}});
  }
  if(method==='POST'&&!equal(request.headers.get('x-csrf-token')||'',session.csrf))throw new ApiError(403,'会话校验失败，请刷新页面后重试。');
  if(path==='/api/session'&&method==='GET')return json({username:session.username,csrf:session.csrf});
  if(path==='/api/logout'&&method==='POST'){
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(session.token_hash).run();
    return json({ok:true},200,{'Set-Cookie':sessionCookie(request,'',0)});
  }
  if(path==='/api/state'&&method==='GET')return json(await current(env));
  if(path==='/api/state'&&method==='POST'){
    const data=await body(request),snapshot=validateSnapshot(data.snapshot);
    if(!Number.isSafeInteger(data.baseVersion)||data.baseVersion<0)throw new ApiError(400,'版本号无效。');
    if(typeof data.updater!=='string'||!data.updater.trim()||data.updater.trim().length>80)throw new ApiError(400,'请填写更新人（1–80 个字符）。');
    if(typeof data.content!=='string'||!data.content.trim()||data.content.trim().length>2000)throw new ApiError(400,'请填写更新内容（1–2000 个字符）。');
    if(typeof data.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(data.requestId))throw new ApiError(400,'请求标识无效。');
    const prior=await env.DB.prepare('SELECT id,snapshot,account FROM revisions WHERE request_id = ?').bind(data.requestId).first();
    if(prior){if(prior.account!==session.username||prior.snapshot!==JSON.stringify(snapshot))throw new ApiError(409,'请求标识重复，请重新保存。');return json({ok:true,version:prior.id,duplicate:true});}
    let result;
    try{
      result=await env.DB.prepare('INSERT INTO revisions (parent_version,request_id,snapshot,updater,content,account,created_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COALESCE(MAX(id),0) FROM revisions) = ?').bind(data.baseVersion,data.requestId,JSON.stringify(snapshot),data.updater.trim(),data.content.trim(),session.username,new Date().toISOString(),data.baseVersion).run();
    }catch(error){
      const duplicate=await env.DB.prepare('SELECT id,snapshot,account FROM revisions WHERE request_id = ?').bind(data.requestId).first();
      if(duplicate?.account===session.username&&duplicate.snapshot===JSON.stringify(snapshot))return json({ok:true,version:duplicate.id,duplicate:true});throw error;
    }
    if(!result.meta.changes)throw new ApiError(409,'其他人已保存新版本。请导出当前参数，再读取最新版本并重新修改。',{currentVersion:(await current(env)).version});
    return json({ok:true,version:Number(result.meta.last_row_id)});
  }
  if(path==='/api/history'&&method==='GET'){
    const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);
    if(!Number.isSafeInteger(before)||before<1)throw new ApiError(400,'分页参数无效。');
    const {results}=await env.DB.prepare('SELECT id,parent_version,updater,content,account,created_at FROM revisions WHERE id < ? ORDER BY id DESC LIMIT 31').bind(before).all();
    return json({items:results.slice(0,30),nextBefore:results.length>30?results[29].id:null});
  }
  if(path==='/api/revision'&&method==='GET'){
    const id=Number(url.searchParams.get('id'));
    const row=Number.isSafeInteger(id)&&id>0?await env.DB.prepare('SELECT id,snapshot FROM revisions WHERE id = ?').bind(id).first():null;
    if(!row)throw new ApiError(404,'未找到此版本。');return json({version:row.id,snapshot:JSON.parse(row.snapshot)});
  }
  if(method==='GET'&&(path==='/'||path==='/workspace'||path==='/login'))return new Response(ASSETS.workspace,{headers:{'Content-Type':'text/html; charset=utf-8'}});
  if(method==='GET'&&path==='/app.js')return new Response(ASSETS.app,{headers:{'Content-Type':'text/javascript; charset=utf-8'}});
  if(method==='GET'&&path==='/password.js')return new Response(ASSETS.password,{headers:{'Content-Type':'text/javascript; charset=utf-8'}});
  if(method==='GET'&&path==='/cloud.css')return new Response(ASSETS.css,{headers:{'Content-Type':'text/css; charset=utf-8'}});
  return json({error:'页面不存在。'},404);
}
export default{async fetch(request,env){
  let response;
  try{response=await route(request,env);}catch(error){
    if(!(error instanceof ApiError))console.error('Rig server error:',error.message);
    response=json({error:error instanceof ApiError?error.message:'服务器暂时无法处理请求，请重试。',...(error.extra||{})},error.status||500);
  }
  const h=new Headers(response.headers);
  h.set('Cache-Control','no-store');h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','no-referrer');h.set('X-Frame-Options','DENY');
  h.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if(new URL(request.url).protocol==='https:')h.set('Strict-Transport-Security','max-age=31536000');
  return new Response(response.body,{status:response.status,headers:h});
}};
