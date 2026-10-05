"""Primary amendment examples, with unavailable durations beyond supplied data."""
import pytest
from cablesim_iec60287.emergency import calculate,corrected_rise


def example():
    return {'schema_version':'cablesim.iec60853-emergency/1','circuit_id':'circuit/reference',
        'scope':'thermally_isolated_circuit','reference_current_a':1550.,'initial_current_a':.771*1550,
        'initial_to_reference_resistance_ratio':11.625/12.612,'steady_joule_rise_k':53.7,
        'rated_response':[{'time_s':21600.,'rise_k':18.1}],
        'response_source':'IEC60853-2 AMD1:2008 F.6.2 / corrected F.3 column 6, PDF page11',
        'source':'IEC60853-2 AMD1:2008 public amendment, printed page9'}


def test_primary_six_hour_emergency_example():
    result = calculate(example())
    assert result['current_curve'][0]['permissible_current_a'] == pytest.approx(2131.,abs=1.)
    assert corrected_rise(7.1,85.-31.3,1/(234.5+31.3)) == pytest.approx(6.,abs=.05)


def test_horizon_and_no_unverified_group_scope():
    value = example();value['overload_current_a'] = 1800.
    assert calculate(value)['duration']['status']=='not_reached_in_supplied_response'
    assert calculate(value)['duration']['safe_duration_s'] is None
    value['overload_current_a'] = 2300.
    assert calculate(value)['duration']['safe_duration_s']==0.
    assert calculate(value)['duration']['bracket_s']==[0.,21600.]
    value['scope']='group_of_three_circuits'
    with pytest.raises(ValueError):calculate(value)


def test_emergency_plugin_check_run_and_exact_version(tmp_path):
    from backend.plugin_host import Executor
    host = Executor(jobs_root=tmp_path)
    cases = [{'case_id':'amendment','input':example(),'parameters':{}}]
    checked = host.check('cablesim.iec60287','iec60853-emergency',cases)
    assert checked.cases[0].status=='succeeded',checked.cases[0].error
    result = host.run('cablesim.iec60287','iec60853-emergency',cases)
    assert result.cases[0].status=='succeeded',result.cases[0].error
    assert result.cases[0].results[0]['value']==pytest.approx(2131.,abs=1.)
    assert result.environment['method']=='iec60853-emergency/0.1.0'
    assert result.cases[0].artifacts['x-cablesim.iec60853-emergency']['engineering_approval'] is False
