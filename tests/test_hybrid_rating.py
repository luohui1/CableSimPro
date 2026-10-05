"""Lightweight portable-model arithmetic, domain and corruption rejection."""
from math import exp
from pathlib import Path
import json
import pytest
from cablesim_hybrid_rating.features import NAMES,VERSION
from cablesim_hybrid_rating.inference import evaluate,domain_violations,predict,Refused
from cablesim_hybrid_rating.training import conformal_quantile
from backend.plugin_host.model_assets import catalogue
from cablesim_hybrid_rating.inference import topology_violations


def test_portable_tree_matches_hand_calculated_branch_and_bias():
    tree={'nodeid':0,'split':'f0','split_condition':1.,'yes':1,'no':2,
          'children':[{'nodeid':1,'leaf':.05},{'nodeid':2,'leaf':-.1}]}
    model={'kind':'xgboost','targets':[{'base_score':1.,'trees':[tree]},
                                     {'base_score':0.,'trees':[tree]}]}
    assert evaluate(model,[.5]*len(NAMES))==pytest.approx([1.05,.05])
    assert evaluate(model,[1.]*len(NAMES))==pytest.approx([.9,-.1])


def test_portable_neural_and_gp_outputs_match_independent_arithmetic():
    mlp={'kind':'mlp','x_mean':[0.],'x_scale':[2.],'y_mean':[1.,3.],'y_scale':[2.,4.],
         'weights':[[[2.,-1.]]],'biases':[[.5,1.]]}
    assert evaluate(mlp,[2.])==pytest.approx([6.,3.])
    gp={'kind':'gaussian_process','x_mean':[0.],'x_scale':[1.],'y_mean':[1.,3.],
        'y_scale':[2.,4.],'x_train':[[0.]],'alpha':[[.2,-.5]],'length_scale':2.}
    assert evaluate(gp,[2.])==pytest.approx([1+.4*exp(-.5),3-2*exp(-.5)])


def test_finite_sample_conformal_rank_uses_ceil_n_plus_one():
    assert conformal_quantile(list(range(20)))==19
    assert conformal_quantile(list(range(100)))==95


def test_construction_identity_normalizes_json_numeric_parameters_but_keeps_bools():
    from cablesim_hybrid_rating.features import construction
    document={'sections':[{'medium':{'material':'soil'},'backfill':None,'soil_layers':[], 'enclosures':[]}],
              'materials':[{'id':'soil','thermal_resistivity':1.}], 'cable_types':[],
              'circuits':[{'id':'circuit/one','cables':[],'system':{'frequency':50.}}]}
    assert construction(document,{'ks':1.,'duct':{'initial':40.}})==construction(document,{'ks':1,'duct':{'initial':40}})
    assert construction(document,{'ks':True})!=construction(document,{'ks':1.})


def test_domain_rejects_structure_family_and_physical_range_separately():
    bundle={'feature_version':VERSION,'family':'direct_single',
            'domain':{'construction_sha256':['known'],'feature_ranges':[[0.,1.]]*len(NAMES)}}
    assert domain_violations(bundle,[.5]*len(NAMES),'known','direct_single')==[]
    values=[.5]*len(NAMES);values[0]=2.
    errors=domain_violations(bundle,values,'unknown','layered_soil')
    assert {e['field'] for e in errors}=={'sections','cable_types/materials/iec','depth_m'}


