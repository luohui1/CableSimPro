"""Declarative plugin presentation contracts; no engineering calculations."""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

HAN = re.compile(r'[\u3400-\u9fff]')
CATEGORIES = Literal['calculation', 'modeling', 'simulation', 'data-standard', 'report', 'agent-skill']


class MetadataModel(BaseModel):
    model_config = ConfigDict(extra='forbid', populate_by_name=True, frozen=True, allow_inf_nan=False)


class UnitDisplay(MetadataModel):
    si: str | None = Field(default=None, description='SI storage unit; null for non-physical text or object references.')
    display: str | None = None
    scale: float = Field(default=1, gt=0, description='display_value = SI_value * scale + offset.')
    offset: float = 0


class ParameterBasis(MetadataModel):
    kind: Literal['standard', 'method', 'numerical', 'engineering', 'source', 'binding']
    reference: str = Field(min_length=1, max_length=500)


class ParameterUnitCases(MetadataModel):
    selector: str = Field(pattern=r'^[A-Za-z_][A-Za-z0-9_]*$')
    cases: dict[str, UnitDisplay] = Field(min_length=1)


class ParameterBinding(MetadataModel):
    type: Literal['domain', 'section', 'load', 'cable_type', 'circuit', 'cable', 'core', 'layer',
                  'material', 'duct', 'artifact', 'source_document', 'model', 'reference_case',
                  'mesh', 'region', 'node', 'standard', 'evidence']
    multiple: bool = False
    keyed: bool = False
    read_only: bool = False
    scope: Literal['workspace', 'input', 'library', 'run'] = 'workspace'


class RuntimeUnit(MetadataModel):
    key: str = Field(min_length=1, max_length=120, description='Reviewed internal-kernel field name; never supplied by the caller.')
    scale: float = Field(default=1, gt=0, description='internal_value = SI_value * scale + offset.')
    offset: float = 0


class ParameterMetadata(BaseModel):
    """JSON Schema keywords are retained; UI extension keywords are typed here."""
    model_config = ConfigDict(extra='allow', populate_by_name=True, frozen=True, allow_inf_nan=False)
    title: str = Field(min_length=1, max_length=100, pattern=r'[\u3400-\u9fff]')
    description: str = Field(min_length=1, max_length=700, pattern=r'[\u3400-\u9fff]')
    unit: UnitDisplay = Field(alias='x-unit')
    unit_cases: ParameterUnitCases | None = Field(default=None, alias='x-unit-by')
    group: str = Field(alias='x-group', min_length=1, max_length=60)
    order: int = Field(alias='x-order', ge=0)
    level: Literal['basic', 'advanced', 'expert'] = Field(alias='x-level')
    binding: ParameterBinding | None = Field(default=None, alias='x-bind')
    default_basis: ParameterBasis | None = Field(default=None, alias='x-default-basis')
    range_basis: ParameterBasis | None = Field(default=None, alias='x-range-basis')
    editor_reason: str | None = Field(default=None, alias='x-editor-reason', max_length=500)
    enum_labels: dict[str, str] | None = Field(default=None, alias='x-enum-labels')
    runtime_unit: RuntimeUnit | None = Field(default=None, alias='x-runtime')

    @model_validator(mode='after')
    def chinese(self):
        if not HAN.search(self.title) or not HAN.search(self.description):
            raise ValueError('每个参数必须有中文工程名称和中文说明')
        if self.editor_reason and (self.level != 'expert' or not HAN.search(self.editor_reason)):
            raise ValueError('自由证据结构只能属于 expert，且必须说明中文原因')
        if self.enum_labels and any(not HAN.search(label) for label in self.enum_labels.values()):
            raise ValueError('枚举选项必须有中文名称')
        return self


class ParameterSchema(BaseModel):
    model_config = ConfigDict(extra='allow', populate_by_name=True, frozen=True)
    type: Literal['object'] = 'object'
    properties: dict[str, ParameterMetadata] = Field(default_factory=dict)
    definitions: dict = Field(default_factory=dict, alias='$defs')
    additionalProperties: bool | dict = False


