"""Validate transferred catalogue facts against their retained original evidence.

The exchange checksum detects transport damage, not false or missing provenance.
Original cells remain evidence after a design revision; this module never compares
them with revised geometry or replaces a historical standard receipt with a new one.
"""
import json
import math
import re

from openpyxl.utils import column_index_from_string

from . import factory_tables as tables
from .catalogue_core import CoreError, basis
from .type_import_models import parts_of
from .workspace import fingerprint


FACT_FIELDS = {'key', 'label', 'value', 'unit', 'display_value', 'display_unit',
               'source', 'method', 'confidence'}
SOURCE_FIELDS = {'kind', 'file', 'file_sha256', 'sheet', 'row', 'column', 'field',
                 'origin', 'catalogue', 'reference', 'method', 'confidence', 'reviewed'}
IMPORT_VERSIONS = {'1.0.0', '1.1.0'}
SHA = re.compile(r'^[a-f0-9]{64}$')
VERSION = re.compile(r'^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$')


def invalid(message):
    tables.fail('TYPE_EXCHANGE_EVIDENCE', message)


def positive(value):
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value) and value > 0
    except OverflowError:
        return False


def same_number(left, right):
    return positive(left) and positive(right) and math.isclose(left, right, rel_tol=1e-12, abs_tol=0)


def digest(value):
    return isinstance(value, str) and SHA.fullmatch(value) is not None


def parsed_source(source):
    try:
        value = json.loads(source['reference'])
    except (KeyError, TypeError, ValueError):
        invalid('型号保存的逐值来源声明无效，不能删除或替换原始结构表证据。')
    # The explicit single-core mapper wraps the same original evidence once.
    if isinstance(value, dict) and value.get('method') == {'name': '单芯明示结构映射', 'version': '1.0.0'}:
        value = value.get('evidence')
    return value


