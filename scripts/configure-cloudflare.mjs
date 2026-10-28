import { readFileSync,writeFileSync } from 'node:fs';
const id=process.env.CLOUDFLARE_DATABASE_ID;
if(!id||! /^[a-f0-9-]{36}$/i.test(id))throw new Error('Set CLOUDFLARE_DATABASE_ID to the actual provisioned D1 database ID.');
const config=JSON.parse(readFileSync(new URL('../wrangler.example.jsonc',import.meta.url),'utf8'));
config.d1_databases[0].database_id=id;
if(process.env.CLOUDFLARE_WORKER_NAME){if(!/^[a-z][a-z0-9-]{2,62}$/.test(process.env.CLOUDFLARE_WORKER_NAME))throw new Error('Invalid Worker name');config.name=process.env.CLOUDFLARE_WORKER_NAME;}
writeFileSync(new URL('../wrangler.json',import.meta.url),JSON.stringify(config,null,2)+'\n');
console.log('Cloudflare configuration generated.');
