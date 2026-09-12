"""Pure contracts: no web, native engine imports, or synthetic engineering claims."""
import copy
import json
import sys
import pytest
from backend.plugins.catalog import Catalog, PluginError
from backend.plugins.contracts import PluginManifest, Dependency, resolve_plugins


def raw():return Catalog().get('cablesim.gmsh').model_dump(mode='json')

@pytest.mark.parametrize('permission',['shell','sql','network.any','project.approve','project.unlock','credentials.read'])
def test_privileged_permissions_never_enter_v1(permission):
    m=raw();m['permissions'].append(permission)
    with pytest.raises(ValueError):PluginManifest.model_validate(m)

@pytest.mark.parametrize('path',['../outside','/tmp/a','D:/secrets','bad\\name','CON','a/../../b'])
def test_payload_paths_reject_escaping_and_windows_unsafe(path):
    m=raw();m['files'][0]['path']=path
    with pytest.raises(ValueError):PluginManifest.model_validate(m)

@pytest.mark.parametrize('version',['latest','*','^1.0.0','01.2.0','1.0','1.0.0-beta'])
def test_v1_requires_exact_stable_semver(version):
    m=raw();m['version']=version
    with pytest.raises(ValueError):PluginManifest.model_validate(m)


def test_unverified_and_roadmap_do_not_claim_validated_installation():
    m=raw();m['scope']['validation']='cross-validated'
    with pytest.raises(ValueError):PluginManifest.model_validate(m)
    m=raw();m['distribution']='roadmap'
    with pytest.raises(ValueError):PluginManifest.model_validate(m)
    m=raw();m['commands'][0]['effect']='proposal'
    with pytest.raises(ValueError):PluginManifest.model_validate(m)


def test_dependency_closure_order_and_cycle_missing_and_versions():
    c=Catalog();roots=(Dependency(plugin_id='cablesim.pyvista',version='0.1.2'),)
    assert [m.plugin_id for m in resolve_plugins(roots,c.manifests)]==['cablesim.gmsh','cablesim.meshio','cablesim.thermal2d','cablesim.pyvista']
    a=raw();b=copy.deepcopy(a);a['plugin_id']='test.one';b['plugin_id']='test.two'
    a['dependencies']=[{'plugin_id':'test.two','version':'0.1.2'}];b['dependencies']=[{'plugin_id':'test.one','version':'0.1.2'}]
    with pytest.raises(ValueError,match='CYCLE'):resolve_plugins((Dependency(plugin_id='test.one',version='0.1.2'),),tuple(PluginManifest.model_validate(m) for m in [a,b]))
    with pytest.raises(ValueError,match='MISSING'):resolve_plugins((Dependency(plugin_id='test.missing',version='1.0.0'),),c.manifests)


def test_catalog_is_inert_and_real_files_are_sealed():
    before=set(sys.modules);c=Catalog()
    assert len(c.manifests)==19
    assert c.get('cablesim.electrothermal-reference').version=='0.1.0'
    for m in c.manifests:
        c.environment(m)
        if m.distribution=='roadmap':
            with pytest.raises(PluginError,match='规划'):c.verify(m)
        else:c.verify(m)
    assert not ({'gmsh','cadquery','skfem','pyvista','meshio'} & (set(sys.modules)-before))


def test_release_corruption_and_duplicate_rejected(tmp_path):
    c=Catalog();m=c.get('cablesim.gmsh');changed=m.model_dump(mode='json');changed['files'][0]['sha256']='0'*64
    with pytest.raises(PluginError):c.verify(PluginManifest.model_validate(changed))
    (tmp_path/'plugins').mkdir();(tmp_path/'plugins/registry.json').write_text(json.dumps({'plugins':[raw(),raw()]}))
    with pytest.raises(ValueError,match='DUPLICATE'):Catalog(tmp_path)


def test_checked_in_schemas_match_runtime_contract():
    from backend.plugins.contracts import ProjectPluginLock
    from backend.plugins.managed_commands import COMMAND_ARGUMENTS
    c=Catalog()
    assert json.loads((c.root/'plugin-spec/manifest.schema.json').read_text())==PluginManifest.model_json_schema()
    assert json.loads((c.root/'plugin-spec/project-lock.schema.json').read_text())==ProjectPluginLock.model_json_schema()
    assert json.loads((c.root/'plugin-spec/commands.schema.json').read_text())=={k:v.model_json_schema() for k,v in COMMAND_ARGUMENTS.items()}
