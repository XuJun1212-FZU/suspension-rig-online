import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function database(filename=':memory:'){
  const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)');
  if(!db.prepare('SELECT name FROM _migrations WHERE name=?').get('0000_rig')){
    db.exec('BEGIN');try{db.exec(readFileSync(new URL('../drizzle/0000_rig.sql',import.meta.url),'utf8'));db.prepare('INSERT INTO _migrations VALUES (?)').run('0000_rig');db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  }
  return {close:()=>db.close(),raw:db,prepare(sql){const s=db.prepare(sql);let args=[];const wrapper={bind(...values){args=values;return wrapper;},async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};},async run(){const r=s.run(...args);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};return wrapper;}};
}
