"""Real fresh-process CAD finalization tests; file existence alone is not success."""
from importlib import metadata
from pathlib import Path
import subprocess
import sys
import pytest
from backend.plugins.service import safe_environment


@pytest.mark.parametrize('attempt', range(5))
def test_cad_import_export_and_natural_exit(tmp_path, attempt):
    expected = {'cadquery': '2.8.0', 'cadquery-ocp': '7.9.3.1.1',
                'vtk': '9.6.2', 'casadi': '3.7.2', 'nlopt': '2.11.0'}
    assert {name: metadata.version(name) for name in expected} == expected
    script = '''
import math
import nlopt
import casadi
import cadquery as cq
shape = cq.Workplane('XY').circle(10).extrude(250)
assert shape.val().isValid()
assert math.isclose(shape.val().Volume(), math.pi*10**2*250, rel_tol=1e-9)
cq.exporters.export(shape, 'roundtrip.step')
loaded = cq.importers.importStep('roundtrip.step')
assert len(loaded.solids().vals()) == 1
assert loaded.val().isValid()
assert math.isclose(loaded.val().Volume(), shape.val().Volume(), rel_tol=1e-9)
print('CAD_VALIDATED_NATURAL_EXIT', flush=True)
'''
    child = subprocess.run([sys.executable, '-I', '-X', 'faulthandler', '-u', '-c', script],
                           cwd=tmp_path, env=safe_environment(tmp_path), capture_output=True,
                           timeout=40, check=False)
    assert child.returncode == 0, (attempt, child.returncode, child.stderr[-2000:])
    assert b'CAD_VALIDATED_NATURAL_EXIT' in child.stdout
    assert (tmp_path/'roundtrip.step').is_file()
