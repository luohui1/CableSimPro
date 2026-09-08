"""Parametric single-core cable generation with explicit electrical-data provenance."""
from math import pi
from pydantic import Field
from fastapi import HTTPException
from .schemas import StrictModel, Cable, Scenario
from .agent import Change, patch

class ModelSpecification(StrictModel):
    cable: Cable
    acknowledge_retained_r20: bool = False


def model_proposal(store, wid: str, revision: int, spec: ModelSpecification):
    with store.db() as db:
        _, state = store.load(db, wid, revision)
    old = Scenario.model_validate(state['scenario'])
    changed_conductor = (old.cable.area_mm2 != spec.cable.area_mm2 or old.cable.conductor != spec.cable.conductor)
    if changed_conductor and old.cable.r20_ohm_km is not None and spec.cable.r20_ohm_km == old.cable.r20_ohm_km and not spec.acknowledge_retained_r20:
        raise HTTPException(422,'导体改变后仍保留原厂家 R20。请重新提供电阻、清空改用估算，或明确确认该电阻适用于新型号。')
    changes = [Change(path='cable.'+k,value=v) for k,v in spec.cable.model_dump().items() if old.cable.model_dump()[k] != v]
    candidate, diff = patch(old,changes)
    radii = spec.cable.radii_mm()
    names = ['导体','导体屏蔽','绝缘','绝缘屏蔽','金属屏蔽等效层','外护套']
    layers = []
    for i,r in enumerate(radii):
        ri = radii[i-1] if i else 0
        layers.append({'name':names[i],'inner_radius_mm':ri,'outer_radius_mm':r,'thickness_mm':r-ri,
                       'geometric_area_mm2':pi*(r*r-ri*ri)})
    return store.stage(wid,revision,{'ready':True,'action':'import','scenario':candidate.model_dump(),
        'changes':diff,'mode':'parametric-model','message':'生成单芯电缆模型','questions':[],
        'assumptions':['尺寸由输入逐层累加，未按照电压等级自动推断绝缘厚度。',
                       '未编辑的材料和损耗参数沿用当前工程；几何层面积不等于绞合导体有效面积。',
                       '三维导体为圆形等效实体；金属屏蔽用等效连续层表示，不是制造图。'],
        'geometry':{'diameter_mm':2*radii[-1],'layers':layers},'events':[]})