class ParameterGroup(MetadataModel):
    id: str = Field(pattern=r'^[a-z][a-z0-9-]*$')
    title: str = Field(min_length=1, max_length=80)
    order: int = Field(ge=0)


class InputContract(MetadataModel):
    input_sources: list[Literal['domain', 'study']] = Field(min_length=1)
    binding: ParameterBinding | None = None
    standalone_schema: ParameterSchema | None = None
    standalone_parameter_schema: ParameterSchema | None = None


class Headline(MetadataModel):
    key: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=80)
    unit: UnitDisplay
    aggregate: Literal['minimum', 'maximum', 'first'] = 'first'
    condition: str | None = Field(default=None, max_length=80)
    artifact: str = Field(min_length=1, max_length=120, description='Same-case validated artifact required for this answer.')
    source_artifact: str | None = Field(default=None, max_length=120, description='Exact engineering artifact accompanied by the answer witness.')


class TemperatureFieldBinding(MetadataModel):
    binding: Literal['iec-trace']
    artifact: Literal['x-cablesim.iec60287-trace']
    model: Literal['kennelly-image-line-sources']
    condition: Literal['operating']
    tolerance_k: Literal[0.1]


class PresentationAsset(MetadataModel):
    role: Literal['cover', 'method', 'validation']
    path: str = Field(pattern=r'^assets/[a-z][a-z0-9-]*\.(webp|svg)$')
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=400)
    media_type: Literal['image/webp', 'image/svg+xml']


class Presentation(MetadataModel):
    category: CATEGORIES
    category_title: str = Field(min_length=1, max_length=40)
    assets: list[PresentationAsset] = Field(min_length=2, max_length=6)
    validation_note: str = Field(min_length=1, max_length=400)


class ReportSection(MetadataModel):
    id: str = Field(pattern=r'^[a-z][a-z0-9-]*$')
    title: str = Field(min_length=1, pattern=r'[\u3400-\u9fff]')
    source: Literal['inputs', 'results', 'artifacts', 'provenance', 'limitations']
    required: bool = True


class ReportTemplate(MetadataModel):
    context_schema: Literal['cablesim.report-context/1']
    format: Literal['html']
    entry: str = Field(pattern=r'^assets/[a-z][a-z0-9-]*\.html$')
    sections: list[ReportSection] = Field(min_length=1, max_length=20)
    engineering_approval: Literal[False] = False

    @model_validator(mode='after')
    def unique_sections(self):
        if len({row.id for row in self.sections})!=len(self.sections):raise ValueError('报告章节标识重复。')
        return self


class SkillCapabilityReference(MetadataModel):
    plugin_id: str = Field(pattern=r'^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$')
    capability: str = Field(pattern=r'^[a-z][a-z0-9-]*$')
    version: str = Field(pattern=r'^\d+\.\d+\.\d+$')


class SkillInputBinding(MetadataModel):
    target: str = Field(pattern=r'^/(parameters|input)(/[^\s]+)?$')
    source: str = Field(pattern=r'^/(inputs|steps)/[^\s]+$')


class SkillStep(MetadataModel):
    id: str = Field(pattern=r'^[a-z][a-z0-9-]*$')
    title: str = Field(min_length=1, pattern=r'[\u3400-\u9fff]')
    capability: SkillCapabilityReference
    parameters_template: dict = Field(default_factory=dict, description='Static JSON values; validate against the referenced sealed capability before any future execution. No expressions, shell or hidden defaults.')
    bindings: list[SkillInputBinding] = Field(default_factory=list, max_length=100)


