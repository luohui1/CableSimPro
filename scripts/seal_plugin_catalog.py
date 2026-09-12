"""Maintainer-only pre-release sealing. This is not installation or signing.

Default is check-only; --write-draft explicitly regenerates source digests and
machine schemas before publishing a release. Distributed versions must not be
resealed in place; bump plugin versions and re-review the dependency pins first.
No plugin modules or optional engineering libraries are imported.
"""
from pathlib import Path
from hashlib import sha256
import argparse
import json
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.plugins.contracts import PluginManifest, ProjectPluginLock
from backend.plugins.managed_commands import COMMAND_ARGUMENTS
from backend.plugins.buried_contract import BuriedField, BuriedSummary
from backend.plugins.electrothermal_contract import ElectrothermalSummary
from backend.plugins.line_source_contract import LineSourceComparison
from backend.plugins.catalog import Catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-draft', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    catalog = Catalog(root)
    releases = []
    for manifest in catalog.manifests:
        if not args.write_draft:
            if manifest.distribution != 'roadmap':
                catalog.verify(manifest)
            continue
        data = manifest.model_dump(mode='json')
        for item in data['files']:
            path = root / item['path']
            if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
                raise ValueError('UNSAFE_RELEASE_PATH')
            item.update(sha256=sha256(path.read_bytes()).hexdigest(), size_bytes=path.stat().st_size)
        sealed = PluginManifest.model_validate(data).model_dump(mode='json')
        if manifest.plugin_id in catalog.release_paths:
            catalog.release_paths[manifest.plugin_id].write_text(json.dumps(sealed,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        else:
            releases.append(sealed)
    schemas = {'manifest': PluginManifest.model_json_schema(),
               'project-lock': ProjectPluginLock.model_json_schema(),
               'commands': {k: v.model_json_schema() for k, v in COMMAND_ARGUMENTS.items()},
               'buried-field': BuriedField.model_json_schema(),
               'buried-summary': BuriedSummary.model_json_schema(),
               'electrothermal-summary': ElectrothermalSummary.model_json_schema(),
               'line-source-crosscheck': LineSourceComparison.model_json_schema()}
    for name, schema in schemas.items():
        path = root / f'plugin-spec/{name}.schema.json'
        if args.write_draft:
            path.write_text(json.dumps(schema, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        elif json.loads(path.read_text('utf-8')) != schema:
            raise ValueError(f'SCHEMA_DRIFT: {name}')
    if args.write_draft:
        (root / 'plugins/registry.json').write_text(json.dumps(
            {'schema_version': 'cablesim.catalog/1', 'plugins': releases},
            ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'plugins': len(catalog.manifests), 'wrote_draft': args.write_draft,
                      'executed_plugins': False, 'signed': False}))


if __name__ == '__main__':
    main()