class ExchangeEvidence:
    def __init__(self, originals):
        self.originals, self.parsed, self.queries, self.expected = originals, {}, {}, []

    def original(self, source):
        key = (source['file_sha256'], source['file'])
        if key[0] not in self.originals or not isinstance(key[1], str) or not key[1].strip():
            invalid('交换文件缺少逐值来源引用的原始结构表。')
        if key not in self.parsed:
            # Identical CSV bytes can have different original filenames; its
            # sheet name is the filename stem. Digest identity permits aliases.
            self.parsed[key] = tables.read(key[1], self.originals[key[0]])
        upload = self.parsed[key]
        if upload['file'] != key[1]:
            invalid('逐值来源的原文件名无效。')
        sheet = next((item for item in upload['sheets'] if item['name'] == source['sheet']), None)
        if sheet is None or type(source['row']) is not int or not 1 <= source['row'] <= len(sheet['grid']):
            invalid('逐值来源的工作表或原表行号不存在。')
        return sheet['grid'][source['row'] - 1]

    def record(self, query, record, historical=None):
        identity = fingerprint(query)
        self.queries[identity] = query
        self.expected.append((identity, record, historical))

    def standard(self, fact, declaration, area):
        source, reference = fact['source'], fact['source']['reference']
        if (fact['key'] != 'r20' or declaration.resistance_basis != 'standard_limit'
                or 'r20' in declaration.common or not isinstance(reference, dict)):
            invalid('标准限值必须对应明确选择的电阻依据，不能冒充厂家原值。')
        conductor = parts_of(declaration.model_dump(mode='json', exclude_none=True))['conductor']
        query = {'schema_version': 'cablesim.standards-query/1', 'standard': 'GB/T 3956',
                 'edition': '2008', 'locator': '表 2', 'quantity': 'resistance_20_max',
                 'conditions': {'area_m2': area, 'conductor_class': 2, 'conductor_material': conductor,
                                **({'coating': 'plain'} if conductor == 'copper' else {})}}
        record = reference.get('record')
        if (reference.get('schema') != 'cablesim.standard-basis-ref/1'
                or reference.get('plugin_id') != basis.PLUGIN or reference.get('query') != query
                or reference.get('query_sha256') != fingerprint(query) or not isinstance(record, dict)
                or not isinstance(reference.get('plugin_version'), str)
                or not VERSION.fullmatch(reference['plugin_version'])):
            invalid('标准限值的固定版本、查询条件或记录不完整。')
        for key in ('data_sha256', 'record_sha256', 'source_sha256', 'request_sha256', 'artifact_digest', 'release_digest'):
            if not digest(reference.get(key)):
                invalid('标准限值缺少完整的来源或方法发行摘要。')
        bare = {key: value for key, value in record.items() if key not in ('record_sha256', 'citation')}
        expected_method = {'name': '标准依据库', 'version': reference['plugin_version'],
                           'release_digest': reference['release_digest']}
        if (reference['record_sha256'] != fingerprint(bare) or record.get('record_sha256') != reference['record_sha256']
                or reference.get('record_id') != record.get('id')
                or not isinstance(record.get('verification'), dict) or record['verification'].get('status') != 'verified'
                or any(reference.get(key) != record.get(key) for key in
                       ('standard', 'edition', 'source_sha256', 'printed_page', 'pdf_page'))
                or reference.get('locator') not in (record.get('table'), record.get('clause'))
                or not isinstance(record.get('quantity'), dict)
                or (record['quantity'].get('key'), record['quantity'].get('unit')) != ('resistance_20_max', 'ohm/km')
                or not same_number(fact['display_value'], record.get('value')) or fact['method'] != expected_method
                or source['kind'] != 'standard'):
            invalid('标准限值、单位、出处或固定记录摘要不一致。')
        # Ask the installed sealed reader for this exact edition and record. A
        # different record is a refusal, never a replacement for the old value.
        self.record({**query, 'record_id': reference['record_id']}, record, reference)

    def facts(self, item, declaration):
        metadata, payload = item['metadata'], item['payload']
        facts = metadata['values']
        # The original importer requires area plus at least one structural
        # quantity. Explicit series.common quantities are also retained facts.
        if not isinstance(facts, list) or not 2 <= len(facts) <= len(tables.FIELDS):
            invalid('每个规格必须保留非空的逐值事实与来源，不能只保留型号结构。')
        keys = [fact.get('key') if isinstance(fact, dict) else None for fact in facts]
        if (any(not isinstance(key, str) or key not in tables.FIELDS for key in keys)
                or len(keys) != len(set(keys)) or 'area' not in keys):
            invalid('逐值事实字段缺失、重复或不受支持，必须保留标称截面。')
        if set(payload['sources']).intersection(tables.FIELDS) != set(keys):
            invalid('逐值事实与型号保留的原始来源集合不一致，不能删除来源。')
        row_identities, columns = set(), set()
        for fact in facts:
            if (not FACT_FIELDS <= set(fact) or set(fact) - FACT_FIELDS - {'usage'}
                    or not isinstance(fact['source'], dict) or not isinstance(fact['method'], dict)):
                invalid('每个规格值须保留原值、单位、来源、方法版本和可信分档。')
            key, source = fact['key'], fact['source']
            label, unit, scale, _ = tables.FIELDS[key]
            scale = .001 if unit == 'kg/km' else scale
            if (fact['label'] != label or fact['display_unit'] != unit or fact['unit'] != tables.SI_UNITS[unit]
                    or not positive(fact['display_value']) or not positive(fact['value'])
                    or not same_number(fact['value'], fact['display_value'] * scale)
                    or key.endswith('_count') and not float(fact['display_value']).is_integer()
                    or key.endswith('_overlap') and fact['display_value'] > 100):
                invalid('逐值事实的原显示值、SI 数值或单位不一致。')
            if (not SOURCE_FIELDS <= set(source) or set(source) - SOURCE_FIELDS - {'usage', 'conditions'}
                    or not isinstance(source['method'], dict)
                    or source['method'].get('name') != tables.IMPORT_METHOD['name']
                    or source['method'].get('version') not in IMPORT_VERSIONS
                    or set(source['method']) != {'name', 'version'}
                    or source['origin'] not in ('table', 'series', 'standard')
                    or source['field'] != key or source['confidence'] != 'reference'
                    or fact['confidence'] != 'reference' or source['reviewed'] is not False
                    or not digest(source['file_sha256']) or source['catalogue'] != (declaration.source or {})
                    or type(metadata.get('row_number')) is not int or source['row'] != metadata['row_number']):
                invalid('逐值来源、方法版本或可信分档无效；交换不能提升原始事实的可信等级。')
            saved_source = payload['sources'][key]
            if parsed_source(saved_source) != source or saved_source['kind'] != source['kind']:
                invalid('逐值来源与型号保存的原始来源声明不一致。')
            current_performance = source['method']['version'] == '1.1.0' and key in tables.SOURCE_ONLY_FIELDS
            if current_performance:
                if (fact.get('usage') != 'catalogue_result' or source.get('usage') != 'catalogue_result'
                        or source.get('conditions') != declaration.reference.get('conditions', {})):
                    invalid('目录性能事实必须保留原工况与用途，不能用作结构输入。')
            elif 'usage' in fact or 'usage' in source or 'conditions' in source:
                invalid('逐值事实用途与原导入方法版本不一致。')
            if source['method']['version'] == '1.0.0' and key in tables.SOURCE_ONLY_FIELDS - {'ampacity'}:
                invalid('旧导入方法不包含此性能字段，不能改写方法版本。')
            row = self.original(source)
            row_identities.add((source['file_sha256'], source['sheet'], source['row']))
            if source['origin'] == 'table':
                if not isinstance(source['column'], str) or not re.fullmatch(r'[A-Z]{1,3}', source['column']):
                    invalid('原表来源必须提供有效的列号。')
                column = column_index_from_string(source['column']) - 1
                if column >= len(row) or column in columns or not same_number(tables.number(row[column]), fact['display_value']):
                    invalid('逐值事实与原表单元格不一致，或同一原列重复对应多个字段。')
                columns.add(column)
                if source['reference'] is not None:
                    invalid('原表数值不能附带另一份相矛盾的数值声明。')
            elif source['column'] is not None:
                invalid('系列共用值或标准限值不能伪称来自原表某一列。')
            if source['origin'] == 'series':
                if (key not in declaration.common or not same_number(fact['display_value'], declaration.common[key])
                        or source['reference'] != declaration.common_basis.get(key)):
                    invalid('系列共用值与明确声明的数值或出处不一致。')
            if source['origin'] == 'standard':
                self.standard(fact, declaration, metadata['area_m2'])
            else:
                expected_kind = 'demo' if declaration.origin == 'demo' else 'manufacturer' if source['origin'] == 'table' else 'user'
                if source['kind'] != expected_kind or fact['method'] != source['method']:
                    invalid('逐值来源类别或导入方法声明不一致。')
            if key == 'area' and not same_number(fact['value'], metadata['area_m2']):
                invalid('规格截面与原始事实不一致。')
        if len(row_identities) != 1:
            invalid('同一规格的原始事实必须来自同一份表的同一行。')

    def verify(self):
        if not self.queries:
            return
        try:
            references, missing = basis.resolve(self.queries)
        except (CoreError, ValueError, OSError) as error:
            invalid('无法核验交换文件中的固定标准记录，请恢复相应依据后重试：' + str(error)[:200])
        if missing or set(references) != set(self.queries):
            invalid('本机无法核验交换文件的固定标准记录；未代用其他版本或条件。')
        for identity, expected, historical in self.expected:
            actual = references[identity]['record']
            if (actual['id'] != expected['id'] or actual['record_sha256'] != expected['record_sha256']
                    or actual['source_sha256'] != expected['source_sha256']):
                invalid('交换文件的固定标准记录与已封签原始依据不一致。')
            # Only the installed release has a verified manifest. An unchanged
            # record cannot authenticate a different historical method version.
            if historical['plugin_version'] != references[identity]['plugin_version']:
                invalid('本机无法核验交换文件声明的标准方法版本；请恢复对应封签发行后重试，不以当前版本替换原记录。')
            if any(historical[key] != references[identity][key] for key in ('data_sha256', 'release_digest')):
                invalid('同一版本的标准依据数据或发行摘要不一致。')
