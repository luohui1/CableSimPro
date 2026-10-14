"""Actual sealed method, independent closed-circuit hand calculations."""
from copy import deepcopy
from math import log, pi, sqrt
import pytest
from backend.plugin_host import Executor
from test_type_electrical import tb_document, params, row


def test_actual_three_phase_matrix_trefoil_flat_and_closed_metal_return(tmp_path):
    cases=[]
    for cores in (1,3):
        for arrangement in ('trefoil','flat'):
            d=tb_document();c=d['cable_types'][0]
            if cores==3:
                original=c['cores'][0];layers=c['common_layers'];c['common_layers']=[]
                c['construction']='three_core'
                points=[(0,0),(.0755,0),(.03775,.0755*sqrt(3)/2)] if arrangement=='trefoil' else [(0,0),(.0755,0),(.151,0)]
                c['cores']=[{**deepcopy(original),'id':'core/'+str(i+1),'x':x,'z':z,'layers':deepcopy(layers)} for i,(x,z) in enumerate(points)]
            p=params(temperature_k=363.15,frequency_hz=50,ks=1,kp=1,spacing_m=.0755,
                core_lay_factor=1,bonding_model='single_point',arrangement=arrangement)
            p['r20_length_basis']='finished_cable'
            cases.append({'case_id':f'c{cores}_{arrangement}','input':d,'parameters':p})
    result=Executor(jobs_root=tmp_path).run('cablesim.type-electrical','electrical',cases)
    for request,case in zip(cases,result.cases):
        assert case.status=='succeeded',case.error
        artifact=case.artifacts['x-cablesim.type-electrical']
        # §4.2(9): three balanced phases cancel the shared log reference.
        # Trefoil Dm=s; flat Dm=(s*s*2s)^(1/3). gmr=.779*30.3/2 mm.
        # L1=2e-7 ln(Dm/gmr), not a sum of three partial self-inductances.
        dm=.0755*(2**(1/3) if request['parameters']['arrangement']=='flat' else 1)
        expected=2e-7*log(dm/(.779*.0303/2))
        assert row(artifact,'inductance')['value']==pytest.approx(expected,rel=1e-12)
        z=row(artifact,'positive-sequence')
        assert z['complex_ohm_m']['real']==pytest.approx(row(artifact,'ac')['value'],rel=1e-12)
        assert z['complex_ohm_m']['imaginary']==pytest.approx(2*pi*50*expected,rel=1e-12)
        assert z['printed_page']==11 and z['pdf_page']==13
        assert row(artifact,'zero-sequence')['status']=='missing'
    d=tb_document();p=deepcopy(cases[0]['parameters'])
    p.update(bonding_model='both_ends',return_path='metallic_only',metal_resistance_ohm_m=.0002,metal_mean_radius_m=.03,metal_nonmagnetic=True)
    p['sources'].update({key:'独立手算：非磁性同心金属管、两端连接且不含大地回流' for key in ('return_path','metal_resistance_ohm_m','metal_mean_radius_m','metal_nonmagnetic')})
    actual=Executor(jobs_root=tmp_path).run('cablesim.type-electrical','electrical',[{'case_id':'zero','input':d,'parameters':p}]).cases[0]
    assert actual.status=='succeeded',actual.error
    artifact=actual.artifacts['x-cablesim.type-electrical']
    # Symmetric closed metal return: each sheath current=-phase current.
    # Z0=Rc+Rs+j*w*2e-7 ln(rs/gmr); this is NOT an earth-return impedance.
    z0=row(artifact,'zero-sequence');rc=row(artifact,'ac')['value']
    assert z0['complex_ohm_m']['real']==pytest.approx(rc+.0002,rel=1e-12)
    assert z0['complex_ohm_m']['imaginary']==pytest.approx(2*pi*50*2e-7*log(.03/(.779*.0303/2)),rel=1e-12)
    p['return_path']='earth'
    refused=Executor(jobs_root=tmp_path).run('cablesim.type-electrical','electrical',[{'case_id':'earth','input':d,'parameters':p}]).cases[0]
    z=row(refused.artifacts['x-cablesim.type-electrical'],'zero-sequence')
    assert z['value'] is None and 'return_path' in z['missing_parameters']
    common=deepcopy(cases[2]['input']);cable=common['cable_types'][0]
    sheath=next(l for l in cable['cores'][0]['layers'] if l['role']=='metallic_sheath')
    cable['common_layers']=[deepcopy(sheath)]
    for core in cable['cores']:
        core['layers']=[l for l in core['layers'] if l['role']!='metallic_sheath']
    p['return_path']='metallic_only'
    rejected=Executor(jobs_root=tmp_path).run('cablesim.type-electrical','electrical',[{'case_id':'common','input':common,'parameters':p}]).cases[0]
    assert rejected.status=='succeeded',rejected.error
    answer=row(rejected.artifacts['x-cablesim.type-electrical'],'zero-sequence')
    assert answer['value'] is None and '共用金属护层' in answer['reason']


