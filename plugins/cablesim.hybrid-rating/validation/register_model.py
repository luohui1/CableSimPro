"""Install the exact numeric model produced by a verified Slurm run; no approval."""
from pathlib import Path
from hashlib import sha256
import json
import sys

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from backend.kernel.batch_files import atomic,digest,read,locked
from backend.plugin_host.registry import Registry


def register(result,repository=ROOT):
    case=result.cases[0]
    if case.status!='succeeded':raise ValueError('Training run failed: '+str(case.error))
    bundle=case.artifacts['x-cablesim.hybrid-model']
    if bundle.get('schema_version')!='cablesim.hybrid-model/1' or bundle.get('authority')!='reference_only' or bundle.get('engineering_approval') is not False:
        raise ValueError('Model authority/schema invalid; no automatic engineering promotion')
    if not bundle.get('training',{}).get('slurm_job_id'):raise ValueError('Missing actual Slurm training provenance')
    folder=Path(repository)/'.data/method-models';folder.mkdir(parents=True,exist_ok=True)
    raw=json.dumps(bundle,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf-8')
    hashed=sha256(raw).hexdigest();path=folder/(hashed+'.json')
    if path.exists():
        if sha256(path.read_bytes()).hexdigest()!=hashed:raise ValueError('Registered immutable model changed')
    else:
        with path.open('xb') as stream:stream.write(raw)
    plugin=Registry(Path(repository)/'plugins',plugin_id=result.plugin_id).get(result.plugin_id)
    names={'direct_single':'直埋单回','direct_double':'直埋双回','duct':'排管','backfill':'矩形回填','layered_soil':'分层土壤'}
    record={'name':'热场修正 · '+names.get(bundle['family'],bundle['family']),'model_version':bundle['model_version'],
        'feature_version':bundle['feature_version'],
        'feature_names':bundle['feature_names'],'feature_units':bundle['feature_units'],
        'family':bundle['family'],'dataset_sha256':bundle['dataset']['sha256'],
        'dataset':{k:v for k,v in bundle['dataset'].items() if k!='split_case_sha256'},
        'method':{'plugin_id':result.plugin_id,'capability':'steady-rating','version':result.plugin_version,
                  'release_digest':digest(plugin.manifest.model_dump(mode='json',by_alias=True))},
        'source_remote_run_id':result.run_id,'artifact_sha256':case.artifact_digests['x-cablesim.hybrid-model'],
        'training_job_id':bundle['training']['slurm_job_id'],'domain':bundle['domain'],
        'domain_template':bundle['input_template'],'parameters':{'iec':bundle['iec_parameters'],
            'rated_circuit':bundle['rated_circuit'],'model_sha256':hashed},
        'validation':bundle['validation'],'authority':'reference_only','engineering_approval':False}
    with locked(folder/'catalogue.lock',blocking=True):
        index=read(folder/'index.json') if (folder/'index.json').exists() else {'schema_version':'cablesim.method-model-catalogue/1','models':{}}
        previous=index['models'].get(hashed)
        if previous is not None and previous!=record:raise ValueError('Model registration identity conflict')
        index['active_feature_version']=bundle['feature_version']
        index['models'][hashed]=record;atomic(folder/'index.json',index)
    return {'model_sha256':hashed,'path':str(path),'record':record}
