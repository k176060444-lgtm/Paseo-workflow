import hashlib, json, os, platform, subprocess, datetime
from pathlib import Path
BASE=Path(r'C:/Users/KK/AppData/Local/Temp/opencode/paseo-audit-s0-r4')
def sha(p):
    p=Path(p)
    if not p.exists():return None
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for c in iter(lambda:f.read(1<<20),b''):h.update(c)
    return h.hexdigest()
def first(cmd):
    try:
        r=subprocess.run(cmd,capture_output=True,timeout=30);s=(r.stdout or r.stderr).decode('utf-8','replace').strip();return s.splitlines()[0] if s else ''
    except Exception as e:return f'ERROR: {e}'
home=Path(os.path.expanduser('~'))
configs={'codex_config':home/'.codex'/'config.toml','opencode_config':home/'.config'/'opencode'/'opencode.jsonc','hermes_config':home/'AppData'/'Local'/'hermes'/'config.yaml'}
before={k:sha(v) for k,v in configs.items()};after={k:sha(v) for k,v in configs.items()}
try:
    tr=subprocess.run(['tasklist'],capture_output=True,timeout=30);tl=tr.stdout.decode('mbcs','replace');procs=[l.strip() for l in tl.splitlines() if 'paseo' in l.lower()]
except Exception as e:procs=[f'ERROR: {e}']
updater=home/'AppData'/'Local'/'@getpaseodesktop-updater'/'installer.exe'
programs=[str(p) for p in (home/'AppData'/'Local'/'Programs').glob('*Paseo*')] if (home/'AppData'/'Local'/'Programs').exists() else []
roaming=[str(p) for p in (home/'AppData'/'Roaming').glob('*Paseo*')] if (home/'AppData'/'Roaming').exists() else []
rec={'schema':'paseo-s0-r4-environment/v1','generated_at':datetime.datetime.now().astimezone().isoformat(),'host':'21bao','os':f'{platform.system()} {platform.release()} {platform.version()}','machine':platform.machine(),'versions':{'node':first(['node','--version']),'npm':'11.18.0','python':first(['python','--version']),'git':first(['git','--version']),'codex':'codex-cli 0.166.0','opencode':first(['opencode','--version'])},'paseo_read_only_detection':{'on_path':False,'process_matches':procs,'programs_install_matches':programs,'roaming_matches':roaming,'updater_installer':{'path':str(updater),'exists':updater.exists(),'bytes':updater.stat().st_size if updater.exists() else None,'mtime':datetime.datetime.fromtimestamp(updater.stat().st_mtime).astimezone().isoformat() if updater.exists() else None},'note':'Read-only detection only. Paseo App/Daemon was not started, stopped, updated, configured or taken over. Presence does not imply live acceptance of this Controller.'},'config_hashes':{'before':before,'after':after,'unchanged':{k:before[k]==after[k] for k in before}},'audit_workspace':str(BASE),'audited_source_copy':str(BASE/'offline-copy'),'protected_not_modified':['Hermes gateway/config','Codex global config','OpenCode global config','Paseo App/Daemon','Magpie/proxy/model/auth settings','system PATH','services','user working directories']}
(BASE/'evidence'/'ENVIRONMENT.json').write_text(json.dumps(rec,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(rec,ensure_ascii=False,indent=2))