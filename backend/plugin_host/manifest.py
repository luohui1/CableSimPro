"""cablesim.plugin/2 manifest (CableSimPro-Plugins/SPEC.md, host API 2.1).

Distribution fields (signature, package archive, per-plugin environment, external tools)
are deferred; a manifest that asks for them is rejected rather than half-honoured.
"""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_serializer, model_validator
from cablesim_sdk.plugin_ui import (ParameterSchema, ParameterGroup, Headline, Presentation,
                                   InputContract, TemperatureFieldBinding, ReportTemplate, AgentSkill, validate_parameter_schema, HAN)

HOST_API = (2, 1)
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
    model_config = ConfigDict(extra='forbid', frozen=True, populate_by_name=True)


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
    kind: Literal['method', 'report-template', 'agent-skill']
    id: str = Field(pattern=r'^[a-z][a-z0-9-]*$')
    title: str = Field(min_length=1, max_length=200)
    solver: Literal['local', 'slurm', 'either'] = Field(
        default='local', description='求解位置：local 仅本机，slurm 仅超算，either 两者均可；省略时按 local。')
    method_version: str = Field(min_length=1, max_length=80)
    analysis: str = Field(pattern=r'^[a-z_]+$')
    input_schema: str = Field(min_length=1, max_length=120)
    outputs: list[Output] = Field(default_factory=list, max_length=100)
    artifacts: list[ArtifactSpec] = Field(default_factory=list, max_length=20)
    validation: Validation
    limitations: list[str] = Field(min_length=1, max_length=40)
    description: str | None = Field(default=None, max_length=700)
    parameter_schema: ParameterSchema = Field(default_factory=ParameterSchema)
    input_contract: InputContract | None = None
    parameter_groups: list[ParameterGroup] = Field(default_factory=list, alias='x-groups')
    headlines: list[Headline] = Field(default_factory=list, alias='x-headline', max_length=3)
    preview: bool = False
    preview_timeout_s: int = Field(default=8, ge=1, le=15)
    study_tasks: list[str] = Field(default_factory=list, max_length=12)
    category: str | None = Field(default=None, max_length=40)
    temperature_field_binding: TemperatureFieldBinding | None = Field(default=None, alias='x-temperature-field-binding')
    report_template: ReportTemplate | None = None
    agent_skill: AgentSkill | None = None

    @model_serializer(mode='wrap')
    def serialize_solver(self, handler):
        value = handler(self)
        # Keep the release identity of manifests written before this optional field.
        if 'solver' not in self.model_fields_set:
            value.pop('solver', None)
        return value

    @model_validator(mode='after')
    def unique(self):
        if self.kind=='method' and (not self.outputs or self.report_template or self.agent_skill):
            raise ValueError('计算能力须声明输出，不能混入报告或技能声明。')
        if self.kind=='report-template' and (not self.report_template or self.agent_skill or self.outputs or self.preview):
            raise ValueError('报告模板仅声明模板，不提供运行输出或预览。')
        if self.kind=='agent-skill' and (not self.agent_skill or self.report_template or self.outputs or self.preview):
            raise ValueError('Agent技能仅声明可复用流程，不提供新运行时。')
        keys = [(o.key, o.type) for o in self.outputs]
        if len(set(keys)) != len(keys):
            raise ValueError('输出键与类型重复')
        basic=0
        if self.parameter_schema.properties:
            basic+=validate_parameter_schema(self.parameter_schema.model_dump(mode='json', by_alias=True, exclude_none=True), self.parameter_groups)
        if self.input_contract and self.input_contract.standalone_schema:
            basic+=validate_parameter_schema(self.input_contract.standalone_schema.model_dump(mode='json', by_alias=True, exclude_none=True), self.parameter_groups)
        if self.input_contract and self.input_contract.standalone_parameter_schema:
            basic+=validate_parameter_schema(self.input_contract.standalone_parameter_schema.model_dump(mode='json', by_alias=True, exclude_none=True), self.parameter_groups)
        if basic>8:raise ValueError('能力的参数与独立输入合计最多8个 basic 字段。')
        if len({value.key for value in self.headlines})!=len(self.headlines):raise ValueError('关键结论量不得重复声明。')
        declared = {output.key for output in self.outputs}
        artifacts = {artifact.type for artifact in self.artifacts}
        if self.temperature_field_binding and not {self.temperature_field_binding.artifact, 'x-cablesim.temperature-field'} <= artifacts:
            raise ValueError('解析场来源与温度场必须同时声明为工件。')
        if any(value.key not in declared or value.artifact not in artifacts or value.source_artifact is not None and value.source_artifact not in artifacts for value in self.headlines):
            raise ValueError('关键结论必须引用已声明的结果和同工况工件')
        if any(not HAN.search(value.title) for value in self.headlines):
            raise ValueError('关键结论名称必须为中文')
        return self


