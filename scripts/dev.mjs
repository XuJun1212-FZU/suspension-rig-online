import { createServer } from 'node:http';
import { mkdirSync,existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { database } from './database.mjs';
if(!existsSync(new URL('../dist/server/index.js',import.meta.url)))await import('./build.mjs');
const {default:worker}=await import('../dist/server/index.js');
mkdirSync(new URL('../.local/',import.meta.url),{recursive:true});
const env={DB:database(fileURLToPath(new URL('../.local/rig.sqlite',import.meta.url))),SETUP_TOKEN:process.env.RIG_SETUP_TOKEN||randomBytes(32).toString('hex')};
const port=Number(process.env.PORT||4173);
const server=createServer(async(req,res)=>{
  try{
    const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(value)headers.set(name,Array.isArray(value)?value.join(', '):value);
    // The local server binds only to loopback; never trust a client-supplied CF IP here.
    headers.set('cf-connecting-ip',req.socket.remoteAddress||'local');
    const request=new Request(`http://127.0.0.1:${port}${req.url}`,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:req,duplex:'half'})});
    const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Local server error');}
});
server.listen(port,'127.0.0.1',async()=>{console.log(`Local: http://127.0.0.1:${port}`);if(!await env.DB.prepare('SELECT username FROM users LIMIT 1').first())console.log('One-time local setup key: '+env.SETUP_TOKEN);});
function stop(){server.close(()=>{env.DB.close();process.exit(0);});}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
