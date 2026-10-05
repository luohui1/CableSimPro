"""Explicit engineering inputs; examples are references, never factory defaults."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator, ValidationError
from cablesim_sdk.validation import FieldValueError


class Given(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    value: float | Literal['continuous_contact','given_r20','stranded_round','stranded_round_compacted']
    unit: Literal['m','ohm/m','K*m/W','1']
    reference: str = Field(min_length=1,max_length=2000)

    @model_validator(mode='before')
    @classmethod
    def explicit(cls,value):
        if isinstance(value,dict) and isinstance(value.get('value'),bool):
            raise FieldValueError('数值不能为布尔值','value')
        if isinstance(value,dict) and isinstance(value.get('value'),str) and value['value'] not in ('continuous_contact','given_r20','stranded_round','stranded_round_compacted'):
            raise FieldValueError('value：填写SI数值，不能使用数值字符串','value')
        return value

    @model_validator(mode='after')
    def source(self):
        if not self.reference.strip():raise FieldValueError('请填写工程参数出处','reference')
        return self


FORM_FIELDS=[
    {'key':'conductor_form','title':'导体构造模型','unit':'1','choices':[['stranded_round_compacted','圆绞紧压'],['stranded_round','圆绞']],
     'example':'stranded_round_compacted','reference':'工程师给定圆绞紧压构造模型；厂家表列示导体外径与单丝尺寸，GB/T3956第2种导体为类别依据，不作为厂家紧压工艺认证。',
     'hint':'与厂家实际圆形导体构造核对；不覆盖扇形或分割导体。'},
    {'key':'core_lay_length','title':'成缆节距','unit':'m','min':0,'max':100,'scale':1,'example':2.152,
     'reference':'工程师给定参考输入：采用 CIGRE TB 880:2022 Case 2 的成缆节距 2.152 m；PDF174–178页；非本型号厂家实测节距。',
     'hint':'须大于0；TB880 Case 2 示例为2.152 m，不能作为所有型号的厂家值。'},
    {'key':'screen_model','title':'铜带纵向电阻模型','unit':'1','choices':[['continuous_contact','连续接触等效'],['given_r20','给定纵向 R20']],
     'example':'continuous_contact','reference':'工程师给定：铜带搭盖处按连续导电接触的等效轴向模型计算；不是厂家接触电阻声明。',
     'hint':'连续接触等效依赖给定接触条件；有厂家或试验 R20 时采用给定值。'},
    {'key':'screen_radial_factor','title':'铜带径向包络 / 单带厚度','unit':'1','min':1,'max':2,'scale':1,'example':2,
     'reference':'工程师给定径向模型：搭盖处按两倍单带厚度包络；GB/T12706.2-2020 附录A的绕包屏蔽尺寸规定作为结构参考，非实测平均厚度。',
     'hint':'1–2；搭盖处可采用2倍包络，实际径向构造应由工程师核对。'},
    {'key':'screen_longitudinal_r20','title':'铜带纵向 R20','unit':'ohm/m','min':0,'max':1,'scale':.001,'optional':True,
     'hint':'界面单位Ω/km；采用给定电阻模型时必填，需注明厂家数据或试验出处。'},
    {'key':'filler_rho','title':'填充与包带热阻率','unit':'K*m/W','min':0,'max':100,'scale':1,'example':6,
     'reference':'工程师给定填充与包带材料模型：采用 IEC60287-2-1:2023 表1 纤维类材料参考值6 K·m/W，PDF41页/印刷39页；不是厂家配方实测。',
     'hint':'需大于0；表1纤维材料参考6 K·m/W，实际配方优先。'},
    {'key':'armour_gap_ratio','title':'钢带间隙 / 带宽','unit':'1','min':0,'max':.5,'scale':1,'example':.5,'optional':True,'armoured_only':True,
     'reference':'工程师给定：本问询采用间隙率0.5；GB/T12706.2-2020 13.7规定不大于50%，上限不代表厂家实际间隙。',
     'hint':'0–0.5，GB/T12706.2-2020 13.7；实际制造间隙优先。'},
    {'key':'steel_relative_permeability','title':'钢带相对磁导率','unit':'1','min':1,'max':2000,'scale':1,'example':300,'optional':True,'armoured_only':True,
     'reference':'工程师给定钢带材料模型：采用 CIGRE TB880:2022 Case 10 的相对磁导率300作为参考，PDF319–320页；非本型号钢带材料实测。',
     'hint':'须大于1；TB880 Case 10 示例300，不能据此保证任意钢材。'},
    {'key':'diameter_rounding','title':'厂家参考外径列示精度','unit':'m','min':0,'max':.001,'scale':.001,'example':.00005,
     'reference':'工程师给定：江苏华远公开外径表按0.1 mm列示，半个末位为0.05 mm；闭合门禁另加 max(0.5 mm,外径1%) 工程制造余量，不作为标准制造验收限值。',
     'hint':'界面单位mm；填写厂家外径列示精度的半个单位，另计 max(0.5 mm,外径1%) 工程闭合余量。'},
]


class EngineeringParameters(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
    values: dict[str,Given]

    @model_validator(mode='after')
    def fields(self):
        allowed={f['key']:f for f in FORM_FIELDS}
        if set(self.values)-set(allowed):raise FieldValueError('工程参数包含未声明字段','values',sorted(set(self.values)-set(allowed))[0])
        missing=[f for f in FORM_FIELDS if not f.get('optional') and f['key'] not in self.values]
        if missing:
            raise ValidationError.from_exception_data(type(self).__name__,[{'type':'value_error','loc':('values',f['key']),'input':None,'ctx':{'error':ValueError(f['title']+' / '+f['unit']+'，'+f['hint'])}} for f in missing])
        for key,field in allowed.items():
            item=self.values.get(key)
            if item is None:continue
            if item.unit!=field['unit']:raise FieldValueError(key+'：SI单位须为 '+field['unit'],'values',key,'unit')
            if 'choices' in field:
                if item.value not in {v[0] for v in field['choices']}:raise FieldValueError(key+'：请选择明确电阻模型','values',key,'value')
            elif not isinstance(item.value,(int,float)) or not field['min']<=item.value<=field['max'] or (field['min']==0 and key not in ('armour_gap_ratio','diameter_rounding') and item.value==0):
                raise FieldValueError(key+'：'+field['hint'],'values',key,'value')
        if self.values['screen_model'].value=='given_r20' and 'screen_longitudinal_r20' not in self.values:
            raise FieldValueError('screen_longitudinal_r20：给定电阻模型须填写纵向R20及来源','values','screen_longitudinal_r20')
        if 'steel_relative_permeability' in self.values and self.values['steel_relative_permeability'].value<=1:raise FieldValueError('steel_relative_permeability：磁性钢带须大于1','values','steel_relative_permeability','value')
        return self
