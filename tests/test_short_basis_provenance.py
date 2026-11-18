"""Real issuer receipts and adversarial provenance on IEC 60949 references."""
from copy import deepcopy
import math

import pytest

from backend.plugin_host import Executor
from tests.test_type_electrical import real_short_basis
from cablesim_type_electrical.basis_catalog import build
from cablesim_type_electrical.short_basis import CATALOG, queries, record


KEY = 'sc-material-constants/r1/sigma_c'
RECEIPTS = ('data_sha256', 'query_sha256', 'release_digest', 'artifact_digest')


@pytest.fixture(scope='module')
def issued():
    return real_short_basis()


def test_real_executor_receipts_match_sealed_catalogue(issued):
    assert build() == CATALOG
    assert len(issued) == len(CATALOG) == 30
    for key, reference in issued.items():
        assert {field: reference[field] for field in RECEIPTS} == {
            field: CATALOG[key][field] for field in RECEIPTS}
        assert reference['record']['citation'] == CATALOG[key]['citation']
        assert record({'basis_references': issued}, key) == reference


@pytest.mark.parametrize('field', RECEIPTS)
@pytest.mark.parametrize('change', ['replace', 'remove'])
def test_issuer_receipts_cannot_be_replaced_or_omitted(issued, field, change):
    reference = deepcopy(issued[KEY])
    if change == 'replace':
        reference[field] = '0'*64
    else:
        del reference[field]
    with pytest.raises(ValueError, match='已封签'):
        record({'basis_references': {KEY: reference}}, KEY)


@pytest.mark.parametrize('citation', ['伪造标准 2026 · Table 999 · 第 999 页', None])
def test_nested_citation_cannot_contradict_sealed_source(issued, citation):
    reference = deepcopy(issued[KEY])
    if citation is None:
        del reference['record']['citation']
    else:
        reference['record']['citation'] = citation
    with pytest.raises(ValueError, match='已封签'):
        record({'basis_references': {KEY: reference}}, KEY)


@pytest.mark.parametrize('field,value', [
    ('standard', 'IEC 60287'), ('edition', '2024'), ('locator', 'Table II'),
    ('record_id', 'sc-material-constants/r2/sigma_c'), ('printed_page', '999'),
    ('pdf_page', True), ('source_sha256', '0'*64),
])
def test_wrapper_metadata_remains_bound_to_the_original_record(issued, field, value):
    reference = deepcopy(issued[KEY])
    reference[field] = value
    with pytest.raises(ValueError, match='已封签'):
        record({'basis_references': {KEY: reference}}, KEY)


@pytest.mark.parametrize('change', ['condition', 'operation', 'fractional_value'])
def test_query_identity_and_fractional_values_have_no_tolerance(issued, change):
    reference = deepcopy(issued[KEY])
    if change == 'condition':
        reference['query']['conditions']['material'] = 'aluminium'
    elif change == 'operation':
        reference['query']['operation'] = 'browse'
    else:
        reference['record']['value'] = math.nextafter(reference['record']['value'], math.inf)
    with pytest.raises(ValueError, match='已封签'):
        record({'basis_references': {KEY: reference}}, KEY)


def test_query_artifact_identity_survives_another_real_batch(issued):
    # request_sha256 includes a fresh run UUID and all batch cases. It cannot
    # be authenticated from a single reference and is not a pinned assertion.
    # The record/answer bytes and their issuer identities are batch-independent.
    result = Executor().run('cablesim.standards-basis', 'lookup', [
        {'case_id': 'single_reference', 'input': queries()[KEY], 'parameters': {}}])
    case = result.cases[0]
    assert case.status == 'succeeded', case.error
    assert result.request_sha256 != issued[KEY]['request_sha256']
    assert case.artifact_digests['x-cablesim.standards-basis'] == issued[KEY]['artifact_digest']
    assert case.artifacts['x-cablesim.standards-basis']['records'][0] == issued[KEY]['record']
    reference = deepcopy(issued[KEY])
    reference['request_sha256'] = result.request_sha256
    assert record({'basis_references': {KEY: reference}}, KEY)['request_sha256'] == result.request_sha256
