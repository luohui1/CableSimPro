"""Request and source-reference boundaries; real engineering flows are tested separately."""
import base64
from copy import deepcopy
from io import BytesIO

from fastapi import HTTPException
from PIL import Image
from pydantic import ValidationError
import pytest

from backend.kernel.formal_contracts import (
    DocumentMetadata, PreviewRequest, SCHEMA, SIGNATURE_ROLES, decode_logo,
    jsonsha, raw_text, resolve_pointer, validate_model_refs,
)


def request():
    return {'kind': 'calculation', 'source': {'workspace_id': 'workspace', 'expected_revision': 1,
        'runs': [{'run_id': 'run', 'input_digest': '1' * 64, 'output_digest': '2' * 64}]},
        'document': {'organization': '交付验收样例单位', 'number': 'CALC-001', 'revision': 'A'}}


def test_request_cannot_supply_signatures_or_mix_source_scopes():
    value = request()
    assert PreviewRequest.model_validate(value).document.number == 'CALC-001'
    value['document']['signatures'] = {'approve': '未经审批的姓名'}
    with pytest.raises(ValidationError):
        PreviewRequest.model_validate(value)
    value = request()
    value['source']['runs'].append(dict(value['source']['runs'][0]))
    with pytest.raises(ValidationError, match='不可重复'):
        PreviewRequest.model_validate(value)
    value = request()
    value['source']['specification_digest'] = '3' * 64
    with pytest.raises(ValidationError):
        PreviewRequest.model_validate(value)


def test_logo_is_embedded_bounded_and_verified_before_rendering():
    picture = BytesIO()
    Image.new('RGB', (16, 8), (24, 62, 89)).save(picture, format='PNG')
    data_uri = 'data:image/png;base64,' + base64.b64encode(picture.getvalue()).decode()
    assert decode_logo(data_uri) == picture.getvalue()
    assert DocumentMetadata(**request()['document'], logo_data_uri=data_uri).logo_data_uri == data_uri
    for invalid in ('https://example.test/logo.png', 'file:///private/logo.png',
                    'data:image/png;base64,' + base64.b64encode(b'not an image').decode(),
                    data_uri.replace('image/png', 'image/jpeg')):
        with pytest.raises(ValueError):
            decode_logo(invalid)
    with pytest.raises(ValidationError):
        DocumentMetadata(**{**request()['document'], 'number': 'bad\r\nHeader: value'})


def reference_model():
    # These values exercise serialization, not a substitute calculation result.
    payload = {'parameters': {'a/b~c': {'value': -0.00000000000000234567891234567, 'unit': 'K⁻¹'}}}
    reference = {'source_id': 'record', 'pointer': '/parameters/a~1b~0c/value'}
    cell = {'value': payload['parameters']['a/b~c']['value'],
            'raw_text': raw_text(payload['parameters']['a/b~c']['value']), 'value_ref': reference,
            'unit': 'K⁻¹', 'unit_ref': {'source_id': 'record', 'pointer': '/parameters/a~1b~0c/unit'}}
    return {'schema': SCHEMA, 'kind': 'calculation', 'title': '计算书', 'metadata': request()['document'],
            'sources': {'record': {'kind': 'serialization-test', 'payload': payload, 'payload_digest': jsonsha(payload)}},
            'sections': [{'id': 'body', 'role': 'body', 'heading': '数据', 'table_ids': ['values'], 'paragraphs': []},
                         {'id': 'trace', 'role': 'trace', 'heading': '追溯记录', 'table_ids': [], 'paragraphs': []}],
            'tables': {'values': {'columns': [{'key': 'value', 'label': '原始数值', 'role': 'value'}],
                                  'rows': [{'id': 'source-row', 'cells': {'value': cell}}]}},
            'signatures': [{'role': role, 'label': label, 'name': None, 'date': None, 'evidence_ref': None}
                           for role, label in SIGNATURE_ROLES]}


def test_reference_validation_rejects_rounding_value_drift_and_wrong_units():
    original = reference_model()
    validate_model_refs(original)
    for field, replacement in (('raw_text', '-2.3457e-15'), ('value', -2.3457e-15), ('unit', 'K')):
        value = deepcopy(original)
        value['tables']['values']['rows'][0]['cells']['value'][field] = replacement
        with pytest.raises(HTTPException) as error:
            validate_model_refs(value)
        assert error.value.detail['code'] == 'FORMAL_SOURCE_INTEGRITY'
    assert resolve_pointer({'a/b~c': [3]}, '/a~1b~0c/0') == 3
    with pytest.raises(ValueError):
        resolve_pointer({'a/b~c': [3]}, '/a~1b~0c/00')


def test_reference_validation_keeps_unsigned_roles_blank_and_ids_out_of_body():
    model = reference_model()
    model['signatures'][-1]['name'] = '无对应记录的姓名'
    with pytest.raises(HTTPException, match='') as error:
        validate_model_refs(model)
    assert '真实记录' in error.value.detail['message']
    model = reference_model()
    model['sections'][0]['paragraphs'] = [{'text': 'cablesim.iec60287', 'source_ref': None, 'verbatim': False}]
    with pytest.raises(HTTPException) as error:
        validate_model_refs(model)
    assert '正文' in error.value.detail['message']
