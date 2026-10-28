import { createServer } from 'node:http';
import { isIP } from 'node:net';
import worker from '../dist/server/index.js';

/** Serve the same authenticated app behind an ordinary HTTPS hosting router. */
export function createRigServer({db,publicOrigin,setupToken,trustProxy=false}) {
  const origin=new URL(publicOrigin);
  if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('PUBLIC_ORIGIN must be a plain HTTP(S) origin.');
  // Sites identity headers are never trusted by this independent Node server.
  const env={DB:db,SETUP_TOKEN:setupToken};
  const server=createServer(async(req,res)=>{
    try{
      if(req.url==='/healthz'&&req.method==='GET'){
        await db.prepare('SELECT 1 AS ok').first();
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"ok":true}');return;
      }
      if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//')){res.writeHead(400);res.end('Invalid request path');return;}
      const host=trustProxy?req.headers['x-forwarded-host']||req.headers.host:req.headers.host;
      if(typeof host!=='string'||host.toLowerCase()!==origin.host.toLowerCase()){res.writeHead(421);res.end('Unexpected host');return;}
      const headers=new Headers();
      for(const [name,value] of Object.entries(req.headers)){
        if(!value||name.startsWith('oai-')||name==='cf-connecting-ip')continue;
        headers.set(name,Array.isArray(value)?value.join(', '):value);
      }
      const proxyIP=trustProxy&&typeof req.headers['x-real-ip']==='string'?req.headers['x-real-ip']:null;
      headers.set('cf-connecting-ip',proxyIP&&isIP(proxyIP)?proxyIP:req.socket.remoteAddress||'local');
      const request=new Request(origin.origin+req.url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:req,duplex:'half'})});
      const response=await worker.fetch(request,env);
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    }catch(error){
      console.error('HTTP request failed:',error.message);
      if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end('{"error":"服务器暂时不可用，请稍后重试。"}');
    }
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  return server;
}
