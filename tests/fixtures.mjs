// TEST ONLY: construct adversarial persisted states without relaxing production
// Store.init(). This module is imported exclusively by offline test files.
// It intentionally rewrites SQLite rows/events; NEVER ship it as runtime code.
import {canonical,sha256,MAX_A,MAX_B,ROLE_PERMISSIONS} from '../src/policy.mjs';

export function resealSyntheticState(store,state) {
  const id=state.id;
  const event=store.db.prepare('SELECT * FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(id);
  if(!event)throw Error('test fixture must first initialize an honest task');
  if(store.db.prepare('SELECT COUNT(*) AS n FROM events WHERE task_id=?').get(id).n!==1)
    throw Error('synthetic test reseal only permitted on single-creation-event fixtures');
  const prior=JSON.parse(event.payload);
  const body=canonical({...prior,_state_sha256:sha256(state)});
  const digest=sha256({id,type:event.type,body,previous:event.previous,at:event.at});
  store.db.exec('BEGIN IMMEDIATE');
  try{
    store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(canonical(state),id);
    store.db.prepare('UPDATE events SET payload=?,digest=? WHERE seq=?').run(body,digest,event.seq);
    store.db.exec('COMMIT');
  }catch(e){store.db.exec('ROLLBACK');throw e;}
  store.verify(id);
}
export function seedSyntheticTask(store,task) {
  const id=task.id;
  const frozen={...(task.frozen??{})};
  if(!frozen.schema)frozen.schema=1;
  if(!frozen.intent)frozen.intent='Synthetic fixture only; not a real work order.';
  frozen.policy={maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS};
  delete frozen.digest;
  frozen.digest=sha256(frozen);
  const boot={...task,id,frozen,stage:'WAIT_GATE_01',status:'WAITING_HUMAN',
    aRound:0,bRound:0,taskSpec:null,taskSpecSha:null,baseSha:null,currentSha:null,
    lastA:null,lastB:null,p0Initial:null,p0Final:null,history:[],inflight:null,
    pendingHuman:null,bFindings:[],changesInB:false};
  store.init(boot);
  const desired={...boot,...task,frozen};
  resealSyntheticState(store,desired);
  return desired;
}
