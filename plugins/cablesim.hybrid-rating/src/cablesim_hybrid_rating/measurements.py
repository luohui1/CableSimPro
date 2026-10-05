"""Physical measurement import contract; project-book screening is a reference."""
from typing import Literal
from pydantic import Field,model_validator
from cablesim_sdk.base import StrictModel


class MeasurementSource(StrictModel):
    title: str=Field(min_length=1,max_length=300)
    url: str=Field(min_length=1,max_length=1000)
    version: str=Field(min_length=1,max_length=100)
    filename: str=Field(min_length=1,max_length=200)
    raw_file_sha256: str=Field(pattern=r'^[0-9a-f]{64}$')
    license: str=Field(min_length=1,max_length=200)
    sheet: str=Field(min_length=1,max_length=100)
    columns: dict[str,str]=Field(min_length=3)


class Point(StrictModel):
    time_s: float=Field(ge=0)
    current_a: float | None=Field(default=None,ge=0)
    temperature_k: float | None=Field(default=None,gt=0,le=1500)
    ambient_temperature_k: float | None=Field(default=None,gt=0,le=1500)
    source_row: int=Field(ge=1,strict=True)


class Series(StrictModel):
    id: str=Field(min_length=1,max_length=120)
    label: str=Field(min_length=1,max_length=120)
    source: MeasurementSource
    sensor: Literal['conductor','sheath','pipe','ambient']
    comparison_statistic: Literal['measured_sensor','maximum_in_rated_circuit']='measured_sensor'
    construction: dict
    domain_input: dict | None=None
    points: list[Point]=Field(min_length=2,max_length=50000)

    @model_validator(mode='after')
    def ordered(self):
        if any(a.time_s>=b.time_s for a,b in zip(self.points,self.points[1:])):
            raise ValueError('points.time_s：时间必须严格递增；请保留原始行号并修正重复/逆序时间。')
        return self


class ScreeningReference(StrictModel):
    basis: Literal['reference_project_book']='reference_project_book'
    minimum_duration_s: float=Field(default=7200.,gt=0)
    maximum_current_variation_fraction: float=Field(default=.05,gt=0,lt=1)
    maximum_temperature_trend_k_h: float=Field(default=1.,gt=0)
    note: str='参考筛选规则，不是产品验收指标；筛选方法及剔除原因须随验证记录保存。'


class Measurements(StrictModel):
    schema_version: Literal['cablesim.field-measurements/1']
    units: dict[str,str]
    time_origin: str=Field(min_length=1,max_length=200)
    screening_reference: ScreeningReference=Field(default_factory=ScreeningReference)
    series: list[Series]=Field(min_length=1,max_length=32)

    @model_validator(mode='after')
    def units_and_ids(self):
        if self.units!={'time':'s','current':'A','temperature':'K'}:
            raise ValueError('units：导入契约须为 time=s、current=A、temperature=K；原始°C/d在导入映射中显式转换。')
        if len({s.id for s in self.series})!=len(self.series):
            raise ValueError('series.id：实测通道标识不能重复。')
        if sum(len(s.points) for s in self.series)>100000:
            raise ValueError('series.points：一次导入最多100000条原始测点，请分文件导入。')
        return self
