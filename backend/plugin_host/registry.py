"""Discover first-party v2 plugins under plugins/<id>/ and verify their sealed files.

A plugin is only runnable when every file listed in its manifest exists inside its own
package directory with the recorded SHA-256 and size, and no unlisted file is present
under src/. Digests prove consistency with the reviewed manifest, not safety or
correctness. Changing one plugin never invalidates another plugin's seal.
"""
from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path

from .manifest import Manifest

ROOT = Path(__file__).resolve().parents[2]
PLUGINS = ROOT / 'plugins'
IGNORED = {'__pycache__'}


class PluginHostError(Exception):
    def __init__(self, code: str, message: str, status: int = 422):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def package_files(directory: Path) -> list[Path]:
    src = directory / 'src'
    if not src.is_dir():
        return []
    return sorted(p for p in src.rglob('*') if p.is_file() and not IGNORED & set(p.relative_to(directory).parts)
                  and p.suffix != '.pyc')


def seal(directory: Path) -> list[dict]:
    """Digest records for every package source file (maintainer tool; see scripts/plugin_sdk.py)."""
    records = []
    for path in package_files(directory):
        if path.is_symlink():
            raise PluginHostError('UNSAFE_PACKAGE_PATH', f'不允许符号链接：{path}')
        data = path.read_bytes()
        records.append({'path': path.relative_to(directory).as_posix(), 'sha256': sha256(data).hexdigest(),
                        'size_bytes': len(data)})
    return records


class Plugin:
    def __init__(self, directory: Path, manifest: Manifest):
        self.directory, self.manifest = directory, manifest

    @property
    def entry(self) -> Path:
        return self.directory / self.manifest.runtime.entry

    def verify(self) -> None:
        listed = {f.path: f for f in self.manifest.files}
        actual = {p.relative_to(self.directory).as_posix() for p in package_files(self.directory)}
        if actual != set(listed):
            extra, missing = sorted(actual - set(listed)), sorted(set(listed) - actual)
            raise PluginHostError('PACKAGE_FILES_MISMATCH', f'{self.manifest.id}: 未登记 {extra}，缺失 {missing}', 409)
        for path, record in listed.items():
            file = self.directory / path
            if file.is_symlink() or not file.resolve().is_relative_to(self.directory.resolve()):
                raise PluginHostError('UNSAFE_PACKAGE_PATH', f'{self.manifest.id}: {path}', 409)
            data = file.read_bytes()
            if len(data) != record.size_bytes or sha256(data).hexdigest() != record.sha256:
                raise PluginHostError('PACKAGE_DIGEST_MISMATCH', f'{self.manifest.id}: {path} 与清单摘要不一致', 409)


class Registry:
    def __init__(self, root: Path = PLUGINS):
        self.root = root
        self.plugins: dict[str, Plugin] = {}
        for manifest_path in sorted(root.glob('*/plugin.json')):
            manifest = Manifest.model_validate(json.loads(manifest_path.read_text('utf-8')))
            if manifest.id != manifest_path.parent.name:
                raise PluginHostError('PLUGIN_DIRECTORY_MISMATCH', f'{manifest_path.parent.name} 目录中的清单 ID 为 {manifest.id}')
            if manifest.id in self.plugins:
                raise PluginHostError('DUPLICATE_PLUGIN', manifest.id)
            self.plugins[manifest.id] = Plugin(manifest_path.parent, manifest)

    def get(self, plugin_id: str) -> Plugin:
        try:
            return self.plugins[plugin_id]
        except KeyError:
            raise PluginHostError('PLUGIN_UNKNOWN', f'未登记插件 {plugin_id}', 404) from None
