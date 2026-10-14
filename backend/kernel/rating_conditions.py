"""Saved type condition templates and result presentation. No rating equations."""
from copy import deepcopy
import json
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import Field, field_validator, model_validator

from backend.domain.models import CableType
from backend.domain.guards import pointer
from backend.schemas import StrictModel
from backend.kernel.workspace import fingerprint
from backend.kernel.rating_table import is_rating_table, rating_rows
from .scenarios import apply_layout


class RatingRow(StrictModel):
    case_id: str = Field(pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$')
    name: str = Field(min_length=1, max_length=100)
    layout: Literal['trefoil', 'flat', 'ducts', 'air', 'three_core_buried_single',
                    'three_core_buried_horizontal', 'three_core_ducts_horizontal']
    depth_m: float = Field(default=.8, gt=0, le=20)
    soil_rho_k_m_w: float = Field(default=1, gt=0, le=100)
    ambient_temperature_c: float = Field(default=20, ge=-50, le=100)
    frequency_hz: float = Field(default=50, gt=0, le=1000, description='工况模板的明示交流频率 / Hz；不取型号草稿的直流占位回路')
    spacing_m: float | None = Field(default=None, gt=0, le=10)
    bonding: Literal['both_ends', 'single_point', 'unspecified'] = 'both_ends'
    rating_basis: Literal['simultaneous', 'individual'] = Field(default='simultaneous', description='多回路共同等负荷，或首回路变化而其他回路保持保存负荷；不同口径不可混用')
    duct_inner_m: float = Field(default=.14, gt=0, le=10)
    duct_outer_m: float = Field(default=.16, gt=0, le=10)
    duct_rho_k_m_w: float = Field(default=6, gt=0, le=100)
    source: str = Field(default='典型工况模板；明示设计条件，非现场测量', min_length=1, max_length=1000)

    @field_validator('duct_outer_m')
    @classmethod
    def pipe_outer(cls, value, info):
        if info.data.get('layout') in ('ducts', 'three_core_ducts_horizontal') and value <= info.data.get('duct_inner_m', .14):
            raise ValueError('管外径必须大于管内径，单位 m')
        return value

    @model_validator(mode='after')
    def pipe(self):
        if self.layout in ('ducts', 'three_core_ducts_horizontal') and self.duct_inner_m >= self.duct_outer_m:
            raise ValueError('duct_inner_m：管内径必须小于外径，单位 m')
        if not self.source.strip() or not self.name.strip():
            raise ValueError('工况名称与来源不能仅包含空格')
        return self


class RatingTableDefinition(StrictModel):
    expected_revision: int = Field(ge=1)
    rows: list[RatingRow] = Field(min_length=1, max_length=100)
    parameters: dict = Field(default_factory=dict)
    selected_case_ids: list[str] | None = Field(default=None, max_length=100)

    @model_validator(mode='after')
    def unique(self):
        if len({r.case_id for r in self.rows}) != len(self.rows):
            raise ValueError('工况标识不能重复')
        if self.selected_case_ids is not None and (len(set(self.selected_case_ids)) != len(self.selected_case_ids)
                or not set(self.selected_case_ids) <= {r.case_id for r in self.rows}):
            raise ValueError('所选工况须为列表中的唯一标识')
        json.dumps(self.model_dump(), allow_nan=False)
        return self


def condition_input(document, row):
    d = deepcopy(document)
    cable = d['cable_types'][0]
    # Measured R20 is an explicitly sourced run input, never a rewrite of design R20.
    for core in cable['cores']:
        observed = next((m for m in d.get('measurements', []) if m['cable_type'] == cable['id']
                         and m.get('core') == core['id'] and m['quantity'] == 'r20'
                         and m['basis'] == 'measurement'), None)
        if observed:
            core['conductor'].update(r20=observed['value'], r20_basis='measurement')
            d['provenance'][pointer('cable_types', cable['id'], 'cores', core['id'], 'conductor', 'r20')] = deepcopy(observed['source'])
    circuit, section = d['circuits'][0], d['sections'][0]
    d['circuits'], d['sections'] = [circuit], [section]
    three_core = cable['construction'] == 'three_core'
    if three_core != row.layout.startswith('three_core_'):
        raise ValueError('layout：三芯型号请选择三芯工况，单芯型号请选择单芯排列。')
    circuit['system'].update(kind='ac_three_phase', frequency=row.frequency_hz)
    circuit['cables'] = [{'id': 'cable/rating-ABC', 'phase': 'L1L2L3'}] if three_core else [
        {'id': 'cable/rating-'+p, 'phase': p, 'parallel_index': 1} for p in ('A', 'B', 'C')]
    source = {'kind': 'user', 'reference': row.source, 'reviewed': False}
    circuit['bonding'] = {'kind': row.bonding, 'source': source}
    circuit['electrical_topology'] = None
    # Zero operating load is an explicit template condition; the plugin still solves
    # the maximum permissible rating. No product operating current is inferred.
    d['load_cases'] = [{'id': 'load/rating', 'kind': 'steady', 'currents': {circuit['id']: 0.0}}]
    diameter = CableType.model_validate(cable).radius()*2
    spacing = row.spacing_m if row.spacing_m is not None else max(.25, diameter*1.5) if three_core else max(.15, diameter*1.5) if row.layout == 'flat' else diameter
    ducted = row.layout in ('ducts', 'three_core_ducts_horizontal')
    if ducted:
        spacing = max(spacing, row.duct_outer_m) if row.spacing_m is None else spacing
    # Use the existing arrangement adapter; duct dimensions are explicitly supplied.
    # Build the three-core placements first; the declared pipe sizes below replace
    # the generic template dimensions, so no hidden 140 mm fit limit is imposed.
    template = ('three_core_buried_horizontal' if ducted else row.layout) if three_core else 'flat' if row.layout == 'flat' else 'tray' if row.layout == 'air' else 'trefoil'
    d = apply_layout(d, template, row.depth_m, spacing)
    section = d['sections'][0]
    if ducted:
        section['enclosures'] = []
        d['materials'] = [m for m in d['materials'] if m['id'] != 'material/rating-duct']
        d['materials'].append({'id': 'material/rating-duct', 'label': '工况管材', 'category': 'duct', 'thermal_resistivity': row.duct_rho_k_m_w})
        for i, place in enumerate(section['placements']):
            eid = 'enclosure/rating-'+str(i+1)
            place['enclosure'] = eid
            section['enclosures'].append({'id': eid, 'type': 'duct', 'x': place['x'], 'z': place['z'],
                'material': 'material/rating-duct', 'inner_diameter': row.duct_inner_m,
                'outer_diameter': row.duct_outer_m, 'contains': [place['cable']]})
        d['provenance'][pointer('materials','material/rating-duct','thermal_resistivity')] = source
    soil_id = 'material/rating-soil'
    d['materials'] = [m for m in d['materials'] if m['id'] != soil_id]
    d['materials'].append({'id': soil_id, 'label': '工况土壤', 'category': 'soil', 'thermal_resistivity': row.soil_rho_k_m_w})
    section['medium'].update(material=soil_id, surface_temperature=row.ambient_temperature_c+273.15)
    if row.layout == 'air':
        section['medium']['air_temperature'] = row.ambient_temperature_c+273.15
    section['layout_template'] = {**row.model_dump(), 'kind': row.layout}
    # A stale workspace criterion cannot supersede the current type's temperature.
    d['criteria'].pop('max_conductor_temperature', None)
    for path in [pointer('circuits',circuit['id'],'system','frequency'), pointer('sections',section['id'],'medium'), pointer('materials',soil_id),
                 pointer('circuits',circuit['id'],'bonding'), pointer('load_cases','load/rating')]:
        d['provenance'][path] = source
    for place in section['placements']:
        for axis in ('x', 'z'):
            d['provenance'][pointer('sections',section['id'],'placements',place['cable'],axis)] = source
    return d


def table_definition(state, body, method):
    if state['revision'] != body.expected_revision:
        raise HTTPException(409, '型号已更新，请重新打开后保存工况；原有工况未覆盖。')
    document = state.get('domain')
    if not document or state.get('study_cable_reference') or len(document['cable_types']) != 1:
        raise HTTPException(422, '载流量表需要一个独立型号草稿。')
    if any(body.parameters.get(k) is not None for k in ('ks','kp','eddy')) and not str(body.parameters.get('source') or '').strip():
        raise HTTPException(422, {'message': '填写系数来源：标准表、厂家资料或明确的计算条件。', 'field': 'parameters.source'})
    cases = []
    for i, row in enumerate(body.rows):
        try:
            inputs = condition_input(document, row)
        except (ValueError, KeyError, TypeError) as exc:
            field = 'layout' if str(exc).startswith('layout：') else 'spacing_m'
            raise HTTPException(422, {'message': f'{row.name}：{exc}', 'field': f'rows.{i}.{field}'}) from None
        cases.append({'case_id': row.case_id, 'label': row.name, 'input': inputs,
                      'parameters': {'rating_mode':row.rating_basis},
                      'metadata': {'kind': 'type-rating-table', 'condition': row.model_dump(),
                                   'type_revision': state['revision'], 'type_sha256': fingerprint(document)}})
    return {'title': document['cable_types'][0]['label'][:90]+' · 载流量表', 'task': 'rating',
            'input_source': 'study', 'method_input': deepcopy(document), 'method': method,
            'parameters': deepcopy(body.parameters), 'driver': {'kind': 'batch', 'cases': cases, 'selected_case_ids': body.selected_case_ids},
            'input_sources': {
                '/driver/cases': {'kind': 'user', 'reference': '逐行保存的典型工况与来源；型号数据引用当前修订', 'reviewed': False},
                **{'/parameters/'+key: {'kind':'user', 'reference':str(body.parameters['source']), 'reviewed':False}
                   for key in body.parameters if str(body.parameters.get('source') or '').strip()},
            }}


def make_router(research):
    router = APIRouter(prefix='/api/design', tags=['Type rating table'])

    @router.post('/workspaces/{wid}/rating-table-definition')
    def definition(wid: str, body: RatingTableDefinition):
        entry = next((m for m in research.methods() if m['method']['plugin_id'] == 'cablesim.iec60287'), None)
        if not entry or not any(c['id'] == 'steady-rating' for c in entry['capabilities']):
            raise HTTPException(422, 'IEC 60287 稳态插件未安装或不可用。')
        return table_definition(research.store.snapshot(wid), body, {**entry['method'], 'capability': 'steady-rating'})

    @router.get('/workspaces/{wid}/rating-table-runs/{rid}')
    async def results(wid: str, rid: str, request: Request, view: Literal['full', 'rows'] = 'full'):
        from .read_responses import read_response

        def load():
            run = research.get_run(wid, rid)
            if not is_rating_table(run):
                raise HTTPException(422, '此运行不是型号载流量表。')
            rows = rating_rows(run)
            # Row inspection needs the verified saved identity, not every batch
            # input and artifact. Explicit trace reads retain the full response.
            if view == 'rows':
                run = {key: run.get(key) for key in ('id', 'workspace', 'study', 'status',
                       'integrity', 'input_digest', 'output_digest', 'freshness', 'created')}
            return {'run': run, 'rows': rows}

        return await read_response(research, ('type-rating-rows', wid, rid, view),
                                   dict, load, request=request)

    return router
