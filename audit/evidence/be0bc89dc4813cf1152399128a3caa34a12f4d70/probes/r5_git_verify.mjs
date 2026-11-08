import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Store} from '../offline-copy/src/store.mjs';
import {WorkflowController} from '../offline-copy/src/controller.mjs';
import {verifyCommitEvidenceSync} from '../offline-copy/src/git.mjs';
import {sha256,ROLE_PERMISSIONS,MAX_A,MAX_B} from '../offline-copy/src/policy.mjs';
import {seedSyntheticTask} from '../offline-copy/tests/fixtures.mjs';
function git(dir,...args){return execFileSync('git',['-C',dir,...args],{encoding:'utf8'}).trim();}
function mkRepo(root){
  const repo=path.join(root,'repo');fs.mkdirSync(repo);git(repo,'init','-q');
  fs.writeFileSync(path.join(repo,'f.txt'),'base');git(repo,'add','.');git(repo,'-c','user.name=T','-c','user.email=t@l','commit','-qm','base');
  const base=git(repo,'rev-parse','HEAD');
  fs.writeFileSync(path.join(repo,'f.txt'),'child');git(repo,'add','.');git(repo,'-c','user.name=T','-c','user.email=t@l','commit','-qm','child');
  const child=git(repo,'rev-parse','HEAD');
  git(repo,'checkout','-q','-b','fork',base);fs.writeFileSync(path.join(repo,'g.txt'),'fork');git(repo,'add','.');git(repo,'-c','user.name=T','-c','user.email=t@l','commit','-qm','fork');
  const fork=git(repo,'rev-parse','HEAD');git(repo,'checkout','-q','--detach',child);
  return {repo,base,child,fork};
}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r5-gitverify-'));
const {repo,base,child,fork}=mkRepo(root);
const wt=path.join(root,'wt');git(repo,'worktree','add','--detach',wt,child);
const wtBase=path.join(root,'wtbase');git(repo,'worktree','add','--detach',wtBase,base);
const results=[];function rec(name,result,detail=''){results.push({name,result,detail});console.log(result,name,detail);}
function expectReject(name,fn,re){try{fn();rec(name,'NOT_CONFIRMED','accepted');}catch(e){const ok=re.test(e.message);rec(name,ok?'CONFIRMED':'WRONG_ERROR',e.message.slice(0,180));}}
function expectOk(name,fn){try{fn();rec(name,'CONFIRMED');}catch(e){rec(name,'NOT_CONFIRMED',e.message.slice(0,180));}}

expectOk('R5-003 verifier accepts real base->child and exact worktree HEAD',()=>{const r=verifyCommitEvidenceSync(repo,base,child,wt);assert.equal(r.baseSha,base);assert.equal(r.commitSha,child);});
expectReject('R5-003 rejects missing SHA',()=>verifyCommitEvidenceSync(repo,base,'f'.repeat(40),wt),/unverified/);
const tree=git(repo,'rev-parse',child+'^{tree}');const blob=git(repo,'rev-parse',child+':f.txt');
expectReject('R5-003 rejects non-commit tree object',()=>verifyCommitEvidenceSync(repo,base,tree,wt),/unverified/);
expectReject('R5-003 rejects non-commit blob object',()=>verifyCommitEvidenceSync(repo,base,blob,wt),/unverified/);
expectReject('R5-003 rejects wrong ancestor child->base',()=>verifyCommitEvidenceSync(repo,child,base,wt),/unverified/);
expectReject('R5-003 rejects worktree HEAD mismatch',()=>verifyCommitEvidenceSync(repo,base,child,wtBase),/unverified/);
expectReject('R5-003 rejects previousSha not ancestor of new child',()=>verifyCommitEvidenceSync(repo,base,child,wt,fork),/unverified/);
expectReject('R5-003 rejects replaced/missing worktree directory',()=>{const gone=path.join(root,'gone');verifyCommitEvidenceSync(repo,base,child,gone);},/unverified/);

