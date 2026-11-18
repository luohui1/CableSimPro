"""Bind built-in manufacturer guidance to the installed original transcription.

The reserved reference block is evidence only. It never supplies model inputs,
grants approval, or changes an ordinary user's unverified reference fields.
"""
from hashlib import sha256
import json
from math import isfinite
from pathlib import Path

from .factory_tables import fail


SCHEMA = 'cablesim.catalogue-published-guidance/1'
IDENTITY = 'bahra.mv-lead-sheathed.guidance'
SOURCE_SHA256 = '6c0d7cf7e92a7292d3b1c3a0ed07a956ac17005c2918c1debd6234c7c155243a'
CATALOGUE = Path(__file__).with_name('catalogue_core') / 'catalogues' / 'bahra_mv_lead_sheathed.json'


def _same(actual, expected):
    """JSON numbers may lose a trailing .0 in a browser; booleans are distinct."""
    if type(expected) in (int, float):
        return (type(actual) in (int, float)
                and (type(actual) is int or isfinite(actual)) and actual == expected)
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(_same(actual[key], value) for key, value in expected.items())
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(_same(left, right) for left, right in zip(actual, expected))
    return actual == expected


def validate_published_guidance(reference):
    if not isinstance(reference, dict) or 'published_guidance' not in reference:
        return
    actual = reference['published_guidance']
    if not isinstance(actual, dict) or actual.get('schema') != SCHEMA or actual.get('id') != IDENTITY:
        fail('PUBLISHED_GUIDANCE_INVALID', '内置厂家指南的格式或身份无效；其他用户资料请保留为未核实的参考声明。')
    try:
        expected = json.loads(CATALOGUE.read_text('utf-8'))['published_guidance']
        encoded = json.dumps({key: value for key, value in expected.items() if key != 'content_sha256'},
                             ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
        if (expected['schema'] != SCHEMA or expected['id'] != IDENTITY
                or expected['source']['sha256'] != SOURCE_SHA256
                or expected['confidence'] != 'reference' or expected['reviewed'] is not False
                or expected['usage'] != 'published_reference_only'
                or expected['content_sha256'] != sha256(encoded).hexdigest()):
            raise ValueError('invalid installed transcription')
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, AttributeError):
        fail('PUBLISHED_GUIDANCE_UNAVAILABLE', '本机内置厂家指南缺失或摘要不一致；保留原资料，恢复准确的资料版本后重试。', 409)
    if not _same(actual, expected):
        fail('PUBLISHED_GUIDANCE_INVALID', '厂家指南的数值、条件、来源或方法与本机内置原件转录不一致；不能自行重算摘要后冒充已核验资料。')
