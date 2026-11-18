"""Legacy Studio names and the packaged host share one runtime and source data."""
from hashlib import sha256
import os
from pathlib import Path
import subprocess
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
MODULES = ('basis', 'catalogue', 'designation', 'library', 'runner', 'structure',
           'tables', 'product', 'methods', 'scene', 'study', 'layouts')


@pytest.mark.parametrize('first', ['backend.kernel.catalogue_core', 'studio_core', 'studio.core.studio_core'])
def test_both_studio_import_names_share_canonical_identity_in_any_order(tmp_path, first):
    script = '''
from importlib import import_module
from pathlib import Path
import sys

import_module(sys.argv[1])
canonical = import_module('backend.kernel.catalogue_core')
root = Path(sys.argv[2])
assert canonical.REPO == root
assert canonical.PLUGINS == root / 'plugins'
names = sys.argv[3:]
for prefix in ('studio_core', 'studio.core.studio_core'):
    legacy = import_module(prefix)
    assert legacy is not canonical  # Preserve the old CLI / Studio-only package path.
    assert legacy.CoreError is canonical.CoreError
    assert legacy.REPO == canonical.REPO and legacy.PLUGINS == canonical.PLUGINS
    for name in names:
        expected = import_module('backend.kernel.catalogue_core.' + name)
        assert import_module(prefix + '.' + name) is expected
        assert getattr(legacy, name) is expected
    for name in ('geometry', 'correction', 'proposal', 'specification', '__main__'):
        module = import_module(prefix + '.' + name)
        assert Path(module.__file__).parent == root / 'studio/core/studio_core'
    cli = import_module(prefix + '.__main__')
    assert cli.handle({'id': 'ping', 'method': 'ping'}) == {'id': 'ping', 'result': {'ok': True}}
    refused = cli.handle({'id': 'missing', 'method': 'not-an-existing-method'})
    assert refused['error']['code'] == 'METHOD_UNKNOWN'
    try:
        raise legacy.CoreError('EXPECTED', 'same error identity')
    except canonical.CoreError as error:
        assert error.code == 'EXPECTED'
catalogue = import_module('backend.kernel.catalogue_core.catalogue')
assert catalogue.CATALOGUES == root / 'backend/kernel/catalogue_core/catalogues'
assert len(catalogue.tables('bahra_mv_lead_sheathed')['rows']) == 13
assert sum(len(table['rows']) for table in catalogue.tables('people_mv_xlpe')['tables']) == 46
print('canonical identities, legacy CLI handlers and 59 source rows verified')
'''
    environment = {**os.environ, 'PYTHONPATH': os.pathsep.join([str(ROOT), str(ROOT / 'studio/core')]),
                   'PYTHONDONTWRITEBYTECODE': '1'}
    result = subprocess.run([sys.executable, '-c', script, first, str(ROOT), *MODULES],
                            cwd=tmp_path, env=environment, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    assert '59 source rows verified' in result.stdout


def test_catalogue_files_have_one_physical_copy_and_pinned_canonical_bytes():
    """Pin canonical JSON, including audited guidance; original PDF identity is checked separately."""
    expected = {
        'people_mv_xlpe.json': 'a910d968e6144fbb175239b95d1da9efe0da2df372a1e18da0f1dc5aebaad3fd',
        'bahra_mv_lead_sheathed.json': 'd4b4f93b280288ef1b4f53ef2258ffffd659bf8f842cbbf1858d0caf6499ce69',
    }
    for filename, digest in expected.items():
        assert sha256((ROOT / 'backend/kernel/catalogue_core/catalogues' / filename).read_bytes()).hexdigest() == digest
        assert not (ROOT / 'studio/core/studio_core/catalogues' / filename).exists()