function storeFixture(){const root2=fs.mkdtempSync(path.join(os.tmpdir(),'p1-r5-store3-'));const store=new Store(path.join(root2,'state'));const id='TASKR5GIT';
  const frozen={schema:1,intent:'Synthetic Git verification probe',project:{repo,baseRef:'HEAD'},tests:{commands:[]},policy:{maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS},souls:{}};frozen.digest=sha256(frozen);
  const honest={id,frozen,stage:'WAIT_GATE_01',status:'WAITING_HUMAN',aRound:0,bRound:0,taskSpec:null,taskSpecSha:null,baseSha:null,currentSha:null,lastA:null,lastB:null,p0Initial:null,p0Final:null,history:[],pendingHuman:null,inflight:null,bFindings:[],changesInB:false,worktree:null,created:new Date().toISOString()};
  return {root2,store,id,honest,close(){store.close();fs.rmSync(root2,{recursive:true,force:true});}};
}
{
  const w=storeFixture();try{
    seedSyntheticTask(w.store,{...w.honest,stage:'PREPARE',status:'READY'});
    const before=w.store.verify(w.id);const t=w.store.get(w.id);
    t.stage='A_WORKER';t.status='READY';t.baseSha='f'.repeat(40);t.currentSha=t.baseSha;t.worktree=path.join(w.store.dir(w.id),'worktree');
    expectReject('R5-003 Store WORKTREE_PREPARED rejects fake SHA',()=>w.store.save(t,'WORKTREE_PREPARED'),/Git repository|unverified/);
    assert.deepEqual(w.store.verify(w.id),before);assert.equal(w.store.get(w.id).baseSha,null);
  }finally{w.close();}
}
{
  const w=storeFixture();try{
    const wt2=path.join(w.store.dir(w.id),'worktree');fs.mkdirSync(path.dirname(wt2),{recursive:true});git(repo,'worktree','add','--detach',wt2,base);
    seedSyntheticTask(w.store,{...w.honest,stage:'A_WORKER',status:'READY',baseSha:base,currentSha:base,worktree:wt2});
    const t=w.store.get(w.id);t.currentSha='f'.repeat(40);t.stage='A_REVIEW';t.status='READY';
    expectReject('R5-003 Store A_COMMIT_FROZEN rejects fake SHA',()=>w.store.save(t,'A_COMMIT_FROZEN'),/unverified/);
    assert.equal(w.store.get(w.id).currentSha,base);
  }finally{w.close();}
}
{
  const w=storeFixture();try{
    const wt3=path.join(w.store.dir(w.id),'worktree');fs.mkdirSync(path.dirname(wt3),{recursive:true});git(repo,'worktree','add','--detach',wt3,base);
    seedSyntheticTask(w.store,{...w.honest,stage:'B_WORKER',status:'READY',baseSha:base,currentSha:base,worktree:wt3});
    const t=w.store.get(w.id);t.currentSha='f'.repeat(40);t.stage='B_REVIEW';t.status='READY';
    expectReject('R5-003 Store B_COMMIT_FROZEN rejects fake SHA',()=>w.store.save(t,'B_COMMIT_FROZEN'),/unverified/);
    assert.equal(w.store.get(w.id).currentSha,base);
  }finally{w.close();}
}
{
  const w=storeFixture();try{
    const sha='f'.repeat(40);const lastA={pass:true,tests:{pass:true},commit:sha};const lastB={pass:true,tests:{pass:true},commit:sha};
    seedSyntheticTask(w.store,{...w.honest,stage:'WAIT_GATE_59',status:'WAITING_HUMAN',baseSha:base,currentSha:sha,aRound:1,bRound:1,lastA,lastB,p0Initial:{passed:true,commit:sha,reports:[{physicalId:'A',commit:sha,verdict:'PASS',findings:[]},{physicalId:'B',commit:sha,verdict:'PASS',findings:[]}]}});
    const c=new WorkflowController({store:w.store,runtime:null,p0:null,gitOps:{verifyCommitEvidenceSync}});
    expectReject('R5-003 Controller.approve Gate 5.9 rejects fake SHA',()=>c.approve({id:w.id,gate:'5.9',digest:sha,actor:'fake-human',receipt:'Fake human final approval receipt long enough.'}),/unverified|Git/);
    assert.equal(w.store.get(w.id).stage,'WAIT_GATE_59');
  }finally{w.close();}
}
{
  const w=storeFixture();try{
    const sha='f'.repeat(40);const wt4=path.join(w.store.dir(w.id),'worktree');fs.mkdirSync(path.dirname(wt4),{recursive:true});git(repo,'worktree','add','--detach',wt4,base);
    seedSyntheticTask(w.store,{...w.honest,stage:'BLOCKED',status:'BLOCKED',baseSha:base,currentSha:sha,worktree:wt4});
    const c=new WorkflowController({store:w.store,runtime:null,p0:null,gitOps:{verifyCommitEvidenceSync}});
    expectReject('R5-003 authorizeRecovery rejects fake SHA',()=>c.authorizeRecovery({id:w.id,actor:'fake-human',receipt:'Fake recovery receipt long enough.',expectedSha:sha}),/unverified|Git/);
    assert.equal(w.store.get(w.id).stage,'BLOCKED');
  }finally{w.close();}
}
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r5/logs/probe-r5-git-verify.json',JSON.stringify(results,null,2));
console.log('TOTAL',results.length,'CONFIRMED',results.filter(x=>x.result==='CONFIRMED').length);
fs.rmSync(root,{recursive:true,force:true});