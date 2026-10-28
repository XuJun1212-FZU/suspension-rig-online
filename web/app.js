(()=>{'use strict';
const byId=id=>document.getElementById(id),store=window.rigStore,main=document.querySelector('main.wrap');
let baseline=null,version=0,session=null,ready=false,busy=false,lastSaved=null,pending=null;
main.inert=true;
const dialog=document.createElement('dialog');dialog.className='cloud-dialog';document.body.appendChild(dialog);
const status=byId('cloudStatus'),copy=s=>JSON.parse(JSON.stringify(s));
const dirty=()=>ready&&JSON.stringify(store.get())!==JSON.stringify(baseline);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=s=>new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
function unload(e){if(dirty()||busy){e.preventDefault();e.returnValue='';}}
let guarded=false;
function update(){
  if(!ready)return;const changed=dirty();
  if(changed!==guarded){window[changed?'addEventListener':'removeEventListener']('beforeunload',unload);guarded=changed;}
  status.classList.toggle('dirty',changed);
  status.textContent=`${session.username} · v${version} · ${changed?'有未保存修改':lastSaved?'已保存 · '+date(lastSaved):'已读取默认参数'}`;
  byId('cloudSave').disabled=!changed||busy;
}
function toast(message){document.querySelector('.cloud-toast')?.remove();const n=document.createElement('div');n.className='cloud-toast';n.setAttribute('role','status');n.textContent=message;document.body.appendChild(n);setTimeout(()=>n.remove(),6000);}
async function api(path,options={}){
  let r;try{r=await fetch(path,{...options,cache:'no-store',headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.method==='POST'?{'X-CSRF-Token':session?.csrf||''}:{}),...options.headers}});}catch{throw new Error('网络连接失败，尚未确认保存。请保持页面打开并重试。');}
  let data;try{data=await r.json();}catch{throw new Error('服务器响应异常，尚未确认保存，请重试。');}
  if(!r.ok){const e=new Error(data.error||'请求失败');e.status=r.status;throw e;}return data;
}
function modal(title,hint,body){
  dialog.innerHTML=`<header class="cloud-dialog-head"><div><h2>${escape(title)}</h2><p>${escape(hint)}</p></div><button class="cloud-close" type="button" aria-label="关闭">×</button></header><div class="cloud-dialog-body">${body}</div>`;
  dialog.querySelector('.cloud-close').onclick=()=>{if(!busy)dialog.close();};
  if(!dialog.open)dialog.showModal();
}
dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
function changes(snapshot){
  const labels=store.labels(),items=[];
  for(const key of Object.keys(snapshot.parameters))if(snapshot.parameters[key]!==baseline.parameters[key])items.push(`${labels[key]||key}：${baseline.parameters[key]} → ${snapshot.parameters[key]}${key==='maxAngle'?'°':' mm'}`);
  if(snapshot.tilt!==baseline.tilt)items.push(`横梁倾转：${baseline.tilt?'允许':'关闭'} → ${snapshot.tilt?'允许':'关闭'}`);
  const modes={three:'三缸',five:'五缸',both:'双方案'};if(snapshot.mode!==baseline.mode)items.push(`方案视图：${modes[baseline.mode]} → ${modes[snapshot.mode]}`);
  return items.join('\n');
}
async function logout(){
  try{await api('/api/logout',{method:'POST',body:'{}'});ready=false;window.removeEventListener('beforeunload',unload);location.replace('/');}
  catch(e){toast('退出失败：'+e.message);}
}
function saveDialog(exitAfter=false){
  if(!ready||busy)return;if(!dirty()){if(exitAfter)logout();else toast('当前没有未保存修改。');return;}
  const invalid=[...document.querySelectorAll('[data-param][type=number]')].find(el=>el.value.trim()===''||!el.validity.valid);
  if(invalid){toast('请先填写有效的数值参数。');invalid.focus();return;}
  const snapshot=copy(store.get()),diff=changes(snapshot);
  modal('登记更新日志',`基于 v${version} 保存。参数和本次更新日志会一起提交，所有登录者共享。`,
    `<div class="cloud-meta">本次修改</div><pre class="cloud-diff">${escape(diff)}</pre><form id="cloudSaveForm"><label for="cloudUpdater">更新人 <span aria-hidden="true">*</span></label><input id="cloudUpdater" required maxlength="80" placeholder="请填写实际更新人姓名" autocomplete="name"><label for="cloudContent">更新内容 <span aria-hidden="true">*</span></label><textarea id="cloudContent" required maxlength="2000" placeholder="请说明调整目的、参数变化或验证结果"></textarea><p class="cloud-meta">登录账号 ${escape(session.username)}、版本号及提交时间由系统记录。</p><p id="cloudSaveError" class="cloud-error" role="alert"></p><a id="cloudRelogin" href="/" target="_blank" rel="noopener" hidden>在新标签页重新登录，返回后重试</a><div class="cloud-buttons"><button type="button" id="cloudCancelSave">取消</button><button type="submit" class="cloud-primary" id="cloudSubmitSave">${exitAfter?'提交日志，保存并退出':'提交日志并保存'}</button></div></form>`);
  byId('cloudCancelSave').onclick=()=>{if(!busy)dialog.close();};
  byId('cloudSaveForm').onsubmit=async e=>{
    e.preventDefault();if(busy)return;
    const updater=byId('cloudUpdater').value.trim(),content=byId('cloudContent').value.trim();
    if(!updater||!content){byId('cloudSaveError').textContent='更新人和更新内容均为必填。';return;}
    const payload={baseVersion:version,snapshot,updater,content};
    const key=JSON.stringify(payload);if(!pending||pending.key!==key)pending={key,requestId:crypto.randomUUID()};
    busy=true;update();dialog.querySelectorAll('button').forEach(b=>b.disabled=true);byId('cloudSaveError').textContent='';
    try{
      session=await api('/api/session');
      const result=await api('/api/state',{method:'POST',body:JSON.stringify({...payload,requestId:pending.requestId})});
      baseline=copy(snapshot);version=result.version;lastSaved=new Date().toISOString();pending=null;busy=false;dialog.close();update();toast(`v${version} 已保存，更新日志已登记。`);if(exitAfter)await logout();
    }catch(error){
      busy=false;byId('cloudSaveError').textContent=error.message;
      if(error.status===401)byId('cloudRelogin').hidden=false;
      if(error.status===409){byId('cloudSaveError').textContent+=' 当前参数仍保留，请先取消并导出参数 JSON。';}
      dialog.querySelectorAll('button').forEach(b=>b.disabled=false);update();
    }
  };
}
function exitDialog(){
  if(!ready||busy)return;if(!dirty()){logout();return;}
  modal('退出前，是否保存修改？','提交更新日志后，参数才会成为大家共用的最新版本。',`<p>当前有尚未保存的参数修改。请选择保存、放弃本次修改，或返回继续编辑。</p><div class="cloud-buttons"><button id="cloudStay">继续编辑</button><button id="cloudDiscard">不保存并退出</button><button id="cloudExitSave" class="cloud-primary">保存并登记日志</button></div>`);
  byId('cloudStay').onclick=()=>dialog.close();byId('cloudExitSave').onclick=()=>saveDialog(true);
  byId('cloudDiscard').onclick=async()=>{if(busy)return;busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);try{
    await api('/api/logout',{method:'POST',body:'{}'});ready=false;window.removeEventListener('beforeunload',unload);location.replace('/');
  }catch(e){busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);toast(e.message);}};
}
async function load(){
  const data=await api('/api/state');baseline=copy(data.snapshot);version=data.version;lastSaved=data.updatedAt;store.set(copy(baseline));update();
  const dot=document.querySelector('.kicker-dot');if(dot)dot.textContent=`● 云端参数 v${version}`;
}
async function reload(){
  if(busy)return;busy=true;main.inert=true;update();
  try{await load();toast('已读取云端最新参数。');}catch(e){toast(e.message);}
  finally{busy=false;main.inert=false;update();}
}
function reloadDialog(){
  if(!ready||busy)return;if(!dirty()){reload();return;}
  modal('读取最新参数','此操作会替换页面中尚未保存的修改。',`<p>建议先使用原网页的“导出参数JSON”保留当前方案。</p><div class="cloud-buttons"><button id="cloudKeep">继续编辑</button><button id="cloudConfirmReload" class="cloud-primary">放弃当前修改并读取</button></div>`);
  byId('cloudKeep').onclick=()=>dialog.close();byId('cloudConfirmReload').onclick=async()=>{dialog.close();await reload();};
}
async function history(){
  if(!ready||busy)return;
  modal('更新日志','按保存时间倒序排列，时间为北京时间。',`<div id="cloudHistoryList">正在读取记录…</div><p id="cloudHistoryError" class="cloud-error" role="alert"></p><div class="cloud-buttons"><button id="cloudMore" hidden>加载更早记录</button><button id="cloudHistoryClose">关闭</button></div>`);
  byId('cloudHistoryClose').onclick=()=>dialog.close();let before=null,items=[];
  async function page(){const more=byId('cloudMore');more.disabled=true;
    try{const d=await api('/api/history'+(before?'?before='+before:''));items.push(...d.items);before=d.nextBefore;
      const root=byId('cloudHistoryList');root.innerHTML=items.length?items.map(x=>`<article class="cloud-history-item"><h3>v${x.id} · ${escape(x.updater)}</h3><div class="cloud-meta">${escape(date(x.created_at))} · 账号 ${escape(x.account)} · 基于 v${x.parent_version}</div><p>${escape(x.content)}</p><button data-version="${x.id}">导出此版本参数</button></article>`).join(''):'还没有保存记录。首次保存时会生成第一条更新日志。';
      root.querySelectorAll('[data-version]').forEach(b=>b.onclick=async()=>{try{const d=await api('/api/revision?id='+b.dataset.version);download(d,`悬架台架_v${d.version}.json`);}catch(e){byId('cloudHistoryError').textContent=e.message;}});
      more.hidden=!before;more.disabled=false;
    }catch(e){byId('cloudHistoryError').textContent=e.message;byId('cloudHistoryList').textContent=items.length?'已有记录保留，请重试。':'读取失败。';more.hidden=false;more.textContent='重试';more.disabled=false;}}
  byId('cloudMore').onclick=page;await page();
}
function download(data,name){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
byId('cloudSave').onclick=()=>saveDialog(false);byId('cloudExit').onclick=exitDialog;byId('cloudLogout').onclick=exitDialog;byId('cloudHistory').onclick=history;byId('cloudReload').onclick=reloadDialog;
window.addEventListener('rig:change',update);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&ready)update();});
(async()=>{try{
  session=await api('/api/session');await load();ready=true;main.inert=false;document.body.classList.remove('cloud-loading');byId('cloudLoading').remove();update();
}catch(e){
  if(e.status===401){location.replace('/');return;}
  byId('cloudLoading').textContent='读取云端参数失败：'+e.message+' 为避免覆盖数据，编辑暂未开放。';
  const retry=document.createElement('button');retry.textContent='重新连接';retry.onclick=()=>location.reload();byId('cloudLoading').append(document.createElement('br'),retry);
}})();})();
