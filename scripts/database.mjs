import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const executeStatement=Symbol('executeStatement');
export function database(filename=':memory:'){
  const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)');
  const journal=JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8'));
  for(const {tag} of journal.entries){
    if(db.prepare('SELECT name FROM _migrations WHERE name=?').get(tag))continue;
    db.exec('BEGIN');try{db.exec(readFileSync(new URL('../drizzle/'+tag+'.sql',import.meta.url),'utf8'));db.prepare('INSERT INTO _migrations VALUES (?)').run(tag);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  }
  return {close:()=>db.close(),raw:db,async batch(statements){db.exec('BEGIN');try{const results=statements.map(s=>s[executeStatement]());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}},prepare(sql){const s=db.prepare(sql);let args=[];const wrapper={bind(...values){args=values;return wrapper;},async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};},[executeStatement](){const r=s.run(...args);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};},async run(){return wrapper[executeStatement]();}};return wrapper;}};
}
