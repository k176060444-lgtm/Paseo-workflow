import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const ROLE_PERMISSIONS = Object.freeze({
  planner: 'READ_ONLY', worker: 'WORKSPACE_WRITE',
  spec_reviewer: 'READ_ONLY', quality_reviewer: 'READ_ONLY',
  tester_gate_a: 'TEST_ONLY', worker_remediation: 'WORKSPACE_WRITE',
  tester_gate_b: 'TEST_ONLY', arbitrator: 'READ_ONLY', pro_audit: 'READ_ONLY',
  blind_a: 'READ_ONLY', blind_b: 'READ_ONLY', blind_c: 'READ_ONLY',
});
export const LOCAL_ROLES = Object.freeze(['planner', 'worker', 'spec_reviewer', 'quality_reviewer',
  'tester_gate_a', 'worker_remediation', 'tester_gate_b', 'arbitrator', 'pro_audit']);
export const MAX_A = 10;
export const MAX_B = 10;
export const TERMINAL = new Set(['WAIT_GATE_01', 'WAIT_GATE_02', 'WAIT_GATE_59', 'WAIT_HUMAN',
  'NEEDS_RECONCILIATION', 'BLOCKED', 'STOPPED_BUDGET', 'CLOSED']);

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sha256 = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
export function assert(condition, message) { if (!condition) throw new Error(message); }
export function checkedId(s) { assert(typeof s === 'string' && /^[a-zA-Z0-9_-]{4,64}$/.test(s), 'invalid task ID'); return s; }
export function within(base, p) {
  const resolved = path.resolve(base, p);
  assert(resolved.startsWith(path.resolve(base) + path.sep), `path escapes approved root: ${p}`);
  return resolved;
}
export function freezeConfig(configFile, intentFile) {
  const configPath = realpathSync(configFile);
  const root = path.dirname(configPath);
  const assetRoot = path.resolve(root, '..'); // config/ and souls/ are siblings in this project
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert(config.schema === 1, 'role matrix schema must be 1');
  assert(config.project && typeof config.project.repo === 'string', 'missing project.repo');
  assert(Array.isArray(config.tests?.commands) && config.tests.commands.length > 0, 'approved test commands required');
  for (const cmd of config.tests.commands) {
    assert(Array.isArray(cmd) && cmd.length >= 2 && cmd.every(x => typeof x === 'string' && x.length), 'test commands must be argv arrays');
  }
  // Gate B MUST run three separately approved layers. A single repeated
  // generic test command cannot be silently presented as Smoke/Canary/Regression.
  const layers=config.tests.gateB;
  assert(layers&&typeof layers==='object'&&!Array.isArray(layers),
    'Gate B needs user-approved smoke/canary/regression command matrix');
  for(const layer of ['smoke','canary','regression']){
    const group=layers[layer];
    assert(Array.isArray(group)&&group.length>0&&group.every(cmd=>
      Array.isArray(cmd)&&cmd.length>=2&&cmd.every(a=>typeof a==='string'&&a.length>0)),
      'Gate B '+layer+' must have independently approved argv commands');
  }
  const souls = {};
  const resolvedRoles = {};
  for (const role of LOCAL_ROLES) {
    const item = config.roles?.[role];
    assert(item && ['codex', 'opencode'].includes(item.harness), `invalid harness for ${role}`);
    assert(typeof item.model === 'string' && item.model.includes('/') && !item.model.includes('<'), `unapproved provider/model for ${role}`);
    assert(item.model.split('/')[0] === item.harness, `harness/model mismatch for ${role}`);
    assert(typeof item.soul === 'string', `missing soul for ${role}`);
    const source = within(assetRoot, path.resolve(root, item.soul));
    const data = readFileSync(source, 'utf8');
    assert(data.trim().length > 50, `empty soul: ${role}`);
    souls[role] = { text: data, sha256: sha256(data) };
    resolvedRoles[role] = { harness: item.harness, model: item.model, soul: item.soul };
  }
  for (const role of ['blind_a','blind_b','blind_c']) {
    const item = config.roles?.[role];
    if (!item) continue;
    assert(typeof item.soul === 'string', `missing soul ${role}`);
    const data = readFileSync(within(assetRoot, path.resolve(root, item.soul)), 'utf8');
    souls[role] = { text:data, sha256:sha256(data) };
  }
  const intent = readFileSync(intentFile, 'utf8');
  assert(intent.trim().length > 10, 'empty task intent');
  const frozen = { schema: 1, intent, intentSha256:sha256(intent), roles:resolvedRoles, souls,
    tests: config.tests, project: {repo:path.resolve(root, config.project.repo), baseRef:config.project.baseRef ?? 'HEAD'},
    p0: {transport:config.p0?.transport??'paseo',...(config.p0??{})}, policy: {maxA:MAX_A,maxB:MAX_B,permissions:ROLE_PERMISSIONS},
    runtime: {paseoUrl:config.runtime?.paseoUrl ?? 'ws://127.0.0.1:6767/ws'},
    source: { configFile:configPath }};
  frozen.digest = sha256(frozen);
  return frozen;
}

