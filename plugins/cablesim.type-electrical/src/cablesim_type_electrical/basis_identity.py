"""A sealed content identity that survives JSON number serialization.

The original issuer's record SHA remains mandatory. This additional consumer
lock compares the same JSON content after lossless integral-number normalization;
it never accepts rounding, boolean substitutions, strings or changed metadata.
"""
from hashlib import sha256
import json
import math

SCHEMA = 'cablesim.basis-json-content/1'


def _numbers(value):
    if isinstance(value, dict):
        return {key: _numbers(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_numbers(item) for item in value]
    if type(value) is float:
        if not math.isfinite(value):
            raise ValueError('标准依据必须包含有限数值。')
        return int(value) if value.is_integer() else value
    return value


def content_digest(value):
    return sha256(json.dumps(_numbers(value), sort_keys=True, separators=(',', ':'),
                            ensure_ascii=False, allow_nan=False).encode('utf-8')).hexdigest()
