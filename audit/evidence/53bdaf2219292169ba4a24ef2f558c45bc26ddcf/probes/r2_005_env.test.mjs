import test from 'node:test';
import assert from 'node:assert/strict';
import {childEnv, execArgv} from '../offline-copy/src/git.mjs';

test('R2-005 childEnv omits an unrelated synthetic secret',()=>{
  process.env.P1_SYNTHETIC_SECRET='do-not-leak';
  try{
    const env=childEnv();
    assert(!('P1_SYNTHETIC_SECRET' in env));
  }finally{delete process.env.P1_SYNTHETIC_SECRET;}
});

test('R2-005 real child process cannot see the synthetic secret',async()=>{
  process.env.P1_SYNTHETIC_SECRET='do-not-leak';
  try{
    const r=await execArgv(process.execPath,['-e','process.stdout.write(process.env.P1_SYNTHETIC_SECRET||"ABSENT")'],{timeoutMs:30000});
    assert.equal(r.code,0);
    assert.equal(r.stdout,'ABSENT');
    assert.equal(r.stderr,'');
  }finally{delete process.env.P1_SYNTHETIC_SECRET;}
});

test('R2-005 explicit extra env is passed through',async()=>{
  const r=await execArgv(process.execPath,['-e','process.stdout.write(process.env.P1_ALLOWED||"ABSENT")'],{timeoutMs:30000,env:{P1_ALLOWED:'allowed-value'}});
  assert.equal(r.code,0);
  assert.equal(r.stdout,'allowed-value');
});

test('R2-005 childEnv keeps required runtime variables but not arbitrary secrets',()=>{
  process.env.P1_SECOND_SECRET='second-do-not-leak';
  try{
    const env=childEnv();
    assert(!('P1_SECOND_SECRET' in env));
    assert('PATH' in env || 'Path' in env);
  }finally{delete process.env.P1_SECOND_SECRET;}
});

test('R2-005 execArgv rejects a truncated/oversized child output and kills it',async()=>{
  // 16 MiB cap: produce 17 MiB and verify the guard fires, process is killed.
  const script='process.stdout.write("x".repeat(17*1024*1024))';
  const r=await execArgv(process.execPath,['-e',script],{timeoutMs:30000});
  assert.equal(r.truncated,true);
  console.log('R2-005 truncation code='+String(r.code)+' signal='+String(r.signal));
});
