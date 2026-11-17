"""Use the real host/Executor and an isolated copy of the saved release library."""
import json
from pathlib import Path
import sqlite3
import math
import pytest
from decimal import Decimal, ROUND_HALF_UP

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


def test_five_engineering_queries_on_saved_release_copy(tmp_path, monkeypatch):
    source = ROOT/'.data/release/engineering.sqlite'
    # This acceptance deliberately requires saved release data, not generated fixtures.
    if not source.is_file(): pytest.skip('真实发布库缺失：不能用夹具冒充真实使用验收。')
    target = tmp_path/'engineering.sqlite'
    with sqlite3.connect(source.as_uri()+'?mode=ro', uri=True) as original, sqlite3.connect(target) as copy:
        original.backup(copy)
    monkeypatch.setenv('CABLESIM_DB', str(target))
    monkeypatch.setenv('CABLESIM_DATASETS_DIR', str(tmp_path/'datasets'))
    from backend.main import create_app
    app = create_app(target)
    app.state.previews.jobs = tmp_path/'previews'
    app.state.previews.jobs.mkdir()
    cases = [
        ('Nielsen et al.', '2019', 'Table 1', 'volumetric_heat_capacity', {'material':'copper'}, 3460000, 8, 9),
        ('GB/T 12706.1', '2020', '表 A.2', 'bundle_factor', {'core_count':4,'equal_core_sections':True,'cable_arrangement':'standard'}, 2.42, 35, 41),
        ('GB/T 3956', '2008', '表 1', 'resistance_20_max', {'area_m2':185e-6,'conductor_class':1,'conductor_material':'copper','coating':'plain','conductor_form':'circular'}, .101, 3, 6),
        ('GB/T 12706.1', '2020', '表 18', 'insulation_mechanical_test_requirement', {'test_item':'老化前抗张强度最小','insulation':'EPR','insulation_test_group':'other_cable'}, 4.2, 29, 35),
        ('GB/T 12706.4', '2020', '表14', 'test_voltage', {'test_item':'冲击电压试验（峰值）','u0_v':3600,'u_v':6000,'um_v':7200}, 60, 15, 19),
        ('GB/T 12706.2', '2020', '13.7', 'armour_tape_gap_ratio_max', {'armour_kind':'tape'}, .5, 13, 21),
        ('GB/T 12706.2', '2020', '17.7.3', 'armour_measured_negative_deviation_max', {'armour_kind':'tape'}, .1, 19, 27),
        ('GB/T 12706.3', '2020', '10.2.2', 'screen_tape_measured_min_ratio', {}, .9, 8, 13),
        ('Youn et al.', '2019', 'Table 1', 'specific_heat_capacity', {'material':'semiconducting_layer'}, '115–433', 8, 8),
        ('GB/T 12706.2', '2020', '17.5.3', 'extruded_inner_covering_measured_min', {'covering_construction':'extruded'},
         {'kind':'affine','a':.8,'b':-.2,'x':'nominal_lining_thickness','parameter_units':{'x':'mm','result':'mm'}}, 18, 26),
        ('GB/T 12706.2', '2020', '13.2', 'armour_allowed_materials', {'armour_kind':'tape'},
         ['galvanized_steel','nonmagnetic_stainless_steel','aluminium','aluminium_alloy'], 11, 19),
        ('GB/T 12706.2', '2020', '13.3.2', 'armour_inner_covering_rule', {'core_count':3}, 'required_conforming_8.2', 11, 19),
        ('GB/T 12706.2', '2020', '13.7', 'armour_tape_layer_count', {'armour_kind':'tape'}, 2, 13, 21),
        ('GB/T 12706.2', '2020', '表 11', 'armour_tape_nominal', {'diameter_m':.0666,'armour_material':'steel'}, .5, 13, 21),
        ('GB/T 12706.2', '2020', '10.2.3', 'screen_nominal_area_requirement', {'screen_kind':'copper_tape'},
         {'fixed_numeric_area':'standard_not_specified','prescribed_requirements':['nominal_tape_thickness','overlap_ratio','measured_minimum_thickness'],'engineering_input_required':True}, 10, 18),
        ('GB 50217', '2018', '3.6.3', 'installation_calculation_requirement', {'subitem':'7','nominal_voltage_v':35000}, 'recommended', 12, 22),
        ('GB 50217', '2018', 'D.0.6', 'ampacity_correction',
         {'tray_kind':'ladder','layer_count':2,'horizontal_parallel_cable_count':7,'cable_spacing_condition':'no_gap'}, .65, 74, 84),
        ('GB 50217', '2018', 'D.0.7', 'ampacity_correction',
         {'u_v':1000,'core_count':3,'area_m2':95e-6,'outdoor_unshaded':'yes','current_basis_environment':'indoor_air_at_outdoor_ambient'}, .90, 74, 84),
        ('Sah et al.', '2022-preprint-v1', 'Table 2', 'other_component_mass_fraction_percent',
         {'backfill_mix':'B80-F20','other_component':'fly_ash'}, 20, 6, 6),
        ('Sah et al.', '2022-preprint-v1', 'Table 3', 'maximum_dry_density', {'backfill_mix':'F'}, 1.38, 7, 7),
        ('IEC 60949', '1988', 'Table I', 'short_circuit_material_k', {'material':'copper','material_role':'conductor'}, 226, 17, 7),
        ('IEC 60949', '1988', 'Table I', 'resistance_temperature_coefficient_reciprocal_0c', {'material':'copper','material_role':'conductor'}, 234.5, 17, 7),
        ('IEC 60949', '1988', 'Table I', 'volumetric_heat_capacity_20c', {'material':'copper','material_role':'conductor'}, 3450000, 17, 7),
        ('IEC 60949', '1988', 'Table I', 'electrical_resistivity_20c', {'material':'copper','material_role':'conductor'}, 1.7241e-8, 17, 7),
        ('IEC 60949', '1988', 'Table II', 'volumetric_heat_capacity',
         {'material':'semiconducting_XLPE_PE','material_role':'other_component','application_case':'short_circuit_non_adiabatic'}, 2400000, 17, 7),
        ('IEC 60949', '1988', 'Table II', 'volumetric_heat_capacity',
         {'material':'semiconducting_EPR','material_role':'other_component','application_case':'short_circuit_non_adiabatic'}, 2100000, 17, 7),
        ('IEC 60949', '1988', '6.3.2', 'short_circuit_geometrical_area_formula', {'screen_construction':'helically_lapped_tape'},
         {'expression':'S = n*w*delta','units':{'S':'mm²','n':'1','w':'mm','delta':'mm'},
          'inter_turn_inter_tape_contact':'not_assumed','current_path':'along_helix','execution':'method_plugin_only'}, 15, 6),
    ]
    with TestClient(app) as client:
        methods = client.get('/api/methods'); assert methods.status_code==200
        pin = next(m['method'] for m in methods.json() if m['method']['plugin_id']=='cablesim.standards-basis')
        assert pin['version']=='0.9.0'
        receipts=[]
        for standard,edition,locator,quantity,conditions,value,printed,pdf in cases:
            query={'schema_version':'cablesim.standards-query/1','standard':standard,'edition':edition,
                   'locator':locator,'quantity':quantity,'conditions':conditions}
            reply=client.post('/api/plugin-queries/cablesim.standards-basis/lookup',
                              json={'release_digest':pin['release_digest'],'input':query})
            assert reply.status_code==200,reply.text
            envelope=reply.json(); answer=envelope['artifacts']['x-cablesim.standards-basis']
            assert envelope['plugin_version']=='0.9.0' and len(envelope['request_sha256'])==64
            assert answer['status']=='resolved' and len(answer['records'])==1, (query,answer)
            record=answer['records'][0]
            assert (record['value'],record['printed_page'],record['pdf_page'])==(value,printed,pdf)
            assert record['verification']['status']=='verified' and len(record['verification']['methods'])>=2
            receipts.append({'query':query,'response':envelope})
        isolation={'schema_version':'cablesim.standards-query/1','standard':'GB/T 12706.2','edition':'2020',
                   'locator':'13.3.3','quantity':'separation_sheath_application',
                   'record_id':'mv-isolation-applicability/r1/separation_sheath_application',
                   'conditions':{'metal_layer_relation':'different','longitudinal_water_barrier':False,'lead_sheath_present':False}}
        reply=client.post('/api/plugin-queries/cablesim.standards-basis/lookup',json={'release_digest':pin['release_digest'],'input':isolation})
        assert reply.status_code==200,reply.text
        r=reply.json()['artifacts']['x-cablesim.standards-basis']['records'][0]
        assert (r['value'],r['printed_page'],r['pdf_page'])==('extruded_required',11,19)
        assert r['verification']['status']=='verified'
        receipts.append({'query':isolation,'response':reply.json()})
        # Missing the newly verified spacing condition must stop at that field.
        incomplete={'schema_version':'cablesim.standards-query/1','standard':'GB 50217','edition':'2018',
                    'locator':'D.0.6','quantity':'ampacity_correction',
                    'conditions':{'tray_kind':'ladder','layer_count':2,'horizontal_parallel_cable_count':7}}
        reply=client.post('/api/plugin-queries/cablesim.standards-basis/lookup',json={'release_digest':pin['release_digest'],'input':incomplete})
        assert reply.status_code==422 and reply.json()['detail']['path']=='/conditions/cable_spacing_condition'
        # Actual host replies are the consumer handoff; only read the source library.
        output=tmp_path/'release-evidence';output.mkdir(parents=True,exist_ok=True)
        (output/'real-queries.json').write_text(json.dumps(receipts,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        # Declared YJV22 nominal inner covering 1.8mm and steel tape 0.5mm:
        # measured minima require actual measurement, 0.8*1.8-0.2=1.24, (1-.1)*.5=.45mm.
        received={receipt['query']['quantity']:receipt['response']['artifacts']['x-cablesim.standards-basis']['records'][0]['value'] for receipt in receipts}
        lining=received['extruded_inner_covering_measured_min']
        assert lining['a']*1.8+lining['b']==pytest.approx(1.24)
        assert (1-received['armour_measured_negative_deviation_max'])*received['armour_tape_nominal']==pytest.approx(.45)
        ladder=next(x for x in receipts if x['query']['locator']=='D.0.6')['response']['artifacts']['x-cablesim.standards-basis']['records'][0]
        assert 200*ladder['value']==130  # Explicit manual example, not a saved rating.
        # Read formula and constants through the real Executor. These are declared
        # hand inputs, not a screen temperature limit or a saved engineering result.
        formula_query=dict(schema_version='cablesim.standards-query/1',standard='IEC 60949',edition='1988',
                           locator='3',quantity='adiabatic_short_circuit_formula',conditions={})
        reply=client.post('/api/plugin-queries/cablesim.standards-basis/lookup',
                          json={'release_digest':pin['release_digest'],'input':formula_query})
        assert reply.status_code==200,reply.text
        formula=reply.json()['artifacts']['x-cablesim.standards-basis']['records'][0]
        assert (formula['printed_page'],formula['pdf_page'])==(9,3)
        assert formula['value']['execution']=='method_plugin_only'
        assert formula['value']['units']['S']=='mm²'
        k=received['short_circuit_material_k'];beta=received['resistance_temperature_coefficient_reciprocal_0c']
        ratio=(250+beta)/(90+beta);z=(ratio-1)/(ratio+1)
        log_by_series=2*sum(z**(2*n+1)/(2*n+1) for n in range(20))
        current=k*25*math.sqrt(math.log(ratio)/1)
        assert current==pytest.approx(k*25*math.sqrt(log_by_series),rel=1e-12)
        assert current==pytest.approx(3577.0876665,abs=1e-6)
        assert math.sqrt(received['volumetric_heat_capacity_20c']*(beta+20)*1e-12/received['electrical_resistivity_20c'])==pytest.approx(k,abs=.5)
        receipts.append({'query':formula_query,'response':reply.json(),
                         'hand_example':{'S_mm2':25,'t_s':1,'theta_i_c':90,'theta_f_c':250,'current_a':current,'approval':'not_granted'}})
        # A physically plausible heat capacity is not an approved transient branch.
        wrong_use=dict(schema_version='cablesim.standards-query/1',standard='IEC 60949',edition='1988',
                       locator='Table II',quantity='volumetric_heat_capacity',
                       conditions={'material':'semiconducting_XLPE_PE','material_role':'other_component','application_case':'transient'})
        reply=client.post('/api/plugin-queries/cablesim.standards-basis/lookup',
                          json={'release_digest':pin['release_digest'],'input':wrong_use})
        assert reply.status_code==200
        rejected=reply.json()['artifacts']['x-cablesim.standards-basis']
        assert rejected['status']=='not_covered' and rejected['records']==[] and rejected['approval']=='not_granted'
        receipts.append({'query':wrong_use,'response':reply.json()})
        (output/'real-queries.json').write_text(json.dumps(receipts,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        # Declared hand calculation, not a fabricated city soil measurement:
        # phi=.4; solid=1500*800; water=.2*4.18e6; air=.2*1200.
        soil=dict(schema_version='cablesim.standards-query/1',operation='evaluate',standard='Hopmans et al.',edition='2002',
                  locator='§2.2 Eq. (1)/(2)',quantity='soil_capacity_expression',
                  conditions={'material':'soil','material_role':'porous_soil','soil_capacity_method':'three_phase','parameter_origin':'project_measured'},
                  formula_inputs={'dry_bulk_density_kg_m3':1500,'particle_density_kg_m3':2500,'solid_specific_heat_capacity_j_kg_k':800,
                                  'water_volumetric_heat_capacity_j_m3_k':4180000,'air_volumetric_heat_capacity_j_m3_k':1200,
                                  'water_volume_fraction':.2,'phase_assumption':'single_temperature_no_phase_change'})
        def soil_query(request):
            return client.post('/api/plugin-queries/cablesim.standards-basis/lookup',json={'release_digest':pin['release_digest'],'input':request})
        response=soil_query(soil); assert response.status_code==200,response.text
        answer=response.json()['artifacts']['x-cablesim.standards-basis'];calculation=answer['calculation']
        assert calculation['output']=={'quantity':'volumetric_heat_capacity','value':2036240,'unit':'J/(m³·K)'}
        assert calculation['derived']['porosity']==.4 and calculation['approval']=='not_granted'
        assert answer['records'][0]['printed_page']=='7-3' and answer['records'][0]['pdf_page']==3
        assert calculation['record_sha256']==answer['records'][0]['record_sha256']
        assert len(calculation['input_sha256'])==64 and answer['records'][0]['verification']['status']=='verified'
        from copy import deepcopy
        for theta,expected in [(0,1200480),(.4,2872000)]:
            check=deepcopy(soil);check['formula_inputs']['water_volume_fraction']=theta
            response=soil_query(check);assert response.status_code==200,response.text
            assert response.json()['artifacts']['x-cablesim.standards-basis']['calculation']['output']['value']==expected
        invalid=deepcopy(soil);invalid['formula_inputs']['water_volume_fraction']=.41
        response=soil_query(invalid);assert response.status_code==422 and response.json()['detail']['path']=='/formula_inputs/water_volume_fraction'
        invalid=deepcopy(soil);del invalid['formula_inputs']['particle_density_kg_m3']
        response=soil_query(invalid);assert response.status_code==422 and response.json()['detail']['path']=='/formula_inputs/particle_density_kg_m3'
        # Consume the returned parameters against original public examples/hand products.
        for locator in ('B.1','B.2'):
            request=dict(schema_version='cablesim.standards-query/1',standard='GB/T 12706.1',edition='2020',
                         locator=locator,quantity='fictitious_rounding',conditions={})
            reply=client.post('/api/plugin-queries/cablesim.standards-basis/lookup',json={'release_digest':pin['release_digest'],'input':request})
            assert reply.status_code==200,reply.text
            record=reply.json()['artifacts']['x-cablesim.standards-basis']['records'][0]
            assert (record['printed_page'],record['pdf_page'])==(38,44)
            params=record['value']; assert params['mode']=='half_up' and params['unit']=='mm'
            if locator=='B.1':
                assert Decimal('2.449').quantize(Decimal(str(params['increment'])),rounding=ROUND_HALF_UP)==Decimal('2.4')
                assert Decimal('30.050').quantize(Decimal(str(params['increment'])),rounding=ROUND_HALF_UP)==Decimal('30.1')
            else: assert params['requires_explicit_increment'] is True and 'increment' not in params
        request=dict(schema_version='cablesim.standards-query/1',standard='Huang and Niu',edition='2025',
                     locator='Table A1',quantity='volumetric_heat_capacity',conditions={'material':'MPP','material_role':'pipe'})
        reply=client.post('/api/plugin-queries/cablesim.standards-basis/lookup',json={'release_digest':pin['release_digest'],'input':request})
        assert reply.status_code==200,reply.text
        record=reply.json()['artifacts']['x-cablesim.standards-basis']['records'][0]
        assert record['value']==920*670==616400
        assert record['semantic']=='literature_derived_reference'
        assert (record['printed_page'],record['pdf_page'])==(68,13)
        # Never accept string booleans or silently use a three-core factor for four cores.
        bad=dict(schema_version='cablesim.standards-query/1',standard='GB/T 12706.1',edition='2020',
                 locator='表 A.2',quantity='bundle_factor',conditions={'core_count':4,'equal_core_sections':'true','cable_arrangement':'standard'})
        reply=client.post('/api/plugin-queries/cablesim.standards-basis/lookup',json={'release_digest':pin['release_digest'],'input':bad})
        assert reply.status_code==422 and reply.json()['detail']['path']=='/conditions/equal_core_sections'
        blocked=dict(schema_version='cablesim.standards-query/1',standard='GB/T 12706.2',edition='2020',
                     locator='表 18',quantity='impulse_test_voltage',conditions={'u_v':10000})
        # The exact old record can still be browsed, but its ambiguous voltage axis is blocked.
        blocked['record_id']='mv-表18/r2/test_voltage'
        reply=client.post('/api/plugin-queries/cablesim.standards-basis/lookup',json={'release_digest':pin['release_digest'],'input':blocked})
        assert reply.status_code==422 and reply.json()['detail']['code']=='EVIDENCE_BLOCKED'
