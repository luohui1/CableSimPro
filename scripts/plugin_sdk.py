"""Plugin SDK: check manifests, release bytes and exact dependency closures.

Usage: python scripts/plugin_sdk.py verify                 every v2 plugin under plugins/<id>/
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
from backend.plugin_host.manifest import Manifest
from backend.plugin_host.registry import PLUGINS, Registry, seal
from backend.plugin_host.dependencies import LOCK_PATH, host_dependencies
from scripts.seal_plugin_catalog import write_json


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
                    write_json(dependency_path,dependencies)
        files = seal(path.parent)
        if data.get('files') != files or b'\r\n' in path.read_bytes():
            if data['id'] not in drifted:
                drifted.append(data['id'])
            if write:
                data['files'] = files
                Manifest.model_validate(data)
                write_json(path,data)
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
        m = Manifest.model_validate_json(args.file.read_text('utf-8'))
        print(json.dumps({'plugin_id': m.id, 'version': m.version, 'sha256': sha256(args.file.read_bytes()).hexdigest(), 'executed': False}))
    elif args.action == 'seal':
        drifted = seal_v2(args.write)
        from scripts.seal_plugin_catalog import synchronize
        registry = synchronize(args.write)
        print(json.dumps({'written' if args.write else 'out_of_date': {'v2_plugins': drifted, 'catalogue': registry}},
                         ensure_ascii=False))
        if (drifted or registry) and not args.write:
            sys.exit(1)
    else:
        registry = Registry()
        for plugin in registry.plugins.values():
            plugin.verify()
        print(json.dumps({'plugins': len(registry.plugins),
                          'v2_plugins': sorted(registry.plugins), 'executed': False}))


if __name__ == '__main__': main()
