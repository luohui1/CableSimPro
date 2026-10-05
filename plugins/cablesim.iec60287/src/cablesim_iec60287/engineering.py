"""Source-bound nominal model preparation; no manufacturer facts are overwritten."""
from copy import deepcopy
from math import pi, sqrt
from backend.domain.models import CableType, Material
from .engineering_contract import EngineeringParameters

GB='GB/T12706.2-2020 10.2.3/13.5表11/13.7/附录A；sha256:3b5fa321c213d4aaac7e04a293b9026626f43cc5b15209b26b713172e56f748d'
THERMAL='IEC60287-2-1:2023 表1，PDF41/印刷39页；sha256:a273d784ccf13b73915557c22ce3642c6c1bef94be6034ebd8237e8a7d997f52'
ELECTRICAL='IEC60287-1-1:2023 5.1.2/5.2/5.3.1/表1/表3/附录A；sha256:b300bb2bea52ce64e24c8137193559d7ee4cc04013ec4122357a2625e868a327'


def complete(value,parameters):
    p=EngineeringParameters.model_validate(parameters).values
    spec=value['specification'];facts=spec['values'];sources=deepcopy(value['sources'])
    if spec['cores']!=3 or spec['designation'] not in ('YJV','YJV22') or spec['u0_v']!=8700 or spec['voltage_v']!=15000 or spec['conductor']!='copper_bare':
        raise ValueError('model-completion：本分支仅覆盖8.7/15 kV三芯铜导体YJV/YJV22；其他系列保留资料缺项')
    if spec['designation']=='YJV22':
        missing=[key for key in ('armour_gap_ratio','steel_relative_permeability') if key not in p]
        if missing:raise ValueError('YJV22工程参数缺项：'+'；'.join(missing)+'，请填写钢带间隙率、相对磁导率和出处')
    def fact(key,unit='m'):
        item=facts.get(key)
        if item is None or item['unit']!=unit or not isinstance(item['value'],(float,int)) or isinstance(item['value'],bool) or item['value']<=0:
            raise ValueError('specification.values.'+key+'：需有来源的正数值，单位'+unit)
        if item['source'] not in sources:raise ValueError(key+'：公开字段缺来源')
        return item['value']
    def given(key):return p[key].value
    dc=fact('conductor_diameter');r20=fact('r20','ohm/m')
    ins=[fact(k) for k in ('conductor_screen_thickness','insulation_thickness','insulation_screen_thickness')]
    nominal=fact('metallic_screen_tape_thickness') if 'metallic_screen_tape_thickness' in facts else .0001
    if nominal<.0001:raise ValueError('metallic_screen_tape_thickness：三芯标称铜带厚度须不小于0.10 mm，GB10.2.3')
    overlap=.15  # GB nominal, kept separate from the manufacturer's actual overlap.
    inside=dc+2*sum(ins);radial=nominal*given('screen_radial_factor');core_d=inside+2*radial
    mean=inside+radial;lay=given('core_lay_length');cll=sqrt(1+(pi*1.29*core_d/lay)**2)
    area=pi*mean*nominal/(1-overlap)
    rs=1.7241e-8/area*cll if given('screen_model')=='continuous_contact' else given('screen_longitudinal_r20')
    # The screen resistance is conditional on the supplied contact model, never
    # presented as a tested resistance or implied by the GB overlap requirement.
    mats=[{'id':'material/cu','label':'铜','category':'conductor','standard_kind':'copper_bare','electrical_resistivity_20':1.7241e-8,'temperature_coefficient_20':.00393},
          {'id':'material/semi','label':'半导电聚乙烯参考','category':'semiconductor','thermal_resistivity':2.5},
          {'id':'material/xlpe','label':'XLPE参考','category':'insulation','standard_kind':'XLPE','thermal_resistivity':3.5,'relative_permittivity':2.5,'loss_tangent':.004},
          {'id':'material/filler','label':'工程师给定填充与包带','category':'filler','thermal_resistivity':given('filler_rho')},
          {'id':'material/pvc','label':'PVC护套参考（绝缘等级口径）','category':'polymer','standard_kind':'PVC','thermal_resistivity':6.}]
    core_layers=[{'role':role,'material':material,'thickness':thick} for role,material,thick in zip(
        ['conductor_screen','insulation','insulation_screen'],['material/semi','material/xlpe','material/semi'],ins)]
    core_layers.append({'role':'metallic_screen','material':'material/cu','thickness':radial,'form':'tape','nominal_tape_thickness':nominal,'overlap':overlap,'longitudinal_r20':rs,'longitudinal_resistance_basis':'dc'})
    pack=core_d*(1+2/sqrt(3));binder=fact('binder_tape_thickness');bedding=fact('bedding_thickness') if 'bedding_thickness' in facts else 0
    armoured=spec['designation']=='YJV22';armour=None
    if armoured:
        if 'armour_tape_count' in facts and fact('armour_tape_count','1')!=2:
            raise ValueError('specification.values.armour_tape_count：YJV22本分支要求两层钢带，GB13.7')
        # A manufacturer's gauge takes precedence. Missing gauges use the
        # GB fictitious-diameter construction, never the actual envelope.
        if 'armour_tape_thickness' in facts:
            gauge=fact('armour_tape_thickness')
        else:
            gauge, fictitious = nominal_steel_gauge(spec,nominal,fact('metallic_screen_tape_width'))
            sources['/derived/armour_tape_thickness']={'kind':'standard','reference':GB+'；标准标称值；铠装前假设直径 '+str(fictitious)+' mm，非实际外径','reviewed':False}
        width=fact('armour_tape_width');gap=width*given('armour_gap_ratio')
        armour={'role':'armour','material':'material/steel','thickness':2*gauge,'nominal_tape_thickness':gauge,'form':'tape','tape_width':width,'tape_gap':gap,'tape_count':2,'tape_application':'two_tape_gap'}
        mats.append({'id':'material/steel','label':'工程师给定磁性钢带','category':'metal','relative_permeability':given('steel_relative_permeability')})
    outer=fact('oversheath_thickness');reported=fact('outer_diameter')
    base=pack+2*(binder+bedding+outer+(armour['thickness'] if armour else 0))
    residual=(reported-base)/2
    if residual<0 and -2*residual>given('diameter_rounding'):
        raise ValueError('screen_radial_factor：径向构造与厂家参考外径不能闭合，请核对铜带包络和尺寸；不能缩减厂家层厚')
    filler=binder+max(0,residual)
    common=[{'role':'filler','material':'material/filler','thickness':filler}]
    if bedding:common.append({'role':'bedding','material':'material/pvc','thickness':bedding})
    if armour:common.append(armour)
    common.append({'role':'oversheath','material':'material/pvc','thickness':outer})
    conductor={'material':'material/cu','form':given('conductor_form'),'nominal_area':spec['area_m2'],'diameter':dc,'r20':r20,'conductor_class':2,'r20_basis':'design'}
    c=core_d/sqrt(3)
    cable={'id':'cable_type/engineering','label':value['name'],'construction':'three_core','core_lay_length':lay,
           'rating':{'u0':spec['u0_v'],'u':spec['voltage_v'],'max_conductor_temperature':{'normal':363.15}},
           'cores':[{'id':'core/'+str(i+1),'x':x,'z':z,'conductor':deepcopy(conductor),'layers':deepcopy(core_layers)} for i,(x,z) in enumerate([(0,c),(-core_d/2,-c/2),(core_d/2,-c/2)])],
           'common_layers':common}
    sources['/cable_type']={'kind':'derived','reference':'标准推导的标称模型；'+GB+'；'+ELECTRICAL+'；结论依赖另列的工程师给定参数','reviewed':False}
    sources['/materials']={'kind':'standard','reference':THERMAL+'；'+ELECTRICAL+'；均为标准参考值，非厂家配方实测','reviewed':False}
    for key,item in p.items():sources['/engineering_parameters/'+key]={'kind':'user','reference':item.reference,'reviewed':False}
    return {'schema':'cablesim.engineering-model/1','name':value['name'],'version':value['version']+'+engineering',
            'cable_type':CableType.model_validate(cable).model_dump(mode='json'),
            'materials':[Material.model_validate(m).model_dump(mode='json') for m in mats], 'sources':sources,
            'engineering_parameters':parameters,'derived':{'copper_tape_area_m2':area,'screen_longitudinal_r20_ohm_m':rs,
                'screen_resistance_formula':'R20=ρ20 C_LL/[π d_mean t/(1-overlap)]；仅连续接触等效分支',
                'nominal_overlap':overlap,'filler_cover_thickness_m':filler,'model_outer_diameter_m':base+2*max(0,residual),
                'reported_outer_diameter_m':reported,'armour_tape_thickness_m':armour['nominal_tape_thickness'] if armour else None,
                'armour_tape_basis':('manufacturer' if 'armour_tape_thickness' in facts else 'standard_nominal') if armour else 'unarmoured',
                'basis':'standard_derived','reference':GB+'；'+ELECTRICAL},
            'dependencies':['导体构造模型','成缆节距','铜带接触/电阻模型与径向包络','填充与包带材料',*(['钢带间隙及磁导率'] if armoured else []),'参考外径列示精度']}


