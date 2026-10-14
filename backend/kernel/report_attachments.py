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
    convergence_id: UUID | None = Field(default=None, description='Saved mesh/domain convergence workflow bound to the final FEM run; no unit.')


class SectionReportImage(StrictModel):
    """Presentation only: calculated values remain in the saved source run."""
    run_id: UUID = Field(description='Saved source run identity; no unit.')
    case_id: str = Field(min_length=1, max_length=120, description='Saved successful case identity.')
    section_id: str = Field(min_length=1, max_length=120, description='Section identity in that case input.')
    input_digest: str = Field(pattern=r'^[0-9a-f]{64}$', description='SHA256 of the immutable run input snapshot.')
    width: int = Field(gt=0, le=8192, description='PNG width, pixels.')
    height: int = Field(gt=0, le=8192, description='PNG height, pixels.')
    png_base64: str = Field(min_length=1, max_length=12_000_000, description='Light-paper section PNG from the workbench drawing; at most 8 MiB decoded.')


def checked_png(image, width, height):
    raw = b64decode(image, validate=True)
    from PIL import Image
    with Image.open(BytesIO(raw)) as png:
        if png.format != 'PNG' or png.width * png.height > 16_000_000 or png.size != (width, height) or len(raw) > 8*1024*1024:
            raise ValueError('导出 PNG 尺寸或大小不符合契约。')
        png.verify()
    return sha256(raw).hexdigest()


