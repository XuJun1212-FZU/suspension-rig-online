(()=>{'use strict';
const dialog=document.createElement('dialog');dialog.className='cloud-dialog rig-password-dialog';dialog.setAttribute('aria-labelledby','rigPasswordTitle');
dialog.innerHTML=`<header class="cloud-dialog-head"><div><h2 id="rigPasswordTitle">修改密码</h2><p>验证原密码后设置新密码，修改成功后需重新登录。</p></div><button type="button" class="cloud-close" id="rigPasswordClose" aria-label="关闭修改密码窗口">×</button></header><div class="cloud-dialog-body"><form id="rigPasswordForm"><label for="rigPasswordAccount">账号</label><input id="rigPasswordAccount" name="username" autocomplete="username" required minlength="3" maxlength="40" pattern="[A-Za-z0-9_.-]+" placeholder="请输入需要修改密码的账号"><label for="rigPasswordCurrent">原密码</label><input id="rigPasswordCurrent" name="current-password" type="password" autocomplete="current-password" required maxlength="128" placeholder="请输入当前密码"><label for="rigPasswordNew">新密码</label><input id="rigPasswordNew" name="new-password" type="password" autocomplete="new-password" required minlength="12" maxlength="128" placeholder="至少 12 个字符"><label for="rigPasswordConfirm">确认新密码</label><input id="rigPasswordConfirm" type="password" autocomplete="new-password" required minlength="12" maxlength="128" placeholder="再次输入新密码"><p id="rigPasswordError" class="cloud-error" role="alert"></p><div class="cloud-buttons"><button type="button" id="rigPasswordCancel">取消</button><button type="submit" class="cloud-primary" id="rigPasswordSubmit">确认修改</button></div></form><section id="rigPasswordDone" hidden><p role="status">密码已修改成功。请使用新密码重新登录。</p><div class="cloud-buttons"><button type="button" class="cloud-primary" id="rigPasswordLogin">使用新密码登录</button></div></section></div>`;
document.body.appendChild(dialog);const $=id=>document.getElementById(id);let busy=false,lastUsername='';
const close=()=>{if(!busy)dialog.close();};$('rigPasswordClose').onclick=close;$('rigPasswordCancel').onclick=close;
dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
dialog.addEventListener('close',()=>{if(!busy)$('rigPasswordForm').reset();});
window.RigPassword={open(username=''){
  if(busy)return;$('rigPasswordForm').reset();$('rigPasswordForm').hidden=false;$('rigPasswordDone').hidden=true;$('rigPasswordError').textContent='';$('rigPasswordAccount').value=username;
  if(!dialog.open)dialog.showModal();$(username?'rigPasswordCurrent':'rigPasswordAccount').focus();
}};
$('rigPasswordForm').onsubmit=async e=>{
  e.preventDefault();if(busy)return;
  const data={username:$('rigPasswordAccount').value.trim(),currentPassword:$('rigPasswordCurrent').value,newPassword:$('rigPasswordNew').value,confirmPassword:$('rigPasswordConfirm').value};
  if(data.newPassword!==data.confirmPassword){$('rigPasswordError').textContent='两次输入的新密码不一致。';return;}
  if(data.currentPassword===data.newPassword){$('rigPasswordError').textContent='新密码不能与原密码相同。';return;}
  busy=true;$('rigPasswordError').textContent='';dialog.querySelectorAll('button,input').forEach(x=>x.disabled=true);$('rigPasswordSubmit').textContent='正在修改…';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch('/api/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:controller.signal});
    let result;try{result=await response.json();}catch{throw new Error('服务器响应异常，请稍后重试。');}
    if(!response.ok)throw new Error(result.error||'修改失败，请重试。');
    lastUsername=data.username;$('rigPasswordForm').reset();$('rigPasswordForm').hidden=true;$('rigPasswordDone').hidden=false;
  }catch(error){$('rigPasswordError').textContent=error.name==='AbortError'?'请求结果尚未确认，请尝试使用新密码登录，或稍后重试。':error.message;}
  finally{clearTimeout(timer);busy=false;dialog.querySelectorAll('button,input').forEach(x=>x.disabled=false);$('rigPasswordSubmit').textContent='确认修改';if(!$('rigPasswordDone').hidden)$('rigPasswordLogin').focus();}
};
$('rigPasswordLogin').onclick=()=>{
  dialog.close();const username=document.getElementById('username'),password=document.getElementById('password');
  if(username&&password){username.value=lastUsername;password.value='';password.focus();}
  else window.open('/login','_blank','noopener');
};
})();