def test_unsampled_translation_and_mixed_ducts_are_rejected_but_sampled_fields_remain_editable():
    from copy import deepcopy
    template={'sections':[{'medium':{'material':'soil','surface_temperature':293.15},'backfill':None,
        'placements':[{'cable':str(i),'x':(i-1)*.1,'z':-1.,'enclosure':str(i)} for i in range(3)],
        'enclosures':[{'id':str(i),'type':'duct','material':'pvc','inner_diameter':.064,'outer_diameter':.075,
            'contains':[str(i)],'x':(i-1)*.1,'z':-1.} for i in range(3)]}],
        'circuits':[{'cables':[{'id':str(i),'phase':i} for i in range(3)]}],
        'load_cases':[{'id':'load','currents':{'c':100.}}]}
    changed=deepcopy(template);changed['sections'][0]['medium']['surface_temperature']=303.15
    changed['load_cases'][0]['currents']['c']=150.
    for p in changed['sections'][0]['placements']+changed['sections'][0]['enclosures']:p['x']*=1.2;p['z']=-1.5
    assert topology_violations(changed,template)==[]
    for duct in changed['sections'][0]['enclosures']:
        duct.update(width=None,height=None)
    assert topology_violations(changed,template)==[]
    shifted=deepcopy(changed)
    for p in shifted['sections'][0]['placements']+shifted['sections'][0]['enclosures']:p['x']+=14.
    assert any(e['field']=='sections.placements.x' for e in topology_violations(shifted,template))
    changed['sections'][0]['enclosures'][1]['inner_diameter']=.07
    assert any(e['field']=='sections.enclosures' for e in topology_violations(changed,template))


def test_missing_and_corrupt_models_never_return_fallback_values(tmp_path):
    p={'iec':{},'rated_circuit':'circuit/one','model_sha256':'a'*64}
    with pytest.raises(Refused) as exc:predict({},p,tmp_path)
    assert exc.value.code=='HYBRID_MODEL_MISSING'
    folder=tmp_path/'.data/method-models';folder.mkdir(parents=True)
    (folder/'index.json').write_text(json.dumps({'models':{'a'*64:{'dataset_sha256':'b'*64}}}))
    (folder/('a'*64+'.json')).write_text('{}')
    with pytest.raises(Refused) as exc:predict({},p,tmp_path)
    assert exc.value.code=='HYBRID_MODEL_CORRUPT'


def test_model_catalogue_is_read_only_and_preserves_unavailable_entry(tmp_path,monkeypatch):
    from types import SimpleNamespace
    class Registry:
        root=tmp_path/'plugins'
        def get(self,_):return SimpleNamespace(manifest=SimpleNamespace(version='0.1.0'),verify=lambda:None)
    import backend.plugin_host.model_assets as assets
    monkeypatch.setattr(assets,'Registry',lambda *_args,**_kwargs:Registry())
    assert catalogue(tmp_path,Registry())==[]
    folder=tmp_path/'.data/method-models';folder.mkdir(parents=True)
    row={'method':{'plugin_id':'cablesim.hybrid-rating','version':'0.1.0'},'authority':'authoritative'}
    path=folder/'index.json';path.write_text(json.dumps({'schema_version':'cablesim.method-model-catalogue/1','models':{'a'*64:row}}))
    before=path.read_bytes();entries=catalogue(tmp_path,Registry())
    assert entries[0]['availability']=='unavailable' and entries[0]['authority']=='reference_only'
    assert path.read_bytes()==before