export const GATE_B_LAYERS=Object.freeze(['smoke','canary','regression']);
export function verifyGateBTests(t){
  const matrix=t?.frozen?.tests?.gateB,tests=t?.lastB?.tests;
  assert(matrix&&tests?.pass===true&&tests.layers&&Array.isArray(tests.receipts),
    'Tester B missing independently approved complete Smoke/Canary/Regression receipts');
  const flattened=[];
  for(const layer of GATE_B_LAYERS){
    const approved=matrix[layer],recorded=tests.layers[layer];
    assert(Array.isArray(approved)&&approved.length>0&&recorded?.pass===true&&
      Array.isArray(recorded.receipts)&&recorded.receipts.length===approved.length,
      'Tester B '+layer+' has missing or failed evidence');
    for(let i=0;i<approved.length;i++){
      const receipt=recorded.receipts[i];
      assert(receipt?.ok===true&&receipt.code===0&&
        sha256(receipt.argv)===sha256(approved[i])&&
        /^[a-f0-9]{64}$/.test(receipt.logSha256??''),
        'Tester B '+layer+' executed a command outside the approved matrix');
      flattened.push({...receipt,layer});
    }
  }
  assert(sha256(flattened)===sha256(tests.receipts),
    'Tester B flattened original receipts do not match three authenticated layers');
  return true;
}
function approvedTestBash(commands=[]){
  const allowed={'*':'deny','git status':'allow','git diff':'allow'};
  const binaries=new Set(['git','node','npm','pnpm','yarn','python','python3','pytest',
    'cargo','go','dotnet','mvn','gradle']);
  for(const argv of commands){
    if(!Array.isArray(argv)||argv.length<1||!binaries.has(argv[0])||
      !argv.every(s=>typeof s==='string'&&/^[A-Za-z0-9_.:/@+=-]+$/.test(s)))
      continue; // No shell metacharacters or interpreter -c/-e injections.
    if(argv[0]==='git'&&argv.join(' ')!=='git diff --check')continue;
    if(argv.some((s,i)=>i>0&&['-c','-e','--eval','--require','-r'].includes(s)))continue;
    allowed[argv.join(' ')]='allow';
  }
  return allowed;
}
export function providerOptions(role, harness,approvedTestCommands=[]) {
  const permission = ROLE_PERMISSIONS[role];
  assert(permission, 'unrecognized role');
  if (harness === 'codex') {
    if (permission === 'READ_ONLY') return {sandbox_mode:'read-only',approval_policy:'never',web_search:'disabled'};
    if (permission === 'TEST_ONLY') return {sandbox_mode:'workspace-write',approval_policy:'never',sandbox_workspace_write:{network_access:false}};
    if (permission === 'WORKSPACE_WRITE') return {sandbox_mode:'workspace-write',approval_policy:'never', sandbox_workspace_write:{network_access:false}};
    // TEST_ONLY is NOT native to Codex; the dedicated disposable test workspace is mandatory.
    return {sandbox_mode:'workspace-write',approval_policy:'never',sandbox_workspace_write:{network_access:false}};
  }
  if (harness === 'opencode') {
    if (permission === 'READ_ONLY') return {permission:{read:'allow',glob:'allow',grep:'allow',list:'allow',edit:'deny',bash:'deny',external_directory:'deny',task:'deny',webfetch:'deny',websearch:'deny'}};
    if (permission === 'TEST_ONLY') return {permission:{read:'allow',glob:'allow',grep:'allow',list:'allow',edit:'allow',bash:approvedTestBash(approvedTestCommands),external_directory:'deny',task:'deny',webfetch:'deny',websearch:'deny'}};
    if (permission === 'WORKSPACE_WRITE') return {permission:{read:'allow',glob:'allow',grep:'allow',list:'allow',edit:'allow',bash:approvedTestBash(approvedTestCommands),external_directory:'deny',webfetch:'deny',websearch:'deny'}};
    return {permission:{read:'allow',glob:'allow',grep:'allow',list:'allow',edit:'allow',bash:'deny',external_directory:'deny',webfetch:'deny',websearch:'deny'}};
  }
  throw new Error(`unsupported harness ${harness}`);
}

