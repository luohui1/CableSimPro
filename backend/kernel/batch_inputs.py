"""Deterministic parameter spaces over an immutable saved-study case; no physics."""
from copy import deepcopy
from itertools import product
from math import isfinite, prod
import random
from typing import Literal

from pydantic import Field, model_validator
from ..schemas import StrictModel
from .drivers import replace_number

UNITS = ('m', 'm^2', 'K', 'A', 'V', 'Hz', 'K*m/W', 'W/(m*K)', 'W/m', '1', 's', 'ohm/m')


class Binding(StrictModel):
    pointer: str = Field(pattern=r'^/(input|parameters)/', max_length=500)
    target_unit: Literal[*UNITS]
    scale: float = 1.
    offset: float = 0.
    reciprocal: bool = Field(default=False, strict=True)
    mode: Literal['set', 'add', 'multiply'] = 'set'


class Choice(StrictModel):
    label: str = Field(min_length=1, max_length=80)
    changes: dict[str, float] = Field(min_length=1, max_length=512)
    mode: Literal['set','add']='set'


class Axis(StrictModel):
    name: str = Field(pattern=r'^[a-z][a-z0-9_]{0,63}$')
    label: str = Field(min_length=1, max_length=80)
    unit: Literal[*UNITS]
    minimum: float | None = None
    maximum: float | None = None
    levels: int = Field(default=2, ge=1, le=10000, strict=True)
    bindings: list[Binding] = Field(default_factory=list, max_length=512)
    choices: list[Choice] = Field(default_factory=list, max_length=100)
    source: str = Field(min_length=1, max_length=1000)

    @model_validator(mode='after')
    def complete(self):
        if self.choices:
            if self.minimum is not None or self.maximum is not None or self.bindings:
                raise ValueError('离散排列只接受 choices，不混入连续范围。')
            if self.unit != '1' or len({c.label for c in self.choices}) != len(self.choices):
                raise ValueError('离散排列单位须为1，选项名称不能重复。')
        elif self.minimum is None or self.maximum is None or self.minimum >= self.maximum or not self.bindings:
            raise ValueError('连续参数须明确上下限（下限小于上限）、单位和已有字段绑定。')
        elif any(b.reciprocal for b in self.bindings) and self.minimum <= 0 <= self.maximum:
            raise ValueError('倒数换算范围不能包含0；热阻率须为正。')
        return self


class ParameterSpace(StrictModel):
    schema_version: Literal['cablesim.parameter-space/1'] = 'cablesim.parameter-space/1'
    sampling: Literal['grid', 'latin_hypercube', 'random']
    sample_count: int = Field(ge=1, le=100000, strict=True)
    seed: int = Field(default=0, ge=0, le=2**32-1, strict=True)
    axes: list[Axis] = Field(min_length=1, max_length=32)
    source: str = Field(min_length=1, max_length=2000)

    @model_validator(mode='after')
    def count(self):
        if len({a.name for a in self.axes}) != len(self.axes):
            raise ValueError('参数名称不能重复。')
        if self.sampling == 'grid':
            expected = prod(len(a.choices) if a.choices else a.levels for a in self.axes)
            if expected != self.sample_count:
                raise ValueError(f'sample_count: 网格各轴点数之积为 {expected}，请调整样本数或轴点数。')
        return self


def pointer_value(value, pointer):
    if not pointer.startswith(('/input/', '/parameters/')):
        raise ValueError(f'{pointer}: 参数只能绑定已有的计算输入或方法设置。')
    for raw in pointer[1:].split('/'):
        key = raw.replace('~1', '/').replace('~0', '~')
        value = value[int(key)] if isinstance(value, list) else value[key]
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value):
        raise ValueError(f'{pointer}: 只能采样已有有限数值，不能改变对象身份或来源。')
    return value


def coordinates(space):
    """MT19937 seed and saved physical samples make replay independent of a backend."""
    n = space.sample_count
    rng = random.Random(space.seed)
    if space.sampling == 'grid':
        axes = [list(range(len(a.choices))) if a.choices else
                [a.minimum + (a.maximum-a.minimum)*(i/(a.levels-1) if a.levels > 1 else .5)
                 for i in range(a.levels)] for a in space.axes]
        return list(product(*axes))
    columns = []
    for axis in space.axes:
        order = list(range(n))
        if space.sampling == 'latin_hypercube':
            rng.shuffle(order)
        unit = [(order[i]+rng.random())/n if space.sampling == 'latin_hypercube' else rng.random()
                for i in range(n)]
        columns.append([min(int(u*len(axis.choices)),len(axis.choices)-1) if axis.choices else
                        axis.minimum+(axis.maximum-axis.minimum)*u for u in unit])
    return list(zip(*columns))


def materialize(base_case, space):
    if not isinstance(space, ParameterSpace):
        space = ParameterSpace.model_validate(space)
    samples = []
    for index, values in enumerate(coordinates(space)):
        case = deepcopy(base_case)
        case['case_id'] = f'sample-{index:06d}'
        parameters = {}
        for axis, value in zip(space.axes, values):
            parameters[axis.name] = {'value': axis.choices[value].label if axis.choices else value,
                                     'unit': axis.unit, 'source': axis.source}
            if axis.choices:
                for pointer, replacement in axis.choices[value].changes.items():
                    current=pointer_value(case, pointer)
                    if axis.choices[value].mode=='add':replacement+=current
                    replace_number(case, pointer, replacement)
            else:
                for binding in axis.bindings:
                    current = pointer_value(case, binding.pointer)
                    number = binding.offset+binding.scale*(1/value if binding.reciprocal else value)
                    if binding.mode == 'add':
                        number += current
                    elif binding.mode == 'multiply':
                        number *= current
                    if not isfinite(number):
                        raise ValueError(f'{binding.pointer}: 采样换算产生非有限数值，请缩小范围。')
                    replace_number(case, binding.pointer, number)
        samples.append({'index': index, 'parameters': parameters, 'case': case})
    return samples
