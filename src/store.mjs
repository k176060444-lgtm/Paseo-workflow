import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonical, sha256, assert, checkedId } from './policy.mjs';

export class Store {
  // Only the Store's own verified, synchronous mutation methods may append
  // against an already-mutated row. No public caller can set this private flag.
  #trustedEventWrite=false;
  #appendVerifiedMutation(id,type,payload) {
    assert(!this.#trustedEventWrite,'nested trusted event append forbidden');
    this.#trustedEventWrite=true;
    try { return this.event(id,type,payload); }
    finally { this.#trustedEventWrite=false; }
  }
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
    const data=typeof content==='string'?content:canonical(content);
    const digest=sha256(data);
    // BEGIN IMMEDIATE spans verification, disk write/fsync and registration:
    // no other SQLite writer can slip between the verified anchor and append.
    // A file left by a failed registration is intentionally an orphan that
    // requires manual reconciliation; never delete potentially useful evidence.
    return this.transaction(()=>{
      this.verify(id);
      const anchor={
        state:sha256(this.get(id)),
        dispatch:this.dispatchHash(id),
        artifacts:this.artifactHash(id),
        head:this.db.prepare('SELECT digest FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(id)?.digest,
      };
      const base=path.join(this.dir(id),'evidence');
      fs.mkdirSync(base,{recursive:true,mode:0o700});
      const file=path.join(base,name);
      const fd=fs.openSync(file,'wx',0o600);
      try{fs.writeFileSync(fd,data,'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      // Recheck even under BEGIN IMMEDIATE: same-connection/monkeypatched
      // synchronous callbacks must not re-anchor an altered state.
      assert(anchor.state===sha256(this.get(id)),'task state changed during evidence fsync');
      assert(anchor.dispatch===this.dispatchHash(id),'dispatch changed during evidence fsync');
      assert(anchor.artifacts===this.artifactHash(id),'manifest changed during evidence fsync');
      assert(anchor.head===this.db.prepare('SELECT digest FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(id)?.digest,
        'ledger changed during evidence fsync');
      this.db.prepare('INSERT INTO artifacts(task_id,name,digest) VALUES(?,?,?)').run(id,name,digest);
      this.#appendVerifiedMutation(id,'ARTIFACT_REGISTERED',{name,digest});
      return {path:file,sha256:digest};
    });
  }
  init(task) {
    assert(!this.get(task.id),'task already exists');
    fs.mkdirSync(this.dir(task.id),{recursive:true,mode:0o700});
    this.transaction(()=>{
      this.db.prepare('INSERT INTO tasks(id,data) VALUES(?,?)').run(task.id,canonical(task));
      this.#appendVerifiedMutation(task.id,'CREATED',{digest:task.frozen.digest});
    });
  }
  get(id) {
    const row=this.db.prepare('SELECT data FROM tasks WHERE id=?').get(checkedId(id));
    return row?JSON.parse(row.data):null;
  }
  #validateTaskTransition(oldTask,nextTask,type){
    assert(oldTask&&nextTask&&oldTask.id===nextTask.id,'task identity changed');
    assert(canonical(nextTask.frozen)===canonical(oldTask.frozen),
      'frozen config is immutable after task creation');
    for(const [key,limit] of [['aRound',10],['bRound',10]]){
      const prev=oldTask[key],curr=nextTask[key];
      if(prev===undefined&&curr===undefined)continue; // synthetic legacy fixtures
      assert(Number.isInteger(prev)&&prev>=0&&prev<=limit,
        `invalid persisted ${key} round counter`);
      assert(Number.isInteger(curr)&&curr>=prev&&curr<=limit&&curr-prev<=1,
        `${key} budget cannot reset, decrease, skip rounds or exceed limit`);
      if(curr!==prev)
        assert(type===(key==='aRound'?'GATE_A_ROUND_START':'GATE_B_ROUND_START'),
          `${key} may only advance in its round-start transition`);
    }
    const pair=(t)=>{
      const spec=t.taskSpec,hash=t.taskSpecSha;
      const present=spec!==null&&spec!==undefined;
      assert(present===(hash!==null&&hash!==undefined),
        'TASK_SPEC and digest must both be present or absent');
      if(!present)return null;
      assert(typeof spec==='string'&&spec.length>20&&typeof hash==='string'&&hash===sha256(spec),
        'TASK_SPEC digest mismatch');
      return {spec,hash};
    };
    const before=pair(oldTask),after=pair(nextTask);
    if(before){
      assert(after&&after.spec===before.spec&&after.hash===before.hash,
        'approved TASK_SPEC is immutable');
    }else if(after){
      assert(type==='TASK_SPEC_CANDIDATE',
        'TASK_SPEC may only be frozen at the Planner candidate transition');
    }
    for(const key of ['created','baseSha']){
      if(oldTask[key]!==undefined&&oldTask[key]!==null)
        assert(nextTask[key]===oldTask[key],`${key} cannot be replaced`);
    }
    if(oldTask.baseSha===null&&nextTask.baseSha!==null&&nextTask.baseSha!==undefined)
      assert(type==='WORKTREE_PREPARED','baseSha may only be established by worktree preparation');
    if(oldTask.currentSha!==undefined&&oldTask.currentSha!==nextTask.currentSha)
      assert(['WORKTREE_PREPARED','A_COMMIT_FROZEN','B_COMMIT_FROZEN'].includes(type),
        'currentSha may only change when freezing a worktree or commit');
    if(Array.isArray(oldTask.history)){
      assert(Array.isArray(nextTask.history)&&nextTask.history.length>=oldTask.history.length,
        'history cannot be truncated');
      assert(canonical(nextTask.history.slice(0,oldTask.history.length))===canonical(oldTask.history),
        'history is append-only');
    }
  }
  save(t,type,payload={}) {
    this.transaction(()=>{
      this.verify(t.id);
      const oldTask=this.get(t.id);
      this.#validateTaskTransition(oldTask,t,type);
      this.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(canonical(t),t.id);
      this.#appendVerifiedMutation(t.id,type,{stage:t.stage,status:t.status,...payload});
    });
  }
  event(id,type,payload){
    assert(!this.readOnly,'store opened read-only');
    // Standalone events (including P0 probe-skip) MUST verify their anchor
    // before they can add a new chain head. Atomic BEGIN IMMEDIATE prevents a
    // concurrent writer from changing the anchor between verify and append.
    if(!this.#trustedEventWrite)
      return this.transaction(()=>{this.verify(id);return this.#appendEventRaw(id,type,payload);});
    return this.#appendEventRaw(id,type,payload);
  }
  #appendEventRaw(id,type,payload) {
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
      this.verify(id);
      this.db.prepare('INSERT INTO dispatches(id,task_id,phase,agent_id,state,created) VALUES(?,?,?,?,?,?)')
        .run(dispatchId,id,phase,null,'DISPATCH_INTENT',new Date().toISOString());
      this.#appendVerifiedMutation(id,'DISPATCH_INTENT',{phase,dispatchId});
    });
  }
  recordAck(dispatchId,agentId){
    this.transaction(()=>{
      const d=this.db.prepare('SELECT * FROM dispatches WHERE id=?').get(dispatchId);
      assert(d,'unknown dispatch');
      this.verify(d.task_id);
      assert(d&&d.state==='DISPATCH_INTENT','unknown or previously acknowledged dispatch');
      this.db.prepare('UPDATE dispatches SET agent_id=?,state=? WHERE id=?')
        .run(agentId,'ACKNOWLEDGED',dispatchId);
      this.#appendVerifiedMutation(d.task_id,'DISPATCH_ACK',{dispatchId,agentId,phase:d.phase});
    });
  }
  recordTerminal(dispatchId){
    this.transaction(()=>{
      const d=this.db.prepare('SELECT * FROM dispatches WHERE id=?').get(dispatchId);
      assert(d,'unknown dispatch');
      this.verify(d.task_id);
      assert(d&&d.state==='ACKNOWLEDGED','terminal requires a known acknowledged dispatch');
      this.db.prepare('UPDATE dispatches SET state=? WHERE id=?').run('TERMINAL',dispatchId);
      this.#appendVerifiedMutation(d.task_id,'DISPATCH_TERMINAL',{dispatchId,phase:d.phase,agentId:d.agent_id});
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
    const registered=this.db.prepare('SELECT name,digest FROM artifacts WHERE task_id=?').all(id);
    const expectedNames=new Set(registered.map(entry=>entry.name));
    const evidenceDir=path.join(this.dir(id),'evidence');
    if(fs.existsSync(evidenceDir)){
      for(const name of fs.readdirSync(evidenceDir)){
        // A crashed artifact registration may leave a real file without a manifest row.
        // Preserve it for manual reconciliation; never silently accept or delete it.
        assert(expectedNames.has(name),`unregistered evidence file requires reconciliation: ${name}`);
        assert(fs.lstatSync(path.join(evidenceDir,name)).isFile(),`non-regular evidence artifact: ${name}`);
      }
    }
    for(const entry of registered){
      const file=path.join(this.dir(id),'evidence',entry.name);
      assert(fs.existsSync(file),'missing registered evidence artifact');
      assert(sha256(fs.readFileSync(file,'utf8'))===entry.digest,`evidence artifact hash mismatch: ${entry.name}`);
    }
    return {events:count,head:previous,dispatchSha256:last._dispatch_sha256,artifactSha256:last._artifact_sha256};
  }
  readSnapshot(fn){
    // All reads including chain verification observe one SQLite snapshot (R2-003).
    this.db.exec('BEGIN');
    try { const result=fn(); this.db.exec('COMMIT'); return result; }
    catch(e){ this.db.exec('ROLLBACK'); throw e; }
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
