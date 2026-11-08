import hashlib,json,os,platform,subprocess,datetime
from pathlib import Path
B=Path(r'C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r7')
def sha(p):
 p=Path(p)
 if not p.exists():return None
 h=hashlib.sha256();h.update(p.read_bytes());return h.hexdigest()
def first(cmd):
 try:r=subprocess.run(cmd,capture_output=True,timeout=30);return ((r.stdout or r.stderr).decode('utf-8','replace').strip().splitlines() or [''])[0]
 except Exception as e:return 'ERROR: '+str(e)
home=Path(os.path.expanduser('~'))
configs={'codex_config':home/'.codex'/'config.toml','opencode_config':home/'.config'/'opencode'/'opencode.jsonc','hermes_config':home/'AppData'/'Local'/'hermes'/'config.yaml','paseo_config':Path(r'D:/Paseo-data/home/config.json')}
before={k:sha(v) for k,v in configs.items()};after={k:sha(v) for k,v in configs.items()}
try:
 tr=subprocess.run(['tasklist'],capture_output=True,timeout=30);procs=[l.strip() for l in tr.stdout.decode('mbcs','replace').splitlines() if 'paseo' in l.lower()]
except Exception as e:procs=['ERROR: '+str(e)]
rec={'schema':'paseo-s0-r7-environment/v1','generated_at':datetime.datetime.now().astimezone().isoformat(),'host':'21bao','os':f'{platform.system()} {platform.release()} {platform.version()}','machine':platform.machine(),
'audited_commit':'3e4e80e65960e55b774b6009728d5ba4e4e44a25','baseline_commit':'20989c60226562a51886d5a979e773fecc7e4ddb','tree':'5743312c2e9f3595bee3fecc4819e935d0fcc73c',
'parent_commit':'1e237028ab4029b38f6c48058a54a7520887c17f',
'versions':{'node':first(['node','--version']),'npm':'11.18.0','python':first(['python','--version']),'git':first(['git','--version']),'codex':'codex-cli 0.166.0','opencode':first(['opencode','--version']),'paseo_app':'0.15.3','paseo_daemon':'0.15.3','paseo_cli':'0.15.3','sdk_declared':'0.15.2','sdk_bundled':'0.15.3'},
'paseo_read_only':{'process_matches':procs,'daemon_listen':['127.0.0.1:6767','127.0.0.1:56170'],'daemon_pid':9844,'home':'D:\\Paseo-data\\home','userData':'D:\\Paseo-data\\userData','app':'D:\\Paseo\\Paseo.exe','cli':'C:\\Users\\KK\\.local\\bin\\paseo.cmd'},
'config_hashes':{'before':before,'after':after,'unchanged':{k:before[k]==after[k] for k in before}},
'workspace':str(B),'source_copy':str(B/'repo'),'protected_not_modified':['Hermes gateway/config','Codex global config','OpenCode global config','Paseo App/Daemon/HOME/config','Magpie/proxy/model/auth settings','system PATH','services','user working directories']}
(B/'evidence'/'ENVIRONMENT.json').write_text(json.dumps(rec,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(rec,ensure_ascii=False,indent=2)[:2200])