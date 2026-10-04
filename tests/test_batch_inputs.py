from copy import deepcopy
import pytest
from backend.kernel.batch_inputs import ParameterSpace, materialize


def space(sampling='latin_hypercube', count=40):
    return dict(sampling=sampling,sample_count=count,seed=7,source='test input range',axes=[
        dict(name='depth',label='埋深',unit='m',minimum=.5,maximum=2.5,levels=5,
             source='explicit study range',bindings=[dict(pointer='/input/depth',target_unit='m')]),
        dict(name='soil',label='土壤热阻率',unit='K*m/W',minimum=.5,maximum=2.5,levels=8,
             source='explicit study range',bindings=[dict(pointer='/input/k',target_unit='W/(m*K)',reciprocal=True)])])


def test_latin_hypercube_covers_every_stratum_and_preserves_base():
    base={'case_id':'base','input':{'depth':1.,'k':1.},'parameters':{}}
    original=deepcopy(base)
    rows=materialize(base,space())
    assert base==original
    assert rows==materialize(base,space())
    for name in ('depth','soil'):
        bins=sorted(int((r['parameters'][name]['value']-.5)/2*40) for r in rows)
        assert bins==list(range(40))
    assert len({r['case']['case_id'] for r in rows})==40
    assert all(r['case']['input']['k']==1/r['parameters']['soil']['value'] for r in rows)


def test_grid_and_categorical_changes_are_explicit():
    base={'input':{'depth':1.,'k':1.},'parameters':{}}
    rows=materialize(base,space('grid'))
    assert len(rows)==40
    assert {r['case']['input']['depth'] for r in rows}=={.5,1.,1.5,2.,2.5}
    spec=space('grid',10)
    spec['axes'][1]=dict(name='arrangement',label='排列',unit='1',source='explicit geometry variants',
        choices=[dict(label='horizontal',changes={'/input/k':1.}),dict(label='vertical',changes={'/input/k':2.})])
    assert {r['parameters']['arrangement']['value'] for r in materialize(base,spec)}=={'horizontal','vertical'}


@pytest.mark.parametrize('change',[{'sample_count':True},{'sample_count':41,'sampling':'grid'},
                                  {'seed':-1},{'sample_count':100001}])
def test_invalid_sampling_is_field_specific(change):
    spec=space();spec.update(change)
    with pytest.raises(ValueError):ParameterSpace.model_validate(spec)


def test_reject_unknown_identity_and_zero_reciprocal():
    spec=space();spec['axes'][0]['bindings'][0]['pointer']='/input/uid'
    with pytest.raises(ValueError,match='身份'):
        materialize({'input':{'uid':'c1','k':1.},'parameters':{}},spec)
    spec=space();spec['axes'][1]['minimum']=-1
    with pytest.raises(ValueError,match='不能包含0'):ParameterSpace.model_validate(spec)
