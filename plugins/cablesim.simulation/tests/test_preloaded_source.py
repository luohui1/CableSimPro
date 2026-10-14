"""Replay an actual dg83 saved source; no local FEM assembly or fabricated field."""
import json
import os
from pathlib import Path
import shutil
import sys
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from cablesim_simulation.preloaded_response import PreloadSource,read_source,native_mesh,source_model


@pytest.fixture
def saved_source(tmp_path):
    directory=os.environ.get('CABLESIM_PRELOAD_VALIDATION')
    if not directory:pytest.skip('需要真实 dg83 预载验收目录；CI 不重新求解或伪造初场。')
    root=Path(directory)
    receipt=json.loads((root/'preload-submitted.json').read_text('utf-8'))
    value=receipt['state']['definition']['method_input']
    source=PreloadSource.model_validate(value['saved_source'])
    name='preload-'+source.attachment_sha256+'.tar.gz'
    original=root/'hpc-runs/preloads'/name
    if not original.is_file():pytest.skip('实际保存初场附件未部署；不生成替代场。')
    folder=tmp_path/'input';folder.mkdir();shutil.copyfile(original,folder/name)
    return tmp_path,source,value


def test_actual_initial_field_keeps_full_nodes_and_phases(saved_source):
    job,source,value=saved_source
    run=read_source(job,source)
    model,problem,cores,phases=source_model(run)
    arrays,mesh=native_mesh(run,2)
    assert len(phases)==3 and set(cores)==set(value['history'][0]['heat_w_m'])
    assert len(arrays['temperature_k'])==len(arrays['points'])>10000
    assert len(arrays['triangles'])==4*len(mesh['triangles'])
    assert source.job_id==run['execution']['job_id']
    assert min(arrays['temperature_k'])>=model.ambient_temperature_k-1e-8


def test_actual_attachment_corruption_and_wrong_identity_are_rejected(saved_source):
    job,source,_=saved_source
    with pytest.raises(ValueError,match='输入或输出字节摘要'):
        read_source(job,source.model_copy(update={'output_sha256':'0'*64}))
    path=job/'input'/('preload-'+source.attachment_sha256+'.tar.gz')
    with path.open('r+b') as stream:
        stream.seek(-1,2);value=stream.read(1);stream.seek(-1,2);stream.write(bytes([value[0]^1]))
    with pytest.raises(ValueError,match='附件摘要'):read_source(job,source)


def test_actual_preloaded_input_contract_rejects_missing_heat_capacity_source(saved_source):
    from jsonschema import Draft202012Validator
    from backend.plugin_host.registry import Registry
    job,source,value=saved_source
    plugin=Registry(Path(__file__).resolve().parents[3]/'plugins',plugin_id='cablesim.simulation').get('cablesim.simulation')
    capability=next(row for row in plugin.manifest.capabilities if row.id=='fem-step-response')
    schema=capability.input_contract.standalone_schema.model_dump(mode='json',by_alias=True,exclude_none=True)
    validator=Draft202012Validator(schema)
    validator.validate(value)
    value['capacities']['soil'].pop('reference')
    assert list(validator.iter_errors(value)), '有真实曲线来源也不能免除逐材料热容出处'
