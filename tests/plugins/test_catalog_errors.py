"""Unknown roots must fail as typed client errors, not uncaught resolver errors."""
import pytest
from backend.plugins.catalog import Catalog, PluginError


@pytest.mark.parametrize('plugin_id,version',[('cablesim.missing','0.1.0'),('cablesim.gmsh','9.9.9')])
def test_unknown_release_plan_is_typed_404(plugin_id,version):
    with pytest.raises(PluginError) as err:Catalog().closure(plugin_id,version)
    assert err.value.status==404 and err.value.code=='PLUGIN_NOT_FOUND'
