"""IEC 60287-3-3:2007 4.1/4.2 and coincident crossings in 4.3.

SI inputs. Equation (1) has a square root (confirmed on the original page).
Sources are fixed horizontal line heat sources, not jointly rated circuits (4.4).
"""
from functools import lru_cache
from math import ceil, exp, expm1, fsum, hypot, log1p, pi, sin, sqrt
from pydantic import BaseModel, ConfigDict, Field
from cablesim_sdk.validation import FieldValueError
from .method import RatingRefused

CLAUSE = 'IEC 60287-3-3:2007 4.1–4.3, Eq.(1)–(16), printed pp.8–11 / PDF pp.10–13'


class HeatSource(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False,str_strip_whitespace=True,strict=True)
    label: str = Field(min_length=1, max_length=120, title='热源名称')
    depth_m: float = Field(gt=0, title='热源轴线埋深', description='从地表至热源轴线的埋深，m。', json_schema_extra={'x-unit':'m'})
    diameter_m: float = Field(gt=0, title='热源外径', description='热源实际外径，m；用于拒绝相互接触。', json_schema_extra={'x-unit':'m'})
    angle_rad: float = Field(gt=0, le=pi/2, title='交叉角', description='水平轴线的锐交叉角，rad；平行热源须用平行模型。', json_schema_extra={'x-unit':'rad'})
    heat_w_m: float = Field(ge=0, title='单位长度发热', description='热源固定总发热，W/m；不能直接用表面温度替代。', json_schema_extra={'x-unit':'W/m'})
    source: str = Field(min_length=1, max_length=1000, title='参数来源', description='几何与固定发热的具体出处；区分厂家资料、测量和工程师给定。')


def sources_for(group):
    values=group.parameters.get('crossing_heat_sources',[])
    if not values:return []
    # Annex A uses the hottest single-core cable and its group-effective T4.
    # Section 1 expressly warns that superposition is optimistic for touching cables.
    section=group.document['sections'][0]
    if any(c['duct'] for c in group.cables) or section.get('backfill') or section.get('soil_layers'):
        raise RatingRefused('CROSSING_SCOPE','IEC 60287-3-3:2007 第 1 条要求周围介质热特性均匀且可叠加；本方法不覆盖排管、回填或分层。请建立包含热源实际几何的三维热仿真。','/parameters/crossing_heat_sources')
    if not group.soil.get('three_core'):
        for i,a in enumerate(group.cables):
            for b in group.cables[i+1:]:
                clearance=hypot(a['point'][0]-b['point'][0],a['point'][1]-b['point'][1])-(a['geometry'].overall_m+b['geometry'].overall_m)/2
                if clearance<=1e-9:
                    raise RatingRefused('CROSSING_TOUCHING_GROUP','接触电缆组（包括接触品字形）不能直接套用交叉降额：IEC 60287-3-3:2007 第 1 条（第 6 页，PDF 第 8 页）说明接触电缆不严格满足叠加原理，直接计算偏乐观。请用包含三相电缆、接触界面和交叉热源的三维热仿真；本次不输出降额值。','/parameters/crossing_heat_sources')
        if len(group.circuits)!=1 or group.circuits[0].get('arrangement')!='flat' or max(c['point'][1] for c in group.cables)-min(c['point'][1] for c in group.cables)>1e-9:
            raise RatingRefused('CROSSING_GROUP_SCOPE','标准覆盖单芯电缆；本实现按 IEC 60287-3-3:2007 附录 A 的最热电缆法支持同埋深、非接触平行单回路。不同埋深品字形或多回路的纵向互热尚未闭合，请用三维热仿真，不以独立单根降额替代。','/parameters/crossing_heat_sources')
        if len({c['current'] for c in group.cables})!=1:
            raise RatingRefused('CROSSING_UNBALANCED_GROUP','附录 A 的单芯平行组按三相等负荷采用最热电缆法；本实现不覆盖不平衡负荷的纵向互热。请使用包含各相实际负荷与交叉段的三维热仿真。','/parameters/crossing_heat_sources')
    elif len(group.cables)!=1:
        raise RatingRefused('CROSSING_SCOPE','交叉降额的三芯分支只覆盖一根直埋电缆；多回路请用三维热仿真。','/parameters/crossing_heat_sources')
    cable_type=next(t for t in group.document['cable_types'] if t['id']==group.document['circuits'][0]['cable_type'])
    conductor=cable_type['cores'][0]['conductor']
    material=next(m for m in group.document['materials'] if m['id']==conductor['material'])
    if (material.get('standard_kind') or group.parameters.get('crossing_conductor_material')) not in ('copper_bare','copper_coated','copper','aluminium'):
        raise RatingRefused('CROSSING_CONDUCTOR_MATERIAL','请明确型号导体材料为铜或铝；不按名称猜测纵向热阻。','/parameters/crossing_conductor_material')
    rows=[];depth=-group.cables[0]['point'][1];radius=group.cables[0]['geometry'].overall_m/2
    for i,value in enumerate(values):
        from pydantic import ValidationError
        try:source=HeatSource.model_validate(value)
        except ValidationError as exc:
            error=exc.errors()[0]
            raise FieldValueError(error['msg'],'parameters','crossing_heat_sources',i,*error['loc']) from exc
        if source.depth_m<=source.diameter_m/2:
            raise RatingRefused('CROSSING_SOURCE_NOT_BURIED','热源须全部位于地表以下；轴线埋深应大于外半径。',f'/parameters/crossing_heat_sources/{i}/depth_m')
        if abs(depth-source.depth_m)<=radius+source.diameter_m/2:
            raise RatingRefused('CROSSING_CONTACT','电缆与热源必须有正净距；接触情形不适用叠加法。',f'/parameters/crossing_heat_sources/{i}/depth_m')
        rows.append(source.model_dump())
    return rows


