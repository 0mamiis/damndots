import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RecordStore } from '@dots/contracts';

export class SqliteStore implements RecordStore {
  readonly db: DatabaseSync;
  private transactionDepth = 0;
  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), {recursive:true});
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records(namespace TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(namespace,id));
      CREATE INDEX IF NOT EXISTS records_updated ON records(namespace,updated_at);`);
  }
  get<T>(namespace:string,id:string):T|undefined {
    const r=this.db.prepare('SELECT body FROM records WHERE namespace=? AND id=?').get(namespace,id) as {body:string}|undefined;
    return r ? JSON.parse(r.body) as T : undefined;
  }
  list<T>(namespace:string):T[] {
    return (this.db.prepare('SELECT body FROM records WHERE namespace=? ORDER BY updated_at,id').all(namespace) as {body:string}[]).map(r=>JSON.parse(r.body) as T);
  }
  put<T extends {id:string}>(namespace:string,value:T):T {
    this.db.prepare('INSERT INTO records(namespace,id,body,updated_at) VALUES(?,?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at').run(namespace,value.id,JSON.stringify(value),new Date().toISOString());
    return structuredClone(value);
  }
  delete(namespace:string,id:string):boolean {return this.db.prepare('DELETE FROM records WHERE namespace=? AND id=?').run(namespace,id).changes>0;}
  transaction<T>(fn:()=>T):T {
    if (this.transactionDepth) return fn();
    this.db.exec('BEGIN IMMEDIATE'); this.transactionDepth++;
    try {const r=fn();this.db.exec('COMMIT');return r;} catch(e) {this.db.exec('ROLLBACK');throw e;} finally {this.transactionDepth--;}
  }
  close():void {this.db.close();}
}
