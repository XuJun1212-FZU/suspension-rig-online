import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { Script } from 'node:vm';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const root = new URL('../', import.meta.url);
const original = read('web/workspace.html');
const match = original.match(/const initial=(\{[^;]+\});/);
if (!match) throw new Error('Cannot locate original parameter defaults');
const defaults = JSON.parse(match[1].replace(/([\w]+):/g, '"$1":'));
const bridge = `window.rigStore={get:()=>({parameters:{...P},mode,tilt}),set:s=>{mode=s.mode;tilt=s.tilt;document.getElementById('tilt').checked=tilt;setP(s.parameters)},labels:()=>Object.fromEntries([...Object.values(schema).flat().map(x=>[x[0],x[1]]),['maxAngle','允许横梁最大倾角'],['tilt','横梁倾转'],['mode','方案视图']])};const cloudRender=render;render=function(){cloudRender();window.dispatchEvent(new Event('rig:change'))};`;
let workspace = original.replace('</head>', '<link rel="stylesheet" href="/cloud.css"></head>')
  .replace('<body>', '<body class="cloud-loading"><div id="cloudToolbar" class="cloud-toolbar" aria-label="云端保存与账户"><span id="cloudStatus" role="status">正在读取最新参数…</span><div><button id="cloudReload">读取最新</button><button id="cloudHistory">更新日志</button><button id="cloudSave" class="cloud-primary">保存参数</button><button id="cloudExit">保存并退出</button><button id="cloudLogout">退出登录</button></div></div><div id="cloudLoading" class="cloud-loading-card">正在读取云端最新参数…</div>')
  .replace('createControls();render();', 'createControls();render();\n' + bridge)
  .replace('</body>', '<script src="/app.js"></script></body>');
for (const script of workspace.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new Script(script[1]);
new Script(read('web/app.js'));new Script(read('web/login.js'));
const login = read('web/login.html').replace('/* LOGIN_CSS */', read('web/cloud.css')).replace('/* LOGIN_JS */', read('web/login.js'));
const assets = {workspace, login, app:read('web/app.js'), css:read('web/cloud.css')};
mkdirSync(new URL('dist/server/', root), {recursive:true});mkdirSync(new URL('dist/.openai/', root), {recursive:true});
writeFileSync(new URL('dist/server/index.js', root), 'const DEFAULT_PARAMETERS=' + JSON.stringify(defaults) + ';\nconst ASSETS=' + JSON.stringify(assets) + ';\n' + read('worker/server.js'));
cpSync(new URL('.openai/hosting.json', root), new URL('dist/.openai/hosting.json', root));
cpSync(new URL('drizzle/', root), new URL('dist/.openai/drizzle/', root), {recursive:true});
console.log('Built authenticated workspace, login, ' + Object.keys(defaults).length + ' parameters and D1 migrations.');
