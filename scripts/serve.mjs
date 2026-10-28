import { mkdirSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { database } from './database.mjs';
import { createRigServer } from './http-server.mjs';

const port=Number(process.env.PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be a valid TCP port.');
const publicOrigin=process.env.PUBLIC_ORIGIN||(process.env.RAILWAY_PUBLIC_DOMAIN?'https://'+process.env.RAILWAY_PUBLIC_DOMAIN:null);
if(!publicOrigin||new URL(publicOrigin).protocol!=='https:')throw new Error('Set PUBLIC_ORIGIN to the service public HTTPS URL.');
const dataDir=resolve(process.env.DATA_DIR||process.env.RAILWAY_VOLUME_MOUNT_PATH||'./.local');
mkdirSync(dataDir,{recursive:true,mode:0o700});
const db=database(join(dataDir,'rig.sqlite'));
const setupToken=process.env.RIG_SETUP_TOKEN;
if(setupToken&&setupToken.length<32){db.close();throw new Error('RIG_SETUP_TOKEN must contain at least 32 random characters.');}
if(!await db.prepare('SELECT username FROM users LIMIT 1').first()&&!setupToken){db.close();throw new Error('Set a secret RIG_SETUP_TOKEN before first deployment.');}
const server=createRigServer({db,publicOrigin,setupToken,trustProxy:!!process.env.RAILWAY_SERVICE_ID||process.env.TRUST_PROXY==='1'});
server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`Suspension rig service ready on port ${port}`));
let stopping=false;
function stop(){if(stopping)return;stopping=true;server.close(()=>{db.close();process.exit(0);});server.closeIdleConnections();setTimeout(()=>{server.closeAllConnections();},8000).unref();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