class AgentSkill(MetadataModel):
    context_schema: Literal['cablesim.workflow-context/1']
    steps: list[SkillStep] = Field(min_length=1, max_length=20)
    effects: list[Literal['read', 'calculate', 'propose']] = Field(min_length=1)
    engineering_approval: Literal[False] = False
    human_approval_required_for: list[Literal['workspace.change', 'engineering.accept', 'external.send']] = Field(default_factory=lambda:['workspace.change','engineering.accept','external.send'],min_length=3,max_length=3)

    @model_validator(mode='after')
    def unique_steps(self):
        if len({row.id for row in self.steps})!=len(self.steps):raise ValueError('技能步骤标识重复。')
        if set(self.human_approval_required_for)!={'workspace.change','engineering.accept','external.send'}:raise ValueError('技能须保留工程修改、工程采纳和外发的人工审批。')
        return self


def has_parameter_range(node: dict) -> bool:
    """Constraints in nullable alternatives and tuple items belong to the field."""
    if not isinstance(node, dict):
        return False
    keys = ('minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
            'minItems', 'maxItems', 'minLength', 'maxLength', 'enum', 'pattern')
    return (any(key in node for key in keys)
            or any(has_parameter_range(branch) for key in ('anyOf', 'oneOf', 'allOf', 'prefixItems')
                   for branch in node.get(key, []))
            or ('items' in node and has_parameter_range(node['items'])))


def validate_parameter_schema(schema: dict, groups: list[ParameterGroup]) -> int:
    """Reject unlabelled nested fields, opaque basic JSON and dangling local refs."""
    from jsonschema import Draft202012Validator

    Draft202012Validator.check_schema(schema)
    known = {group.id for group in groups}
    if len(known) != len(groups) or any(not HAN.search(group.title) for group in groups):
        raise ValueError('参数分组标识必须唯一且标题为中文')
    defs = schema.get('$defs', {})
    basic = 0

    def visit(node, path=(), property_node=False):
        nonlocal basic
        if not isinstance(node, dict):
            return
        if property_node or 'x-unit' in node:
            meta = ParameterMetadata.model_validate(node)
            if meta.group not in known:
                raise ValueError(f'{".".join(path)} 引用了未声明的分组 {meta.group}')
            if meta.level == 'basic':
                basic += 1
            if 'default' in node and meta.default_basis is None:
                raise ValueError(f'{".".join(path)} 默认值缺少依据')
            if has_parameter_range(node) and meta.range_basis is None:
                raise ValueError(f'{".".join(path)} 范围缺少依据')
            if node.get('additionalProperties') is True and not (meta.level == 'expert' and meta.editor_reason):
                raise ValueError(f'{".".join(path)} 自由 JSON 必须列入 expert 并说明原因')
        if '$ref' in node and (not node['$ref'].startswith('#/$defs/') or node['$ref'][8:] not in defs):
            raise ValueError('参数契约只接受存在的包内 $defs 引用')
        props = node.get('properties', {})
        for field in props.values():
            raw = field.get('x-unit-by')
            if raw is None:
                continue
            units = ParameterUnitCases.model_validate(raw)
            selector = props.get(units.selector, {})
            if not selector.get('enum') or set(units.cases) != set(selector['enum']):
                raise ValueError('条件单位必须引用同一对象的枚举，并覆盖全部选项')
            common = UnitDisplay.model_validate(field['x-unit'])
            if common.si is not None or common.display is not None:
                raise ValueError('条件单位不能同时声明另一套固定单位')
        orders = [value.get('x-order') for value in props.values()]
        if len(orders) != len(set(orders)):
            raise ValueError(f'{".".join(path)} 参数排序重复')
        for key, value in props.items():
            visit(value, (*path, key), True)
        for key, value in node.get('$defs', {}).items():
            visit(value, (*path, '$defs', key))
        if isinstance(node.get('additionalProperties'), dict):
            visit(node['additionalProperties'], (*path, '*'))
        if isinstance(node.get('items'), dict):
            visit(node['items'], (*path, '[]'))
        for key in ('anyOf', 'oneOf', 'allOf', 'prefixItems'):
            for value in node.get(key, []):
                visit(value, path)

    visit(schema)
    if basic > 8:
        raise ValueError('每项能力最多声明8个 basic 参数')
    return basic
