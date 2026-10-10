"""Save a sourced steady reference and derive its step response through host APIs.

Run: python plugins/cablesim.simulation/validation/run_step_response.py
The separate .data/simulation/step-response workspace is resumable; no release DB
is read or changed. All mesh/solver work follows the frozen dg83 executor.
"""
from pathlib import Path
import json
import sys
import time
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(ROOT),str(Path(__file__).parent)]
from step_response_case import case
from backend.main import create_app
from backend.kernel.hpc_executor import HpcExecutor
from backend.kernel.batch_files import atomic,read
from backend.plugin_host.registry import Registry
from backend.kernel.workspace import fingerprint
from fastapi.testclient import TestClient


def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--repeat',action='store_true',help='Explicitly derive a fresh saved response; preserve previous runs.')
    options=parser.parse_args()
    folder=ROOT/'.data/simulation/step-response';folder.mkdir(parents=True,exist_ok=True);identity=folder/'identity.json'
    app=create_app(folder/'workspace.sqlite');app.state.research.executor=HpcExecutor(root=folder/'hpc')
    with TestClient(app) as client:
        def api(method,url,**kwargs):
            response=client.request(method,url,**kwargs)
            if response.status_code>=400:raise ValueError(str(response.status_code)+' '+response.text)
            return response.json()
        if identity.exists():
            state=read(identity)
            if options.repeat:
                state['response_request']=str(uuid4());state.pop('response_started',None);atomic(identity,state)
        else:
            workspace=api('POST','/api/workspaces',json={});value,controls=case()
            plugin=Registry(plugin_id='cablesim.simulation').get('cablesim.simulation')
            method=dict(plugin_id=plugin.manifest.id,version=plugin.manifest.version,capability='fem-step-response',release_digest=fingerprint(plugin.manifest.model_dump(mode='json',by_alias=True)))
            study=api('POST',f'/api/workspaces/{workspace["id"]}/studies',json=dict(expected_revision=workspace['revision'],title='有来源铜 XLPE 子模型 · 固定焦耳稳态',method=method,input_source='study',method_input=value,parameters=controls))
            state=dict(workspace=workspace['id'],revision=workspace['revision'],study=study['id'],study_revision=study['revision'],steady_request=str(uuid4()),response_request=str(uuid4()));atomic(identity,state)
        root=f'/api/workspaces/{state["workspace"]}/studies/{state["study"]}'
        if not state.get('steady_run'):
            study=api('GET',root);plugin=Registry(plugin_id='cablesim.simulation').get('cablesim.simulation')
            definition=study['definition'];method={**definition['method'],'version':plugin.manifest.version,'release_digest':fingerprint(plugin.manifest.model_dump(mode='json',by_alias=True))}
            if definition['method']!=method:
                study=api('PUT',root,json={**definition,'method':method,'expected_revision':state['revision'],'expected_study_revision':study['revision']})
                state['study_revision']=study['revision'];atomic(identity,state)
            pre=api('GET',root+'/preflight',params=dict(expected_revision=state['revision'],expected_study_revision=state['study_revision']))
            if not pre['ready']:raise ValueError(pre)
            run=api('POST',root+'/runs',json=dict(request_id=state['steady_request'],expected_revision=state['revision'],expected_study_revision=state['study_revision'],scope_acknowledged=True,lock_digest=pre['lock_digest']))
            state['steady_run']=run['id'];atomic(identity,state)
        run=api('GET',root+'/runs/'+state['steady_run'],params={'view':'full'})
        if run['status'] in ('failed','interrupted'):
            run=api('POST',root+'/runs/'+state['steady_run']+'/resume')
        while run['status'] in ('accepted','running','validating'):
            print('Steady '+run['status'],flush=True);time.sleep(5)
            run=api('GET',root+'/runs/'+state['steady_run'],params={'view':'full'})
        if run['status']!='succeeded':raise ValueError(run)
        atomic(folder/'steady.json',run)
        path=f'/api/hpc/workspaces/{state["workspace"]}/studies/{state["study"]}/step-responses'
        args=dict(request_id=state['response_request'],source_run_id=state['steady_run'],max_core_hours=16.,budget_confirmed=True)
        if not state.get('response_started'):
            estimate=api('POST',path+'/estimate',json=args);atomic(folder/'estimate.json',estimate)
            response=api('POST',path,json=args);state['response_started']=True;atomic(identity,state)
        response=api('GET','/api/hpc/step-responses/'+state['response_request'])
        if response['status']=='interrupted':response=api('POST','/api/hpc/step-responses/'+state['response_request']+'/resume')
        while response['status'] in ('queued','running'):
            print('Response '+response['status']+' '+str((response.get('execution') or {}).get('job_id')),flush=True);time.sleep(5)
            response=api('GET','/api/hpc/step-responses/'+state['response_request'])
        atomic(folder/'response.json',response)
        if response['status']!='completed':raise ValueError(response.get('reason'))
        atomic(folder/'emergency-input.json',response.get('emergency_input'))
        print(json.dumps({'status':response['response']['convergence']['status'],'job_id':response['response']['job_id'],
                          'core_hours':response['used_core_hours'],'wall_seconds':response['response']['wall_seconds'],
                          'steady_rise_k':response['response']['steady_joule_rise_k'],'convergence':response['response']['convergence'],
                          'analytic_difference_k':response['response']['analytic_cross_check']['maximum_difference_k']},ensure_ascii=False),flush=True)


if __name__=='__main__':main()