def prepare(research, wid, ids, images, fem_reference, section_images=None):
    ids = list(dict.fromkeys(str(value) for value in ids))
    primary = ids[0]
    attachments = {'section_images': [], 'field_images': [], 'cad_images': [], 'fem_chapter': None}
    for image in section_images or []:
        if fem_reference:
            from .fem_evidence import display_read
            saved = display_read(research,wid,primary)
        else:
            saved = research.get_run(wid, primary)
        from .report_selection import context
        selection=context(saved)
        if selection and image['case_id']!=selection['case_id']:
            raise HTTPException(422, {'code':'REPORT_SOURCE_INCONSISTENT','message':'截面附图必须使用首页推荐型号或最接近候选的同一保存工况。'})
        case = next((c for c in saved['snapshot']['cases'] if c['case_id'] == image['case_id']), None)
        valid = any(c['case_id'] == image['case_id'] and c['status'] == 'succeeded' for c in saved['output']['cases'])
        section = next((s for s in (case or {}).get('input', {}).get('sections', []) if s.get('id') == image['section_id']), None)
        if str(image['run_id']) != primary or saved['integrity'] != 'verified' or image['input_digest'] != saved['input_digest'] or not valid or section is None:
            raise HTTPException(409, '截面图必须引用所选保存运行的成功工况、截面和输入摘要。')
        attachments['section_images'].append({**image, 'label': section.get('label') or '敷设截面',
            'image_sha256': checked_png(image['png_base64'], image['width'], image['height'])})
        output_case=next(c for c in saved['output']['cases'] if c['case_id']==image['case_id'])
        field=output_case.get('artifacts',{}).get('x-cablesim.temperature-field')
        if field and not any(f['case_id']==image['case_id'] for f in attachments['field_images']):
            if saved.get('artifact_status',{}).get(image['case_id'],{}).get('x-cablesim.temperature-field',{}).get('status')!='verified':raise HTTPException(409,'温度场工件来源校验失败，不能纳入计算书。')
            from .convergence import has_temperature_field
            if has_temperature_field(saved) and not fem_reference:
                from .fem_evidence import proof
                if proof(research,saved,(fem_reference or {}).get('convergence_id'))['status']!='converged':raise HTTPException(422,'温度场未收敛，不能进入正式计算书。')
            if fem_reference:continue  # Its frozen chapter includes this same saved field.
            from .report_reads import saved_field_image
            from .report_reads import checkpoint
            checkpoint('field_image')
            raw=saved_field_image(field,research)
            checkpoint('evidence')
            analytic=field.get('source',{}).get('binding')=='iec-trace'
            if analytic:
                # Reuse the saved-triangle renderer, but label the actual IEC
                # soil projection instead of its default FEM footer.
                from PIL import Image,ImageDraw
                from .batch_field_chapter import field_font
                with Image.open(BytesIO(raw)) as png:
                    draw=ImageDraw.Draw(png)
                    # The colour-bar minimum label extends below y=546. Erase
                    # the old caption area only, keeping that saved scale legible.
                    draw.rectangle((0,546,min(909,png.width),png.height),fill='white')
                    draw.text((45,570),'保存 IEC 解析土壤场投影 · 仅土壤 · 水平／高程单位 m',fill='black',font=field_font(18))
                    stream=BytesIO();png.save(stream,format='PNG');raw=stream.getvalue()
            attachments['field_images'].append({'case_id':image['case_id'],'png_base64':b64encode(raw).decode(),'image_sha256':sha256(raw).hexdigest(),
                'basis':'IEC 解析土壤场投影；显示网格，电缆与排管内部不出值。' if analytic else '已通过收敛核验的有限元温度场。',
                'source_digest':output_case.get('artifact_digests',{}).get('x-cablesim.temperature-field'),
                'minimum_c':min(field['temperature_k'])-273.15,'maximum_c':max(field['temperature_k'])-273.15})
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
        attachments['cad_images'].append({**image, 'image_sha256': checked_png(image['png_base64'], image['metadata']['width'], image['metadata']['height'])})
    if fem_reference:
        fem_id, iec_id = str(fem_reference['fem_run_id']), str(fem_reference['iec_run_id'])
        if primary not in (fem_id, iec_id): raise HTTPException(409, '有限元章节必须包含所选源运行。')
        from .fem_evidence import workflow_for, report_chapter
        workflow=workflow_for(research,wid,fem_id)
        convergence_id=fem_reference.get('convergence_id') or (workflow or {}).get('id')
        data, fem = report_chapter(research, wid, fem_id, iec_id, convergence_id)
        convergence=data.get('convergence') or {}
        # Workflow completion is not the physical verdict. Chapter verifies the
        # saved observations; use that verdict for the delivery gate.
        verdict=convergence.get('verdict',convergence)
        if verdict.get('status') != 'converged' or not 0<verdict.get('tolerance_k',.1)<=.1:
            raise HTTPException(422, '有限元未收敛，不能进入正式计算书。')
        chosen = next(c for c in fem['output']['cases'] if c['case_id']==data['fem']['case_id'])
        from .report_reads import saved_field_image, checkpoint
        checkpoint('field_image')
        raw = saved_field_image(chosen['artifacts']['x-cablesim.temperature-field'],research)
        checkpoint('evidence')
        attachments['fem_chapter'] = {'data': data, 'png_base64': b64encode(raw).decode(), 'image_sha256': sha256(raw).hexdigest()}
        for rid in (fem_id, iec_id):
            if rid not in ids: ids.append(rid)
    return ids, attachments


