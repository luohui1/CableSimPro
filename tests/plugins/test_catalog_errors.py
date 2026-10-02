"""Unknown roots must fail as typed client errors, not uncaught resolver errors."""
import pytest
import json
from pathlib import Path
from backend.plugins.catalog import Catalog, PluginError


@pytest.mark.parametrize('plugin_id,version',[('cablesim.missing','0.1.0'),('cablesim.gmsh','9.9.9')])
def test_unknown_release_plan_is_typed_404(plugin_id,version):
    with pytest.raises(PluginError) as err:Catalog().closure(plugin_id,version)
    assert err.value.status==404 and err.value.code=='PLUGIN_NOT_FOUND'


def test_v1_and_v2_cannot_publish_conflicting_plugin_ids(tmp_path):
    root = Path(__file__).resolve().parents[2]
    directory = tmp_path / 'plugins/cablesim.iec60287'
    directory.mkdir(parents=True)
    (directory / 'plugin.json').write_bytes((root / 'plugins/cablesim.iec60287/plugin.json').read_bytes())
    catalog = json.loads((root / 'plugins/registry.json').read_text('utf-8'))
    roadmap = next(m for m in catalog['plugins'] if m['plugin_id'] == 'cablesim.dolfinx')
    roadmap['plugin_id'] = 'cablesim.iec60287'
    (tmp_path / 'plugins/registry.json').write_text(json.dumps(catalog), 'utf-8')
    with pytest.raises(ValueError, match='DUPLICATE_CATALOG_PROTOCOL'):
        Catalog(tmp_path)
