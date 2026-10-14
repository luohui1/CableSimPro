"""Sealed, offline standard excerpts. Resolving evidence never approves a requirement."""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from math import isclose, isfinite
from pathlib import Path
import re

VERSION = '0.7.0'
DATA = Path(__file__).parent
NUMERIC_FIELDS = {'area_m2', 'screen_area_m2', 'diameter_m', 'u0_v', 'u_v', 'um_v', 'core_count',
                  'conductor_class', 'nominal_thickness_m', 'duration_s'}
TEXT_FIELDS = {'insulation', 'conductor_material', 'coating', 'conductor_form',
               'screened', 'armour_material', 'armour_kind', 'sheath_material', 'layer'}
CONDITION_FIELDS = NUMERIC_FIELDS | TEXT_FIELDS


class BasisError(ValueError):
    def __init__(self, code: str, path: str, message: str):
        super().__init__(message)
        self.code, self.path = code, path


def digest(value) -> str:
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                             separators=(',', ':'), allow_nan=False).encode('utf-8')).hexdigest()


def _equal(a, b):
    if isinstance(a, (int, float)) and not isinstance(a, bool) and isinstance(b, (int, float)):
        return isclose(a, b, rel_tol=1e-12, abs_tol=0)
    return type(a) is type(b) and a == b


def _matches(actual, predicate):
    if not isinstance(predicate, dict):
        return _equal(actual, predicate)
    for operator, expected in predicate.items():
        if operator == 'in':
            if not any(_equal(actual, x) for x in expected):
                return False
        elif operator == 'eq':
            if not _equal(actual, expected):
                return False
        elif operator == 'gt':
            if actual <= expected or _equal(actual, expected):
                return False
        elif operator == 'gte':
            if actual < expected and not _equal(actual, expected):
                return False
        elif operator == 'lt':
            if actual >= expected or _equal(actual, expected):
                return False
        elif operator == 'lte':
            if actual > expected and not _equal(actual, expected):
                return False
        else:
            raise BasisError('DATA_INVALID', '/conditions', '依据库含未声明的条件运算符。')
    return True


