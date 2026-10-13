"""GB/T 12706 Annex A/B arithmetic, solely from pinned lookup evidence.

This module never supplies missing coefficients, substitutes physical diameters,
or uses another part's tables. A receipt is mandatory for every operation.
"""
from decimal import Decimal, ROUND_HALF_UP
import math

from cablesim_standard_check.basis import validate


class MissingBasis(ValueError):
    pass


def evidence(ref, query):
    if not ref:
        raise MissingBasis(f"{query['standard']}—{query['edition']} {query['locator']}：本库暂未收录完整计算参数及页码，不能生成此护层尺寸。")
    record = validate(ref, query)
    if not all(type(record.get(key)) is int and record[key] > 0 for key in ('printed_page', 'pdf_page')):
        raise MissingBasis(record.get('citation', query['locator']) + '：缺少计算依据页码。')
    return record


def decimal(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)) or not math.isfinite(value):
        raise ValueError('计算输入必须为有限数值，并使用依据指定的单位。')
    return Decimal(str(value))


def round_value(value, rounding_record):
    """B.1/B.2: one direct rounding, never successive intermediate rounding."""
    rule = rounding_record.get('value')
    if not isinstance(rule, dict) or rule.get('mode') != 'half_up' or rule.get('unit') != 'mm':
        raise MissingBasis('附录 B：缺少有页码的 half_up 修约参数；不依据引用字符串推测规则。')
    increment = decimal(rule.get('increment'))
    if increment <= 0:
        raise ValueError('附录 B 修约增量必须为正值。')
    value = decimal(value)
    if value < 0:
        raise ValueError('护层厚度与假设直径不得为负值。')
    return (value / increment).quantize(Decimal('1'), rounding=ROUND_HALF_UP) * increment


class DiameterChain:
    """Each operation carries its own evidence and an explicit B rounding receipt."""
    def __init__(self, rounding_record):
        self.rounding_record, self.steps = rounding_record, []

    def step(self, name, formula, inputs, raw, record):
        result = round_value(raw, self.rounding_record)
        self.steps.append({'stage': name, 'formula': formula,
            'inputs': {key: float(value) for key, value in inputs.items()}, 'unit': 'mm',
            'raw_value': str(raw), 'rounded_value': float(result),
            'rounding': {'raw_value': str(raw), 'increment': self.rounding_record['value']['increment'],
                         'mode': 'half_up', 'result': float(result), 'record': self.rounding_record},
            'record': record, 'citation': record['citation']})
        return result

    def conductor(self, record):
        if record.get('criterion') not in ('nominal', 'fictitious_method_parameter') or record.get('quantity', {}).get('unit') != 'mm':
            raise MissingBasis('导体假设直径须使用本部分表 A.1 的毫米参考值，不能用真实导体外径代替。')
        return self.step('导体假设直径', 'dL = 表 A.1', {}, decimal(record['value']), record)

    def core(self, diameter, insulation, record):
        parameters = record['value']
        if not isinstance(parameters, dict) or parameters.get('kind') != 'core_diameter':
            raise MissingBasis('附录 A.2.2：缺少绝缘厚度倍数及屏蔽直径增量参数。')
        factor, addition = decimal(parameters.get('insulation_multiplier')), decimal(parameters.get('screen_increment_mm'))
        if diameter <= 0 or insulation <= 0 or factor <= 0 or addition < 0:
            raise ValueError('绝缘线芯直径与厚度应为正值，屏蔽增量不得为负值。')
        raw = diameter + factor * insulation + addition
        return self.step('绝缘线芯假设直径', 'Dc = dL + m·ti + Δscreen',
                         {'dL': diameter, 'ti': insulation, 'm': factor, 'Δscreen': addition}, raw, record)

    def bundle(self, diameter, record):
        if record.get('quantity', {}).get('unit') != '1':
            raise MissingBasis('成缆系数的单位应为无量纲，不能代入外径或其他电压部分系数。')
        factor = decimal(record['value'])
        if factor <= 0 or diameter <= 0:
            raise ValueError('成缆系数与线芯假设直径应为正值。')
        return self.step('缆芯假设直径', 'Df = B·Dc', {'B': factor, 'Dc': diameter}, factor * diameter, record)

    def cover(self, diameter, thickness, record, name):
        parameters = record['value']
        if not isinstance(parameters, dict) or parameters.get('kind') != 'cover_diameter':
            raise MissingBasis(record['citation'] + '：缺少该护层的直径增量倍数。')
        factor = decimal(parameters.get('thickness_multiplier'))
        if factor <= 0 or diameter <= 0 or thickness < 0:
            raise ValueError('护层直径增量倍数与内径应为正值，厚度不得为负值。')
        return self.step(name, 'Dout = Din + m·t', {'Din': diameter, 'm': factor, 't': thickness}, diameter + factor * thickness, record)

    def thickness(self, diameter, record, other_rounding=None):
        p = record['value']
        if not isinstance(p, dict) or p.get('kind') != 'affine' or p.get('x') != 'diameter' or p.get('parameter_units') != {'a': '1', 'b': 'mm', 'diameter': 'mm', 'result': 'mm'}:
            raise MissingBasis(record['citation'] + '：未覆盖的厚度公式或参数单位。')
        a, b, floor = decimal(p.get('a')), decimal(p.get('b')), decimal(p.get('floor'))
        if diameter <= 0 or a < 0 or b < 0 or floor <= 0:
            raise ValueError('厚度公式内径与最小厚度应为正值，系数不得为负值。')
        raw = a * diameter + b
        old_rounding = self.rounding_record
        if other_rounding is not None:
            from copy import deepcopy
            self.rounding_record = deepcopy(other_rounding)
            increment = p.get('rounding', {}).get('increment')
            if increment is None:
                raise MissingBasis(record['citation']+'：条款未给修约精度，不能执行 B.2。')
            self.rounding_record['value']['increment'] = increment
            self.rounding_record['increment_source'] = record
        rounded = self.step(record['quantity']['name'], 't = max(tmin, roundB(a·D+b))',
                            {'a': a, 'D': diameter, 'b': b, 'tmin': floor}, raw, record)
        self.rounding_record = old_rounding
        value = max(floor, rounded)
        self.steps[-1].update(rounded_value=float(value), floor_applied=rounded < floor)
        return value
