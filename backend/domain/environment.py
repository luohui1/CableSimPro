"""SI geometry for ground regions; these facts do not imply solver support."""
from pydantic import Field, model_validator

from ..schemas import StrictModel


class Backfill(StrictModel):
    id: str = Field(pattern=r'^region/[A-Za-z0-9_-]+$')
    label: str = '回填区'
    material: str
    x: float
    z: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)

    @model_validator(mode='after')
    def below_surface(self):
        if self.z + self.height / 2 > 1e-12:
            raise ValueError('回填区不得超出地表')
        return self


class SoilLayer(StrictModel):
    id: str = Field(pattern=r'^region/[A-Za-z0-9_-]+$')
    label: str
    material: str
    top_z: float = Field(le=0)
    bottom_z: float

    @model_validator(mode='after')
    def ordered(self):
        if self.bottom_z >= self.top_z:
            raise ValueError('土壤层底界必须低于顶界')
        return self
