"""Read-only formal delivery requests and exact, shared renderer data contracts.

The source builder owns engineering interpretation. Renderers consume one table
map, ordered body/trace sections and literal cells. Numeric cells always carry a
JSON Pointer into a frozen source payload; presentation never rounds a value.
"""
from __future__ import annotations

import base64
import binascii
from datetime import date
from hashlib import sha256
from io import BytesIO
import json
import math
import re
from typing import Annotated, Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator


SCHEMA = 'cablesim.formal-delivery/1'
KINDS = ('specification', 'calculation', 'rating_table', 'research_report')
TITLES = {'specification': '产品规格书', 'calculation': '计算书',
          'rating_table': '载流量表', 'research_report': '研究报告'}
SIGNATURE_ROLES = (('design', '设计'), ('check', '校核'), ('review', '审核'), ('approve', '批准'))
MAX_LOGO_BYTES = 512 * 1024
MAX_SOURCE_BYTES = 32 * 1024 * 1024
MAX_ROWS = 6000
Digest = Annotated[str, StringConstraints(pattern=r'^[0-9a-f]{64}$')]
DocumentKind = Literal['specification', 'calculation', 'rating_table', 'research_report']


def fail(code: str, message: str, status: int = 422) -> None:
    raise HTTPException(status_code=status, detail={'code': code, 'message': message})


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def jsonsha(value: Any) -> str:
    return sha256(canonical_bytes(value)).hexdigest()


