"""Verify frozen batch rows/raw artifacts before building numeric training input."""
from pathlib import Path
from hashlib import sha256
import gzip
import json
import sys

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from backend.kernel.batch_files import read,digest,atomic
from backend.kernel.batch_worker import verify_row
from cablesim_sdk.domain import DomainDocument
from cablesim_sdk.reproduction import digest as solver_digest


def assemble(directories):
    rows=[];sources=[];benchmarks=[];template=None;iec_parameters=None;rated=None;family=None;scope=None
    for directory in map(Path,directories):
        plan=read(directory/'plan.json')
        if digest(plan)!=read(directory/'integrity.json')['plan_sha256']:raise ValueError('PLAN_INTEGRITY_FAILED')
        source={'dataset_id':plan['id'],'plan_sha256':digest(plan),'runtime_sha256':plan['runtime_sha256'],
                'method':plan['method'],'split':plan['source']['split'],'samples':0,'failed_samples':0}
        for descriptor in plan['samples']:
            path=directory/'samples'/(descriptor['case_id']+'.json')
            if not path.is_file():continue
            record=verify_row(read(path),directory)
            sample=read(directory/'inputs'/(descriptor['case_id']+'.json'))
            if (digest(sample)!=descriptor['sample_sha256'] or digest(sample['case'])!=record['case_sha256']
                or record['runtime_sha256']!=plan['runtime_sha256'] or record['method']!=plan['method']):
                raise ValueError('SAMPLE_SOURCE_BINDING_FAILED')
            if not record['valid']:
                source['failed_samples']+=1;continue
            raw=json.loads(gzip.decompress((directory/record['raw_result']).read_bytes()))
            payload=raw['cases'][0]['artifacts']['x-cablesim.dataset-sample']
            label=payload.get('hybrid')
            if label and label.get('paired') is False:
                raise ValueError('IEC_BASELINE_NOT_COVERED: layered FEM labels are retained but cannot train an IEC residual model')
            if not label or not payload['valid'] or payload['convergence']['mesh_status']!='converged':
                raise ValueError('HYBRID_LABEL_MISSING')
            normalized=DomainDocument.model_validate(sample['case']['input']).model_dump(mode='json')
            if (payload['input_sha256']!=solver_digest(normalized)
                or label['iec']['input_sha256']!=digest(normalized)):
                raise ValueError('LABEL_INPUT_BINDING_FAILED')
            if family is not None and label['family']!=family:raise ValueError('Training must separate scene families')
            family=label['family'];scope=label['physics_scope']
            if template is None and source['split']=='in_domain':
                template=sample['case']['input'];iec_parameters=sample['case']['parameters']['iec']
                rated=sample['case']['parameters']['controls']['rated_circuit']
            rows.append({'case_sha256':record['case_sha256'],'input_sha256':record['input_sha256'],
                'row_sha256':record['row_sha256'],'raw_sha256':record['raw_sha256'],
                'solver_input_sha256':payload['input_sha256'],'normalized_input_sha256':digest(normalized),
                'dataset_id':plan['id'],'sample_id':descriptor['case_id'],'valid':True,'mesh_status':'converged',
                'family':family,'split':source['split'],'construction_sha256':label['construction_sha256'],
                'physical_sha256':digest({'construction':label['construction_sha256'],'features':label['features']}),
                'features':label['features'],'targets':label['targets'],
                'iec_wall_seconds':label['iec']['wall_seconds'],'fem_wall_seconds':payload['wall_seconds'],
                'convergence':payload['convergence'],'mesh':payload['mesh']})
            source['samples']+=1
            if source['split']=='in_domain' and len(benchmarks)<20:
                benchmarks.append({'input':sample['case']['input'],'case_sha256':record['case_sha256'],
                    'row_sha256':record['row_sha256'],'raw_sha256':record['raw_sha256'],
                    'fem_wall_seconds':payload['wall_seconds']})
        sources.append(source)
    if template is None:raise ValueError('No converged in-domain input')
    # Primitive domains are declared before sampling; derived IEC features and
    # load ratios are bounded using only the training-side inputs in train().
    feature_ranges={'depth_m':[.6,2.],'soil_rho_k_m_w':[.5,2.5],
                    'ambient_temperature_k':[263.15,313.15],'current_a':[80.,260.]}
    return {'schema_version':'cablesim.hybrid-training/1','family':family,'samples':rows,
        'dataset_sha256':digest(rows),'sources':sources,'physics_scope':scope,
        'input_template':template,'iec_parameters':iec_parameters,'rated_circuit':rated,'feature_ranges':feature_ranges,
        'performance_cases':benchmarks}
