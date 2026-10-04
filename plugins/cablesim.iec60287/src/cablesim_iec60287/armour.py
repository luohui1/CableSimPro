"""IEC 1-1:2023 §5.4.1, §5.4.3.3.1 and §5.4.3.5, bounded SL thermal input.

All lengths are m, temperatures K, resistance Ω/m and thermal resistance K m/W.
Supplied Rc, Rs and lambda1 are explicitly bound to the declared rating point.
"""
from math import pi, sqrt, isfinite
from typing import Literal
from pydantic import BaseModel,ConfigDict,Field,model_validator


class ArmouredRating(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False,frozen=True)
    schema_version: Literal['cablesim.iec60287.armoured-sl/1']='cablesim.iec60287.armoured-sl/1'
    armour_kind: Literal['magnetic_steel_wire','nonmagnetic_parallel']
    frequency_hz: float=Field(gt=0,le=100)
    conductor_temperature_k: float=Field(gt=273.15,le=473.15)
    ambient_temperature_k: float=Field(gt=0,le=373.15)
    conductor_ac_resistance_ohm_m: float=Field(gt=0,le=.01)
    sheath_resistance_ohm_m: float=Field(gt=0,le=.1)
    lambda1: float=Field(ge=0)
    lambda1_circulating: float=Field(ge=0)
    dielectric_loss_per_core_w_m: float=Field(ge=0)
    armour_r20_ohm_m: float=Field(gt=0,le=.1)
    armour_alpha20_per_k: float=Field(gt=0,lt=.01)
    armour_mean_diameter_m: float=Field(gt=0,le=1)
    core_axis_radius_m: float=Field(gt=0,le=.5)
    t1_k_m_w: float=Field(gt=0)
    t2_k_m_w: float=Field(gt=0)
    t3_k_m_w: float=Field(gt=0)
    t4_k_m_w: float=Field(gt=0)
    source_reference: str=Field(min_length=1,max_length=1000)
    maximum_iterations: int=Field(default=200,ge=10,le=1000)
    temperature_tolerance_k: float=Field(default=1e-8,gt=0,le=.001)

    @model_validator(mode='after')
    def thermal_scope(self):
        if not self.source_reference.strip():raise ValueError('填写各热阻、电阻、损耗在同一工作点的来源及条款。')
        if self.ambient_temperature_k>=self.conductor_temperature_k:raise ValueError('导体温限须高于环境温度。')
        if 2*self.core_axis_radius_m>=self.armour_mean_diameter_m:raise ValueError('铠装平均直径必须包围三芯轴线，核对m单位。')
        if self.lambda1_circulating>self.lambda1:raise ValueError('护套环流分量不能超过护套总损耗。')
        return self


def nonmagnetic_equivalent(sheath_r,armour_r,sheath_mean_m,armour_mean_m):
    """§5.4.2 parallel resistance and RMS diameter; no unvalidated loss partition."""
    if not all(isfinite(x) and x>0 for x in (sheath_r,armour_r,sheath_mean_m,armour_mean_m)):
        raise ValueError('非磁性护套/铠装电阻与直径须为正有限SI数值。')
    return sheath_r*armour_r/(sheath_r+armour_r),sqrt((sheath_mean_m**2+armour_mean_m**2)/2)


def armoured_rating(r:ArmouredRating):
    if r.armour_kind!='magnetic_steel_wire':
        raise ValueError('非磁性铠装须按§5.4.2与护套合并、重新计算λ1；当前独立SL热路缺该验证，拒算，不能套用钢丝公式。')
    rc,rs=r.conductor_ac_resistance_ohm_m,r.sheath_resistance_ohm_m
    shielding=1-rc/rs*r.lambda1_circulating
    if shielding<=0:raise ValueError('§5.4.3.5屏蔽修正非正；检查护套电阻与环流损耗来源。')
    wd=r.dielectric_loss_per_core_w_m;head=r.conductor_temperature_k-r.ambient_temperature_k
    numerator=head-wd*(.5*r.t1_k_m_w+3*(r.t2_k_m_w+r.t3_k_m_w+r.t4_k_m_w))
    if numerator<=0:raise ValueError('介质损耗已耗尽温升余量，无正允许电流。')
    theta=r.ambient_temperature_k;history=[]
    for iteration in range(r.maximum_iterations):
        ra=r.armour_r20_ohm_m*(1+r.armour_alpha20_per_k*(theta-293.15))
        if ra<=0:raise ValueError('铠装工作电阻非正。')
        lambda2=1.23*ra/rc*(2*r.core_axis_radius_m/r.armour_mean_diameter_m)**2/(1+(2.77*ra*1e6/(2*pi*r.frequency_hz))**2)*shielding
        denominator=rc*r.t1_k_m_w+3*rc*(1+r.lambda1)*r.t2_k_m_w+3*rc*(1+r.lambda1+lambda2)*(r.t3_k_m_w+r.t4_k_m_w)
        current=sqrt(numerator/denominator)
        updated=r.conductor_temperature_k-((current**2*rc+.5*wd)*r.t1_k_m_w+(current**2*rc*(1+r.lambda1)+wd)*3*r.t2_k_m_w)
        history.append({'iteration':iteration+1,'armour_temperature_k':updated,'armour_resistance_ohm_m':ra,'lambda2':lambda2,'ampacity_a':current})
        if abs(updated-theta)<r.temperature_tolerance_k:
            return {'schema':'cablesim.iec60287.armoured-sl-trace/1','ampacity_a':current,'lambda1':r.lambda1,'lambda2':lambda2,
                    'armour_temperature_k':updated,'armour_resistance_ohm_m':ra,'shielding_factor':shielding,
                    'armour_loss_w_m':3*rc*current**2*lambda2,'history':history,'input':r.model_dump(mode='json'),
                    'clauses':['IEC 60287-1-1:2023 §5.4.1','§5.4.3.3.1','§5.4.3.5','§4.1.1'],
                    'limitations':['仅三芯圆导体钢丝铠装SL热路；热阻、Rc、Rs和λ1须为同一温限工作点。',
                                   '不推导缺失材料/结构，不覆盖两芯、钢带、单芯磁性及非磁性热路；不替代完整领域映射。']}
        theta=.5*(theta+updated)
    raise ValueError('铠装温度迭代未收敛，请核对工作点与热阻。')
