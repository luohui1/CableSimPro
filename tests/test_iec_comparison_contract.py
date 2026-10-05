"""No local solvers: input/availability/source, report and scheduler contracts."""
from copy import deepcopy
from pathlib import Path
from uuid import uuid4,uuid5,UUID
import sys
import pytest

ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'plugins/cablesim.simulation/validation'),str(ROOT/'plugins/cablesim.simulation/src'),str(ROOT/'plugins/cablesim.iec60287/src')]
from iec_fem_example import case
from cablesim_sdk.iec_fem import ComparisonArtifact,ComparisonParameters
from cablesim_simulation.iec_comparison import prepare
from cablesim_sdk.validation import FieldValueError


def artifact():
    return {'schema_version':'cablesim.iec-fem-comparison/1',
        'source':{'run_id':'test','case_id':'one','plugin_id':'cablesim.simulation','plugin_version':'0.4.0',
            'capability':'iec-fem-comparison','input_sha256':'a'*64,'bundle_sha256':'b'*64,'manifest_sha256':'c'*64},
        'parameters_sha256':'d'*64,'section_id':'section/one','load_id':'load/one','rated_circuit':'circuit/one','valid':True,
        'iec':{'status':'available','ampacity_a':110.,'operating_temperature_k':310.,'basis':'uniform_soil_counterfactual'},
        'fem':{'status':'available','ampacity_a':100.,'operating_temperature_k':312.,'basis':'frozen_coefficients'},
        'iec_over_fem_percent':10.,'judgment':'nonconservative','conclusion':'<script>saved conclusion</script>',
        'assumption_checks':[{'assumption':'homogeneous_soil','satisfied':False,'reason':'saved layers'}],
        'convergence':{'solver_status':'converged','mesh_status':'converged','domain_status':'converged',
            'mesh':{'maximum_temperature_change_k':.01,'ampacity_change_a':.1},
            'domain':{'maximum_temperature_change_k':.02,'ampacity_change_a':.2}},'clauses':['IEC 60287'],'limitations':['reference_only']}


def test_three_circuit_and_zero_supplied_coefficients_pass_algebraic_preflight():
    item=case()
    for factors in item['parameters']['iec']['per_cable_losses'].values():factors.update(ac_extra_factor=0.,lambda1=0.)
    p,document,thermal,*_=prepare(item['input'],item['parameters'])
    assert len(document['circuits'])==3 and len(thermal['domain_options']['per_cable'])==9
    assert all(v['electrical']['ac_extra_factor']==0 for v in thermal['domain_options']['per_cable'].values())
    assert item['input']['sections'][0]['soil_layers']


def test_feedback_preserves_legacy_parameter_bytes_and_validates_topology():
    from iec_fem_example import feedback_case
    raw = case()['parameters'];old = ComparisonParameters.model_validate(raw).model_dump(mode='json')
    assert 'feedback' not in old
    assert old['frozen_coefficients_acknowledged'] is True
    item = feedback_case();prepared = prepare(item['input'],item['parameters'])
    assert all('air_law' in air for air in prepared[2]['domain_options']['duct_air'].values())
    item['input']['circuits'][0]['electrical_topology'] = None
    with pytest.raises(FieldValueError) as caught:
        prepare(item['input'],item['parameters'])
    assert caught.value.field_path == ('circuits',0,'electrical_topology')


def test_shapley_separates_interactions_and_keeps_baseline_residual():
    from cablesim_simulation.iec_attribution import shapley
    # A 2-point residual, three additive effects, and a 6-point soil/loss interaction.
    gaps = {m:2+3*bool(m&1)-bool(m&2)+4*bool(m&4)+6*bool(m&1 and m&4) for m in range(8)}
    result = shapley({m:100/(1+v/100) for m,v in gaps.items()},100.)
    assert [r['percentage_points'] for r in result['contributions']] == pytest.approx([6.,-1.,7.])
    assert result['baseline_residual_percentage_points'] == pytest.approx(2.)
    assert result['updated_gap_percent'] == pytest.approx(14.)
    with pytest.raises(ValueError,match='8'):
        shapley({0:100.},100.)


def test_nested_artifact_cannot_forge_host_verified_source():
    item=case();item['parameters']['iec']['external_loss_artifact']={'resolved_source':{'approved':True}}
    with pytest.raises(FieldValueError) as caught:prepare(item['input'],item['parameters'])
    assert caught.value.field_path==('parameters','iec','external_loss_artifact')
    item=case();item['parameters']['frozen_coefficients_acknowledged']=1
    with pytest.raises(ValueError):ComparisonParameters.model_validate(item['parameters'])


