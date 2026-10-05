"""Reproducible 10 kV three-circuit duct study fixture; no solver is run here."""
from copy import deepcopy
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))


def case():
    from backend.domain.migration import convert
    from backend.schemas import Scenario
    from backend.kernel.scenarios import system_models,METHOD_DEFAULTS
    d=convert(Scenario().model_dump())['document']
    model=next(m for m in system_models() if m['id']=='system.cu-xlpe-al-400')
    cable=deepcopy(model['payload']['cable_type'])
    cable['rating']['u0']=6000.;cable['rating']['u']=10000.;cable['label']='10 kV 同心光滑护套数值研究结构'
    next(l for l in cable['cores'][0]['layers']+cable['common_layers'] if l['role']=='insulation')['thickness']=.0034
    d['cable_types']=[cable]
    ids={m['id'] for m in model['payload']['materials']}
    d['materials']=[m for m in d['materials'] if m['id'] not in ids]+deepcopy(model['payload']['materials'])
    for material in d['materials']:
        if material['id']=='material/cu':material['thermal_resistivity']=1/380.
    section=d['sections'][0];soil=section['medium']['material']
    next(m for m in d['materials'] if m['id']==soil)['thermal_resistivity']=.7
    d['materials'] += [
        {'id':'material/example-lower','label':'下层设计土壤','category':'soil','thermal_resistivity':2.5},
        {'id':'material/example-fill','label':'设计回填','category':'soil','thermal_resistivity':1.},
        {'id':'material/example-duct','label':'PVC管','category':'duct','thermal_resistivity':6.}]
    base=deepcopy(d['circuits'][0]);d['circuits']=[];section['placements']=[];section['enclosures']=[]
    currents={}
    for row in range(3):
        circuit=deepcopy(base);circuit['id']=f'circuit/example-{row}';circuit['label']=f'10 kV 第{row+1}回'
        circuit['cable_type']=cable['id'];circuit['bonding']['kind']='single_point';circuit['cables']=[]
        currents[circuit['id']]=150.
        for col,phase in enumerate('ABC'):
            uid=f'cable/example-{row}-{phase}';duct=f'enclosure/example-{row}-{phase}';x=(col-1)*.24;z=-.9-row*.24
            circuit['cables'].append({'id':uid,'phase':phase})
            section['placements'].append({'cable':uid,'x':x,'z':z,'enclosure':duct})
            section['enclosures'].append({'id':duct,'type':'duct','x':x,'z':z,'material':'material/example-duct',
                'inner_diameter':.08,'outer_diameter':.09,'contains':[uid]})
        d['circuits'].append(circuit)
    section['soil_layers']=[{'id':'region/example-upper','label':'上层','material':soil,'top_z':0.,'bottom_z':-.6},
        {'id':'region/example-lower','label':'下层','material':'material/example-lower','top_z':-.6,'bottom_z':-200.}]
    section['backfill']={'id':'region/example-fill','material':'material/example-fill','x':0.,'z':-1.14,'width':1.2,'height':1.2}
    d['load_cases'][0]['currents']=currents
    source='可复现数值研究结构：6/10 kV、400 mm2、绝缘3.4 mm、三回3×3排管；尺寸/土层为设计假设，非厂家样本或工程审批。'
    d['provenance']['/iec-fem/example']={'kind':'demo','reference':source,'reviewed':False}
    iec=deepcopy(METHOD_DEFAULTS['cablesim.iec60287'])
    iec['per_cable_losses']={q['cable']:{'ac_extra_factor':.04,'lambda1':.02} for q in section['placements']}
    iec['loss_input_source']='热场比较的显式数值边界：AC附加系数0.04、护套损耗比0.02；非实测或完整三回电磁模型。'
    return {'case_id':'three-circuit-duct','input':d,'parameters':{
        'section_id':section['id'],'load_id':d['load_cases'][0]['id'],'iec':iec,'bounds_m':[-30.,-30.,30.,0.],
        'controls':{'operation':'ampacity','element_order':2,'mesh_size_m':.0016,'far_mesh_size_m':1.2,'mesh_transition_m':8.,
            'fine_mesh_band_m':.0002,'near_soil_mesh_size_m':.02,'near_soil_margin_m':.5,
            'max_nodes':400000,'tolerance_k':1e-5,'max_iterations':100,'relaxation':.8,
            'current_upper_a':1800.,'current_tolerance_a':.01,'rated_circuit':d['circuits'][1]['id']},
        'mesh_scales':[1.5,1.,.75],'domain_scale':2.,'uniform_soil_counterfactual_acknowledged':True,
        'frozen_coefficients_acknowledged':True,'source':source}}


def feedback_case():
    """Same saved dimensions/R20/loads; explicit numerical EM scope and topology."""
    item = case()
    source = {'kind':'demo','reference':'三回排管数值研究接线：共同ABC相序、A相0 rad、各回路护套单点接地；非工程接线图。','reviewed':False}
    for circuit in item['input']['circuits']:
        circuit['bonding']['source'] = deepcopy(source)
        circuit['electrical_topology'] = {'phase_sequence':'ABC','reference_angle_rad':0.,'source':deepcopy(source)}
    item['parameters'].update(frozen_coefficients_acknowledged=False,feedback={
        'electrical':'native_getdp','duct_air':True,'conductor_model':'r20_matched_continuum',
        'source':'数值研究模型：普通非绝缘圆绞线以保存R20和包络面积匹配连续轴向导电率；各介质非磁性，金属区按平均温度更新；材料定律研究区间0–150 °C。'})
    return item


def capacity_data(model):
    """Explicit reference properties for this numerical example, not site tests."""
    soil = 1/(.9*5.09e-7)
    capacities = {r.uid:soil for r in [model.environment.background,*model.environment.soil_layers,*model.environment.backfills]}
    by_role = {'conductor':3.45e6,'conductor_screen':2.e6,'insulation':2.4e6,
               'insulation_screen':2.e6,'metallic_sheath':2.5e6,'oversheath':1.7e6}
    for cable in model.cables:
        for layer in cable.layers:capacities[layer.uid] = by_role[layer.role]
        if cable.duct:
            capacities[cable.duct.uid+'/wall'] = 1.7e6
            capacities[cable.duct.uid+'/air'] = (1.4/.4)*101325/298.15
    return capacities,{
        'solids':'Alliander cable-thermal-model c1d4c5df9372097991798d8afa1d1af29033a4ba data/material_properties.csv: cmCu, scrSemiconductingXLPE, imXLPEUnfilled, samAluminium, pcPVC; J/(m3 K).',
        'soil':'Nielsen et al., Applied Sciences 2019 9:800 Table A2: rhoT=.9 K m/W, diffusivity=5.09e-7 m2/s; derived Cvol=1/(rhoT*diffusivity), adopted uniformly for synthetic soil/backfill capacity, while saved conductivities remain unchanged.',
        'air':'NASA Glenn Specific Heats cp and cv, published 2021-05-18: cp-cv=R, gamma=1.4, pv=RT. Declared ideal-gas isobaric equivalent Cvol=gamma/(gamma-1)*101325/298.15; constant reference property, not a measured duct property.'}


if __name__=='__main__':
    import json
    print(json.dumps(case(),ensure_ascii=False,indent=2))