class BasisLibrary:
    def __init__(self, directory: Path = DATA):
        try:
            index = json.loads((directory / 'integrity.json').read_text('utf-8'))
            contents = {}
            for name,item in index['files'].items():
                if not re.fullmatch(r'(?:basis|verification|records-[a-z-]+)\.json',name):
                    raise ValueError('索引文件名越界')
                raw = (directory / name).read_bytes()
                if len(raw) != item['size_bytes'] or sha256(raw).hexdigest() != item['sha256']:
                    raise ValueError('摘要不一致')
                contents[name] = raw
            self._index = json.loads(contents['basis.json'])
            self._raw = contents
            self._loaded = {}
            self._verification = None
            for item in self._index['record_files']:
                name=item['name']
                if {k:item[k] for k in ('sha256','size_bytes')} != index['files'][name]:
                    raise ValueError('分册摘要与索引不同')
            self.data_sha256 = index['files']['basis.json']['sha256']
            if self._index['schema'] != 'cablesim.standards-basis/1' or self._index['version'] != VERSION:
                raise ValueError('版本不一致')
            manifest_path = directory.parents[1] / 'plugin.json'
            if directory.resolve() == DATA.resolve() or manifest_path.exists():
                manifest = json.loads(manifest_path.read_text('utf-8'))
                if manifest['id'] != 'cablesim.standards-basis' or manifest['version'] != VERSION:
                    raise ValueError('发行不一致')
                sealed = {f['path']: f for f in manifest['files']}
                for name in ('excerpts.json', 'integrity.json', *index['files']):
                    raw = contents.get(name) or (directory / name).read_bytes()
                    item = sealed['src/cablesim_standards_basis/' + name]
                    if len(raw) != item['size_bytes'] or sha256(raw).hexdigest() != item['sha256']:
                        raise ValueError('封签不一致')
        except (OSError, ValueError, KeyError, TypeError):
            raise BasisError('BASIS_INTEGRITY_FAILED', '/', '依据库缺失或摘要不一致；请重新安装准确版本的插件。') from None

    def _records(self, table_ids=None):
        records = []
        for item in self._index['record_files']:
            if table_ids is not None and not table_ids.intersection(item.get('table_ids', table_ids)):
                continue
            name = item['name']
            if name not in self._loaded:
                self._loaded[name] = json.loads(self._raw[name])
            records.extend(self._loaded[name])
        return records

    @property
    def data(self):
        # Existing compilation and consumer contracts retain the complete view.
        return {**self._index, 'records': self._records()}

    @property
    def verification(self):
        if self._verification is None:
            self._verification = json.loads(self._raw['verification.json'])
        return self._verification

    def query(self, request: dict) -> dict:
        if not isinstance(request, dict):
            raise BasisError('INPUT_INVALID', '/', '查询应为对象。')
        allowed = {'schema_version', 'operation', 'standard', 'edition', 'locator',
                   'quantity', 'conditions', 'record_id', 'expected_data_sha256', 'compact', 'formula_inputs', 'table_id'}
        extra = set(request) - allowed
        if extra:
            field = sorted(extra)[0]
            raise BasisError('INPUT_INVALID', '/' + field, '未声明的查询字段，请按查询契约填写。')
        if request.get('schema_version') != 'cablesim.standards-query/1':
            raise BasisError('INPUT_INVALID', '/schema_version', '请使用 cablesim.standards-query/1。')
        operation = request.get('operation', 'resolve')
        if 'formula_inputs' in request and operation != 'evaluate':
            raise BasisError('INPUT_INVALID', '/formula_inputs', '公式输入仅用于 evaluate 查询。')
        if operation == 'catalog':
            if set(request) - {'schema_version', 'operation', 'compact'} or ('compact' in request and type(request['compact']) is not bool):
                raise BasisError('INPUT_INVALID', '/', '目录查询仅接受 schema_version 和 operation。')
            return {'schema': 'cablesim.standards-answer/1', 'plugin_id': 'cablesim.standards-basis',
                    'plugin_version': VERSION, 'data_sha256': self.data_sha256,
                    'query_sha256': digest(request), 'approval': 'not_granted',
                    'status': 'catalogued', 'tables': [{k:v for k,v in t.items() if k != 'record_ids'} for t in self._index['tables']] if request.get('compact') else self._index['tables'],
                    'not_covered': self._index['not_covered'], 'records': []}
        if 'compact' in request:
            raise BasisError('INPUT_INVALID', '/compact', '紧凑模式仅用于目录查询。')
        if 'table_id' in request and (operation not in ('list', 'browse') or not isinstance(request['table_id'], str) or not request['table_id'] or len(request['table_id']) > 180):
            raise BasisError('INPUT_INVALID', '/table_id', '表索引标识仅用于list/browse；取唯一判据请用record_id。')
        for field in ('standard', 'edition', 'locator'):
            if not isinstance(request.get(field), str) or not request[field].strip() or len(request[field]) > 80:
                raise BasisError('INPUT_INVALID', '/' + field, '请填写明确的标准号、版本和条款或表号。')
        if operation not in ('resolve', 'list', 'evaluate', 'browse'):
            raise BasisError('INPUT_INVALID', '/operation', '请选择 resolve（取判据）或 list（完整列出）。')
        for field in ('quantity', 'record_id'):
            if field in request and (not isinstance(request[field], str) or not request[field] or len(request[field]) > 180):
                raise BasisError('INPUT_INVALID', '/' + field, '请输入有效的量名或记录标识。')
        if operation in ('resolve', 'evaluate') and not request.get('quantity'):
            raise BasisError('INPUT_INVALID', '/quantity', '取判据时必须指定量名，不能用不同物理量互相替代。')
        conditions = request.get('conditions', {})
        if not isinstance(conditions, dict):
            raise BasisError('INPUT_INVALID', '/conditions', '条件须为对象，数值字段使用契约规定的 SI 单位。')
        if operation in ('list', 'browse') and (conditions or request.get('record_id')):
            raise BasisError('INPUT_INVALID', '/conditions', '完整列出不接受条件或记录筛选；请改用 resolve。')
        declared = self._index.get('condition_fields', {})
        for key, value in conditions.items():
            if key not in CONDITION_FIELDS and key not in declared:
                raise BasisError('INPUT_INVALID', '/conditions/' + key, '未知条件；请使用依据库声明的条件名和 SI 单位。')
            if key in NUMERIC_FIELDS or declared.get(key, {}).get('type') == 'number':
                if type(value) not in (int, float) or (type(value) is float and not isfinite(value)) or value <= 0:
                    raise BasisError('INPUT_INVALID', '/conditions/' + key, '请输入正的有限 SI 数值；截面为 m²，厚度和直径为 m，电压为 V。')
                maximum = {'area_m2': .01, 'screen_area_m2': .01, 'diameter_m': 2, 'nominal_thickness_m': 1,
                           'u0_v': 1e6, 'u_v': 1e6, 'um_v': 1e6}.get(key, declared.get(key, {}).get('maximum'))
                if maximum is not None and value > maximum:
                    raise BasisError('INPUT_INVALID', '/conditions/' + key, '数值超过查询边界；请核对 SI 单位。')
                if (key.endswith('_count') or key == 'conductor_class') and (int(value) != value or value > 100):
                    raise BasisError('INPUT_INVALID', '/conditions/' + key, '请输入正整数类别或芯数。')
            elif declared.get(key, {}).get('type') == 'boolean':
                if type(value) is not bool:
                    raise BasisError('INPUT_INVALID', '/conditions/' + key, '请选择明确的 true 或 false，不能用数字或文字代替声明条件。')
            elif not isinstance(value, str) or not value or len(value) > declared.get(key, {}).get('maxLength',60):
                raise BasisError('INPUT_INVALID', '/conditions/' + key, '请输入明确的材料、结构或分支代号。')
            elif key == 'screened' and value not in ('yes', 'no'):
                raise BasisError('INPUT_INVALID', '/conditions/screened', '请选择 yes（有屏蔽）或 no（无屏蔽）。')
        expected = request.get('expected_data_sha256')
        if expected is not None:
            if not isinstance(expected, str) or not re.fullmatch('[0-9a-f]{64}', expected):
                raise BasisError('INPUT_INVALID', '/expected_data_sha256', '请提供完整的 SHA256。')
            if expected != self.data_sha256:
                raise BasisError('BASIS_VERSION_CHANGED', '/expected_data_sha256', '依据库版本或内容已变化；请重新核对引用，不能静默换版。')
        selected_tables = {t['id'] for t in self._index['tables'] if t['standard'] == request['standard'] and t['edition'] == request['edition'] and request['locator'] in (t['table'], t['clause']) and (not request.get('table_id') or t['id'] == request['table_id'])}
        records = [r for r in self._records(selected_tables) if r['standard'] == request['standard']
                   and r['id'].split('/')[0] in selected_tables
                   and r['edition'] == request['edition']
                   and request['locator'] in (r['table'], r['clause'])
                   and (not request.get('quantity') or r['quantity']['key'] == request['quantity'])
                   and (not request.get('record_id') or r['id'] == request['record_id'])]
        base = {'schema': 'cablesim.standards-answer/1', 'plugin_id': 'cablesim.standards-basis',
                'plugin_version': VERSION, 'data_sha256': self.data_sha256,
                'query_sha256': digest(request), 'approval': 'not_granted'}
        if operation in ('resolve', 'evaluate'):
            candidates = [r for r in records if all(k not in conditions or _matches(conditions[k], p)
                                                    for k, p in r['conditions'].items())]
            missing = sorted({k for r in candidates for k in r['conditions'] if k not in conditions})
            if missing:
                raise BasisError('CONDITIONS_REQUIRED', '/conditions/' + missing[0],
                                 '请补齐适用条件：' + '、'.join(missing) + '；不按缺省值选取判据。')
            records = [r for r in candidates if all(k in r['conditions'] for k in conditions)]
            if len(records) > 1:
                raise BasisError('BASIS_AMBIGUOUS', '/conditions', '条件匹配到多条依据；请指定完整条件或记录标识。')
        if not records:
            return {**base, 'status': 'not_covered', 'reason': '此版本、条款、量或条件本轮未覆盖；不得替换为其他标准版本。', 'records': []}
        blocked = [r for r in records if r['verification']['status'] != 'verified']
        if blocked and operation in ('resolve', 'evaluate'):
            raise BasisError('EVIDENCE_BLOCKED', '/record_id', '此条依据存在未确认差异，禁止用于自动核对。')
        enriched = []
        for record in records:
            record = deepcopy(record)
            record['record_sha256'] = digest(record)
            record['citation'] = citation(record)
            enriched.append(record)
        if operation == 'browse':
            return {**base, 'status': 'listed', 'records': enriched,
                    'tables': [{k:v for k,v in t.items() if k != 'record_ids'} for t in self._index['tables']],
                    'not_covered': self._index['not_covered'],
                    'browse': {k:request[k] for k in ('standard','edition','locator')}}
        status = ('listed' if operation == 'list' else
                  'reference_value_missing' if records[0]['value'] is None and records[0]['semantic'].startswith('literature') else
                  'explicit_not_applicable' if records[0]['value'] is None else 'resolved')
        if operation == 'evaluate':
            from .soil_capacity import evaluate
            return {**base, 'status': 'evaluated', 'records': enriched,
                    'calculation': evaluate(enriched[0], request.get('formula_inputs'))}
        if 'formula_inputs' in request:
            raise BasisError('INPUT_INVALID', '/formula_inputs', '公式输入仅用于 evaluate 查询。')
        return {**base, 'status': status, 'records': enriched}


def citation(record: dict) -> str:
    locator = record['table'] or '条款 ' + record['clause']
    return f"{record['standard']}—{record['edition']} {locator}，第 {record['printed_page']} 页（PDF 第 {record['pdf_page']} 页）"