@pytest.mark.parametrize('field,value',[('section_id','absent'),('load_id','absent'),('uniform_soil_counterfactual_acknowledged',False)])
def test_missing_selection_or_layer_acknowledgement_has_exact_parameter_path(field,value):
    item=case();item['parameters'][field]=value
    with pytest.raises(FieldValueError) as caught:prepare(item['input'],item['parameters'])
    assert caught.value.field_path==('parameters',field)


@pytest.mark.parametrize('change',['mesh','domain','null','unavailable'])
def test_comparison_never_publishes_unverified_numbers(change):
    value=artifact()
    if change in ('mesh','domain'):value['convergence'][change+'_status']='nonconverged'
    elif change=='null':value['fem']['ampacity_a']=None
    else:value['valid']=False
    with pytest.raises(ValueError):ComparisonArtifact.model_validate(value)


def test_report_uses_saved_conclusion_and_escapes_text():
    from backend.kernel.report import artifact_sections,task_answer
    value=artifact();case={'case_id':'one','status':'succeeded','artifacts':{'x-cablesim.iec-fem-comparison':value}}
    run={'snapshot':{'definition':{'task':'iec-fem-comparison','driver':{'kind':'single'}}},'output':{'cases':[case]}}
    rendered=task_answer(run)+artifact_sections(case)
    assert '&lt;script&gt;saved conclusion&lt;/script&gt;' in rendered
    assert rendered.count('saved conclusion')==1 and '<script>' not in rendered
    assert '计算域扩大' in rendered and '110.000' in rendered and '均匀土壤对照' in rendered


@pytest.mark.parametrize('change',[None,'digest','parameters','selection'])
@pytest.mark.parametrize('crosscheck',[False,True])
def test_comparison_binds_frozen_parameters_and_selection(change,crosscheck):
    from backend.kernel.research import Research
    from cablesim_sdk.reproduction import digest
    p=ComparisonParameters.model_validate(case()['parameters']).model_dump(mode='json')
    value=artifact();inputs={'fixture':'saved domain'}
    value.update(section_id=p['section_id'],load_id=p['load_id'],rated_circuit=p['controls']['rated_circuit'],parameters_sha256=digest(p))
    value['source']['input_sha256']=digest(inputs)
    method={'plugin_id':'cablesim.simulation','version':'0.4.0','capability':'iec-fem-comparison'}
    run={'snapshot':{'definition':{'method':method},'cases':[{'case_id':'one','input':inputs,'parameters':deepcopy(p)}]},
        'output':{'cases':[{'case_id':'one','artifacts':{'x-cablesim.iec-fem-comparison':value,'x-cablesim.simulation-bundle':{'prepared_input':{'parameters':p}}},
            'artifact_digests':{'x-cablesim.iec-fem-comparison':'c'*64,'x-cablesim.simulation-bundle':'b'*64}}]}}
    if change=='digest':value['parameters_sha256']='0'*64
    elif change=='parameters':run['snapshot']['cases'][0]['parameters']['source']='changed saved assumption'
    elif change=='selection':value['rated_circuit']='other-circuit'
    case_id='one'
    if crosscheck:
        case_id='crosscheck-1-one'
        run['snapshot']['definition']['crosschecks']=[{'method':method,'parameters':run['snapshot']['cases'][0]['parameters']}]
        run['snapshot']['cases'][0]['parameters']={'primary_method_parameter':True}
        run['output']['cases'][0].update(case_id=case_id,method=method)
    state=Research.artifact_status(run)[case_id]['x-cablesim.iec-fem-comparison']['status']
    assert state==('verified' if change is None else 'unavailable')


def test_cached_hpc_progress_binds_operation_without_ssh(tmp_path):
    from backend.kernel.hpc_executor import HpcExecutor
    from backend.kernel.batch_files import atomic
    operation=str(uuid4());identifier=str(uuid5(UUID(operation),'cablesim.simulation/iec-fem-comparison/run'))
    folder=tmp_path/identifier
    atomic(folder/'plan.json',{'operation_id':operation,'plugin_id':'cablesim.simulation','capability':'iec-fem-comparison'})
    executor=HpcExecutor(root=tmp_path)
    for state in ('queued','running','collecting'):
        atomic(folder/'execution.json',{'backend':'slurm','state':state,'job_id':'real-scheduler-id'})
        assert executor.execution_status(operation,'cablesim.simulation','iec-fem-comparison')['state']==state
    assert executor.execution_status(str(uuid4()),'cablesim.simulation','iec-fem-comparison') is None