def raw_text(value: Any) -> str:
    """Keep the JSON numeric lexeme, including negative zero and full precision."""
    if value is None:
        return ''
    if isinstance(value, str):
        return value
    return canonical_bytes(value).decode('utf-8')


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def decode_logo(value: str | None) -> bytes | None:
    """Accept bounded, embedded PNG/JPEG only; no path or network lookup."""
    if value is None:
        return None
    match = re.fullmatch(r'data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)', value)
    if not match:
        raise ValueError('单位标志须为内嵌 PNG 或 JPEG，不支持网络地址。')
    try:
        content = base64.b64decode(match[2], validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError('单位标志的 Base64 数据无效。') from error
    if not content or len(content) > MAX_LOGO_BYTES:
        raise ValueError('单位标志须不超过 512 KiB。')
    from PIL import Image, UnidentifiedImageError
    try:
        with Image.open(BytesIO(content)) as picture:
            expected = 'PNG' if match[1] == 'png' else 'JPEG'
            if picture.format != expected or not (0 < picture.width <= 2400 and 0 < picture.height <= 2400):
                raise ValueError('单位标志格式与声明不符，或尺寸超过 2400 × 2400。')
            if getattr(picture, 'n_frames', 1) != 1:
                raise ValueError('单位标志须为单帧静态图片。')
            picture.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError('单位标志不是可读取的安全图片。') from error
    return content


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')


class RunPin(StrictRequest):
    run_id: str = Field(min_length=1, max_length=128)
    input_digest: Digest
    output_digest: Digest


class SourceSelection(StrictRequest):
    workspace_id: str = Field(min_length=1, max_length=128)
    expected_revision: int = Field(ge=0, strict=True)
    specification_digest: Digest | None = None
    runs: list[RunPin] = Field(default_factory=list, max_length=16)

    @model_validator(mode='after')
    def unique_runs(self):
        if len({item.run_id for item in self.runs}) != len(self.runs):
            raise ValueError('运行记录不可重复选择。')
        return self


class DocumentMetadata(StrictRequest):
    organization: str = Field(min_length=1, max_length=120)
    number: str = Field(min_length=1, max_length=80)
    revision: str = Field(min_length=1, max_length=32)
    header: str = Field(default='', max_length=160)
    footer: str = Field(default='', max_length=160)
    issued_on: str | None = None
    logo_data_uri: str | None = Field(default=None, max_length=720000)

    @field_validator('organization', 'number', 'revision', 'header', 'footer')
    @classmethod
    def printable_line(cls, value, info):
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError('文件元数据不能包含控制字符或换行。')
        value = value.strip()
        if not value and info.field_name in ('organization', 'number', 'revision'):
            raise ValueError('单位名称、文件编号和版次不能为空。')
        return value

    @field_validator('issued_on')
    @classmethod
    def fixed_date(cls, value):
        if value is not None:
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
                raise ValueError('签发日期须为 YYYY-MM-DD。')
            date.fromisoformat(value)
        return value

    @field_validator('logo_data_uri')
    @classmethod
    def embedded_logo(cls, value):
        decode_logo(value)
        return value


class PreviewRequest(StrictRequest):
    kind: DocumentKind
    source: SourceSelection
    document: DocumentMetadata

    @model_validator(mode='after')
    def source_shape(self):
        if self.kind == 'specification':
            if self.source.specification_digest is None or self.source.runs:
                raise ValueError('规格书须固定 specification_digest，由该规格书确定来源运行。')
        else:
            if self.source.specification_digest is not None or not self.source.runs:
                raise ValueError('计算书、载流量表和研究报告须固定完整的来源运行摘要。')
            if self.kind != 'research_report' and len(self.source.runs) != 1:
                raise ValueError('计算书或载流量表每份选择一条完整运行；多运行请用研究报告。')
        return self


class ExportRequest(PreviewRequest):
    format: Literal['pdf', 'xlsx'] = 'pdf'
    expected_model_digest: Digest


def resolve_pointer(payload: Any, pointer: str) -> Any:
    if not isinstance(pointer, str) or (pointer and not pointer.startswith('/')):
        raise ValueError('来源指针不是 RFC 6901 JSON Pointer。')
    current = payload
    if not pointer:
        return current
    for encoded in pointer[1:].split('/'):
        if re.search(r'~(?![01])', encoded):
            raise ValueError('来源指针含无效转义。')
        key = encoded.replace('~1', '/').replace('~0', '~')
        if isinstance(current, list):
            if not re.fullmatch(r'0|[1-9][0-9]*', key):
                raise ValueError('来源数组指针无效。')
            current = current[int(key)]
        elif isinstance(current, dict):
            current = current[key]
        else:
            raise ValueError('来源指针进入了非容器值。')
    return current


def referenced_value(model: dict, reference: dict) -> Any:
    return resolve_pointer(model['sources'][reference['source_id']]['payload'], reference['pointer'])


def iter_cells(model: dict):
    for table_id, table in model['tables'].items():
        for row in table['rows']:
            for column in table['columns']:
                yield table_id, row['id'], column['key'], row['cells'][column['key']]


def validate_model_refs(model: dict) -> None:
    """Reject silent rounding, guessed numbers, source drift and wrong units."""
    try:
        if model.get('schema') != SCHEMA or model.get('kind') not in KINDS:
            raise ValueError('交付模型版本或类型无效。')
        if len(canonical_bytes(model['sources'])) > MAX_SOURCE_BYTES:
            raise ValueError('完整来源超过 32 MiB，请减少所选运行；不会截断输入快照。')
        for source in model['sources'].values():
            if jsonsha(source['payload']) != source['payload_digest']:
                raise ValueError('冻结来源摘要不一致。')
        used, saw_trace = [], False
        body_text = [model['title'], model['metadata']['organization'], model['metadata']['number'],
                     model['metadata']['revision'], model['metadata'].get('header', ''), model['metadata'].get('footer', '')]
        for section in model['sections']:
            if section['role'] not in ('body', 'trace') or (saw_trace and section['role'] != 'trace'):
                raise ValueError('追溯章节必须完整地附在正文之后。')
            saw_trace |= section['role'] == 'trace'
            used.extend(section['table_ids'])
            for figure in section.get('figures', []):
                if figure.get('kind') != 'cable_section':
                    raise ValueError('未支持的交付图形类型。')
                if not isinstance(referenced_value(model, figure['geometry_ref']), dict):
                    raise ValueError('截面图没有保存的几何记录。')
                if figure.get('input_ref') is not None:
                    referenced_value(model, figure['input_ref'])
            if section['role'] == 'body':
                body_text.append(section['heading'])
                body_text.extend(paragraph['text'] for paragraph in section.get('paragraphs', []))
                body_text.extend(figure.get('title', '') for figure in section.get('figures', []))
                for figure in section.get('figures', []):
                    geometry = referenced_value(model, figure['geometry_ref'])
                    body_text.extend(str(row.get('label') or '') for row in geometry.get('layers', []))
                for table_id in section['table_ids']:
                    table = model['tables'][table_id]
                    body_text.append(table.get('title', ''))
                    body_text.extend(column['label'] for column in table['columns'])
                    body_text.extend(cell['raw_text'] for row in table['rows'] for cell in row['cells'].values())
                    body_text.extend(str(cell.get('unit') or '') for row in table['rows'] for cell in row['cells'].values())
        if not saw_trace or set(used) != set(model['tables']) or len(used) != len(set(used)):
            raise ValueError('交付表格或追溯章节缺失、重复。')
        if sum(len(table['rows']) for table in model['tables'].values()) > MAX_ROWS:
            raise ValueError('可见交付表超过 6000 行，请减少所选运行；不会截断表格。')
        for table in model['tables'].values():
            keys = [column['key'] for column in table['columns']]
            if not keys or len(keys) != len(set(keys)):
                raise ValueError('交付表格列为空或重复。')
            if len({row['id'] for row in table['rows']}) != len(table['rows']):
                raise ValueError('交付表格行标识重复。')
            if any(set(row['cells']) != set(keys) for row in table['rows']):
                raise ValueError('交付表格单元格与列定义不一致。')
        for _table_id, _row_id, _column_key, cell in iter_cells(model):
            value = cell['value']
            if not isinstance(value, (str, int, float, bool, type(None))):
                raise ValueError('可见单元格须为标量；完整数组应留在来源快照。')
            if cell['raw_text'] != raw_text(value):
                raise ValueError('单元格原文与冻结值不一致，不允许舍入。')
            reference = cell.get('value_ref')
            if is_number(value):
                if not math.isfinite(value) or not reference:
                    raise ValueError('数值没有明确冻结来源，或不是有限值。')
            if reference is not None and canonical_bytes(referenced_value(model, reference)) != canonical_bytes(value):
                raise ValueError('单元格与来源运行记录不一致。')
            unit_reference = cell.get('unit_ref')
            if unit_reference is not None and 'source_id' in unit_reference:
                if referenced_value(model, unit_reference) != cell.get('unit'):
                    raise ValueError('单位与冻结来源不一致。')
        expected_roles = [role for role, _label in SIGNATURE_ROLES]
        if [item['role'] for item in model['signatures']] != expected_roles:
            raise ValueError('必须保留设计、校核、审核、批准四个独立签栏。')
        for item in model['signatures']:
            if not item.get('evidence_ref') and any(item.get(key) for key in ('name', 'date')):
                raise ValueError('签栏没有真实记录依据。')
            body_text.extend(str(item.get(key) or '') for key in ('label', 'name', 'date'))
        if any(re.search(r'\b(?:x-)?cablesim\.[a-zA-Z0-9_.-]+', text) for text in body_text):
            raise ValueError('正文含有原始方法标识，须使用保存的方法名称或放入追溯章节。')
        if 'source_digest' in model and model['source_digest'] != jsonsha(model['sources']):
            raise ValueError('来源集合摘要不一致。')
        if 'model_digest' in model and model['model_digest'] != jsonsha({key: value for key, value in model.items() if key != 'model_digest'}):
            raise ValueError('交付模型摘要不一致。')
    except (KeyError, IndexError, TypeError, ValueError, OverflowError) as error:
        fail('FORMAL_SOURCE_INTEGRITY', str(error))


def public_model(model: dict) -> dict:
    """The preview exposes cells and provenance; files retain full snapshots."""
    return {**model, 'sources': {key: {field: value for field, value in source.items() if field != 'payload'}
                                for key, source in model['sources'].items()}}


def filename(model: dict, extension: str) -> str:
    number = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', model['metadata']['number']).strip(' .')
    return f"{number or 'CableSimPro'}-{model['kind']}.{extension}"
