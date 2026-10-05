"""Freeze refinement cases, never compute fields or infer engineering materials."""
from copy import deepcopy
from fastapi import HTTPException

TASKS={'transient-temperature','electrothermal-steady'}

def expand(definition,cases):
 if definition.get('task') not in TASKS or definition.get('verification') or definition['driver']['kind']!='single':return cases,None
 original=cases[0];parameters=original['parameters'];mesh=parameters['mesh']
 option='domain_options' if definition['task']=='transient-temperature' else 'electromagnetic_options'
 bounds=parameters[option].get('bounds_m')
 if bounds is None:
  # The plugin supports an intrinsic circular cable/air boundary as a physical
  # Dirichlet boundary, not a truncated exterior. No domain expansion is possible.
  section=next((s for s in original['input']['sections'] if s['id']==parameters[option]['section_id']),{})
  if section.get('kind')!='air' or len(section.get('placements',[]))!=1:
   raise HTTPException(422,{'code':'CONVERGENCE_BOUNDS_REQUIRED','message':'parameters.domain_options.bounds_m：填写有限外部计算域（m）后进行网格和域加倍研究。'})
 refined=[]
 for index,factor in enumerate((2.,1.,.5)):
  case=deepcopy(original);case['case_id']='mesh-'+str(index)
  controls=case['parameters']['mesh'];controls['size_m']=mesh['size_m']*factor
  if mesh.get('far_size_m') is not None:controls['far_size_m']=mesh['far_size_m']*factor
  if mesh.get('minimum_circle_segments') is not None:controls['minimum_circle_segments']=max(8,round(mesh['minimum_circle_segments']/factor))
  refined.append(case)
 spec={'kind':'automatic-temperature-convergence','mesh_case_ids':[c['case_id'] for c in refined],
       'domain_case_id':None,'tolerance_k':.1,'domain_policy':'physical_boundary' if bounds is None else 'double_exterior',
       'peak_basis':'whole_history' if definition['task']=='transient-temperature' else 'steady_hotspot',
       'policy_version':'cablesim.refinement/1'}
 if bounds is not None:
  case=deepcopy(refined[-1]);case['case_id']='domain-double'
  left,bottom,right,top=bounds;center=(left+right)/2;width=right-left;depth=top-bottom
  case['parameters'][option]['bounds_m']=[center-width,top-2*depth,center+width,top]
  refined.append(case);spec['domain_case_id']=case['case_id']
 return refined,spec
