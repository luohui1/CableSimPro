"""Sourced Cu/XLPE cable submodel, not a full-paper or IEC official example.

Huang & Niu (2025), DOI 10.1049/hve2.12465, printed p.68 (PDF p.13),
Appendix A Table A1. The table supplies dimensions and fixed thermal properties.
Depth, ambient and fixed 12 W/m load are explicit analytic validation inputs.
No published temperature/rating is claimed for this reduced two-layer model.
"""
SOURCE_SHA256='34fc4f54064ac14e70b437dc99146b295aa21a9bf73d421067475559372a12d1'
REFERENCE='Huang & Niu 2025, DOI 10.1049/hve2.12465, printed p.68 / PDF p.13, Appendix A Table A1'


def case():
    materials=[('soil','均匀土壤',1.25,1900,1300),('xlpe','XLPE',.4,1200,2526),('copper','铜导体',387.6,8889,381)]
    capacities={uid:dict(value_j_m3_k=d*c,material=name,reference=REFERENCE,source_sha256=SOURCE_SHA256,
        page=68,table='A1',density_kg_m3=d,specific_heat_j_kg_k=c,
        limitations='论文采用的固定物性；未公布温度与土壤含水率范围，不外推为现场材料认证。') for uid,name,k,d,c in materials}
    geometry=[dict(uid=uid,kind='rectangle' if uid=='soil' else 'disk',
        values=[-8.,-8.,8.,0.] if uid=='soil' else [0.,-1.,.0335/2 if uid=='xlpe' else .0205/2],
        material=dict(k_w_m_k=k,source=REFERENCE)) for uid,name,k,d,c in materials]
    value=dict(schema_version='cablesim.fem-step-response/1',circuit_id='reference-circuit',reference_current_a=400.,ambient_temperature_k=293.15,
        problem=dict(schema_version='cablesim.simulation-problem/1',physics='steady_heat',geometry=geometry,
        boundaries=[dict(uid='ground',selector='outer',values=[],kind='temperature',value=293.15)],
        excitations=[],probes_m=[[.2,-1.]],provenance={'source':REFERENCE},
        assumptions=['单根铜/XLPE两层子模型；埋深1 m、环境20 °C、参考400 A和固定12 W/m为明确的交叉核对输入。','省略屏蔽、填充、护套，不声称复现整根论文电缆。']),
        conductor_regions=['copper'],joule_heat_w_m={'copper':12.},capacities=capacities,source=REFERENCE+'；12 W/m 为给定焦耳损耗验证载荷。')
    controls=dict(operation='steady_reference',mesh=dict(size_m=.003,far_size_m=.5,transition_m=.5,minimum_circle_segments=32,field_order=2,max_nodes=120000),
                  first_time_s=10.,final_time_s=1e8,intervals_per_decade=12,max_levels=4,tolerance_k=.1)
    return value,controls
