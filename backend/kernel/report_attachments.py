"""Freeze display evidence into a delivery; never accept client-authored FEM values."""
from base64 import b64decode, b64encode
from hashlib import sha256
from html import escape
from io import BytesIO
from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import Field
from ..schemas import StrictModel


class CadCamera(StrictModel):
    yaw: float = Field(description='Radians.')
    elevation: float = Field(description='Radians.')
    heading: float = Field(description='Radians.')
    zoom: float = Field(gt=0, description='Dimensionless viewport zoom.')
    panX: float = Field(description='Viewport horizontal pan, pixels.')
    panY: float = Field(description='Viewport vertical pan, pixels.')
    view: Literal['iso','front','end','top','free']
    mode: Literal['peel','section','transparent','scene']
    section: float = Field(description='Normalized slice position, dimensionless.')


class CadFieldReference(StrictModel):
    runId: UUID = Field(description='Saved source run identity; no unit.')
    caseId: str = Field(min_length=1, max_length=120, description='Saved case identity.')
    source: str = Field(max_length=4096, description='Source label containing the sealed method digest.')
    label: str | None = Field(default=None, max_length=512)


class CadField(CadFieldReference):
    kind: Literal['iec','fem','difference'] | None = None
    minimum: float = Field(description='Displayed lower colour-scale endpoint, degC or K for a difference.')
    maximum: float = Field(description='Displayed upper colour-scale endpoint, degC or K for a difference.')
    references: list[CadFieldReference] = Field(default_factory=list, max_length=2)
    provisional: bool = Field(default=False, description='Trial images are excluded from formal deliveries.')


class CadImageMetadata(StrictModel):
    schema_version: Literal['cablesim.cad-image/1'] = Field(alias='schema')
    mime: Literal['image/png']
    width: int = Field(gt=0, le=8192, description='PNG width, pixels.')
    height: int = Field(gt=0, le=8192, description='PNG height including legend/source footer, pixels.')
    camera: CadCamera
    geometryInputSha256: str = Field(pattern=r'^[0-9a-f]{64}$', description='Displayed scene-input SHA256.')
    displayLengthM: float = Field(gt=0, description='Displayed cable length, m.')
    scaleMmPerPixel: float = Field(gt=0, description='Display scale, mm/pixel.')
    field: CadField = Field(description='Saved result and legend source; geometry-only or trial exports are not engineering evidence.')


class CadReportImage(StrictModel):
    png_base64: str = Field(min_length=1, max_length=12_000_000, description='PNG bytes, Base64; at most 8 MiB decoded.')
    metadata: CadImageMetadata


class FemChapterReference(StrictModel):
    fem_run_id: UUID = Field(description='Saved, converged FEM run in this workspace.')
    iec_run_id: UUID = Field(description='Saved IEC run with matching input and electrical parameters.')


def prepare(research, wid, ids, images, fem_reference):
    ids = list(dict.fromkeys(str(value) for value in ids))
    primary = ids[0]
    attachments = {'cad_images': [], 'fem_chapter': None}
    for image in images:
        field = image['metadata']['field']
        if str(field['runId']) != primary or field['provisional']:
            raise HTTPException(409, '三维图必须来自所选保存运行；试算图不能交付。')
        for ref in [field, *field['references']]:
            saved = research.get_run(wid, str(ref['runId']))
            if saved['integrity'] != 'verified':
                raise HTTPException(409, '三维图来源运行的完整性未通过。')
            case = next((c for c in saved['output']['cases'] if c['case_id'] == ref['caseId'] and c['status'] == 'succeeded'), None)
            pin = saved['snapshot']['definition']['method']
            if case is None or pin['release_digest'] not in ref['source']:
                raise HTTPException(409, '三维图来源与保存结果或方法封签不一致。')
            field_digest = case.get('artifact_digests', {}).get('x-cablesim.temperature-field')
            if field_digest and field_digest not in ref['source']:
                raise HTTPException(409, '三维图引用的温度场摘要不一致。')
            if str(ref['runId']) not in ids: ids.append(str(ref['runId']))
        raw = b64decode(image['png_base64'], validate=True)
        from PIL import Image
        with Image.open(BytesIO(raw)) as png:
            if png.format != 'PNG' or png.width * png.height > 16_000_000 or png.size != (image['metadata']['width'], image['metadata']['height']) or len(raw) > 8*1024*1024:
                raise ValueError('三维导出 PNG 尺寸或大小不符合契约。')
            png.verify()
        attachments['cad_images'].append({**image, 'image_sha256': sha256(raw).hexdigest()})
    if fem_reference:
        fem_id, iec_id = str(fem_reference['fem_run_id']), str(fem_reference['iec_run_id'])
        if primary not in (fem_id, iec_id): raise HTTPException(409, '有限元章节必须包含所选源运行。')
        from .batch_field_chapter import chapter, selected_case, field_png
        data = chapter(research, None, wid, fem_id, iec_id)
        if (data.get('convergence') or {}).get('status') != 'converged':
            raise HTTPException(422, '有限元未收敛，不能进入正式计算书。')
        fem = research.get_run(wid, fem_id)
        chosen, _ = selected_case(fem)
        raw = field_png(chosen['artifacts']['x-cablesim.temperature-field'])
        attachments['fem_chapter'] = {'data': data, 'png_base64': b64encode(raw).decode(), 'image_sha256': sha256(raw).hexdigest()}
        for rid in (fem_id, iec_id):
            if rid not in ids: ids.append(rid)
    return ids, attachments


def chapter_html(attachments, audience='internal'):
    """The same frozen chapter text is used by HTML and both PDF editions."""
    from .report import table
    bodies = []
    for image in attachments.get('cad_images', []):
        m = image['metadata']; f = m['field']
        bodies.append('<h2>三维结果图</h2><p>保存结果的显示图；色标 '+escape(str(f['minimum']))+' ～ '+escape(str(f['maximum']))+
                      (' K' if f.get('kind')=='difference' else ' °C')+'，展示段 '+escape(str(m['displayLengthM']))+' m。</p>'+
                      '<p>来源：'+escape(f['source'] if audience=='internal' else f['source'].split(' · ')[0])+'</p>')
    fem = attachments.get('fem_chapter')
    if fem:
        data = fem['data']; conv = data['convergence']
        bodies.append('<h2>有限元温度场与 IEC 对照</h2><p>收敛状态：'+escape(conv['status'])+'</p>'+
            table(['对象','物理量','有限元','IEC','差值','单位'], [[r['entity'],r['key'],r['fem'],r['iec'],r['delta'],r['unit']] for r in data['rows']])+
            table(['工况','网格 / m','最热点 / K','变化 / K'], [[r.get('case_id'),r.get('mesh_size_m'),r.get('hotspot_k'),r.get('change_k')] for r in conv['rows']])+
            table(['边界口径','有限元','IEC'], [[r['item'],r['fem'],r['iec']] for r in data['scope']])+
            '<p>图来自保存温度场工件'+(' '+escape(data['field']['artifact_digest']) if audience=='internal' else '')+'；差异提示不是标准验收限值。</p>')
    return bodies
