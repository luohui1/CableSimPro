"""Reject malformed structural snapshots before starting a plugin process."""
from copy import deepcopy
from pathlib import Path
import subprocess
import sys

import pytest

from backend.plugin_host import Executor
from backend.plugin_host.executor import validate_domain_input
from backend.plugin_host.registry import PluginHostError


def structural_fragment():
    return {
        'schema_version': 'cablesim.domain/1',
        'materials': [{'id': 'material/cu', 'category': 'conductor'}],
        'cable_types': [{
            'id': 'cable_type/example',
            'cores': [{'conductor': {'material': 'material/cu', 'diameter': .02}, 'layers': []}],
            'common_layers': [],
        }],
    }


@pytest.mark.parametrize('invalid,field', [
    ('schema', 'schema_version'),
    ('nan', 'conductor.diameter'),
    ('reference', 'conductor.material'),
    ('measurement', 'measurements.0'),
])
def test_domain_wire_error_starts_no_worker_and_creates_no_artifact(tmp_path, invalid, field):
    document = structural_fragment()
    conductor = document['cable_types'][0]['cores'][0]['conductor']
    if invalid == 'schema':
        document['schema_version'] = 'unsupported'
    elif invalid == 'nan':
        conductor['diameter'] = float('nan')
    elif invalid == 'reference':
        conductor['material'] = 'material/missing'
    else:
        document['measurements'] = [{
            'id': 'measurement/r20', 'cable_type': 'cable_type/example', 'core': 'core/1',
            'role': 'conductor', 'quantity': 'r20', 'value': .000075, 'unit': 'm',
            'basis': 'measurement', 'source': {'kind': 'measurement', 'reference': 'test report'},
        }]

    def forbidden_worker(*args, **kwargs):
        pytest.fail('Invalid domain input reached the plugin process')

    host = Executor(jobs_root=tmp_path, verify=False, process_runner=forbidden_worker)
    with pytest.raises(PluginHostError) as error:
        host.check('cablesim.standard-check', 'dimensions', [{
            'case_id': 'invalid', 'input': document, 'parameters': {'cable_type_id': 'cable_type/example'},
        }])
    assert error.value.code == 'INPUT_CONTRACT_VIOLATION'
    assert field in error.value.message
    assert not list(tmp_path.iterdir())


def test_wire_validation_preserves_partial_structural_facts():
    document = structural_fragment()
    original = deepcopy(document)
    validate_domain_input(document)
    assert document == original
    assert 'circuits' not in document and 'rating' not in document['cable_types'][0]


def test_frozen_host_validation_imports_without_the_source_checkout(tmp_path):
    from backend.kernel.batch_runtime import freeze_runtime

    repository = Path(__file__).resolve().parents[1]
    freeze_runtime(tmp_path, 'cablesim.type-electrical', repository)
    probe = (
        'import sys;sys.path.insert(0,sys.argv[1]);'
        'from backend.plugin_host import Executor;'
        'from cablesim_sdk.domain import FactoryMeasurement;'
        'print("frozen-host-ready")'
    )
    result = subprocess.run(
        [sys.executable, '-I', '-c', probe, str(tmp_path/'runtime')],
        cwd=tmp_path, capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == 'frozen-host-ready'
