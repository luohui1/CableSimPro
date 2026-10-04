"""Temperature-dependent external losses must participate in the heat iteration."""
from copy import deepcopy
from itertools import product
import pytest
from cablesim_iec60287.domain import prepare
from cablesim_iec60287.group import operating, rate_group
from cablesim_iec60287.loss_table import interpolate, validate
from cablesim_iec60287.method import RatingRefused
from test_iec60287_group import document, parameters


def fixture():
    d=document('flat');entities=[c['id'] for c in d['circuits'][0]['cables']]
    axes=[{'entity':e,'state':s,'regions':[e+s],'values_c':[0.,250.]}
          for e in entities for s in ('conductor_temperature_c','sheath_temperature_c')]
    def coefficients(point):
        return {e:{'lambda1':.1+.0005*point[2*i+1]+.0001*point[2*((i+1)%3)],
                   'lambda2':0.,'ac_extra_factor':.02+.0002*point[2*i]} for i,e in enumerate(entities)}
    rows=[]
    for index in product((0,1),repeat=6):
        point=[axes[i]['values_c'][j] for i,j in enumerate(index)]
        rows.append({'index':list(index),'temperature_c':point,'coefficients':coefficients(point)})
    a={'schema':'cablesim.loss-coefficients/1','unit':'1','source':'Synthetic multilinear law, test only',
       'resolved_source':{'artifact_sha256':'a'*64},'frequency_hz':50,
       'validity':{'kind':'temperature_tensor','ampacity_iteration_allowed':True},
       'temperature_table':{'axes':axes,'rows':rows,'interpolation':'multilinear','extrapolation':'forbidden',
       'reference_current_a':{e:250. for e in entities},'current_scale_range':[0.,10.],
       'validation_points':[{'temperature_c':[125.]*6,'coefficients':coefficients([125.]*6)}],
       'error':{'kind':'measured_cell_centres_not_global_bound','maximum_absolute':0.,'acceptance_absolute':.001}}}
    p=parameters()
    base=prepare(d,p)
    a['temperature_table']['dc_reference']={c['id']:{'r20_ohm_m':c['rating'].conductor.r20_ohm_m,'alpha20_per_k':c['rating'].conductor.alpha20_per_k} for c in base.cables}
    p['external_loss_artifact']=a
    return d,p,a,entities


def test_coupled_axes_interpolate_and_refuse_changed_current_ratio():
    d,p,a,ids=fixture();validate(a,set(ids))
    cables=[{'id':e} for e in ids]
    result=interpolate(a,cables,[500.]*3,[30.,40.,50.],[20.,25.,35.])
    assert result[ids[0]]['lambda1']==pytest.approx(.1+.0005*20+.0001*40)
    assert result[ids[2]]['ac_extra_factor']==pytest.approx(.03)
    with pytest.raises(RatingRefused,match='电流比例'):
        interpolate(a,cables,[500.,501.,500.],[30.]*3,[20.]*3)
    with pytest.raises(RatingRefused,match='未外推'):
        interpolate(a,cables,[500.]*3,[251.,30.,30.],[20.]*3)


def test_iteration_uses_converged_temperature_instead_of_initial_row():
    d,p,a,ids=fixture();g=prepare(d,p);state=operating(g)
    rows=state['cable_states']
    for i,row in enumerate(rows):
        assert row['lambda1']==pytest.approx(.1+.0005*row['sheath_temperature_c']+.0001*rows[(i+1)%3]['conductor_temperature_c'],abs=1e-8)
        assert row['ac_extra_factor']==pytest.approx(.02+.0002*row['conductor_temperature_c'],abs=1e-8)
    fixed=deepcopy(p);fixed.pop('external_loss_artifact')
    fixed.update(per_cable_losses={e:{'lambda1':.1,'lambda2':0.,'ac_extra_factor':.02} for e in ids},loss_input_source='Synthetic constant comparison')
    assert max(r['conductor_temperature_c'] for r in rows)>max(r['conductor_temperature_c'] for r in operating(prepare(d,fixed))['cable_states'])


def test_rating_reaches_temperature_limit_with_variable_losses():
    d,p,a,ids=fixture();result=rate_group(prepare(d,p))
    rating=result['circuit_ratings'][0]
    assert rating['ampacity_a']>250
    assert min(r['margin_k'] for r in rating['cable_states'])==pytest.approx(0,abs=.001)
    assert result['external_loss_interpolation_error']['maximum_absolute']==0


def test_table_boundary_cannot_be_reported_as_ampacity_and_wrong_r20_is_refused():
    d,p,a,ids=fixture();a['temperature_table']['current_scale_range']=[0.,1.1]
    with pytest.raises(RatingRefused,match='未将范围边界冒充允许电流'):rate_group(prepare(d,p))
    a['temperature_table']['dc_reference'][ids[0]]['r20_ohm_m']*=2
    with pytest.raises(ValueError,match='R20'):prepare(d,p)


@pytest.mark.parametrize('defect',['missing_node','duplicate_node','nan','armor','validation','wrong_temperature','false_error','invalid_hash'])
def test_invalid_sealed_table_is_rejected(defect):
    _,_,a,ids=fixture();t=a['temperature_table']
    if defect=='missing_node':t['rows'].pop()
    if defect=='duplicate_node':t['rows'][-1]=deepcopy(t['rows'][0])
    if defect=='nan':t['rows'][0]['coefficients'][ids[0]]['lambda1']=float('nan')
    if defect=='armor':t['rows'][0]['coefficients'][ids[0]]['lambda2']=.1
    if defect=='validation':t['validation_points']=[]
    if defect=='wrong_temperature':t['rows'][0]['temperature_c'][0]=5
    if defect=='false_error':t['validation_points'][0]['coefficients'][ids[0]]['lambda1']+=.1
    if defect=='invalid_hash':a['resolved_source']['artifact_sha256']='unverified'
    with pytest.raises((ValueError,RatingRefused)):validate(a,set(ids))


def test_solid_round_requires_the_external_field_table():
    d,p,a,ids=fixture();d['cable_types'][0]['cores'][0]['conductor']['form']='solid_round'
    assert prepare(d,p).cables
    p.pop('external_loss_artifact')
    with pytest.raises(ValueError,match='实心圆导体'):prepare(d,p)
