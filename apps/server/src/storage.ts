import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RecordStore, ListOptions } from '@dots/contracts';

const KEY = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
/** Fields that large tables are filtered on get an expression index, so a lookup never parses unrelated rows. */
const INDEXES: Array<[string, string[]]> = [
  ['activity', ['taskId']], ['activity', ['dotId']],
  ['worker_jobs', ['status', 'computerId']], ['worker_jobs', ['computerId', 'kind']],
  ['tasks', ['status']], ['tasks', ['dotId']],
];
const bind = (value: string | number | boolean): string | number => typeof value === 'boolean' ? (value ? 1 : 0) : value;
const path = (key: string) => {
  if (!KEY.test(key)) throw new Error('Invalid record field: ' + key);
  return "json_extract(body, '$." + key + "')";
};

export class SqliteStore implements RecordStore {
  readonly db: DatabaseSync;
  private transactionDepth = 0;
  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), {recursive:true});
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records(namespace TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(namespace,id));
      CREATE INDEX IF NOT EXISTS records_updated ON records(namespace,updated_at);`);
    for (const [namespace, keys] of INDEXES) {
      this.db.exec('CREATE INDEX IF NOT EXISTS records_' + namespace + '_' + keys.join('_').toLowerCase() + ' ON records(namespace, ' + keys.map(path).join(', ') + ', updated_at) WHERE namespace = ' + "'" + namespace + "'");
    }
  }
  get<T>(namespace:string,id:string):T|undefined {
    const r=this.db.prepare('SELECT body FROM records WHERE namespace=? AND id=?').get(namespace,id) as {body:string}|undefined;
    return r ? JSON.parse(r.body) as T : undefined;
  }
  /** Records written in the same millisecond keep the order they were first inserted in (rowid), not a random id order. */
  list<T>(namespace:string,options:ListOptions={}):T[] {
    const where = Object.entries(options.where ?? {});
    const clauses = where.map(([key]) => path(key) + ' = ?');
    const values = where.map(([, value]) => bind(value));
    const limit = options.limit !== undefined ? Math.max(1, Math.floor(options.limit)) : undefined;
    const direction = options.newest ? 'DESC' : 'ASC';
    const sql = 'SELECT body FROM records WHERE namespace=?' + clauses.map(c => ' AND ' + c).join('') + ' ORDER BY updated_at ' + direction + ', rowid ' + direction + (limit ? ' LIMIT ' + limit : '');
    const rows = (this.db.prepare(sql).all(namespace, ...values) as {body:string}[]).map(r => JSON.parse(r.body) as T);
    // Callers always see chronological order, including when only the newest rows were requested.
    return options.newest ? rows.reverse() : rows;
  }
  put<T extends {id:string}>(namespace:string,value:T):T {
    this.db.prepare('INSERT INTO records(namespace,id,body,updated_at) VALUES(?,?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at').run(namespace,value.id,JSON.stringify(value),new Date().toISOString());
    return structuredClone(value);
  }
  delete(namespace:string,id:string):boolean {return this.db.prepare('DELETE FROM records WHERE namespace=? AND id=?').run(namespace,id).changes>0;}
  /** Deletes all but the newest rows of one namespace (by updated_at); returns how many were removed. */
  trim(namespace:string,keep:number,olderThan?:string,where?:Record<string,string|number|boolean>):number {
    const entries = Object.entries(where ?? {});
    const filter = entries.map(([key]) => ' AND ' + path(key) + ' = ?').join('');
    const values = entries.map(([, value]) => bind(value));
    const age = olderThan ? ' AND updated_at < ?' : '';
    const sql = 'DELETE FROM records WHERE namespace=?' + filter + age + ' AND id NOT IN (SELECT id FROM records WHERE namespace=?' + filter + ' ORDER BY updated_at DESC, rowid DESC LIMIT ?)';
    return Number(this.db.prepare(sql).run(namespace, ...values, ...(olderThan ? [olderThan] : []), namespace, ...values, Math.max(0, Math.floor(keep))).changes);
  }
  transaction<T>(fn:()=>T):T {
    if (this.transactionDepth) return fn();
    this.db.exec('BEGIN IMMEDIATE'); this.transactionDepth++;
    try {const r=fn();this.db.exec('COMMIT');return r;} catch(e) {this.db.exec('ROLLBACK');throw e;} finally {this.transactionDepth--;}
  }
  close():void {this.db.close();}
}
/** Applies the same filter in memory, so stores without native filtering behave identically. */
export function query<T extends object>(store:RecordStore,namespace:string,options:ListOptions={}):T[] {
  let rows = store.list<T>(namespace, options);
  const where = Object.entries(options.where ?? {});
  if (where.length) rows = rows.filter(row => where.every(([key, value]) => (row as Record<string, unknown>)[key] === value));
  return options.limit !== undefined ? (options.newest ? rows.slice(-options.limit) : rows.slice(0, options.limit)) : rows;
}
