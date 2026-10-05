"""Automatic refinement identities and whole-history convergence, no native solve."""
from copy import deepcopy
from backend.kernel.automatic_convergence import expand
from backend.kernel.convergence import temperature_convergence
from simulation_fixtures import domain,transient_parameters,coupled_parameters

def fixture(task):
 doc=domain(task=='electrothermal-steady')
 params=coupled_parameters(doc) if task=='electrothermal-steady' else transient_parameters(doc)
 definition={'task':task,'verification':None,'driver':{'kind':'single'}}
 cases,spec=expand(definition,[{'case_id':'case-0','input':doc,'parameters':params}])
 outputs=[];statuses={}
 for index,c in enumerate(cases):
  artifacts={'x-cablesim.temperature-field':{'hotspot':{'temperature_k':295+index*.01},'mesh':{'points':[[0,0]]*(10+index)}}}
  if task=='transient-temperature':artifacts['x-cablesim.temperature-history']={'curves':[{'peak_temperature_k':300+index*.01}]}
  outputs.append({'case_id':c['case_id'],'status':'succeeded','artifacts':artifacts})
  statuses[c['case_id']]={k:{'status':'verified'} for k in artifacts}
 return {'snapshot':{'definition':definition,'cases':cases,'automatic_convergence':spec},'output':{'cases':outputs},'artifact_status':statuses}

def test_intrinsic_domain_has_three_grids_and_uses_whole_transient_peak():
 run=fixture('transient-temperature');result=temperature_convergence(run)
 assert len(run['snapshot']['cases'])==3 and result['status']=='converged'
 assert result['reference_case_id']=='mesh-2' and result['rows'][0]['hotspot_k']==300
 assert result['domain_change_k'] is None and result['peak_basis']=='whole_history'
 run['output']['cases'][2]['artifacts']['x-cablesim.temperature-history']['curves'][0]['peak_temperature_k']=300.2
 assert temperature_convergence(run)['status']=='unconverged'

def test_finite_exterior_requires_fourth_case_and_unchanged_input():
 run=fixture('electrothermal-steady');cases=run['snapshot']['cases']
 assert len(cases)==4 and cases[-1]['parameters']['electromagnetic_options']['bounds_m']==[-1.6,-1.6,1.6,0]
 assert temperature_convergence(run)['status']=='converged'
 cases[-1]['input']['load_cases'][0]['currents']['circuit/one']=101
 assert temperature_convergence(run)['status']=='unconverged'

def test_saved_definition_and_original_parameters_are_not_modified():
 definition={'task':'transient-temperature','verification':None,'driver':{'kind':'single'}}
 case={'case_id':'case-0','input':domain(),'parameters':transient_parameters(domain())};before=deepcopy(case)
 expand(definition,[case]);assert case==before