def layered_case():
    import importlib.util
    path=Path(__file__).resolve().parents[1]/'plugins/cablesim.hybrid-rating/validation/prepare_batches.py'
    spec=importlib.util.spec_from_file_location('hybrid_test_prepare',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module.base_case('layered_soil')


def test_equal_soil_layers_recover_hand_calculated_half_space_resistance():
    from math import acosh,log,hypot,pi
    from cablesim_hybrid_rating.layered import prepare_layered
    case=layered_case();value=case['input'];materials={m['id']:m for m in value['materials']}
    rho=materials[value['sections'][0]['medium']['material']]['thermal_resistivity']
    materials['material/lower-soil']['thermal_resistivity']=rho
    group=prepare_layered(value,case['parameters']['iec'])
    depth=-group.cables[0]['point'][1]
    for i,cable in enumerate(group.cables):
        for j,other in enumerate(group.cables):
            x=abs(cable['point'][0]-other['point'][0])
            expected=rho/(2*pi)*(acosh(depth/(cable['geometry'].overall_m/2)) if i==j else log(hypot(x,2*depth)/x))
            assert group.matrix[i][j]==pytest.approx(expected,abs=1e-11)


@pytest.mark.parametrize('depth',[.6,1.2])
@pytest.mark.parametrize('spacing',[.12,(4*.8**2-2*.6**2)**.5/2])
def test_layered_reflections_match_independent_fourier_interface_solution(depth,spacing):
    from cablesim_hybrid_rating.layered import prepare_layered,independent_matrix
    case=layered_case();value=case['input'];materials={m['id']:m for m in value['materials']}
    materials[value['sections'][0]['medium']['material']]['thermal_resistivity']=.5
    materials['material/lower-soil']['thermal_resistivity']=2.5
    for i,point in enumerate(value['sections'][0]['placements']):
        point['z']=-depth;point['x']=(i-1)*spacing
    group=prepare_layered(value,case['parameters']['iec'])
    for series,integral in zip(group.matrix,independent_matrix(group)):
        assert series==pytest.approx(integral,abs=1e-8)


def test_layered_interface_intersection_and_em_growth_override_are_explicitly_rejected():
    from cablesim_hybrid_rating.layered import prepare_layered
    from cablesim_hybrid_rating.labels import Settings
    case=layered_case()
    for point in case['input']['sections'][0]['placements']:point['z']=-.8
    with pytest.raises(ValueError,match='跨越土层界面'):prepare_layered(case['input'],case['parameters']['iec'])
    case['parameters'].update(physics='electromagnetic_thermal',electromagnetic_mesh={
        'size_m':.0007,'far_size_m':.2,'transition_m':.15,'exterior_growth_start_m':.3})
    with pytest.raises(ValueError,match='exterior_growth_start_m'):Settings.model_validate(case['parameters'])


def test_layered_prediction_only_allows_the_sampled_shared_interface_to_move():
    from copy import deepcopy
    original=layered_case()['input'];changed=deepcopy(original)
    layers=changed['sections'][0]['soil_layers']
    layers[0]['bottom_z']-=.1;layers[1]['top_z']-=.1
    assert topology_violations(changed,original)==[]
    for index,field in [(0,'top_z'),(1,'bottom_z'),(1,'top_z')]:
        invalid=deepcopy(changed);invalid['sections'][0]['soil_layers'][index][field]+=.1
        assert any(e['field']=='sections.soil_layers' for e in topology_violations(invalid,original))


def test_measurement_import_preserves_sensor_source_rows_and_rejects_wrong_units_and_time():
    from copy import deepcopy
    from cablesim_hybrid_rating.measurements import Measurements
    value={'schema_version':'cablesim.field-measurements/1',
        'units':{'time':'s','current':'A','temperature':'K'},'time_origin':'2021-01-01T00:00:00Z',
        'series':[{'id':'sheath-1','label':'Cable sheath sensor','sensor':'sheath','construction':{},
            'source':{'title':'Measured cable test','url':'https://example.org/dataset','version':'1',
                'filename':'data.xlsx','raw_file_sha256':'a'*64,'license':'CC-BY-4.0','sheet':'measurements',
                'columns':{'time_s':'A','current_a':'B','temperature_k':'C'}},
            'points':[{'time_s':0.,'current_a':280.,'temperature_k':313.15,'source_row':2},
                      {'time_s':7200.,'current_a':280.,'temperature_k':313.25,'source_row':3}]}]}
    parsed=Measurements.model_validate(value)
    assert parsed.series[0].sensor=='sheath' and parsed.series[0].points[1].source_row==3
    assert parsed.series[0].domain_input is None
    changed=deepcopy(value);changed['units']={'time':'d','current':'A','temperature':'C'}
    with pytest.raises(ValueError,match='units'):Measurements.model_validate(changed)
    changed=deepcopy(value);changed['series'][0]['points'][1]['time_s']=0.
    with pytest.raises(ValueError,match='严格递增'):Measurements.model_validate(changed)
    changed=deepcopy(value);changed['series'][0]['source']['raw_file_sha256']='unverified'
    with pytest.raises(ValueError,match='raw_file_sha256'):Measurements.model_validate(changed)
