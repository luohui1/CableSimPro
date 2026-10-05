"""Converged thermal/coupled FEM and explicit standard or counterfactual traces."""
from copy import deepcopy
import time
from pydantic import Field
from pydantic import model_validator
from typing import Literal

from cablesim_sdk.base import StrictModel
from cablesim_sdk.domain import DomainDocument
from cablesim_simulation.thermal_dataset import calculate as finite_element
from .features import baseline,extract,construction,family,digest,VERSION


class Settings(StrictModel):
    iec: dict
    controls: dict
    bounds_m: tuple[float,float,float,float]
    dataset: dict = Field(default_factory=dict)
    source: str = Field(min_length=1)
    physics: Literal['thermal','electromagnetic_thermal']='thermal'
    electromagnetic_mesh: dict | None=None

    @model_validator(mode='after')
    def numerical_gates(self):
        from cablesim_simulation.thermal_input import Controls
        from cablesim_simulation.thermal_dataset import Verification
        Controls.model_validate(self.controls);Verification.model_validate(self.dataset)
        if self.physics=='electromagnetic_thermal':
            from cablesim_sdk.simulation import MeshControls
            mesh=MeshControls.model_validate(self.electromagnetic_mesh)
            if mesh.exterior_growth_start_m is not None:
                raise ValueError('electromagnetic_mesh.exterior_growth_start_m：埋地电磁热标签不允许全局原点增长覆盖局部细化，请省略该项或设为null。')
        return self


def calculate(value,parameters):
    settings=Settings.model_validate(parameters)
    original=DomainDocument.model_validate(value).model_dump(mode='json')
    layered=bool(original['sections'][0].get('soil_layers'))
    start=time.perf_counter();document,prepared,iec=baseline(original,settings.iec)
    iec_seconds=time.perf_counter()-start
    rated=settings.controls['rated_circuit']
    features,base=extract(document,prepared,iec,rated)
    rating=next(r for r in iec['circuit_ratings'] if r['entity']==rated)
    # A saved global ceiling remains authoritative. The independent IEC
    # bracket reduces unnecessarily unstable over-temperature trials.
    controls=deepcopy(settings.controls)
    controls['current_maximum_a']=controls['current_upper_a']
    controls['current_upper_a']=min(controls['current_upper_a'],1.25*rating['ampacity_a'])
    states={s['entity']:s for s in rating['cable_states']}
    per_cable={};duct_air={}
    for cable in prepared.cables:
        uid=cable['id'];state=states[uid]
        ctype=next(t for t in document['cable_types'] if t['id']==next(c for c in document['circuits'] if c['id']==cable['circuit'])['cable_type'])
        layers=ctype['cores'][0]['layers']+ctype['common_layers']
        layer_ids=[uid+'/conductor']+[uid+'/layer-'+str(i) for i in range(len(layers))]
        heat={key:0. for key in layer_ids}
        # IEC dielectric heat is distributed equally to its two insulation
        # interfaces, preserving total power; the radial distribution is a
        # declared thin-screen approximation, not measured material behaviour.
        heat[layer_ids[1]]=state['dielectric_loss_w_m']/2
        heat[layer_ids[3]]=state['dielectric_loss_w_m']/2
        screen=layer_ids[1+next(i for i,l in enumerate(layers) if l['role']=='metallic_sheath')]
        per_cable[uid]={'electrical':{'ac_extra_factor':state['ac_extra_factor'],
            'sheath_loss_factor':state['lambda1'],'sheath_layer_uid':screen,
            'source':'IEC rated-point coefficients; baseline_sha256='+digest(iec)},
            'fixed_layer_heat_w_m':heat,'prescribed_core_temperature_k':None,
            'equivalent_layers_acknowledged':False}
        if cable['duct']:
            duct_air[cable['duct']['id']]={'resistance_k_m_w':state['t4_air_gap_k_m_w'],
                 'source':'IEC60287-2-1:2023 4.2.6.1; frozen rated-point air resistance; sha256='+digest(iec)}
    ambient=document['sections'][0]['medium']['surface_temperature']
    bc={'kind':'temperature','temperature_k':ambient,'h_w_m2_k':None,'emissivity':None}
    parameters={'controls':controls,'dataset':settings.dataset,
        'domain_options':{'section_id':document['sections'][0]['id'],'load_id':document['load_cases'][0]['id'],
            'bounds_m':settings.bounds_m,'boundaries':{k:deepcopy(bc) for k in ('top','bottom','left','right')},
            'per_cable':per_cable,'duct_air':duct_air,'source':settings.source}}
    if settings.physics=='electromagnetic_thermal':
        from .coupled import calculate as coupled
        payload=coupled(document,settings,prepared,iec)
    else:
        payload=finite_element(document,parameters)
    temperatures=[s['conductor_max_temperature_k'] for s in payload['operating']['cables'] if s['circuit']==rated]
    truth={'ampacity_a':payload['rating']['rating']['ampacity_a'],'temperature_k':max(temperatures)}
    payload['hybrid']={'schema_version':'cablesim.hybrid-sample/1','feature_version':VERSION,
        'family':family(document),'paired':True,'construction_sha256':construction(document,settings.iec),
        'features':features,'baseline':base,'fem':truth,
        'targets':{'ampacity_ratio':truth['ampacity_a']/base['ampacity_a'],
                   'temperature_residual_k':truth['temperature_k']-base['temperature_k']},
        'iec':{'method':'IEC60287-1-1:2023 / 2-1:2023','input_sha256':digest(document),
               'parameters_sha256':digest(settings.iec),'trace_sha256':digest(iec),'wall_seconds':iec_seconds,
               'clauses':['1-1 5.1.2/5.2/5.3','2-1 4.2.3.3.2/4.2.7'],
               'operating_cable_states':iec['operating']['cable_states'],
               'verification':iec['verification']},
        'physics_scope':'2D thermal FEM; constant thermal properties; linear R(T); frozen IEC rated-point AC/sheath/duct coefficients; no CFD',
        'source':settings.source,'authority':'reference_only','engineering_approval':False}
    if settings.physics=='electromagnetic_thermal':
        payload['hybrid']['physics_scope']='GetDP A-u / P1 thermal; pointwise sigma(T), conductor skin/proximity and sheath induced/circulating losses; explicit R20-preserving homogenized cylinder; no earth return/3D stranded conductor'
    if layered:
        payload['hybrid']['uniform_iec_counterfactual']={'ampacity_a':base['ampacity_a'],
            'purpose':'uniform-soil IEC diagnostic only; not the same-condition layered baseline','trace_sha256':digest(iec)}
        payload['hybrid']['iec']['purpose']='Explicit uniform-soil counterfactual for residual learning; not a same-condition layered result'
        payload['hybrid']['iec']['counterfactual_input_sha256']=iec['hybrid_baseline']['input_sha256']
        from .layered import prepare_layered,independent_matrix
        from cablesim_iec60287.group import rate_group
        try:
            group=prepare_layered(original,settings.iec)
            layered_result=rate_group(group,verification_coefficients=independent_matrix(group))
            _,layered_base=extract(original,group,layered_result,rated)
            layered_base['kind']='layered_same_condition'
            payload['hybrid']['layered_reference']={'status':'available','baseline':layered_base,
                'method':'IEC internal/electrical model + independently derived two-layer Fourier Green matrix',
                'trace_sha256':digest(layered_result),'external_resistance':group.soil,
                'verification':layered_result['verification'],'input_sha256':digest(original)}
        except ValueError as error:
            payload['hybrid']['layered_reference']={'status':'not_covered','reason':str(error)}
    return payload
