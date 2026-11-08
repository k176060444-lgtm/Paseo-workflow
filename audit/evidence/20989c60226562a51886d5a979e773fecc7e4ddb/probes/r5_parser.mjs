import assert from 'node:assert/strict';
import {parseAgentOutput} from '../offline-copy/src/policy.mjs';

const F={verdict:'FAIL',summary:'real blocker',findings:['BLOCKER: breaks gate']};
const P={verdict:'PASS',summary:'example pass',findings:[]};
const tick=String.fromCharCode(96).repeat(3);
const results=[];
function ok(name,fn){try{fn();results.push({name,result:'CONFIRMED'});console.log('CONFIRMED',name);}catch(e){results.push({name,result:'NOT_CONFIRMED',error:e.message});console.log('NOT_CONFIRMED',name,e.message);}}
function bad(name,fn,re){try{fn();results.push({name,result:'NOT_CONFIRMED'});console.log('NOT_CONFIRMED',name);}catch(e){const yes=re.test(e.message);results.push({name,result:yes?'CONFIRMED':'WRONG_ERROR',error:e.message});console.log(yes?'CONFIRMED':'WRONG_ERROR',name,e.message);}}

bad('R4-005 local FAIL then PASS rejected',()=>parseAgentOutput('## audit\n'+JSON.stringify(F)+'\n'+JSON.stringify(P),'spec_reviewer'),/ambiguous or missing/);
bad('R4-005 local PASS then FAIL rejected',()=>parseAgentOutput('## audit\n'+JSON.stringify(P)+'\n'+JSON.stringify(F),'spec_reviewer'),/ambiguous or missing/);
bad('R4-005 local two fenced verdicts rejected',()=>parseAgentOutput('Example:\n'+tick+'json\n'+JSON.stringify(P)+'\n'+tick+'\n'+tick+'json\n'+JSON.stringify(F)+'\n'+tick,'spec_reviewer'),/ambiguous or missing/);
ok('R4-005 local inline example + terminal FAIL accepted as FAIL',()=>{const r=parseAgentOutput('## report\nExample: '+JSON.stringify(P)+'\n'+JSON.stringify(F),'spec_reviewer');assert.equal(r.verdict,'FAIL');});
ok('R4-005 local single terminal fenced FAIL accepted',()=>{const r=parseAgentOutput('## report\n'+tick+'json\n'+JSON.stringify(F)+'\n'+tick,'spec_reviewer');assert.equal(r.verdict,'FAIL');});
ok('R4-005 local indented/pretty/CRLF accepted',()=>{const r=parseAgentOutput('## report\r\n  '+JSON.stringify(F,null,2).replace(/\n/g,'\r\n  '),'spec_reviewer');assert.equal(r.verdict,'FAIL');});
bad('R4-005 local truncated JSON rejected',()=>parseAgentOutput('## report\n'+JSON.stringify(F).slice(0,-4),'spec_reviewer'),/ambiguous or missing/);
bad('R4-005 local trailing prose rejected',()=>parseAgentOutput('## report\n'+JSON.stringify(F)+'\nTrailing instructions','spec_reviewer'),/terminal/);
bad('R4-005 local PASS+BLOCKER finding rejected',()=>parseAgentOutput(JSON.stringify({verdict:'PASS',summary:'x',findings:['BLOCKER: x']}),'spec_reviewer'),/inconsistent PASS\/findings/);
ok('R4-005 local APPROVE_WITH_COMMENTS+LOW accepted',()=>{const r=parseAgentOutput(JSON.stringify({verdict:'APPROVE_WITH_COMMENTS',summary:'x',findings:['LOW: nit']}),'spec_reviewer');assert.equal(r.verdict,'APPROVE_WITH_COMMENTS');});
bad('R4-005 local APPROVE_WITH_COMMENTS+HIGH rejected',()=>parseAgentOutput(JSON.stringify({verdict:'APPROVE_WITH_COMMENTS',summary:'x',findings:['HIGH: x']}),'spec_reviewer'),/inconsistent PASS\/findings/);
import fs from 'node:fs';
fs.writeFileSync('C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r4/logs/probe-r5-parser-local.json',JSON.stringify(results,null,2));
console.log('TOTAL',results.length,'CONFIRMED',results.filter(x=>x.result==='CONFIRMED').length);