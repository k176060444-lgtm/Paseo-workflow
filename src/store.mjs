import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonical, sha256, assert, checkedId } from './policy.mjs';

export class Store {
  constructor(root) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, {recursive:true,mode:0o700});
    this.db = new DatabaseSync(path.join(this.root,'workflow.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, previous TEXT NOT NULL, digest TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dispatches(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, phase TEXT NOT NULL, agent_id TEXT, state TEXT NOT NULL, created TEXT NOT NULL);`);
  }
  dir(id) { return path.join(this.root,'tasks',checkedId(id)); }
  artifact(id, name, content) {
    assert(/^[a-zA-Z0-9._-]{1,100}$/.test(name), 'unsafe artifact filename');
    const base = path.join(this.dir(id),'evidence');
    fs.mkdirSync(base,{recursive:true,mode:0o700});
    const file = path.join(base,name);
    const fd = fs.openSync(file,'wx',0o600);
    try { fs.writeFileSync(fd,typeof content==='string'?content:canonical(content),'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return {path:file,sha256:sha256(typeof content==='string'?content:canonical(content))};
  }
  init(task) {
    assert(!this.get(task.id), 'task already exists');
    fs.mkdirSync(this.dir(task.id),{recursive:true,mode:0o700});
    this.db.prepare('INSERT INTO tasks(id,data) VALUES(?,?)').run(task.id,canonical(task));
    this.event(task.id,'CREATED',{digest:task.frozen.digest});
  }
  get(id) {
    const row=this.db.prepare('SELECT data FROM tasks WHERE id=?').get(checkedId(id));
    return row?JSON.parse(row.data):null;
  }
  save(t, type, payload={}) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old=this.get(t.id); assert(old,'unknown task');
      this.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(canonical(t),t.id);
      this.event(t.id,type,{stage:t.stage,status:t.status,...payload});
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  event(id,type,payload) {
    const prev=this.db.prepare('SELECT digest FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(id)?.digest??'0'.repeat(64);
    const at=new Date().toISOString(), body=canonical({...payload,_state_sha256:sha256(this.get(id))});
    const digest=sha256({id,type,body,previous:prev,at});
    this.db.prepare('INSERT INTO events(task_id,type,payload,previous,digest,at) VALUES(?,?,?,?,?,?)').run(id,type,body,prev,digest,at);
    return digest;
  }
  recordIntent(id,phase,dispatchId) {
    this.db.prepare('INSERT INTO dispatches(id,task_id,phase,agent_id,state,created) VALUES(?,?,?,?,?,?)').run(dispatchId,id,phase,null,'DISPATCH_INTENT',new Date().toISOString());
    this.event(id,'DISPATCH_INTENT',{phase,dispatchId});
  }
  recordAck(dispatchId,agentId) {
    this.db.prepare('UPDATE dispatches SET agent_id=?,state=? WHERE id=?').run(agentId,'ACKNOWLEDGED',dispatchId);
    const d=this.db.prepare('SELECT task_id,phase FROM dispatches WHERE id=?').get(dispatchId);if(d)this.event(d.task_id,'DISPATCH_ACK',{dispatchId,agentId,phase:d.phase});
  }
  recordTerminal(dispatchId) {this.db.prepare('UPDATE dispatches SET state=? WHERE id=?').run('TERMINAL',dispatchId);const d=this.db.prepare('SELECT task_id,phase,agent_id FROM dispatches WHERE id=?').get(dispatchId);if(d)this.event(d.task_id,'DISPATCH_TERMINAL',{dispatchId,phase:d.phase,agentId:d.agent_id});}
  dispatches(id) {return this.db.prepare('SELECT * FROM dispatches WHERE task_id=? ORDER BY created').all(id);}
  verify(id) {
    let previous='0'.repeat(64);
    for(const e of this.db.prepare('SELECT * FROM events WHERE task_id=? ORDER BY seq').all(id)){
      assert(e.previous===previous,'event ledger previous digest mismatch');
      assert(e.digest===sha256({id,type:e.type,body:e.payload,previous,at:e.at}),'event ledger hash mismatch');
      previous=e.digest;
    }
    const last=this.db.prepare('SELECT payload FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(id);
    if(last)assert(JSON.parse(last.payload)._state_sha256===sha256(this.get(id)),'persisted task state differs from last ledger state');
    return {events:this.db.prepare('SELECT count(*) n FROM events WHERE task_id=?').get(id).n,head:previous};
  }
  withLock(id,cb) {
    const file=path.join(this.dir(id),'controller.lock');
    const fd=fs.openSync(file,'wx',0o600);
    fs.writeSync(fd,JSON.stringify({pid:process.pid,created:new Date().toISOString()}));fs.fsyncSync(fd);
    const done=()=>{fs.closeSync(fd);fs.unlinkSync(file);};
    return Promise.resolve().then(cb).finally(done);
  }
  close(){this.db.close();}
}