def nominal_steel_gauge(spec,tape_thickness,tape_width):
    """GB12706.2 Annex A.2.1–5/9, Table11; supported round three-core build."""
    from decimal import Decimal, ROUND_HALF_UP
    def rounded(value):return float(Decimal(str(value)).quantize(Decimal('.1'),rounding=ROUND_HALF_UP))
    conductors={35:6.7,50:8.,70:9.4,95:11.,120:12.4,150:13.8,185:15.3,240:17.5,300:19.5,400:22.6}
    nominal_area=round(spec['area_m2']*1e6)
    if nominal_area not in conductors:raise ValueError('标准钢带厚度推导未覆盖此截面')
    screen_area=tape_thickness*1e3*tape_width*1e3
    increases=[(1.5,.5),(2.5,.5),(4,.5),(6,.6),(10,.8),(16,1.1),(25,1.2),(35,1.4),(50,1.7),(70,2.),(95,2.4),(120,2.7),(150,3.),(185,4.),(240,5.),(300,6.)]
    increase=0 if 2*tape_thickness<.00015 else next((d for a,d in increases if a>=screen_area),None)
    if increase is None:raise ValueError('标准屏蔽假设直径推导超出表A.2')
    insulation=spec['values']['insulation_thickness']['value']*1e3
    core=rounded(conductors[nominal_area]+2*insulation+3+increase)
    pack=rounded(2.16*core)
    bedding=rounded(pack+2*(.4 if pack<=40 else .6))
    before=rounded(bedding+(1 if bedding<=29 else 1.6))
    return (.0002 if before<=30 else .0005 if before<=70 else .0008),before
