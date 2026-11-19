"""Bind built-in manufacturer guidance to the installed original transcription.

The reserved reference blocks are evidence only. They never supply model inputs,
grant approval, or change an ordinary user's unverified reference fields.
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
OPERATING_LIMIT_SCHEMA = 'cablesim.published-operating-limits/1'
PEOPLE_SOURCE_SHA256 = 'c60b53c188478b55f424f49ca31506c5f7c100d2c876f91aab65622e86ddba4a'


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


def _validate_bahra_guidance(actual):
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


def _validate_people_operating_limits(actual):
    if not isinstance(actual, dict) or actual.get('schema') != OPERATING_LIMIT_SCHEMA:
        fail('PUBLISHED_OPERATING_LIMITS_INVALID', '内置厂家使用条件的格式或版本无效；其他用户资料请保留为未核实的参考声明。')
    try:
        # Reuse the same transcription that creates the public workbook's
        # declarations, rather than keeping a second set of permitted limits.
        from .public_catalogues import _data, _people_operating_limits
        _, expected = _people_operating_limits(_data('people-mv'))
        if (expected['schema'] != OPERATING_LIMIT_SCHEMA
                or expected['source']['sha256'] != PEOPLE_SOURCE_SHA256
                or expected['semantic'] != 'manufacturer_limit'
                or expected['usage'] != 'permitted_limits_only'
                or expected['confidence'] != 'reference' or expected['reviewed'] is not False):
            raise ValueError('invalid installed transcription')
    except (OSError, UnicodeError, ValueError, KeyError, TypeError, AttributeError):
        fail('PUBLISHED_OPERATING_LIMITS_UNAVAILABLE', '本机内置厂家使用条件缺失或来源身份不一致；保留原资料，恢复准确的资料版本后重试。', 409)
    if not _same(actual, expected):
        fail('PUBLISHED_OPERATING_LIMITS_INVALID', '厂家使用条件的数值、单位、适用条件、来源或方法与本机内置原件转录不一致；不能作为已核验的公开许可条件使用。')


def validate_published_guidance(reference):
    if not isinstance(reference, dict):
        return
    if 'published_guidance' in reference:
        _validate_bahra_guidance(reference['published_guidance'])
    if 'published_operating_limits' in reference:
        _validate_people_operating_limits(reference['published_operating_limits'])
