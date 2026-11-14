"""Reading a cable designation the way it is written on an inquiry or in a factory table.

Covers extruded XLPE power cables named after GB/T 12706 (YJV, YJLV22, YJY23 ...) and the high-voltage
metal-sheathed types (YJLW03, YJQ02 ...). What the letters do not say is left empty, never guessed:
"YJV22" alone has no voltage and no size.
"""
import re

from . import CoreError

# Burning-behaviour and similar prefixes that precede the type letters; kept as written.
_PREFIX = re.compile(r'^(?:WDZ[A-D]?N?|Z[A-DR]?N?|ZR|NH|N|GZR|FS|TF|DL)$')
_MEDIUM = re.compile(r'^YJ(L)?(S)?([VY])(\d\d)?$')
_HIGH = re.compile(r'^YJ(L)?(LW|Q)(0[23])$')
_VOLTAGE = re.compile(r'(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\s*(?:\([^)]*\))?\s*(?:KV|千伏)?')
_SIZE = re.compile(r'(\d+)\s*[×xX*]\s*(\d+(?:\.\d+)?)')
ARMOUR = {
    '2': {'kind': 'steel_tape', 'label': '双钢带铠装'},
    '3': {'kind': 'steel_wire', 'wire': 'fine', 'label': '细钢丝铠装'},
    '4': {'kind': 'steel_wire', 'wire': 'thick', 'label': '粗钢丝铠装'},
    '6': {'kind': 'nonmagnetic_tape', 'label': '非磁性金属带铠装'},
    '7': {'kind': 'nonmagnetic_wire', 'label': '非磁性金属丝铠装'},
}
SHEATH = {'V': 'PVC', 'Y': 'PE', '2': 'PVC', '3': 'PE'}
SHEATH_LABEL = {'PVC': '聚氯乙烯', 'PE': '聚乙烯'}


def parse(text):
    """The parts of a designation: type letters, voltage, cores and size. Missing parts are None."""
    if not isinstance(text, str) or not text.strip():
        raise CoreError('DESIGNATION_UNKNOWN', '请填写型号，例如 YJV22-8.7/15 3×240。', '/designation')
    raw = text.strip()
    tokens = [token for token in re.split(r'[\s\-—–－_,，;；]+', raw.upper().replace('（', '(').replace('）', ')')) if token]
    prefixes, model, match = [], None, None
    for token in tokens:
        medium, high = _MEDIUM.match(token), _HIGH.match(token)
        if medium or high:
            model, match = token, medium or high
            break
        if _PREFIX.match(token):
            prefixes.append(token)
    if model is None:
        raise CoreError('DESIGNATION_UNKNOWN', f'“{raw}”不是已收录的交联聚乙烯绝缘电力电缆型号写法（如 YJV、YJLV22、YJY23、YJLW03）。', '/designation')
    result = {'text': raw, 'prefixes': prefixes, 'model': model, 'insulation': 'XLPE',
              'conductor': 'aluminium' if match.group(1) else 'copper', 'screen': None, 'metal_sheath': None, 'armour': None}
    if match.re is _MEDIUM:
        code = match.group(4)
        result['screen'] = 'copper_wire' if match.group(2) else 'copper_tape'
        if code is None:
            result['sheath'] = SHEATH[match.group(3)]
        else:
            if code[0] not in ARMOUR or code[1] not in '23':
                raise CoreError('DESIGNATION_UNKNOWN', f'“{model}”的铠装与外护层代号 {code} 未收录（已收录 22、23、32、33、42、43、62、63、72、73）。', '/designation')
            result['armour'] = dict(ARMOUR[code[0]])
            result['sheath'] = SHEATH[code[1]]
            # With an armour the first letter names the covering under it; the outer sheath is the last digit.
            result['inner_covering'] = SHEATH[match.group(3)]
    else:
        result['metal_sheath'] = 'corrugated_aluminium' if match.group(2) == 'LW' else 'lead'
        result['sheath'] = SHEATH[match.group(3)[1]]
    rest = raw.upper().replace(model, ' ', 1)
    voltage = _VOLTAGE.search(rest)
    result['u0_v'] = float(voltage.group(1)) * 1000 if voltage else None
    result['u_v'] = float(voltage.group(2)) * 1000 if voltage else None
    size = _SIZE.search(rest[voltage.end():] if voltage else rest)
    result['cores'] = int(size.group(1)) if size else None
    result['area_mm2'] = float(size.group(2)) if size else None
    return result


def describe(parts):
    """The designation said in words, as a factory would read it out."""
    words = ['铜芯' if parts['conductor'] == 'copper' else '铝芯', '交联聚乙烯绝缘']
    if parts['metal_sheath']:
        words.append('皱纹铝套' if parts['metal_sheath'] == 'corrugated_aluminium' else '铅套')
    elif parts['screen'] == 'copper_wire':
        words.append('铜丝屏蔽')
    if parts['armour']:
        words.append(parts['armour']['label'])
    words.append(SHEATH_LABEL[parts['sheath']] + '护套')
    return ''.join(words) + '电力电缆'


def name(parts, cores=None, area_mm2=None):
    """The canonical written form: prefixes, type, voltage, cores × size."""
    text = '-'.join([*parts['prefixes'], parts['model']])
    if parts.get('u0_v') and parts.get('u_v'):
        text += f"-{parts['u0_v'] / 1000:g}/{parts['u_v'] / 1000:g} kV"
    cores, area_mm2 = cores or parts.get('cores'), area_mm2 or parts.get('area_mm2')
    if cores and area_mm2:
        text += f' {cores}×{area_mm2:g}'
    return text
