"""Plugin SDK: check manifests, release bytes and exact dependency closures.

Usage: python scripts/plugin_sdk.py verify                 v1 catalogue + every v2 plugin under plugins/<id>/
       python scripts/plugin_sdk.py manifest path/to/plugin.json
       python scripts/plugin_sdk.py seal [--write]         v2 plugins: check (default) or rewrite each files[] seal
This tool does not install packages, import plugin modules, or execute hooks.
Resealing is a maintainer action for unreleased versions; a released version must bump its version first.
"""
from pathlib import Path
from hashlib import sha256
import argparse
import json
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.plugins.catalog import Catalog
from backend.plugins.contracts import PluginManifest
from backend.plugin_host.manifest import Manifest
from backend.plugin_host.registry import PLUGINS, Registry, seal
from backend.plugin_host.dependencies import LOCK_PATH, host_dependencies


def seal_v2(write: bool) -> list[str]:
    drifted = []
    for path in sorted(PLUGINS.glob('*/plugin.json')):
        data = json.loads(path.read_text('utf-8'))
        dependencies = host_dependencies(path.parent)
        dependency_path = path.parent / LOCK_PATH
        if dependencies or dependency_path.exists():
            current = json.loads(dependency_path.read_text('utf-8')) if dependency_path.exists() else None
            if current != dependencies:
                drifted.append(data['id'])
                if write:
                    dependency_path.write_text(json.dumps(dependencies, ensure_ascii=False, indent=2) + '\n',
                                               encoding='utf-8', newline='\n')
        files = seal(path.parent)
        if data.get('files') != files or b'\r\n' in path.read_bytes():
            if data['id'] not in drifted:
                drifted.append(data['id'])
            if write:
                data['files'] = files
                Manifest.model_validate(data)
                path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    return drifted


def seal_v1_registry(write: bool) -> list[str]:
    """Refresh source seals structurally, including shared file lists in the v1 catalog."""
    root = PLUGINS.parent
    drifted = []
    for path in [PLUGINS / 'registry.json', *sorted((PLUGINS / 'releases').glob('*.json'))]:
        catalog = json.loads(path.read_text('utf-8'))
        changed = False
        for entry in catalog.get('plugins', [catalog]):
            files = []
            for f in entry['files']:
                data = (root / f['path']).read_bytes()
                files.append({'path': f['path'], 'sha256': sha256(data).hexdigest(), 'size_bytes': len(data)})
            if files != entry['files']:
                drifted.append(entry['plugin_id'])
                entry['files'] = files
                changed = True
        if write and changed:
            path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return drifted


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['verify', 'manifest', 'seal'])
    parser.add_argument('file', nargs='?', type=Path)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    if args.action == 'manifest':
        if args.file is None: parser.error('manifest requires a file')
        if args.file.stat().st_size > 1024 * 1024: raise ValueError('MANIFEST_SIZE_LIMIT')
        m = PluginManifest.model_validate_json(args.file.read_text('utf-8'))
        print(json.dumps({'plugin_id': m.plugin_id, 'version': m.version, 'sha256': m.digest(), 'executed': False}))
    elif args.action == 'seal':
        drifted = seal_v2(args.write)
        registry = seal_v1_registry(args.write)
        print(json.dumps({'written' if args.write else 'out_of_date': {'v2_plugins': drifted, 'v1_catalogue': registry}},
                         ensure_ascii=False))
        if (drifted or registry) and not args.write:
            sys.exit(1)
    else:
        catalog = Catalog()
        for m in catalog.manifests:
            if m.distribution != 'roadmap': catalog.verify(m)
        registry = Registry()
        for plugin in registry.plugins.values():
            plugin.verify()
        print(json.dumps({'plugins': len(catalog.manifests), 'catalog_sha256': catalog.digest,
                          'v2_plugins': sorted(registry.plugins), 'executed': False}))


if __name__ == '__main__': main()
