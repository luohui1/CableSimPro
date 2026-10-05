"""Join immutable solver observations without changing either solver result."""
from pathlib import Path
import json,sys
from copy import deepcopy
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(ROOT/'plugins/cablesim.comsol-bridge/src'))
from cablesim_sdk.reproduction import comparison
from cablesim_sdk.simulation import validate
from cablesim_comsol_bridge.adapter import digest

def read(path):return json.loads(path.read_text('utf-8'))

def main():
 out=ROOT/'.data/simulation/comsol-comparison';reports=[]
 for name in ['eddy-twin','eddy-induced','eddy-lunca']:
  fixture=read(ROOT/f'plugins/cablesim.simulation/src/cases/{name}.json')
  opened=read(out/name/'open-quadratic.json')['mesh_sequence']
  native_file=out/name/('probe-0.2.json' if name=='eddy-lunca' else 'native-0.0005.json')
  native=read(native_file);bundle=native['cases'][0]['artifacts']['x-cablesim.simulation-bundle']
  canonical,_=validate(fixture['input'],fixture['parameters']['mesh']);ph=digest(canonical.model_dump(mode='json'))
  reference={**fixture,'reference_solver':{'name':'COMSOL','problem_sha256':digest(bundle['problem']),
             'source_problem_sha256':bundle['evidence']['problem_sha256'],'normalization':'Shared sorted UTF-8 JSON; source run evidence is unchanged',
             'run_id':native['run_id'],'solver':bundle['result']['solver'],'observations':bundle['observations']}}
  report=comparison(opened[-1]['observations'],reference,{**opened[-1]['numerical_evidence'],'problem_sha256':ph})
  for i,row in enumerate(report['rows']):
   row['last_open_mesh_change']=opened[-1]['rows'][i]['calculated']-opened[-2]['rows'][i]['calculated']
  report['case_id']=name
  report['investigation']=({
   'eddy-twin':'COMSOL vs GetDP difference is below last GetDP mesh step; residual vs 177 micro-ohm/m is dominated by published integer rounding and finite exterior.',
   'eddy-induced':'COMSOL and P2 GetDP agree below last mesh step. Both remain above FEMM Table1 by about 0.26-0.88%. Original FEMM mesh and exterior BC were not published; the cause is not proven. Table2 of the same paper reports 3756/652/2354 kA/m2 from the second analytical approximation, exposing its own larger method discrepancy. Keep this unresolved, not independent exact reproduction.',
   'eddy-lunca':'Same finite A=0 exterior: independent native point fields agree after local probe refinement. Paper uses balloon exterior and 73-sample RMS, so its point-field target is not the same numerical model/statistic. The separate raw-field exterior sequence verifies truncation; 73 inclusive cosine samples are sensitivity analysis, not proof of the authors phase grid.'})[name]
  reports.append(report)
  (out/name/'three-way.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
 merged={'schema':'cablesim.reproduction-report/1','kind':'suite','cases':reports,'engineering_approval':False,
         'status':'review_required','iec_comparison':'等待 IEC 插件封签'}
 (out/'report.json').write_text(json.dumps(merged,ensure_ascii=False,indent=2),'utf-8')
 for report in reports:
  print(json.dumps({'case':report['case_id'],'rows':[(r['id'],r['reference'],r['calculated'],r['reference_solver_value'],r['last_open_mesh_change']) for r in report['rows']]}))

if __name__=='__main__':main()