@lru_cache(maxsize=128)
def _kernel(depth, source_depth, angle, rho, gamma, heat):
    """Eq.(2), right-endpoint exponential-cell quadrature, Eq.(10)/(11).

    Integrate beyond the Eq.(11) temperature-tail boundary, but bound work by
    the exponentially weighted remainder instead of materializing a long array.
    The omitted temperature contribution is <= peak * exp(-gamma*zmax).
    """
    s=sin(angle);distance=abs(depth-source_depth)
    if distance<=0 or not 0<angle<=pi/2:raise ValueError('Crossing depth/angle outside the line-source model.')
    dz=min(.01,.009/gamma)  # gamma*dz < 0.01, strictly.
    coefficient=rho/(4*pi)
    ratio=.01/(coefficient*heat) if heat else 1000
    z_required=sqrt(max(0,4*depth*source_depth/expm1(ratio)-distance**2))/s if ratio<700 else 0
    n=max(ceil(z_required/dz)+1,ceil(24/(gamma*dz)))
    evaluated=min(n,ceil(32/(gamma*dz)))
    value=coefficient*expm1(gamma*dz)*fsum(
        exp(-gamma*i*dz)*log1p(4*depth*source_depth/(distance**2+(i*dz*s)**2)) for i in range(1,evaluated+1))
    return value,dz,n,n*dz,coefficient*log1p(4*depth*source_depth/distance**2)*exp(-gamma*evaluated*dz)


def derate(*, current_a, resistance_ohm_m, alpha20_per_k, area_m2, conductor_rho_k_m_w,
           cores, t1, t2, t3, t4, lambda1, lambda2, dielectric_w_m, limit_c, ambient_c,
           depth_m, soil_rho_k_m_w, sources):
    """Fixed-source iterative DF, Eq.(1)–(9), with saved intermediate evidence.

    All heat sources cross the rated route at the same longitudinal position.
    Finite-spacing or mutually re-rated crossings need 4.3/4.4, not this subset.
    """
    tr=t1+cores*(t2+t3+t4)
    weighted=t1+cores*((1+lambda1)*t2+(1+lambda1+lambda2)*(t3+t4))
    tl=conductor_rho_k_m_w/area_m2
    dielectric_rise=dielectric_w_m*(t1/2+cores*(t2+t3+t4))
    budget=limit_c-ambient_c-dielectric_rise
    if budget<=0:raise RatingRefused('CROSSING_NO_HEADROOM','介质损耗已用尽温升余量。','/parameters/crossing_heat_sources')
    dw0=resistance_ohm_m*alpha20_per_k*current_a**2/(1+alpha20_per_k*(limit_c-20))
    first=fsum(s['heat_w_m']*soil_rho_k_m_w/(4*pi)*log1p(4*depth_m*s['depth_m']/(depth_m-s['depth_m'])**2) for s in sources)
    # This initial unattenuated estimate is not an admissibility verdict.
    rise=min(first,budget);history=[]
    for iteration in range(1,101):
        dw=dw0*(1-rise/budget)
        if 1-dw*weighted<=0:raise RatingRefused('CROSSING_ATTENUATION_INVALID','纵向衰减因子不存在实数解；检查负荷和热阻输入。','/parameters/crossing_heat_sources')
        gamma=sqrt((1-dw*weighted)*tl/tr)
        terms=[]
        for s in sources:
            mutual,dz,n,zmax,tail=_kernel(depth_m,s['depth_m'],s['angle_rad'],soil_rho_k_m_w,gamma,s['heat_w_m'])
            terms.append({**s,'mutual_k_m_w':mutual,'rise_k':mutual*s['heat_w_m'],
                'dz_m':dz,'intervals':n,'zmax_m':zmax,'omitted_rise_bound_k':tail*s['heat_w_m'],
                'unattenuated_end_rise_k':s['heat_w_m']*soil_rho_k_m_w/(4*pi)*log1p(4*depth_m*s['depth_m']/((depth_m-s['depth_m'])**2+(zmax*sin(s['angle_rad']))**2)),
                'net_clearance_m':None})
        new=fsum(s['rise_k'] for s in terms)
        history.append({'iteration':iteration,'rise_k':new,'gamma_per_m':gamma,'incremental_heat_w_k_m':dw})
        if abs(new-rise)<1e-9:break
        rise=new
    else:raise RatingRefused('CROSSING_NOT_CONVERGED','交叉热源降额迭代未收敛。','/parameters/crossing_heat_sources')
    factor=sqrt(max(0,1-new/budget))
    return {'clause':CLAUSE,'baseline_current_a':current_a,'derated_current_a':current_a*factor,'derating_factor':factor,
        'crossing_rise_k':new,'dielectric_rise_k':dielectric_rise,'thermal_budget_k':budget,
        'longitudinal_resistance_k_per_w_m':tl,'radial_resistance_k_m_w':tr,'weighted_resistance_k_m_w':weighted,
        'first_estimate_rise_k':first,'history':history,'sources':terms,
        'scope':'水平固定线热源、同一交叉位置、均匀土壤、等温地表、正净距；未联合求解热源电流或给定电流温度。'}


