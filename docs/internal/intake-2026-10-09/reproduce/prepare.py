"""Prepare a new credential-free consumer fixture beside this script.
Usage: python3 prepare.py --install
Requires an existing Node/npm executable. --install reads the public npm registry.
Never copies the user's configuration or credentials, and never starts a real model.
"""
from pathlib import Path
import os,json,subprocess,sys
base=Path(__file__).resolve().parent/'consumer'
if base.exists():raise SystemExit('Refusing to reuse consumer/. Copy scripts to a new scratch directory.')
for name in ['project','home/.codex','xdg/config','xdg/cache','xdg/data','npm-cache','install']:
 (base/name).mkdir(parents=True,exist_ok=True)
for name in ['empty-npmrc','empty-global-npmrc']:(base/name).write_text('')
env={'PATH':str(base/'install/bin')+os.pathsep+os.environ['PATH'],'HOME':str(base/'home'),'CODEX_HOME':str(base/'home/.codex'),'XDG_CONFIG_HOME':str(base/'xdg/config'),'XDG_CACHE_HOME':str(base/'xdg/cache'),'XDG_DATA_HOME':str(base/'xdg/data'),'npm_config_cache':str(base/'npm-cache'),'npm_config_userconfig':str(base/'empty-npmrc'),'npm_config_globalconfig':str(base/'empty-global-npmrc'),'npm_config_registry':'https://registry.npmjs.org','TMPDIR':os.environ.get('TMPDIR','/tmp')}
(base/'public-env.json').write_text(json.dumps(env,indent=2))
if '--install' in sys.argv:
 subprocess.run(['npm','install','--prefix',str(base/'install'),'-g','@geraldmaron/construct@3.0.0-alpha.26','--no-audit','--no-fund'],env=env,check=True)
else:print('Prepared; install exact alpha.26 into consumer/install before setup.')
