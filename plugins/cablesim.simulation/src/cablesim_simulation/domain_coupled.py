"""Saved SI domain to pointwise GetDP/heat feedback, with declared material ranges."""
from copy import deepcopy
from pydantic import Field
from cablesim_sdk.simulation import Strict,MeshControls,Condition
from cablesim_sdk.electrothermal import Electrothermal
from .research_electromagnetic import prepare_domain


class Validity(Strict):
    minimum_temperature_k: float=Field(gt=0)
    maximum_temperature_k: float=Field(gt=0)
    source: str=Field(min_length=1)


class Options(Strict):
    electromagnetic_options: dict
    mesh: MeshControls
    thermal_boundaries: list[Condition]=Field(min_length=1)
    material_validity: dict[str,Validity]
    initial_temperature_k: float=Field(gt=0)
    temperature_tolerance_k: float=Field(default=1e-4,gt=0,le=.01)
    power_relative_tolerance: float=Field(default=1e-6,gt=0,le=1e-3)
    maximum_iterations: int=Field(default=60,ge=2,le=200)
    relaxation: float=Field(default=.7,gt=0,le=1)
    fixed_heat_w_m_by_region: dict[str,float]=Field(default_factory=dict)


def prepare(value,parameters):
    options=Options.model_validate(parameters)
    problem,bindings,region_materials,topology,document,section=prepare_domain(value,options.electromagnetic_options)
    if problem.electrical_networks or problem.axial_lengths_m:
        raise ValueError('bonding.cross_bonded：当前温度反馈使用单截面热场；三小段损耗可独立求解，分段电热反馈未覆盖。')
    materials={material.id:material for material in document.materials}
    raw=problem.model_dump(mode='json')
    for shape in raw['geometry']:
        mid=region_materials.get(shape['uid'])
        if mid is None:
            mid=section.medium.material
        if mid is not None:
            resistivity=materials[mid].thermal_resistivity
            if resistivity is None:raise ValueError('materials.'+mid+'.thermal_resistivity：稳态耦合缺热阻率，单位 K*m/W。')
            shape['material']['k_w_m_k']=1/resistivity
        elif shape['material'].get('k_w_m_k') is None:
            raise ValueError('electromagnetic_options.background.k_w_m_k：耦合外域缺热导率，单位 W/(m*K)。')
    expected={mid for uid,mid in region_materials.items() if next(g for g in problem.geometry if g.uid==uid).material.conductivity_s_m>0}
    if set(options.material_validity)!=expected:
        raise ValueError('material_validity：须逐个导电材料提供有来源的有效温度区间，不能外推。')
    laws={}
    for uid,mid in region_materials.items():
        if next(g for g in problem.geometry if g.uid==uid).material.conductivity_s_m<=0:continue
        material=materials[mid];state=options.electromagnetic_options['material_states'][mid]['temperature_k']
        alpha=material.temperature_coefficient_20
        if alpha is None:raise ValueError('materials.'+mid+'.temperature_coefficient_20：温度反馈缺电阻温度系数，单位 1/K。')
        validity=options.material_validity[mid]
        laws[uid]={'reference_temperature_k':state,'alpha_per_k':alpha/(1+alpha*(state-293.15)),
                   **validity.model_dump(mode='json')}
    ambient=section.medium.surface_temperature if section.kind=='ground' else section.medium.air_temperature
    if not isinstance(ambient,(int,float)):
        raise ValueError('sections.'+section.id+'.medium：稳态耦合需明确的恒定环境温度，单位 K。')
    for boundary in options.thermal_boundaries:
        if boundary.kind=='temperature' and boundary.value!=ambient:
            raise ValueError('thermal_boundaries.value：给定温度须绑定已保存截面的环境温度，不能另行覆盖。')
    model=Electrothermal.model_validate({'schema_version':'cablesim.electrothermal/1','magnetic':raw,
        'thermal_boundaries':[boundary.model_dump(mode='json') for boundary in options.thermal_boundaries],
        'fixed_heat_w_m_by_region':options.fixed_heat_w_m_by_region,
        'resistivity_laws':laws,**{name:getattr(options,name) for name in
            ('initial_temperature_k','temperature_tolerance_k','power_relative_tolerance','maximum_iterations','relaxation')}})
    return model,options.mesh
