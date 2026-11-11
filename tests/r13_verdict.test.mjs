import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveP0Verdict,assertP0Summary,acceptedP0Dispute,parseAgentOutput,
  AGENT_SCHEMA,sha256} from '../src/policy.mjs';

const seat=(nodeId,verdict,findings=[])=>({
  nodeId,physicalId:'host-'+nodeId,commit:'a'.repeat(40),
  verdict,findings
});
test('R13 signed-seat contract rejects false PASS summary including absent dispute',()=>{
 const reports=[seat('5bao','FAIL',['HIGH: independent defect']),
   seat('9bao','PASS',[])];
 const correct=deriveP0Verdict(reports);
 assert.deepEqual(correct,{passed:false,dispute:true,findings:['HIGH: independent defect']});
 assert.throws(()=>assertP0Summary({reports,passed:true,dispute:false,
   findings:['HIGH: independent defect']}),/P0 summary passed\/dispute/);
 assert.throws(()=>assertP0Summary({reports,passed:false,dispute:false,
   findings:['HIGH: independent defect']}),/P0 summary passed\/dispute/);
 assert.throws(()=>assertP0Summary({reports,passed:false,dispute:true,
   findings:[]}),/P0 summary passed\/dispute/);
});
test('R13 final Arbitrator outputSchema carries actual hash-bound disputeResolution end-to-end',()=>{
 const reports=[seat('5bao','FAIL',['HIGH: independent defect']),
   seat('9bao','PASS',[])];
 const resolution={reportSetSha256:sha256(reports),decisions:[{
  nodeId:'5bao',reportSha256:sha256(reports[0]),disposition:'FALSE_POSITIVE',
  rationale:'Independent code evidence confirms the reported issue does not occur on the approved final SHA.',
  codeRefs:['src/feature.mjs:120']
 }]};
 assert.equal(AGENT_SCHEMA.properties.disputeResolution.type,'object');
 const parsed=parseAgentOutput(JSON.stringify({
  verdict:'PASS',summary:'Final independent technical ruling accepted',
  findings:[],disputeResolution:resolution
 }),'arbitrator');
 assert.deepEqual(parsed.disputeResolution,resolution);
 const final={p0Initial:{commit:'a'.repeat(40),reports,passed:false,
   dispute:true,findings:['HIGH: independent defect']},
  currentSha:'a'.repeat(40),finalArbitration:{disputeResolution:resolution}};
 assert.equal(acceptedP0Dispute(final),true);
 final.p0Initial.passed=true; // attack cannot waive signed FAIL vote
 assert.equal(acceptedP0Dispute(final),false);
 assert.throws(()=>parseAgentOutput(JSON.stringify({
  verdict:'PASS',summary:'Non-Arbitrator attempted to waive P0',
  findings:[],disputeResolution:resolution
 }),'quality_reviewer'),/only final Arbitrator/);
 assert.throws(()=>parseAgentOutput(JSON.stringify({
  verdict:'PASS',summary:'Incomplete zero hash dispute',
  findings:[],disputeResolution:{...resolution,decisions:[{...resolution.decisions[0],reportSha256:'bad'}]}
 }),'arbitrator'),/malformed/);
});
