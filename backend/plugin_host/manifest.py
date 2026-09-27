"""cablesim.plugin/2 manifest, minimal-protocol subset (docs/design/PLUGIN_CONTRACT.md).

Distribution fields (signature, package archive, per-plugin environment, external tools)
are deferred; a manifest that asks for them is rejected rather than half-honoured.
"""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

HOST_API = (2, 0)
ID = r'^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$'
SEMVER = r'^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$'
CUSTOM = re.compile(r'^x-[a-z0-9-]+\.[a-z0-9._-]+$')

# Result vocabulary cablesim.results/1 subset: semantic key -> SI unit. Custom keys need an x-<publisher>. prefix.
KEY_UNITS = {
    'ampacity': 'A', 'conductor_temperature': 'K', 'sheath_temperature': 'K', 'surface_temperature': 'K',
    'losses.conductor': 'W/m', 'losses.sheath': 'W/m', 'losses.dielectric': 'W/m', 'losses.total': 'W/m',
    'loss_factor.sheath': '1', 'ac_resistance': 'Ω/m', 'capacitance': 'F/m',
    'thermal_resistance.insulation': 'K·m/W', 'thermal_resistance.oversheath': 'K·m/W',
    'thermal_resistance.external': 'K·m/W',
}
RESULT_TYPES = {'quantity'}


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)


class Publisher(Strict):
    id: str = Field(pattern=r'^[a-z][a-z0-9-]*$')
    name: str = Field(min_length=1, max_length=100)


class HostApi(Strict):
    major: int
    min_minor: int = Field(ge=0)


class License(Strict):
    spdx: str = Field(min_length=1, max_length=120)
    review_required: bool


class Runtime(Strict):
    kind: Literal['python']  # 'executable' and external tools are deferred
    python: str
    entry: str = Field(pattern=r'^src/[A-Za-z0-9_./-]+\.py$')


class Resources(Strict):
    timeout_s: int = Field(ge=1, le=3600)
    memory_mb: int = Field(ge=16, le=65536)
    network: Literal['none']


class Output(Strict):
    key: str
    type: str
    per: Literal['circuit', 'cable', 'core', 'section']
    required: bool

    @model_validator(mode='after')
    def known(self):
        if self.key not in KEY_UNITS and not CUSTOM.match(self.key):
            raise ValueError(f'未登记的结果键 {self.key}；自定义键需带 x-<发布者>. 前缀')
        if self.type not in RESULT_TYPES:
            raise ValueError(f'结果类型 {self.type} 尚未实现')
        return self


class ArtifactSpec(Strict):
    type: str = Field(pattern=r'^(x-[a-z0-9-]+\.)?[a-z0-9.-]+$')
    required: bool


class Validation(Strict):
    level: Literal['unverified', 'interface-tested', 'analytic-benchmark', 'reference-benchmark', 'field-validated']
    cases: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def evidence(self):
        if self.level != 'unverified' and not self.cases:
            raise ValueError('验证等级高于 unverified 必须列出算例')
        return self


class Capability(Strict):
    kind: Literal['method']
    id: str = Field(pattern=r'^[a-z][a-z0-9-]*$')
    title: str = Field(min_length=1, max_length=200)
    method_version: str = Field(min_length=1, max_length=80)
    analysis: str = Field(pattern=r'^[a-z_]+$')
    input_schema: str = Field(min_length=1, max_length=120)
    outputs: list[Output] = Field(min_length=1, max_length=100)
    artifacts: list[ArtifactSpec] = Field(default_factory=list, max_length=20)
    validation: Validation
    limitations: list[str] = Field(min_length=1, max_length=40)

    @model_validator(mode='after')
    def unique(self):
        keys = [(o.key, o.type) for o in self.outputs]
        if len(set(keys)) != len(keys):
            raise ValueError('输出键与类型重复')
        return self


class PackageFile(Strict):
    path: str = Field(pattern=r'^src/[A-Za-z0-9_./-]+$')
    sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    size_bytes: int = Field(ge=0, le=20 * 1024 * 1024)

    @model_validator(mode='after')
    def confined(self):
        if '..' in self.path.split('/') or '//' in self.path:
            raise ValueError('包内路径不能越界')
        return self


class Manifest(Strict):
    schema_: Literal['cablesim.plugin/2'] = Field(alias='schema')
    id: str = Field(pattern=ID)
    version: str = Field(pattern=SEMVER)
    name: str = Field(min_length=1, max_length=100)
    publisher: Publisher
    host_api: HostApi
    license: License
    platforms: list[str] = Field(min_length=1)
    runtime: Runtime
    permissions: list[Literal['project.read', 'study.run', 'artifact.read', 'artifact.write', 'project.propose']]
    dependencies: list[dict] = Field(max_length=0)  # inter-plugin dependencies are not part of the minimal protocol yet
    resources: Resources
    capabilities: list[Capability] = Field(min_length=1, max_length=50)
    files: list[PackageFile]

    @model_validator(mode='after')
    def coherent(self):
        if self.id.split('.')[0] != self.publisher.id:
            raise ValueError('插件 ID 前缀必须等于发布者 ID')
        if self.host_api.major != HOST_API[0] or self.host_api.min_minor > HOST_API[1]:
            raise ValueError(f'需要宿主插件 API {self.host_api.major}.{self.host_api.min_minor}，当前 {HOST_API[0]}.{HOST_API[1]}')
        if 'study.run' not in self.permissions:
            raise ValueError('method 能力需要 study.run 权限')
        if any(c.artifacts for c in self.capabilities) and 'artifact.write' not in self.permissions:
            raise ValueError('产出工件需要 artifact.write 权限')
        ids = [c.id for c in self.capabilities]
        if len(set(ids)) != len(ids):
            raise ValueError('能力 ID 重复')
        paths = [f.path for f in self.files]
        if len(set(paths)) != len(paths):
            raise ValueError('文件清单重复')
        if self.runtime.entry not in paths:
            raise ValueError('入口程序必须在文件清单中')
        return self

    def capability(self, capability_id: str) -> Capability:
        for c in self.capabilities:
            if c.id == capability_id:
                return c
        raise KeyError(capability_id)