def test_actual_tape_capacity_sharing_pass_fail_and_changed_basis_rejected(tmp_path):
    d=tb_document();c=d['cable_types'][0];c['construction']='three_core'
    copper={'id':'material/screen-copper','category':'metal','label':'手算裸铜带','standard_kind':'copper_bare'}
    d['materials'].append(copper)
    original=deepcopy(c['cores'][0]);original['layers']=[deepcopy(l) for l in c['common_layers'] if l['role']!='metallic_sheath']
    original['layers'].insert(-1,{'role':'metallic_screen','material':copper['id'],'form':'tape','tape_application':'helical_overlap','tape_count':1,'tape_width':.1,'nominal_tape_thickness':.0001,'thickness':.0001,'overlap':.15})
    c['common_layers']=[]
    c['cores']=[{**deepcopy(original),'id':'core/'+str(i+1),'x':i*.08,'z':0} for i in range(3)]
    p=params(duration_s=1.,initial_temperature_k=363.15,final_temperature_k=523.15,
        metal_initial_temperature_k=343.15,metal_final_temperature_k=433.15,
        metal_capacity_basis='adiabatic',bonding_model='both_ends',return_path='metallic_only',screen_fault_current_a=600.)
    p['parallel_components']=[{'row_id':core['id']+':metallic_screen-adiabatic','resistance_ohm':r,'initial_temperature_k':343.15,'final_temperature_k':433.15,'source':'同一 1 m 金属返回段，明示电阻和 70→160 °C 手算条件'} for core,r in zip(c['cores'],(.01,.02,.02))]
    high=deepcopy(p);high['screen_fault_current_a']=6000.
    changed=deepcopy(p);key='sc-material-constants/r1/K'
    changed['basis_references'][key]['record']['value']+=1
    result=Executor(jobs_root=tmp_path).run('cablesim.type-electrical','short-circuit',[
        {'case_id':'safe','input':d,'parameters':p},{'case_id':'unsafe','input':d,'parameters':high},{'case_id':'changed','input':d,'parameters':changed}])
    # IEC60949 §6.3.2 S=1*100*.1=10 mm². §3: pure copper
    # Iad=226*10*sqrt(ln((160+234.5)/(70+234.5)))=~1150 A.
    # AMD1 §4 inverse R shares: .5,.25,.25 => 300,150,150 A.
    capacity=226*10*sqrt(log((160+234.5)/(70+234.5)))
    for index,case in enumerate(result.cases[:2]):
        assert case.status=='succeeded',case.error
        artifact=case.artifacts['x-cablesim.type-short-circuit'];sharing=row(artifact,'parallel-fault-sharing')
        assert sharing['status']==('available' if index==0 else 'failed')
        details=sharing['formula_inputs']['components']
        assert [item['share'] for item in details]==pytest.approx([.5,.25,.25])
        assert all(item['capacity_a']==pytest.approx(capacity) for item in details)
        assert sharing['value']==pytest.approx(capacity-(300 if index==0 else 3000))
        assert '4 amendment' in sharing['clause'] and sharing['basis_references']
        assert all(r['basis_references'] for r in artifact['rows'] if r['id'].endswith('-fault-check'))
        if index==1:
            # The real 6000 A case exceeds the computed screen capacity. Its
            # original failed rows must never become optional publication scope.
            from backend.kernel.type_versions import can_exclude
            failures=[r for r in artifact['rows'] if r.get('satisfied') is False]
            assert failures
            assert all(not can_exclude({'id':'short_circuit/'+r['id'],
                'channel':'short_circuit','result':r}) for r in failures)
    assert result.cases[2].status=='not_applicable'
    assert '标准依据快照与已封签的判据不一致' in result.cases[2].error['message']