def chapter_html(attachments, audience='internal'):
    """The same frozen chapter text is used by HTML and both PDF editions."""
    from .report import table
    bodies = []
    for image in attachments.get('section_images', []):
        bodies.append('<h2>敷设截面与电缆详图</h2><p>'+escape(image['label'])+'；尺寸按保存输入绘制，温度标注按该工况保存结果绘制。</p><p>来源：所选运行的输入快照与结果；附图由工作台同一二维绘图组件导出。</p>')
    for image in attachments.get('field_images', []):
        bodies.append('<h2>保存温度场</h2><p>色标 '+f"{image['minimum_c']:.1f} ～ {image['maximum_c']:.1f}"+' °C；'+escape(image['basis'])+'来源为保存且已校验的温度场工件，工件摘要 '+escape(str(image['source_digest']))+'</p>')
    for image in attachments.get('cad_images', []):
        m = image['metadata']; f = m['field']
        bodies.append('<h2>三维结果图</h2><p>保存结果的显示图；色标 '+escape(str(f['minimum']))+' ～ '+escape(str(f['maximum']))+
                      (' K' if f.get('kind')=='difference' else ' °C')+'，展示段 '+escape(str(m['displayLengthM']))+' m。</p>'+
                      '<p>来源：'+escape(f['source'] if audience=='internal' else f['source'].split(' · ')[0])+'</p>')
    fem = attachments.get('fem_chapter')
    if fem:
        data = fem['data']; conv = data['convergence']
        from .study_pdf import number
        def value(v,unit):return '未计算' if v is None else number(v-273.15 if unit=='K' else v,1)
        compared=[[('最热导体' if r['entity']=='maximum' else r['entity']),
            '导体温度 / °C' if r['key']=='conductor_temperature' else '共同能力 / A' if r.get('case')=='rating-simultaneous' else '条件能力 / A',
            value(r['fem'],r['unit']),value(r['iec'],r['unit']),number(r['delta'],2) if r['delta'] is not None else '—',
            number(r.get('relative_percent'),2)+'%' if r.get('relative_percent') is not None else '—'] for r in data['rows'] if r['fem'] is not None]
        source=data.get('boundary_source') or {}
        boundary_source=' '.join(str(source.get(k,'')) for k in ('standard','clause'))
        if source.get('printed_page'):boundary_source+=f" · 印刷第 {source['printed_page']} 页 / PDF 第 {source['pdf_page']} 页"
        executions=[];seen=set()
        for purpose,execution in [('最终额定校核',data.get('execution') or {})]+[('原生预检',e) for e in data.get('preflight_jobs',[])]+[('网格 / 扩域计算',e) for e in data.get('convergence_jobs',[])]+[('收敛起始保存运行（核时另计）' if i==0 else '收敛记录来源',r.get('execution') or {}) for i,r in enumerate(conv['rows'])]:
            job=execution.get('job_id')
            if job is None or str(job) in seen:continue
            hours=execution.get('core_hours')
            if hours is None and execution.get('actual_cpu_seconds') is not None:hours=execution['actual_cpu_seconds']/3600
            seen.add(str(job));executions.append([purpose,str(job),number(hours,3) if hours is not None else '未记录'])
        bodies.append('<h2>有限元温度场与 IEC 对照</h2><p>已收敛：网格与扩域均通过；门槛 '+number(conv.get('verdict',conv).get('tolerance_k',.1))+' K。两类均须连续两级满足，结果来自保存运行。</p>'+
            table(['对象','量值','有限元','IEC','差值 K / A','相对差'],compared)+
            '<p>温度相对差以 IEC 绝对温度 K 为分母；载流量仅按相同口径比较。未计算的口径不借用另一方法的数值。</p>'+
            '<h3>逐级收敛记录</h3>'+table(['级别','网格 / mm','最热点 / °C','变化 / K'], [[('额定校核（不计入收敛级别）' if r.get('kind')=='rating' else {'mesh':'网格','domain':'扩域'}.get(r.get('kind'),'核验')+' '+str(i)),number(r['mesh_size_m']*1000,2),number(r['hotspot_k']-273.15,3),number(r.get('change_k'),4) if r.get('kind')!='rating' and r.get('change_k') is not None else '—'] for i,r in enumerate(conv['rows'],1)])+
            '<h3>超算执行追溯</h3>'+table(['用途','Slurm 作业号','实际核时'],executions or [['保存执行记录','未记录','未记录']])+
            '<h3>边界与来源</h3>'+table(['边界口径','有限元','IEC'], [[r['item'],r['fem'],r['iec']] for r in data['scope']])+
            '<p>'+escape(boundary_source+'；'+source.get('scope','保存参数定义的边界。'))+'</p>'+
            '<p>本次收敛流程核时 '+number(conv.get('actual_core_hours'),3)+'；最终运行核时 '+number(data.get('execution',{}).get('core_hours'),3)+'，最终运行已包含在流程总量中，不重复累加。</p>'+
            ('<p>承接核验历史核时 '+number(conv['validation_history']['actual_core_hours'],3)+'；历史与本次合计 '+number(conv['validation_history']['actual_core_hours']+conv['actual_core_hours'],3)+'，历史包含失败作业的核时。</p>' if conv.get('validation_history') else '')+
            '<p>图来自保存温度场工件'+(' '+escape(data['field']['artifact_digest']) if audience=='internal' else '')+'；差异提示不是标准验收限值。</p>')
    return bodies