class PackageFile(Strict):
    path: str = Field(pattern=r'^(src/[A-Za-z0-9_./-]+|assets/[A-Za-z0-9_-]+\.(svg|webp|html|css|json))$')
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
    description: str | None = Field(default=None, min_length=1, max_length=120)
    icon: Literal['assets/icon.svg'] | None = None
    presentation: Presentation | None = None
    publisher: Publisher
    host_api: HostApi
    license: License
    platforms: list[str] = Field(min_length=1)
    runtime: Runtime | None = None
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
        executable=any(cap.kind=='method' for cap in self.capabilities)
        if executable and self.runtime is None:
            raise ValueError('计算插件必须声明已实现的运行时。')
        if not executable and self.runtime is not None:
            raise ValueError('报告模板和Agent技能本轮只接受声明，不启用运行时。')
        if executable and 'study.run' not in self.permissions:
            raise ValueError('method 能力需要 study.run 权限')
        if any(c.artifacts for c in self.capabilities) and 'artifact.write' not in self.permissions:
            raise ValueError('产出工件需要 artifact.write 权限')
        ids = [c.id for c in self.capabilities]
        if len(set(ids)) != len(ids):
            raise ValueError('能力 ID 重复')
        paths = [f.path for f in self.files]
        if len(set(paths)) != len(paths):
            raise ValueError('文件清单重复')
        if self.runtime is not None and self.runtime.entry not in paths:
            raise ValueError('入口程序必须在文件清单中')
        if any(cap.report_template and cap.report_template.entry not in paths for cap in self.capabilities):
            raise ValueError('报告模板入口必须纳入包内封签。')
        if self.presentation:
            roles = [asset.role for asset in self.presentation.assets]
            if len(roles) != len(set(roles)) or not {'cover', 'method'} <= set(roles):
                raise ValueError('展示资源必须有唯一封面和方法图')
            if any(asset.path not in paths for asset in self.presentation.assets):
                raise ValueError('展示资源必须纳入文件封签')
            if any(not HAN.search(cap.title) or not cap.description or not HAN.search(cap.description)
                   or cap.kind=='method' and not cap.headlines for cap in self.capabilities):
                raise ValueError('自描述插件每项能力必须有中文标题、说明及1–3个关键结论')
        if self.host_api.min_minor >= 1 or self.description is not None or self.icon is not None:
            if self.host_api.min_minor < 1:
                raise ValueError('展示信息需要宿主插件 API 2.1')
            if self.description is None or self.icon is None:
                raise ValueError('插件必须声明简介与图标')
            for label, value, maximum in [('名称', self.name, 40), ('简介', self.description, 120)]:
                if not value.strip() or value != value.strip() or len(value) > maximum or any(ord(c) < 32 for c in value):
                    raise ValueError(f'插件{label}必须是无首尾空白的单行文本，最多 {maximum} 字符')
            if self.icon not in paths:
                raise ValueError('图标必须在文件清单中')
        return self

    def capability(self, capability_id: str) -> Capability:
        for c in self.capabilities:
            if c.id == capability_id:
                return c
        raise KeyError(capability_id)