// Accept a strict final JSON object OR a Markdown report followed by a final
// fenced/bare JSON envelope. Never interpret arbitrary prose as PASS (R2-006).
export function finalJsonEnvelope(raw, role='agent') {
  assert(typeof raw==='string','agent result must be text');
  // JSON verdicts are security decisions, not examples: find every complete
  // standalone line-start verdict object, then require exactly ONE. In
  // particular, FAIL followed by PASS must never silently return PASS.
  const results=[];
  for(const match of raw.matchAll(/(?:^|\r?\n)[ \t]*(?=\{)/g)){
    const start=match.index+match[0].length;
    let depth=0,inString=false,escaped=false,end=-1;
    for(let i=start;i<raw.length;i++){
      const c=raw[i];
      if(inString){
        if(escaped)escaped=false;
        else if(c==='\\')escaped=true;
        else if(c==='"')inString=false;
        continue;
      }
      if(c==='"'){inString=true;continue;}
      if(c==='{')depth++;
      else if(c==='}'){if(--depth===0){end=i+1;break;}if(depth<0)break;}
    }
    if(end<0)continue;
    try {
      const obj=JSON.parse(raw.slice(start,end));
      if(obj&&typeof obj==='object'&&!Array.isArray(obj)&&typeof obj.verdict==='string')
        results.push({obj,end});
    } catch{}
  }
  assert(results.length===1,
    `${role}: ambiguous or missing final JSON verdict object; manual reconciliation required`);
  const suffix=raw.slice(results[0].end).trim();
  assert(suffix===''||suffix==='```',
    `${role}: final JSON verdict must be terminal; manual reconciliation required`);
  return results[0].obj;
}
// Normalize legacy Soul verdicts at the input trust boundary, never in signed
// payloads. Gate-specific PASS aliases are accepted only for their Tester.
export function normalizeVerdict(value,role){
  const base={APPROVE:'PASS',REQUEST_CHANGES:'FAIL',REJECT:'FAIL',
    NEEDS_CLARIFICATION:'QUESTION',UNVERIFIED:'QUESTION'};
  if(value==='GATE_A_PASS'){
    assert(role==='tester_gate_a','Gate A PASS from wrong role');return 'PASS';
  }
  if(value==='GATE_B_PASS'){
    assert(role==='tester_gate_b','Gate B PASS from wrong role');return 'PASS';
  }
  return base[value]??value;
}
export function parseAgentOutput(raw, role) {
  const output=finalJsonEnvelope(raw,role);
  assert(output && typeof output === 'object' && !Array.isArray(output), `${role}: invalid output`);
  // Legacy Soul v1.1 uses APPROVE/REQUEST_CHANGES; normalize at the trust boundary.
  output.verdict = normalizeVerdict(output.verdict,role);
  assert(['PASS','FAIL','QUESTION','NEEDS_SPECIALIST','APPROVE_WITH_COMMENTS'].includes(output.verdict), `${role}: invalid verdict`);
  assert(typeof output.summary === 'string' && output.summary.length > 0, `${role}: missing summary`);
  assert(Array.isArray(output.findings) && output.findings.every(f => typeof f === 'string'), `${role}: findings must be strings`);
  if (PASS(output.verdict) && (
    hasBlockingFinding(output.findings) ||
    (output.verdict==='PASS' && output.findings.length>0) ||
    (output.verdict==='APPROVE_WITH_COMMENTS' && output.findings.some(f =>
      !/^\s*(?:[-*]\s*)?\[?(?:LOW|MEDIUM|INFO|ADVISORY)\]?\s*[:：-]/i.test(f)))
  )) throw new Error(`${role}: inconsistent PASS/findings severity; manual reconciliation required`);
  if (role === 'planner') assert(typeof output.taskSpec === 'string' && output.taskSpec.length > 20, 'planner TASK_SPEC absent');
  if(output.userAlignment!==undefined)
    assert(typeof output.userAlignment==='string'&&output.userAlignment.length>40,
      'Planner USER_ALIGNMENT is invalid');
  return output;
}
// Interpret case-insensitive severity markers in prose, not arbitrary mentions within a
// sentence. Reviewers must supply a machine-readable severity in the next Soul version.
export const hasBlockingFinding = findings => findings.some(f =>
  /^(?:\s*[-*]\s*)?(?:\[?(?:BLOCKER|CRITICAL|HIGH|P0|P1)\]?\s*[:：-]|severity\s*[:=]\s*(?:BLOCKER|CRITICAL|HIGH|P0|P1)\b)/i.test(f));
export const PASS = verdict => verdict === 'PASS' || verdict === 'APPROVE_WITH_COMMENTS';
export const PAUSE = verdict => verdict === 'QUESTION' || verdict === 'NEEDS_SPECIALIST';
// Never use an Adapter-provided PASS/dispute flag for technical acceptance.
// These values are derived from the actual per-seat verdicts only. The Store
// separately verifies the original signed node reports against these entries.
export function deriveP0Verdict(reports){
  assert(Array.isArray(reports)&&reports.length>=2,'P0 requires at least two seat reports');
  for(const report of reports)
    assert(report&&['PASS','FAIL','QUESTION','NEEDS_SPECIALIST','APPROVE_WITH_COMMENTS'].includes(report.verdict)&&
      Array.isArray(report.findings)&&report.findings.every(x=>typeof x==='string')&&
      !(PASS(report.verdict)&&report.findings.length>0),
      'P0 report invalid or contradictory verdict/findings');
  const anyPass=reports.some(r=>PASS(r.verdict));
  const anyFail=reports.some(r=>r.verdict==='FAIL');
  const anyUnknown=reports.some(r=>PAUSE(r.verdict));
  return {passed:reports.every(r=>PASS(r.verdict)&&r.findings.length===0),
    dispute:anyUnknown||(anyPass&&anyFail),
    findings:reports.flatMap(r=>r.findings)};
}
export function assertP0Summary(summary){
  assert(summary&&Array.isArray(summary.reports),'P0 original report set absent');
  const computed=deriveP0Verdict(summary.reports);
  assert(summary.passed===computed.passed&&summary.dispute===computed.dispute&&
    canonical(summary.findings)===canonical(computed.findings),
    'P0 summary passed/dispute/findings contradict independently signed seat verdicts');
  return computed;
}
/* An Arbitrator may dismiss a genuinely disputed, independently verified P0
 * finding with evidence, but may NEVER waive missing witnesses, unsigned
 * reports, unknown results, or a unanimous FAIL. The complete signed original
 * P0 report set stays immutable in the task ledger. */
export function acceptedP0Dispute(t){
  const p0=t.p0Final??t.p0Initial;
  const decisions=t.finalArbitration?.disputeResolution;
  if(!p0||p0.commit!==t.currentSha||!Array.isArray(p0.reports)||
    p0.reports.length<2||!Array.isArray(decisions?.decisions)||
    decisions.reportSetSha256!==sha256(p0.reports))return false;
  // Guard even direct callers of acceptedP0Dispute, not just Store/Controller.
  let derived;
  try{derived=deriveP0Verdict(p0.reports);}catch{return false;}
  if(!derived.dispute||derived.passed||p0.passed!==derived.passed||
    p0.dispute!==derived.dispute||canonical(p0.findings)!==canonical(derived.findings))
    return false;
  const positives=p0.reports.filter(r=>PASS(r.verdict)&&r.findings?.length===0);
  const negative=p0.reports.filter(r=>r.verdict==='FAIL');
  if(positives.length===0||negative.length===0||positives.length+negative.length!==p0.reports.length||
    decisions.decisions.length!==negative.length)return false;
  return negative.every(r=>{
    const matches=decisions.decisions.filter(d=>d.nodeId===r.nodeId&&
      d.reportSha256===sha256(r)&&d.disposition==='FALSE_POSITIVE'&&
      typeof d.rationale==='string'&&d.rationale.trim().length>=40&&
      Array.isArray(d.codeRefs)&&d.codeRefs.length>0&&
      d.codeRefs.every(x=>typeof x==='string'&&x.trim().length>=3));
    return matches.length===1;
  });
}

export const AGENT_SCHEMA = {type:'object',properties:{verdict:{type:'string',enum:['PASS','FAIL','QUESTION','NEEDS_SPECIALIST','APPROVE_WITH_COMMENTS','APPROVE','REQUEST_CHANGES']},summary:{type:'string'},findings:{type:'array',items:{type:'string'}},taskSpec:{type:'string'},userAlignment:{type:'string'}},required:['verdict','summary','findings'],additionalProperties:false};
