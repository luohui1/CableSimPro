"""Read manifests as inert JSON. Never import third-party code while browsing."""
from __future__ import annotations

import importlib.metadata
import json
import platform
from hashlib import sha256
from pathlib import Path
from .contracts import PluginManifest, Dependency, resolve_plugins
from ..foundation.contracts import content_hash

ROOT = Path(__file__).resolve().parents[2]


class PluginError(Exception):
    def __init__(self, code: str, message: str, status: int = 422):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


class Catalog:
    def __init__(self, root: Path = ROOT):
        self.root = root.resolve()
        payload = json.loads((self.root / 'plugins/registry.json').read_text('utf-8'))
        # Additive first-party release records; one catalog, one global ownership check.
        additional = []
        self.release_paths = {}
        for path in sorted((self.root/'plugins/releases').glob('*.json')):
            if path.is_symlink() or path.stat().st_size > 128*1024:
                raise ValueError('UNSAFE_RELEASE_DESCRIPTOR')
            m = PluginManifest.model_validate_json(path.read_bytes())
            if m.plugin_id in self.release_paths:
                raise ValueError('DUPLICATE_CATALOG_PLUGIN')
            self.release_paths[m.plugin_id] = path
            additional.append(m)
        self.manifests = tuple(PluginManifest.model_validate(m) for m in payload['plugins']) + tuple(additional)
        if len({m.plugin_id for m in self.manifests}) != len(self.manifests):
            raise ValueError('DUPLICATE_CATALOG_PLUGIN')
        commands = [c.id for m in self.manifests for c in m.commands]
        if len(commands) != len(set(commands)):
            raise ValueError('DUPLICATE_CATALOG_COMMAND')
        self.index = {m.plugin_id: m for m in self.manifests}
        for manifest in self.manifests:
            resolve_plugins((Dependency(plugin_id=manifest.plugin_id, version=manifest.version),), self.manifests)
        self.digest = content_hash([m.model_dump(mode='json') for m in self.manifests])

    def get(self, plugin_id: str, version: str | None = None) -> PluginManifest:
        m = self.index.get(plugin_id)
        if m is None or (version is not None and m.version != version):
            raise PluginError('PLUGIN_NOT_FOUND', '目录中没有这个确切插件版本。', 404)
        return m

    def closure(self, plugin_id: str, version: str) -> tuple[PluginManifest, ...]:
        self.get(plugin_id, version)  # Unknown root/version is a normal 404, not a server error.
        try:
            return resolve_plugins((Dependency(plugin_id=plugin_id, version=version),), self.manifests)
        except ValueError as exc:
            raise PluginError('DEPENDENCY_INVALID', '插件依赖图无效，不能生成安装计划。', 409) from exc

    def verify(self, manifest: PluginManifest) -> None:
        if manifest.distribution == 'roadmap':
            raise PluginError('NOT_IMPLEMENTED', '规划条目尚无可安装实现，不能安装或运行。', 409)
        if platform.system().lower() not in manifest.platforms:
            raise PluginError('PLATFORM_UNSUPPORTED', '此适配器未声明支持当前平台。', 409)
        for item in manifest.files:
            path = self.root / item.path
            if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(self.root):
                raise PluginError('PACKAGE_INTEGRITY', '插件文件缺失或路径不安全。', 409)
            if path.stat().st_size != item.size_bytes or sha256(path.read_bytes()).hexdigest() != item.sha256:
                raise PluginError('PACKAGE_INTEGRITY', '插件字节与版本清单不符；须重新发布，不允许静默替换。', 409)

    @staticmethod
    def environment(manifest: PluginManifest) -> dict:
        versions, missing = {}, []
        for requirement in manifest.requirements:
            try:
                version = importlib.metadata.version(requirement.distribution)
            except importlib.metadata.PackageNotFoundError:
                version = None
            versions[requirement.distribution] = version
            if version != requirement.version:
                missing.append(f'{requirement.distribution}=={requirement.version}')
        return {'versions': versions, 'missing': missing,
                'metadata_ready': not missing, 'native_import_verified': False}