def apply(group,payload):
    sources=sources_for(group)
    if not sources:return payload
    document=group.document
    cable_type=next(t for t in document['cable_types'] if t['id']==document['circuits'][0]['cable_type'])
    conductor=cable_type['cores'][0]['conductor'];material=next(m for m in document['materials'] if m['id']==conductor['material'])
    kind=material.get('standard_kind') or group.parameters.get('crossing_conductor_material')
    rho={'copper_bare':.0026,'copper_coated':.0026,'copper':.0026,'aluminium':.0049}.get(kind)
    if rho is None:raise RatingRefused('CROSSING_CONDUCTOR_MATERIAL','请明确选择交叉段导体为铜或铝；纵向热阻按标准式(4)，不按材料名称猜测。','/parameters/crossing_conductor_material')
    medium=next(m for m in document['materials'] if m['id']==document['sections'][0]['medium']['material'])
    records=[]
    for rated in payload['circuit_ratings']+([payload['simultaneous_rating']] if payload.get('simultaneous_rating') else []):
        if rated['ampacity_a'] is None:continue
        state=min(rated['cable_states'],key=lambda row:row['margin_k'])
        c=next(c for c in group.cables if c['id']==state['entity'])
        three_core=bool(group.soil.get('three_core'))
        # Annex A, Table A.1: T4 belongs to the hottest cable in the loaded
        # parallel group, not its isolated self resistance. Preserve mutual heat.
        t4=state['t4_self_soil_k_m_w'] if three_core else state['external_temperature_rise_k']/state['total_loss_w_m']
        alpha=c['model']['alpha'] if three_core else c['rating'].conductor.alpha20_per_k
        result=derate(current_a=rated['ampacity_a'],resistance_ohm_m=state['ac_resistance_ohm_m'],alpha20_per_k=alpha,
            area_m2=conductor['nominal_area'],conductor_rho_k_m_w=rho,cores=3 if three_core else 1,t1=state['t1_k_m_w'],t2=state.get('t2_k_m_w',0),
            t3=state['t3_k_m_w'],t4=t4,lambda1=state['lambda1'],lambda2=state.get('lambda2',0),
            dielectric_w_m=state['dielectric_loss_per_core_w_m'] if three_core else state['dielectric_loss_w_m'],limit_c=state['temperature_limit_c'],ambient_c=group.ambient,
            depth_m=-c['point'][1],soil_rho_k_m_w=medium['thermal_resistivity'],sources=sources)
        for source in result['sources']:source['net_clearance_m']=abs(-c['point'][1]-source['depth_m'])-(c['geometry'].overall_m+source['diameter_m'])/2
        result['rated_cable']=c['id']
        result['t4_group_effective_k_m_w']=t4
        if not three_core:result['scope']+=' 单芯非接触平行组采用附录 A 最热电缆及含相间互热的等效外部热阻；同回路等负荷降额。'
        result['entity']=rated.get('entity',group.circuits[0]['id']);records.append(result)
        rated['baseline_ampacity_a']=rated['ampacity_a'];rated['ampacity_a']=result['derated_current_a']
    payload['crossing_derating']=records
    payload['baseline_evidence']={'operating':payload['operating'],'verification':payload['verification'],'heat_contributions':payload['heat_contributions']}
    payload['heat_contributions']=[]
    payload['rating_components']=None
    payload['verification']={**payload['verification'],'basis':'降额前平行截面独立核验；交叉降额的纵向积分与迭代记录见 crossing_derating。'}
    payload['sources'].append(CLAUSE)
    payload['operating']={'cable_states':[],'iterations':0,'residual_k':None,'error':{'code':'CROSSING_RATING_ONLY','message':'交叉降额输出温限下的允许电流；本分支未求给定电流的三维温度，不以原平行截面温度代替。'}}
    return payload
