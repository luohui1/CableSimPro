"""Topology boundaries and independently defined interpolation/section checks."""
from copy import deepcopy
import json
from pathlib import Path
import pytest
from backend.domain.models import DomainDocument
from cablesim_iec60287.domain import prepare
from cablesim_iec60287.group import _loss_details
from cablesim_iec60287.group import rate_group
from cablesim_iec60287.double_flat import interpolate, eddy_factor, verified_tables
from cablesim_iec60287.method import RatingRefused
from test_iec60287_group import document,parameters

ROOT = Path(__file__).resolve().parents[3]
PRIVATE = ROOT/'.data/iec60287'


def cross_document(lengths):
    d = document('trefoil')
    d['circuits'][0]['bonding'].update(kind='cross_bonded',minor_section_lengths=lengths,
        section_permutations=[[0,1,2],[1,2,0],[2,0,1]],source={'kind':'user','reference':'合成接线图','reviewed':False})
    return d


def test_equal_minor_sections_cancel_circulation_but_not_eddy():
    g = prepare(cross_document([400,400,400]),parameters())
    losses = _loss_details(g,[5e-5]*3,[60]*3)
    assert all(v['circulating']==0 and v['eddy_raw']>0 and v['total']==v['eddy_raw'] for v in losses)


def test_known_unequal_minor_sections_use_residual_emf_energy():
    d = cross_document([400,400,480]);g = prepare(d,parameters())
    result = _loss_details(g,[5e-5]*3,[60]*3)
    baseline = deepcopy(d);baseline['circuits'][0]['bonding']={'kind':'both_ends','transposed':False}
    before = _loss_details(prepare(baseline,parameters()),[5e-5]*3,[60]*3)
    # Independent phasor norm: |400+400 exp(j120)+480 exp(j240)|² / 1280².
    expected = 80**2/1280**2
    assert result[0]['cross_bonding_factor']==pytest.approx(expected)
    assert result[0]['circulating']==pytest.approx(before[0]['circulating']*expected)


@pytest.mark.parametrize('change',[{'minor_section_lengths':[400,400]}, {'section_permutations':[[0,1,2]]*3}, {'source':None}])
def test_cross_bonding_missing_or_duplicate_connections_refused(change):
    d = cross_document([400,400,400]);d['circuits'][0]['bonding'].update(change)
    with pytest.raises(ValueError):DomainDocument.model_validate(d)


def test_phase_topology_requires_units_range_and_source():
    d = document('flat');d['circuits'][0]['electrical_topology']={'phase_sequence':'ACB','reference_angle_rad':0,'source':{'kind':'user','reference':'接线核对'}}
    DomainDocument.model_validate(d)
    d['circuits'][0]['electrical_topology']['reference_angle_rad']=180
    with pytest.raises(ValueError):DomainDocument.model_validate(d)


def test_reversing_sequence_swaps_outer_phase_loss():
    d=document('flat');p=parameters();a=_loss_details(prepare(d,p),[5e-5]*3,[60]*3)
    d['circuits'][0]['electrical_topology']={'phase_sequence':'ACB','reference_angle_rad':0,'source':{'kind':'user','reference':'反向相序'}}
    b=_loss_details(prepare(d,p),[5e-5]*3,[60]*3)
    assert a[1]['total']==pytest.approx(b[1]['total'])
    assert sorted(v['total'] for v in a)==pytest.approx(sorted(v['total'] for v in b))
    assert a[0]['total']!=b[0]['total']


def test_trilinear_interpolation_preserves_mixed_terms_without_extrapolation():
    axes=[[0,1]]*3
    f=lambda x,y,z:2+x+3*y+5*z+7*x*y+11*y*z+13*x*z+17*x*y*z
    grid=[[[f(x,y,z) for z in axes[2]] for y in axes[1]] for x in axes[0]]
    assert interpolate(axes,grid,[.23,.51,.77])==pytest.approx(f(.23,.51,.77))
    with pytest.raises(RatingRefused):interpolate(axes,grid,[1.01,.5,.5])


@pytest.mark.skipif(not (PRIVATE/'double-flat-examples.json').exists(),reason='controlled IEC 1-2 validation fixture not supplied')
def test_double_flat_worked_cable_one_and_reverse_symmetry():
    tables=json.loads((PRIVATE/'double-flat-tables.json').read_text('utf-8'))
    cases=json.loads((PRIVATE/'double-flat-examples.json').read_text('utf-8'))['cases']
    verified_tables(tables)
    for case in cases:
        calculated=[eddy_factor(**case['input'],cable_index=i,payload=tables)['total'] for i in range(6)]
        # The explicitly worked cable-1 arithmetic is the independent reference.
        # Other printed rows are recorded separately: intermediate m/gs/Gs rounding
        # does not preserve a 0.001 absolute tolerance for every position.
        assert calculated[0]==pytest.approx(case['expected'][0],abs=case['absolute_tolerance']),case['case']
        assert all(v>0 for v in calculated)
        if case['input']['direction']=='reverse':
            assert calculated==pytest.approx(list(reversed(calculated)),rel=1e-12)
        if case['case'].endswith('8.3'):
            # Full-precision derivation, not the conflicting printed 1.151.
            assert calculated[1]==pytest.approx(1.1461150899150074,abs=1e-10)
    tables['tables']['CH'][0][0][0]+=1e-3
    with pytest.raises(RatingRefused,match='来源或完整性'):verified_tables(tables)


@pytest.mark.skipif(not (PRIVATE/'double-flat-tables.json').exists(),reason='controlled source tables not supplied')
def test_double_flat_topology_runs_temperature_and_refuses_uncovered_currents():
    d=document('double_flat');p=parameters();p.update(eddy='trefoil',operation='temperature',double_flat_tables=json.loads((PRIVATE/'double-flat-tables.json').read_text('utf-8')))
    for c in d['circuits']:
        c['bonding']['kind']='single_point'
        c['electrical_topology']={'phase_sequence':'ABC','reference_angle_rad':0,'source':{'kind':'user','reference':'合成双回同负荷拓扑'}}
    g=prepare(d,p);result=rate_group(g)
    assert len(result['operating']['cable_states'])==6
    assert all(r['ampacity_a'] is None for r in result['circuit_ratings'])
    d['load_cases'][0]['currents'][d['circuits'][1]['id']]+=20
    with pytest.raises(RatingRefused,match='同负荷'):prepare(d,p)


def test_getdp_fixed_point_artifact_is_not_a_temperature_validity_envelope():
    d=document('trefoil');p=parameters();p['external_loss_artifact']={'schema':'cablesim.loss-coefficients/1','unit':'1','source':'合成 GetDP 固定点',
      'resolved_source':{'artifact_sha256':'a'*64},'validity':{'kind':'fixed_operating_point','ampacity_iteration_allowed':False}}
    with pytest.raises(RatingRefused,match='固定工作点'):prepare(d,p)
