"""Verified IEC 60853-2 emergency equation, using a supplied rated response.

Only §8.1 / AMD1:2008 Annex F.6.2 is admitted. Cable thermal-network reduction,
group §8.2 and cyclic-rating clauses require the base text and are not inferred.
"""
from math import sqrt
from typing import Literal
from pydantic import Field,model_validator
from cablesim_sdk.base import StrictModel
from cablesim_sdk.validation import FieldValueError


class ResponsePoint(StrictModel):
    time_s: float = Field(gt=0)
    rise_k: float = Field(gt=0)


class Emergency(StrictModel):
    schema_version: Literal['cablesim.iec60853-emergency/1']
    circuit_id: str = Field(min_length=1)
    scope: Literal['thermally_isolated_circuit']
    reference_current_a: float = Field(gt=0)
    initial_current_a: float = Field(ge=0)
    initial_to_reference_resistance_ratio: float = Field(gt=0,le=1)
    steady_joule_rise_k: float = Field(gt=0)
    rated_response: list[ResponsePoint] = Field(min_length=1,max_length=10000)
    overload_current_a: float | None = Field(default=None,gt=0)
    response_source: str = Field(min_length=1)
    source: str = Field(min_length=1)

    @model_validator(mode='after')
    def applicable(self):
        ratio = (self.initial_current_a/self.reference_current_a)**2*self.initial_to_reference_resistance_ratio
        if ratio>=1:
            raise FieldValueError('初始稳态须低于参考温限；请核对初始电流与电阻比。','initial_current_a')
        if any(a.time_s>=b.time_s or a.rise_k>b.rise_k for a,b in zip(self.rated_response,self.rated_response[1:])):
            raise FieldValueError('阶跃响应时间须严格递增、温升不得下降。','rated_response')
        if any(p.rise_k>self.steady_joule_rise_k for p in self.rated_response):
            raise FieldValueError('参考阶跃温升不得超过同一口径的稳态焦耳温升。','rated_response')
        return self


def corrected_rise(rise_k,steady_rise_k,alpha_initial_per_k):
    """AMD1:2008 §8.3 Eq.(8-3); not a second correction of Eq.(8-1)."""
    from math import isfinite
    if not all(isfinite(v) for v in (rise_k,steady_rise_k,alpha_initial_per_k)) or not 0<=rise_k<=steady_rise_k or alpha_initial_per_k<0:
        raise ValueError('温升须位于0与稳态值之间，温度系数须为非负有限值。')
    return rise_k/(1+alpha_initial_per_k*(steady_rise_k-rise_k))


def calculate(value):
    p = Emergency.model_validate(value)
    initial = (p.initial_current_a/p.reference_current_a)**2*p.initial_to_reference_resistance_ratio
    rows = [{'time_s':r.time_s,'rated_rise_k':r.rise_k,'permissible_current_a':p.reference_current_a*sqrt(
        initial+(1-initial)/(r.rise_k/p.steady_joule_rise_k))} for r in p.rated_response]
    duration = None
    if p.overload_current_a is not None:
        factor = (p.overload_current_a/p.reference_current_a)**2
        if factor<=1:
            duration = {'status':'within_reference_continuous_rating','safe_duration_s':None,'bracket_s':None}
        else:
            threshold = p.steady_joule_rise_k*(1-initial)/(factor-initial)
            previous_time,previous_rise = 0.,0.
            duration = {'status':'not_reached_in_supplied_response','safe_duration_s':None,'bracket_s':None,
                        'observed_duration_s':p.rated_response[-1].time_s}
            for row in p.rated_response:
                if row.rise_k>=threshold:
                    estimated = previous_time+(row.time_s-previous_time)*(threshold-previous_rise)/(row.rise_k-previous_rise)
                    duration = {'status':'bracketed_by_supplied_response','safe_duration_s':previous_time,
                        'estimated_time_s':estimated,'bracket_s':[previous_time,row.time_s]}
                    break
                previous_time,previous_rise = row.time_s,row.rise_k
    return {'schema':'cablesim.iec60853-emergency-result/1','input':p.model_dump(mode='json'),
        'current_curve':rows,'duration':duration,
        'clauses':['IEC 60853-2:1989 §8.1 Eq.(8-1); AMD1:2008 Annex F.6.2 (printed p.9)',
                   'AMD1:2008 printed p.7: no additional Eq.(8-3) correction to the Eq.(8-1) result'],
        'scope':'thermally_isolated_circuit_with_supplied_rated_response',
        'not_covered':['Cable/duct two-loop parameter derivation','Grouped-circuit §8.2','Cyclic-current rating'],
        'limitations':['参考响应和稳态焦耳温升必须来自同一已核对的标准热路；不从缺失的标准正文推导参数。',
            '允许时长只给输入时间点的安全下界与括区；线性插值是估计，不当作已验证精确持续时间。'],
        'engineering_approval':False}
