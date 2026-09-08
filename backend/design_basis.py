"""Versioned design references and scope checks, not a claim of standards compliance.
Only bibliographic/scope metadata is supplied. No licensed standard tables are reproduced.
"""
from typing import Literal
from pydantic import Field, model_validator
from .schemas import StrictModel, Scenario

VERIFIED_DATE = '2026-09-08'
STANDARDS = [
    {'id':'iec60287-1-1','designation':'IEC 60287-1-1:2023','title':'稳态载流量方程与损耗','category':'计算方法',
     'url':'https://webstore.iec.ch/en/publication/68118','implementation':'partial_reference',
     'scope':'稳态电缆载流量；本程序仅实现范围受限的热网络，交流附加及屏蔽损耗系数需输入。'},
    {'id':'iec60287-2-1','designation':'IEC 60287-2-1:2023','title':'电缆热阻计算','category':'计算方法',
     'url':'https://webstore.iec.ch/en/publication/68134','implementation':'partial_reference',
     'scope':'标准包含多种敷设条件；本程序不能据此自动支持排管、土壤干燥或成组敷设。'},
    {'id':'iec60502-2','designation':'IEC 60502-2:2014+AMD1:2024 / COR1:2026','title':'6～30 kV 挤包绝缘电力电缆','category':'产品标准',
     'url':'https://webstore.iec.ch/en/publication/95394','implementation':'scope_only',
     'scope':'额定电压 U 为 6～30 kV；记录 2026-07 勘误。结构、尺寸、公差及试验条款尚未编码。','min_u':6,'max_u':30},
    {'id':'iec60228','designation':'IEC 60228:2023','title':'绝缘电缆的导体','category':'导体标准',
     'url':'https://webstore.iec.ch/en/publication/71891','implementation':'reference_only',
     'scope':'导体标称截面积、结构及电阻要求；未载入对应导体类别的最大直流电阻限值表。'},
    {'id':'gb12706-2','designation':'GB/T 12706.2—2020','title':'6～30 kV 挤包绝缘电力电缆','category':'产品标准',
     'url':'https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=FF02D64568B22C7D9BF3462B27B2CB8E','implementation':'scope_only',
     'scope':'官方平台显示现行；20257010-T-604 为修订计划，不能当作已发布替代标准。尺寸与试验条款尚未编码。','min_u':6,'max_u':30},
    {'id':'gb3956','designation':'GB/T 3956—2008','title':'电缆的导体','category':'导体标准',
     'url':'https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=149B3068D059EFD9BCFB8A8AF57E5B1C','implementation':'reference_only',
     'scope':'官方平台显示现行；与 IEC 60228:2023 不视作同一版本。限值表尚未编码。'},
    {'id':'iec60364-5-52','designation':'IEC 60364-5-52:2009+AMD1:2024','title':'低压装置布线系统','category':'敷设与设计',
     'url':'https://webstore.iec.ch/en/publication/103734','implementation':'unsupported',
     'scope':'低压布线系统要求，不能替代本中压项目的电缆载流量算法。'},
    {'id':'iec60853-2','designation':'IEC 60853-2:1989+AMD1:2008','title':'循环与应急载流量','category':'暂态计算',
     'url':'https://webstore.iec.ch/en/publication/3710','implementation':'unsupported',
     'scope':'循环及应急负荷计算；当前只有稳态内核，未实现本标准的暂态方法。'},
]
BY_ID = {s['id']:s for s in STANDARDS}

class DesignBasis(StrictModel):
    reference_ids: list[str] = Field(default_factory=list, max_length=12)
    rated_voltage_kv: float = Field(default=20, gt=0, le=110)
    highest_voltage_kv: float = Field(default=24, gt=0, le=126)
    environment: Literal['buried','vertical_air','duct','shaft_bundle'] = 'buried'
    note: str = Field(default='', max_length=1000)

    @model_validator(mode='after')
    def known(self):
        if len(set(self.reference_ids)) != len(self.reference_ids):
            raise ValueError('设计依据不能重复。')
        if set(self.reference_ids) - BY_ID.keys():
            raise ValueError('存在未登记的标准标识。')
        if self.highest_voltage_kv < self.rated_voltage_kv:
            raise ValueError('设备最高电压 Um 不能低于额定电压 U。')
        return self


def inspect_basis(scenario: Scenario, basis: DesignBasis) -> dict:
    findings = []
    def add(code, level, message, source=None):
        findings.append({'code':code,'level':level,'message':message,'standard_id':source})
    if scenario.cable.u0_kv > basis.rated_voltage_kv:
        add('VOLTAGE_ORDER','error','输入应满足 U₀ ≤ U ≤ Um；当前相对地额定电压高于额定电压 U。')
    if basis.environment in ('duct','shaft_bundle'):
        add('ENVIRONMENT_UNSUPPORTED','error','当前尚未实现排管或竖井成束散热模型，不能套用直埋或单根空气模型。')
    for key in basis.reference_ids:
        standard = BY_ID[key]
        if standard.get('min_u') is not None and not standard['min_u'] <= basis.rated_voltage_kv <= standard['max_u']:
            add('PRODUCT_VOLTAGE_SCOPE','error',standard['designation']+' 的额定电压范围不覆盖当前 U。',key)
        if standard['implementation']=='unsupported':
            add('METHOD_UNIMPLEMENTED','error',standard['scope'],key)
        else:
            add('CLAUSES_NOT_VERIFIED','warning',standard['designation']+' 仅作为设计参考，未完成全部条款实现及独立标准算例校核。',key)
    if scenario.cable.r20_ohm_km is None:
        add('RESISTANCE_ESTIMATED','warning','未提供厂家 R20；当前按材料电阻率与面积估算，不代表标准规定的最大电阻。')
    add('LOSS_FACTORS_ASSUMED','warning','交流附加与屏蔽损耗系数为显式输入；未自动计算接地回路及集肤邻近损耗。')
    if basis.environment=='vertical_air':
        add('AIR_BOUNDARY_REQUIRED','warning','单根隔离空气模型需要另行提供 h、辐射率及沿高空气温度；不包含井道气流。')
    return {'basis':basis.model_dump(),'findings':findings,'can_record':not any(f['level']=='error' for f in findings),
            'compliance':'not_assessed','metadata_verified_on':VERIFIED_DATE,
            'statement':'适用范围检查通过不等于符合标准。选择依据不会自动更换物性、环境值或求解公式。'}


def require_basis(state: dict, domain: str):
    """Explicitly selected environmental domain cannot silently dispatch another solver."""
    if not state.get('design_basis'):
        return
    from fastapi import HTTPException
    basis = DesignBasis.model_validate(state['design_basis'])
    check = inspect_basis(Scenario.model_validate(state['scenario']), basis)
    errors = [f['message'] for f in check['findings'] if f['level']=='error']
    if basis.environment != domain:
        errors.append('当前设计依据的敷设环境与所请求的计算不一致；请先审查并修改设计依据。')
    if errors:
        raise HTTPException(422,'；'.join(errors))
