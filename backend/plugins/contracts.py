"""Manifest-first plugin contracts. Reuse R2's quantity/path/hash vocabulary.

A declaration is not a permission grant, numerical validation, or OS sandbox.
"""
from __future__ import annotations

from typing import Annotated, Literal
from pydantic import Field, model_validator
from ..foundation.contracts import Contract, Digest, PayloadFile, content_hash

PluginId = Annotated[str, Field(pattern=r'^[a-z][a-z0-9-]{1,39}\.[a-z][a-z0-9-]{1,63}$')]
ReleaseVersion = Annotated[str, Field(pattern=r'^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')]
Permission = Literal['project.read', 'project.propose', 'study.run', 'artifact.read', 'artifact.write']
Category = Literal['design', 'mesh', 'analysis', 'data', 'visualization', 'report', 'validation']


class Dependency(Contract):
    plugin_id: PluginId
    version: ReleaseVersion


# Runtime distributions can use multi-component releases (e.g. OCP 7.9.3.1.1).
# Keep these exact numeric pins distinct from the plugin's x.y.z release version.
RuntimeVersion = Annotated[str, Field(pattern=r'^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*)){1,5}$', max_length=64)]


class RuntimeRequirement(Contract):
    distribution: str = Field(pattern=r'^[A-Za-z][A-Za-z0-9_.-]{0,63}$')
    version: RuntimeVersion


class Command(Contract):
    id: str = Field(pattern=r'^[a-z][a-z0-9_.-]{2,99}$')
    title: str = Field(min_length=1, max_length=100)
    effect: Literal['read', 'proposal', 'study', 'artifact']
    input_contract: str = Field(min_length=3, max_length=100)
    output_contract: str = Field(min_length=3, max_length=100)
    ui_slot: Literal['command', 'inspector', 'canvas', 'results', 'artifacts']


class EngineeringScope(Contract):
    description: str = Field(min_length=10, max_length=1500)
    limitations: tuple[str, ...] = Field(min_length=1, max_length=20)
    validation: Literal['unverified', 'contract-tests', 'analytic-benchmark', 'cross-validated']
    evidence: tuple[str, ...] = Field(default=(), max_length=30)


class PluginManifest(Contract):
    schema_version: Literal['cablesim.plugin/1'] = 'cablesim.plugin/1'
    plugin_id: PluginId
    version: ReleaseVersion
    api_major: Literal[1] = 1
    name: str = Field(min_length=1, max_length=100)
    publisher: str = Field(min_length=1, max_length=80)
    category: Category
    runtime: Literal['host', 'python-worker', 'external', 'frontend']
    distribution: Literal['core', 'bundled-adapter', 'roadmap']
    adapter_license: str = Field(min_length=1, max_length=100)
    upstream: str = Field(default='', max_length=250)
    upstream_license: str = Field(default='', max_length=200)
    license_review_required: bool = Field(default=False, strict=True)
    platforms: tuple[Literal['linux', 'windows', 'darwin'], ...] = Field(min_length=1)
    permissions: tuple[Permission, ...] = Field(default=(), max_length=5)
    dependencies: tuple[Dependency, ...] = Field(default=(), max_length=12)
    requirements: tuple[RuntimeRequirement, ...] = Field(default=(), max_length=12)
    commands: tuple[Command, ...] = Field(min_length=1, max_length=30)
    scope: EngineeringScope
    files: tuple[PayloadFile, ...] = Field(default=(), max_length=64)

    @model_validator(mode='after')
    def check_members(self) -> PluginManifest:
        for values in (self.permissions, self.platforms,
                       tuple(c.id for c in self.commands),
                       tuple(d.plugin_id for d in self.dependencies),
                       tuple(r.distribution.lower() for r in self.requirements),
                       tuple(f.path.casefold() for f in self.files)):
            if len(values) != len(set(values)):
                raise ValueError('DUPLICATE_PLUGIN_MEMBER')
        if any(d.plugin_id == self.plugin_id for d in self.dependencies):
            raise ValueError('SELF_DEPENDENCY')
        required = {'proposal': 'project.propose', 'study': 'study.run', 'artifact': 'artifact.write'}
        for c in self.commands:
            permission = required.get(c.effect)
            if permission and permission not in self.permissions:
                raise ValueError('EFFECT_PERMISSION_MISSING')
        if self.distribution == 'roadmap' and self.files:
            raise ValueError('ROADMAP_MUST_NOT_ADVERTISE_INSTALLABLE_FILES')
        if self.distribution != 'roadmap' and not self.files:
            raise ValueError('RELEASE_REQUIRES_VERIFIABLE_FILES')
        if self.distribution == 'core' and self.runtime != 'host':
            raise ValueError('CORE_MUST_USE_HOST_RUNTIME')
        if self.scope.validation != 'unverified' and not self.scope.evidence:
            raise ValueError('VALIDATION_REQUIRES_EVIDENCE_REFERENCE')
        return self

    def digest(self) -> str:
        return content_hash(self)


class PluginPin(Contract):
    plugin_id: PluginId
    version: ReleaseVersion
    release_sha256: Digest
    permissions: tuple[Permission, ...]


class ProjectPluginLock(Contract):
    schema_version: Literal['cablesim.plugin-lock/1'] = 'cablesim.plugin-lock/1'
    project_id: str
    project_revision: int = Field(ge=1, strict=True)
    lock_revision: int = Field(ge=0, strict=True)
    plugins: tuple[PluginPin, ...]

    def digest(self) -> str:
        return content_hash(self)


def resolve_plugins(roots: tuple[Dependency, ...], manifests: tuple[PluginManifest, ...]) -> tuple[PluginManifest, ...]:
    """Exact, bounded closure. No 'latest', implicit upgrades, or version coercion."""
    if len(manifests) > 256 or len(roots) > 32:
        raise ValueError('PLUGIN_GRAPH_LIMIT')
    index = {(m.plugin_id, m.version): m for m in manifests}
    if len(index) != len(manifests):
        raise ValueError('DUPLICATE_PLUGIN_RELEASE')
    visiting: set[str] = set()
    resolved: dict[str, PluginManifest] = {}

    def visit(ref: Dependency, depth: int) -> None:
        if depth > 32:
            raise ValueError('PLUGIN_DEPENDENCY_DEPTH')
        if ref.plugin_id in visiting:
            raise ValueError('PLUGIN_DEPENDENCY_CYCLE')
        if ref.plugin_id in resolved:
            if resolved[ref.plugin_id].version != ref.version:
                raise ValueError('PLUGIN_VERSION_CONFLICT')
            return
        release = index.get((ref.plugin_id, ref.version))
        if release is None:
            raise ValueError('PLUGIN_DEPENDENCY_MISSING')
        visiting.add(ref.plugin_id)
        for child in release.dependencies:
            visit(child, depth + 1)
        visiting.remove(ref.plugin_id)
        resolved[ref.plugin_id] = release

    for root in roots:
        visit(root, 0)
    return tuple(resolved.values())
