"""Plugin SDK: check manifests, release bytes and exact dependency closures.

Usage: python scripts/plugin_sdk.py verify                 every v2 plugin under plugins/<id>/
       python scripts/plugin_sdk.py manifest path/to/plugin.json
       python scripts/plugin_sdk.py seal [plugins/<id>/plugin.json] [--write]
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
from backend.plugin_host.registry import PLUGINS, Registry, PluginHostError, seal
from backend.plugin_host.dependencies import LOCK_PATH, host_dependencies, DependencySnapshot, dependency_batch
from scripts.seal_plugin_catalog import write_json


def seal_v2(write: bool, selected: Path | None = None) -> list[str]:
    drifted = []
    snapshot = DependencySnapshot(PLUGINS.parent)
    for path in sorted(PLUGINS.glob('*/plugin.json')):
        plugin_id = path.parent.name
        writable = write and (selected is None or path.resolve() == selected)
        try:
            data = json.loads(path.read_text('utf-8'))
            dependencies = host_dependencies(path.parent, snapshot)
            dependency_path = path.parent / LOCK_PATH
            if dependencies or dependency_path.exists():
                current = json.loads(dependency_path.read_text('utf-8')) if dependency_path.exists() else None
                if current != dependencies:
                    drifted.append(plugin_id)
                    if writable:
                        write_json(dependency_path,dependencies)
            files = seal(path.parent)
            if data.get('files') != files or b'\r\n' in path.read_bytes():
                if plugin_id not in drifted:
                    drifted.append(plugin_id)
                if writable:
                    data['files'] = files
                    Manifest.model_validate(data)
                    write_json(path,data)
        except (OSError, ValueError, SyntaxError, KeyError, TypeError, PluginHostError):
            if selected is None or path.resolve() == selected:
                raise
            if path.parent.name not in drifted:
                drifted.append(path.parent.name)
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
        selected = args.file.resolve() if args.file is not None else None
        if selected is not None and (selected.parent.parent != PLUGINS.resolve() or selected.name != 'plugin.json' or not selected.is_file()):
            parser.error('seal requires a registered plugins/<id>/plugin.json manifest')
        if selected is not None:
            manifest = Manifest.model_validate_json(selected.read_bytes())
            if manifest.id != selected.parent.name:
                parser.error('manifest ID must match the selected plugin directory')
        drifted = seal_v2(args.write, selected)
        from scripts.seal_plugin_catalog import synchronize, catalogue_drift
        other_catalogue = catalogue_drift(exclude=selected.parent.name) if selected else []
        registry = synchronize(args.write, plugin_id=selected.parent.name if selected else None)
        other = [name for name in drifted if selected is not None and name != selected.parent.name]
        affected = [name for name in drifted if name not in other]
        if other or other_catalogue:
            print(json.dumps({'warning':'其他插件存在漂移，未写入；请由各插件维护者处理。',
                              'v2_plugins':other,'catalogue_plugins':other_catalogue},ensure_ascii=False),file=sys.stderr)
        print(json.dumps({'written' if args.write else 'out_of_date': {'v2_plugins': affected, 'catalogue': registry}},
                         ensure_ascii=False))
        if (affected or registry) and not args.write:
            sys.exit(1)
    else:
        registry = Registry()
        with dependency_batch(DependencySnapshot(registry.root.parent)):
            for plugin in registry.plugins.values():
                plugin.verify()
        print(json.dumps({'plugins': len(registry.plugins),
                          'v2_plugins': sorted(registry.plugins), 'executed': False}))


if __name__ == '__main__': main()
