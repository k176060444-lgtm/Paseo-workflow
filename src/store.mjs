import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonical, sha256, assert, checkedId } from './policy.mjs';

export class Store {
  constructor(root,{readOnly=false}={}) {
    this.root=path.resolve(root);
    this.readOnly=readOnly;
    if (readOnly) {
      assert(fs.existsSync(path.join(this.root,'workflow.sqlite')),'state database not found (read-only)');
    } else fs.mkdirSync(this.root,{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path.join(this.root,'workflow.sqlite'),{readOnly});
    if(!readOnly) this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, previous TEXT NOT NULL, digest TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dispatches(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, phase TEXT NOT NULL, agent_id TEXT, state TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts(task_id TEXT NOT NULL, name TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(task_id,name));`);
  }
  dir(id) { return path.join(this.root,'tasks',checkedId(id)); }
  transaction(fn) {
    assert(!this.readOnly,'store opened read-only');
    this.db.exec('BEGIN IMMEDIATE');
    try {const result=fn(); this.db.exec('COMMIT');return result;}
    catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  dispatchHash(id){
    return sha256(this.db.prepare('SELECT id,phase,agent_id,state,created FROM dispatches WHERE task_id=? ORDER BY id').all(id));
  }
  artifactHash(id){
    return sha256(this.db.prepare('SELECT name,digest FROM artifacts WHERE task_id=? ORDER BY name').all(id));
  }
  artifact(id,name,content) {
    assert(!this.readOnly,'store opened read-only');
    assert(/^[a-zA-Z0-9._-]{1,100}$/.test(name),'unsafe artifact filename');
    assert(this.get(id),'cannot write artifact before task exists');
    const base=path.join(this.dir(id),'evidence');
    fs.mkdirSync(base,{recursive:true,mode:0o700});
    const file=path.join(base,name);
    const data=typeof content==='string'?content:canonical(content);
    const fd=fs.openSync(file,'wx',0o600);
    try{fs.writeFileSync(fd,data,'utf8');fs.fsyncSync(fd);} finally{fs.closeSync(fd);}
    const digest=sha256(data);
    this.transaction(()=>{
      this.db.prepare('INSERT INTO artifacts(task_id,name,digest) VALUES(?,?,?)').run(id,name,digest);
      this.event(id,'ARTIFACT_REGISTERED',{name,digest});
    });
    return {path:file,sha256:digest};
  }
  init(task) {
    assert(!this.get(task.id),'task already exists');
    fs.mkdirSync(this.dir(task.id),{recursive:true,mode:0o700});
    this.transaction(()=>{
      this.db.prepare('INSERT INTO tasks(id,data) VALUES(?,?)').run(task.id,canonical(task));
      this.event(task.id,'CREATED',{digest:task.frozen.digest});
    });
  }
  get(id) {
    const row=this.db.prepare('SELECT data FROM tasks WHERE id=?').get(checkedId(id));
    return row?JSON.parse(row.data):null;
  }
  save(t,type,payload={}) {
    this.transaction(()=>{
      assert(this.get(t.id),'unknown task');
      this.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(canonical(t),t.id);
      this.event(t.id,type,{stage:t.stage,status:t.status,...payload});
    });
  }
  event(id,type,payload){
    assert(!this.readOnly,'store opened read-only');
    const prev=this.db.prepare('SELECT digest FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(id)?.digest??'0'.repeat(64);
    const at=new Date().toISOString();
    const body=canonical({...payload,_state_sha256:sha256(this.get(id)),
      _dispatch_sha256:this.dispatchHash(id),_artifact_sha256:this.artifactHash(id)});
    const digest=sha256({id,type,body,previous:prev,at});
    this.db.prepare('INSERT INTO events(task_id,type,payload,previous,digest,at) VALUES(?,?,?,?,?,?)').run(id,type,body,prev,digest,at);
    return digest;
  }
  recordIntent(id,phase,dispatchId){
    this.transaction(()=>{
      this.db.prepare('INSERT INTO dispatches(id,task_id,phase,agent_id,state,created) VALUES(?,?,?,?,?,?)')
        .run(dispatchId,id,phase,null,'DISPATCH_INTENT',new Date().toISOString());
      this.event(id,'DISPATCH_INTENT',{phase,dispatchId});
    });
  }
  recordAck(dispatchId,agentId){
    this.transaction(()=>{
      const d=this.db.prepare('SELECT * FROM dispatches WHERE id=?').get(dispatchId);
      assert(d&&d.state==='DISPATCH_INTENT','unknown or previously acknowledged dispatch');
      this.db.prepare('UPDATE dispatches SET agent_id=?,state=? WHERE id=?')
        .run(agentId,'ACKNOWLEDGED',dispatchId);
      this.event(d.task_id,'DISPATCH_ACK',{dispatchId,agentId,phase:d.phase});
    });
  }
  recordTerminal(dispatchId){
    this.transaction(()=>{
      const d=this.db.prepare('SELECT * FROM dispatches WHERE id=?').get(dispatchId);
      assert(d&&d.state==='ACKNOWLEDGED','terminal requires a known acknowledged dispatch');
      this.db.prepare('UPDATE dispatches SET state=? WHERE id=?').run('TERMINAL',dispatchId);
      this.event(d.task_id,'DISPATCH_TERMINAL',{dispatchId,phase:d.phase,agentId:d.agent_id});
    });
  }
  dispatches(id){return this.db.prepare('SELECT * FROM dispatches WHERE task_id=? ORDER BY created,id').all(id);}
  verify(id){
    assert(this.get(id),'unknown task');
    let previous='0'.repeat(64), count=0;
    for(const e of this.db.prepare('SELECT * FROM events WHERE task_id=? ORDER BY seq').all(id)){
      assert(e.previous===previous,'event ledger previous digest mismatch');
      assert(e.digest===sha256({id,type:e.type,body:e.payload,previous,at:e.at}),'event ledger hash mismatch');
      previous=e.digest;count++;
    }
    assert(count>0,'task missing audit events');
    const last=JSON.parse(this.db.prepare('SELECT payload FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(id).payload);
    assert(last._state_sha256===sha256(this.get(id)),'persisted task state differs from ledger');
    assert(last._dispatch_sha256===this.dispatchHash(id),'dispatch ledger mismatch');
    assert(last._artifact_sha256===this.artifactHash(id),'artifact manifest mismatch');
    for(const entry of this.db.prepare('SELECT name,digest FROM artifacts WHERE task_id=?').all(id)){
      const file=path.join(this.dir(id),'evidence',entry.name);
      assert(fs.existsSync(file),'missing registered evidence artifact');
      assert(sha256(fs.readFileSync(file,'utf8'))===entry.digest,`evidence artifact hash mismatch: ${entry.name}`);
    }
    return {events:count,head:previous,dispatchSha256:last._dispatch_sha256,artifactSha256:last._artifact_sha256};
  }
  withLock(id,cb){
    assert(!this.readOnly,'store opened read-only');
    const file=path.join(this.dir(id),'controller.lock');
    // Stale lock after crash intentionally requires explicit external reconciliation.
    const fd=fs.openSync(file,'wx',0o600);
    fs.writeSync(fd,JSON.stringify({pid:process.pid,created:new Date().toISOString()}));fs.fsyncSync(fd);
    const done=()=>{fs.closeSync(fd);fs.unlinkSync(file);};
    return Promise.resolve().then(cb).finally(done);
  }
  close(){this.db.close();}
}
