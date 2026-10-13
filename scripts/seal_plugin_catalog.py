"""Check the v2 catalog and executable physical-artifact schemas; no plugins execute."""
from pathlib import Path
import argparse
import json
import os
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.plugin_host.registry import Registry, PluginHostError
from backend.plugin_host.manifest import Manifest
from backend.plugin_host.buried_contract import BuriedField, BuriedSummary
from backend.plugin_host.electrothermal_contract import ElectrothermalSummary
from backend.plugin_host.line_source_contract import LineSourceComparison
from backend.kernel.workspace import fingerprint
from cablesim_sdk.simulation_artifacts import TemperatureField
from cablesim_sdk.result_answers import HeadlineWitness

ROOT = Path(__file__).resolve().parents[1]


def write_json(path,value):
    """Readers observe the previous or next complete seal, never truncated JSON."""
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent,prefix='.',suffix='.part',delete=False) as stream:
        temporary=Path(stream.name)
        stream.write((json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
    try:os.replace(temporary,path)
    finally:temporary.unlink(missing_ok=True)


def catalogue_drift(*, exclude=None):
    """Read-only reminders; a targeted seal never repairs foreign entries."""
    path = ROOT/'plugins/registry.json'
    current = json.loads(path.read_text('utf-8'))
    installed = {entry['plugin_id']:entry for entry in current['plugins']}
    drifted = []
    names = set()
    for manifest_path in sorted((ROOT/'plugins').glob('*/plugin.json')):
        name = manifest_path.parent.name
        names.add(name)
        if name == exclude:
            continue
        try:
            plugin = Registry(ROOT/'plugins', plugin_id=name).get(name)
            entry = {'plugin_id':name,'version':plugin.manifest.version,
                     'manifest':'plugins/'+name+'/plugin.json',
                     'release_digest':fingerprint(plugin.manifest.model_dump(mode='json',by_alias=True))}
            if installed.get(name) != entry:
                drifted.append(name)
        except (OSError, ValueError, PluginHostError):
            drifted.append(name)
    drifted.extend(sorted(set(installed)-names-{exclude}))
    return drifted


def synchronize(write=False, *, plugin_id=None):
    registry = Registry(plugin_id=plugin_id)
    catalogue = {'schema_version':'cablesim.catalog/2', 'plugins':[
        {'plugin_id':p.manifest.id, 'version':p.manifest.version,
         'manifest':'plugins/'+p.manifest.id+'/plugin.json',
         'release_digest':fingerprint(p.manifest.model_dump(mode='json',by_alias=True))}
        for p in registry.plugins.values()]}
    if plugin_id is not None:
        path = ROOT/'plugins/registry.json'
        current = json.loads(path.read_text('utf-8'))
        entry = catalogue['plugins'][0]
        entries = current['plugins']
        previous = next((item for item in entries if item['plugin_id'] == plugin_id), None)
        if previous == entry:
            return []
        current['plugins'] = [entry if item['plugin_id'] == plugin_id else item for item in entries]
        if previous is None:
            current['plugins'].append(entry)
        if write:
            write_json(path, current)
        return ['plugins/registry.json']
    schemas = {'manifest':Manifest.model_json_schema(),
               'temperature-field':TemperatureField.model_json_schema(),
               'headline-witness':HeadlineWitness.model_json_schema(),
               'buried-field':BuriedField.model_json_schema(), 'buried-summary':BuriedSummary.model_json_schema(),
               'electrothermal-summary':ElectrothermalSummary.model_json_schema(),
               'line-source-crosscheck':LineSourceComparison.model_json_schema()}
    expected = {ROOT/'plugins/registry.json':catalogue, **{
        ROOT/('plugin-spec/'+name+'.schema.json'):value for name,value in schemas.items()}}
    drifted = []
    for path,value in expected.items():
        if not path.is_file() or json.loads(path.read_text('utf-8')) != value:
            drifted.append(path.relative_to(ROOT).as_posix())
            if write:
                path.parent.mkdir(parents=True,exist_ok=True)
                write_json(path,value)
    return drifted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-draft',action='store_true')
    args = parser.parse_args()
    drifted = synchronize(args.write_draft)
    if drifted and not args.write_draft:
        raise ValueError('CATALOG_SCHEMA_DRIFT: '+', '.join(drifted))
    print(json.dumps({'plugins':len(Registry().plugins),'wrote_draft':args.write_draft,'executed_plugins':False,'signed':False}))


if __name__ == '__main__':
    main()
