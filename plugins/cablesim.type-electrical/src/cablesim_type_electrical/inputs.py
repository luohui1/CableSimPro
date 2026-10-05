"""SI parameter contracts shared by installed forms and the plugin admission path."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

NUMBER_SPECS = {
    'temperature_k': (223.15, 473.15, '工作温度', 'K'),
    'frequency_hz': (1, 100, '频率', 'Hz'),
    'phase_voltage_v': (1, 500000, '运行相电压', 'V'),
    'ks': (0, 2, '集肤系数 kₛ', '1'),
    'kp': (0, 2, '邻近系数 kₚ', '1'),
    'spacing_m': (.0001, 10, '导体中心距', 'm'),
    'core_lay_factor': (1, 1.5, '成缆绞入系数', '1'),
    'duration_s': (.001, 100, '持续时间', 's'),
    'initial_temperature_k': (223.15, 773.15, '导体初始温度', 'K'),
    'final_temperature_k': (223.15, 773.15, '导体最终温度', 'K'),
    'metal_initial_temperature_k': (223.15, 773.15, '金属组件初始温度', 'K'),
    'metal_final_temperature_k': (223.15, 773.15, '金属组件最终温度', 'K'),
    'contact_factor': (.01, 1, '金属接触因数', '1'),
    'inner_thermal_resistivity': (.01, 100, '内侧介质热阻率', 'K·m/W'),
    'outer_thermal_resistivity': (.01, 100, '外侧介质热阻率', 'K·m/W'),
    'inner_volumetric_heat_capacity': (10000, 1e8, '内侧介质体积热容', 'J/(m³·K)'),
    'outer_volumetric_heat_capacity': (10000, 1e8, '外侧介质体积热容', 'J/(m³·K)'),
}


def quantity(key):
    lower, upper, title, unit = NUMBER_SPECS[key]
    return Field(default=None, ge=lower, le=upper, title=title,
                 description=f'{title}，保存单位 {unit}；填写时须提供对应 sources 出处，缺少来源不产生该项数值。',
                 json_schema_extra={'x-unit': unit, 'x-source-required': True})


class TypeParameters(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, allow_inf_nan=False)
    cable_type_id: str = Field(min_length=1, title='电缆结构', description='当前型号中的精确电缆结构标识。')
    circuit_id: str | None = Field(default=None, min_length=1, title='接地拓扑回路', description='必须引用当前型号的实际回路；不由名称推测拓扑。')
    sources: dict[str, str] = Field(default_factory=dict, title='参数出处', description='参数名到标准条款、报告或明确设计条件的出处映射；不是自动生成的实测证明。')


class ElectricalParameters(TypeParameters):
    temperature_k: float | None = quantity('temperature_k')
    frequency_hz: float | None = quantity('frequency_hz')
    phase_voltage_v: float | None = quantity('phase_voltage_v')
    ks: float | None = quantity('ks')
    kp: float | None = quantity('kp')
    spacing_m: float | None = quantity('spacing_m')
    core_lay_factor: float | None = quantity('core_lay_factor')
    r20_length_basis: Literal['finished_cable', 'straight_core'] | None = Field(default=None, title='R₂₀ 长度基准', description='每米成品电缆或每米直线线芯；未声明时不进行长度换算。')
    arrangement: Literal['trefoil', 'flat'] | None = Field(default=None, title='单芯相间排列', description='等距品字形或水平排列；完整金属回路阻抗仍由插件明确范围拒绝。')


class ShortCircuitParameters(TypeParameters):
    duration_s: float | None = quantity('duration_s')
    initial_temperature_k: float | None = quantity('initial_temperature_k')
    final_temperature_k: float | None = quantity('final_temperature_k')
    metal_initial_temperature_k: float | None = quantity('metal_initial_temperature_k')
    metal_final_temperature_k: float | None = quantity('metal_final_temperature_k')
    contact_factor: float | None = quantity('contact_factor')
    inner_thermal_resistivity: float | None = quantity('inner_thermal_resistivity')
    outer_thermal_resistivity: float | None = quantity('outer_thermal_resistivity')
    inner_volumetric_heat_capacity: float | None = quantity('inner_volumetric_heat_capacity')
    outer_volumetric_heat_capacity: float | None = quantity('outer_volumetric_heat_capacity')
    wire_contact: Literal['fully_embedded', 'air_spaces', 'touching'] | None = Field(default=None, title='铜丝接触条件', description='只有已声明且适用的嵌入/间隔条件可以产生非绝热结果。')
    interest_times_s: list[Annotated[float, Field(ge=.1, le=5)]] = Field(default_factory=list, max_length=20, title='关注时间点', description='0.1–5 s，最多 20 点；曲线电流由插件计算，前端不外推。', json_schema_extra={'x-unit': 's'})

    @model_validator(mode='after')
    def temperatures(self):
        for first, final in (('initial_temperature_k', 'final_temperature_k'), ('metal_initial_temperature_k', 'metal_final_temperature_k')):
            initial, ending = getattr(self, first), getattr(self, final)
            if initial is not None and ending is not None and ending <= initial:
                raise ValueError(f'parameters.{final}：最终温度必须高于初始温度，单位 K。')
        return self
