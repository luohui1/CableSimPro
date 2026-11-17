"""The shared Studio producer issues the same release identity as the host API."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import sys

import pytest

from backend.kernel.catalogue_core import basis, library, product, runner
from backend.kernel.workspace import fingerprint
from backend.plugin_host import Registry

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'plugins/cablesim.type-electrical/src'))
from cablesim_type_electrical.short_basis import CATALOG, queries, record


@pytest.fixture(scope='module')
def references():
    values, missing = basis.resolve(queries())
    assert not missing
    assert len(values) == 30
    return values


def test_real_shared_runner_keeps_file_receipt_and_normalized_release_separate():
    query = next(iter(queries().values()))
    result = runner.run(basis.PLUGIN, 'lookup', [
        {'case_id': 'identity', 'input': query, 'parameters': {}}])
    assert result['cases'][0]['status'] == 'succeeded', result['cases'][0]
    plugin = Registry(ROOT/'plugins', plugin_id=basis.PLUGIN).get(basis.PLUGIN)
    plugin.verify()
    assert result['manifest_sha256'] == sha256((plugin.directory/'plugin.json').read_bytes()).hexdigest()
    assert result['release_digest'] == fingerprint(plugin.manifest.model_dump(mode='json', by_alias=True))
    assert result['release_digest'] != result['manifest_sha256']


def test_all_thirty_shared_references_pass_the_unchanged_strict_consumer(references):
    for key, reference in references.items():
        assert reference['record_sha256'] == reference['record']['record_sha256'] == CATALOG[key]['digest']
        assert reference['release_digest'] == CATALOG[key]['release_digest']
        assert record({'basis_references': references}, key) == reference


def test_file_byte_hash_cannot_be_substituted_for_release_identity(references):
    key = 'sc-material-constants/r1/sigma_c'
    altered = deepcopy(references[key])
    altered['release_digest'] = sha256((ROOT/'plugins/cablesim.standards-basis/plugin.json').read_bytes()).hexdigest()
    with pytest.raises(ValueError, match='已封签'):
        record({'basis_references': {key: altered}}, key)


def test_shared_product_short_circuit_uses_real_issued_references():
    cable = library.get('huayuan.yjv22-15kv-240')
    values = {'duration_s': 1.0, 'initial_temperature_k': 363.15, 'final_temperature_k': 523.15}
    result = product.short_circuit(cable, values, {
        key: 'Explicit regression condition: 1 s and conductor 90→250 °C; not a factory test'
        for key in values})
    assert result['basis_missing'] == []
    rows = [row for row in result['rows'] if row['id'].endswith(':conductor-adiabatic')]
    assert len(rows) == 3
    for row in rows:
        assert row['status'] == 'available'
        assert row['value'] == pytest.approx(34340.04159876265, abs=1e-6)
        assert row['basis_references']
        for reference in row['basis_references']:
            key = reference['record_id']
            assert record({'basis_references': {key: reference}}, key) == reference
