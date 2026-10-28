// Disposable loopback-only UI preview. The database is in memory and never deployed.
import { createServer } from 'node:http';
import worker from '../dist/server/index.js';
import { database } from '../scripts/database.mjs';
const port=4173,origin=`http://127.0.0.1:${port}`;
const env={DB:database(),SETUP_TOKEN:'disposable-preview-setup-key'};
await worker.fetch(new Request(origin+'/api/setup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'preview',password:'PreviewOnly-2026!',setupToken:env.SETUP_TOKEN})}),env);
const server=createServer(async(req,res)=>{try{const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(', '):value);const request=new Request(origin+req.url,{method:req.method,headers,...(req.method==='GET'?{}:{body:req,duplex:'half'})});const r=await worker.fetch(request,env);res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));}catch(e){res.writeHead(500);res.end(e.message);}});
server.listen(port,'127.0.0.1',()=>console.log('Disposable UI preview: '+origin));
process.on('SIGINT',()=>server.close(()=>{env.DB.close();process.exit(0);}));
