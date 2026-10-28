(()=>{'use strict';
const $=id=>document.getElementById(id);let setup=false;
async function init(){try{
  const r=await fetch('/api/status',{cache:'no-store'}),data=await r.json();if(!r.ok)throw new Error(data.error||'无法连接服务器');
  setup=data.setupRequired;
  if(setup){$('loginTitle').textContent='首次配置管理员';$('loginHint').textContent='设置站点登录账号和密码（至少 12 位），并输入部署时的初始化密钥。';$('setupFields').hidden=false;$('confirmPassword').required=true;$('setupToken').required=true;$('password').minLength=12;$('password').autocomplete='new-password';}
  if(setup&&data.ownerSetup){$('loginHint').textContent='已验证站点所有者身份。请设置站点账号和至少 12 位的密码，之后用这组账号密码进入工作台。';$('setupToken').required=false;$('setupToken').hidden=true;document.querySelector('label[for="setupToken"]').hidden=true;}
  if(setup&&data.ownerSignInRequired&&!data.setupAvailable){$('loginHint').textContent='请先验证站点所有者身份，再设置账号密码。';$('loginForm').hidden=true;const a=document.createElement('a');a.href='/signin-with-chatgpt?return_to=%2F';a.target='_top';a.className='cloud-primary';a.textContent='站点所有者使用 ChatGPT 验证';$('loginForm').after(a);return;}
  if(setup&&!data.setupAvailable)throw new Error('尚未配置初始化密钥，请联系站点部署者。');
  $('loginSubmit').disabled=false;$('loginSubmit').textContent=setup?'创建账号并进入':'登录工作台';
}catch(e){$('loginError').textContent=e.message;$('loginSubmit').textContent='重新连接';$('loginSubmit').disabled=false;$('loginSubmit').type='button';$('loginSubmit').onclick=()=>location.reload();}}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginError').textContent='';
  if(setup&&$('password').value!==$('confirmPassword').value){$('loginError').textContent='两次输入的密码不一致。';return;}
  const button=$('loginSubmit');button.disabled=true;button.textContent='正在验证…';
  try{const r=await fetch(setup?'/api/setup':'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('username').value.trim(),password:$('password').value,...(setup?{setupToken:$('setupToken').value}:{})})});const d=await r.json();if(!r.ok)throw new Error(d.error||'登录失败');$('password').value='';$('confirmPassword').value='';$('setupToken').value='';location.replace('/');}
  catch(error){$('loginError').textContent=error.message;button.disabled=false;button.textContent=setup?'创建账号并进入':'登录工作台';}
});init();})();
