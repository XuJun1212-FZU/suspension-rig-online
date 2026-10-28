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
  return env.DB.prepare('SELECT token_hash, username, csrf, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(await digest(token),Date.now()).first();
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
  if(method==='POST'&&(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site'))throw new ApiError(403,'请求来源无效。');
  if(path==='/api/status'&&method==='GET'){
    const user=await env.DB.prepare('SELECT username FROM users LIMIT 1').first();
    const ownerSetup=!user&&isSetupOwner(request,env);
    return json({setupRequired:!user,setupAvailable:!user&&(!!env.SETUP_TOKEN||ownerSetup),ownerSetup,ownerSignInRequired:!user&&!!env.SETUP_OWNER_EMAIL&&!ownerSetup});
  }
  if((path==='/api/setup'||path==='/api/login')&&method==='POST'){
    const data=await body(request),ip=request.headers.get('cf-connecting-ip')||'local';
    await limited(env,'ip:'+await digest(ip),40);
    if(path==='/api/setup'){
      if(await env.DB.prepare('SELECT username FROM users LIMIT 1').first())throw new ApiError(409,'管理员已经创建，请直接登录。');
      await limited(env,'setup',10);
      const tokenValid=env.SETUP_TOKEN&&typeof data.setupToken==='string'&&equal(await digest(data.setupToken),await digest(env.SETUP_TOKEN));
      if(!isSetupOwner(request,env)&&!tokenValid)throw new ApiError(403,'请使用站点所有者身份登录，或填写正确的初始化密钥。');
      credentials(data);const salt=random();
      const result=await env.DB.prepare('INSERT INTO users (username,password_hash,salt,created_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM users)').bind(data.username,await passwordHash(data.password,salt),salt,new Date().toISOString()).run();
      if(!result.meta.changes)throw new ApiError(409,'管理员已经创建，请直接登录。');
    }else{
      if(typeof data.username!=='string'||typeof data.password!=='string'||data.username.length>40||data.password.length>128)throw new ApiError(401,'账号或密码不正确。');
      await limited(env,'user:'+await digest(data.username.toLowerCase()),10);
      const user=await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(data.username).first();
      const actual=await passwordHash(data.password,user?.salt||'missing-user-dummy-salt');
      if(!user||!equal(actual,user.password_hash))throw new ApiError(401,'账号或密码不正确。');
      await env.DB.prepare('DELETE FROM login_limits WHERE bucket = ?').bind('user:'+await digest(data.username.toLowerCase())).run();
    }
    const token=random(),csrf=random();
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()).run();
    await env.DB.prepare('DELETE FROM login_limits WHERE expires_at < ?').bind(Date.now()).run();
    await env.DB.prepare('INSERT INTO sessions (token_hash,username,csrf,expires_at) VALUES (?,?,?,?)').bind(await digest(token),data.username,csrf,Date.now()+SESSION_SECONDS*1000).run();
    return json({ok:true},200,{'Set-Cookie':sessionCookie(request,token)});
  }
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
