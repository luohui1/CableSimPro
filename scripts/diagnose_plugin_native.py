"""CI-only native crash reproduction using a generated fixture, not user data.

Never treats a nonzero native exit as success. Artifacts capture stage markers and
exit codes; this diagnostic does not replace the native integration test gate.
"""
from pathlib import Path
import json
import subprocess
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from backend.plugins.service import safe_environment

SCRIPT = r'''
from pathlib import Path
import sys
print('process-start', flush=True)
ROOT=Path(sys.argv[1]);sys.path.insert(0,str(ROOT))
variant=sys.argv[2]
if variant=='import-only':
    import cadquery as cq
    print('native-import-only-complete',flush=True)
    sys.exit(0)
if variant=='native-first':
    import cadquery as cq
    print('cadquery-first-imported', flush=True)
from backend.schemas import Scenario
from backend.foundation.study import prepare_study
print('contracts-imported', flush=True)
if variant!='native-first':
    import cadquery as cq
print('cadquery-imported', flush=True)
scenario=Scenario().model_dump(mode='json')
from backend.foundation.contracts import CircularRecipe, CircularLayer
from backend.schemas import Scenario
s=Scenario();radii=[r/1000 for r in s.cable.radii_mm()]
roles=('conductor','conductor_screen','insulation','insulation_screen','metallic_screen','jacket')
recipe=CircularRecipe(length_m=.25,layers=tuple(CircularLayer(uid=f'cable/{role}',role=role,inner_radius_m=0 if i==0 else radii[i-1],outer_radius_m=radii[i]) for i,role in enumerate(roles))).model_dump(mode='json')
solids=[]
for i,layer in enumerate(recipe['layers']):
    sketch=cq.Workplane('XY').circle(layer['outer_radius_m']*1000)
    if layer['inner_radius_m']:
        sketch=sketch.circle(layer['inner_radius_m']*1000)
    solid=sketch.extrude(250).val()
    print('solid',i,solid.isValid(),solid.Volume(),flush=True)
    solids.append(solid)
compound=cq.Compound.makeCompound(solids)
print('compound-created',flush=True)
if variant=='shape-only':
    print('skip-export-for-isolation',flush=True)
else:
    cq.exporters.export(compound,'cable.step',exportType='STEP')
    print('step-written',Path('cable.step').stat().st_size,flush=True)
if variant=='collect-before-exit':
    del compound, solids, solid, sketch
    import gc
    print('gc-collected',gc.collect(),flush=True)
print('normal-script-end',flush=True)
'''


def main():
    artifacts=ROOT/'artifacts';artifacts.mkdir(exist_ok=True)
    rows=[]
    for variant in ['import-only','standard','collect-before-exit']:
        with tempfile.TemporaryDirectory(prefix='csp-native-') as tmp:
            folder=Path(tmp);script=folder/'probe.py';script.write_text(SCRIPT,encoding='utf-8')
            env=safe_environment(folder)
            if variant=='windows-environment':
                import os
                for key in ('COMSPEC','SYSTEMDRIVE','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA'):
                    if key in os.environ:env[key]=os.environ[key]
                env['APPDATA']=str(folder/'AppData'/'Roaming');env['LOCALAPPDATA']=str(folder/'AppData'/'Local')
                Path(env['APPDATA']).mkdir(parents=True);Path(env['LOCALAPPDATA']).mkdir(parents=True)
            try:
                p=subprocess.run([sys.executable,'-X','faulthandler','-I','-u',str(script),str(ROOT),variant],cwd=folder,env=env,
                                 stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=35,check=False)
                row={'variant':variant,'exit_code':p.returncode,'stdout':p.stdout.decode('utf-8',errors='replace')[-10000:],
                     'stderr':p.stderr.decode('utf-8',errors='replace')[-12000:],'step_present':(folder/'cable.step').is_file()}
            except subprocess.TimeoutExpired:
                row={'variant':variant,'timeout':True}
            rows.append(row)
    (artifacts/'native-crash-probes.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
    for row in rows:print(json.dumps(row))

if __name__=='__main__':main()
