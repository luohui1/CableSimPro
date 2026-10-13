"""Report-ready projections of verified saved fields; never solve or approve."""
from io import BytesIO
from math import isfinite
from fastapi import HTTPException
from .batch_files import digest
from .batch_convergence import observation, verdict


def selected_case(run,case_id=None):
    if run.get('integrity')!='verified' or run.get('status') not in ('succeeded','partial'):
        raise ValueError('只能引用完整性通过的已保存运行。')
    cases=run['output']['cases']
    identifier=case_id or run.get('convergence',{}).get('reference_case_id') or cases[0]['case_id']
    observation(run,identifier,'mesh')
    return next(c for c in cases if c['case_id']==identifier),next(c for c in run['snapshot']['cases'] if c['case_id']==identifier)


def reference(run,case):
    return {'run_id':run['id'],'study':run['study'],'study_name':run['snapshot']['definition']['title'],
            'sequence':run.get('sequence'),'created':run.get('created'),'case_id':case['case_id'],
            'method':run['snapshot']['definition']['method'],'input_digest':digest(case['input']),
            'output_digest':run['output_digest'],'freshness':run.get('freshness','unknown'),
            'version_status':run.get('version_status'),
            'eligible_current_report':run.get('freshness')=='current' and (run.get('version_status') or {}).get('status')!='stale'}


def compare(fem,iec,case_id=None):
    if fem['snapshot']['definition']['method'].get('capability')!='iec-thermal-field':raise ValueError('当前计算书对照仅覆盖 IEC 耦合有限元热场。')
    chosen,original=selected_case(fem,case_id)
    if iec.get('integrity')!='verified' or iec.get('status') not in ('succeeded','partial') or iec['snapshot']['definition']['method']['plugin_id']!='cablesim.iec60287':
        raise ValueError('参考运行必须是完整性通过的 IEC 保存运行。')
    # Operation selects saved quantities, not the electrical/thermal condition.
    def scope(parameters):
        # Legacy Celsius and saved SI Kelvin spell the same starting state.
        # Normalize the unit, never discard an electrical/thermal selector.
        from copy import deepcopy
        value={k:deepcopy(v) for k,v in parameters.items() if k!='operation'}
        solver=value.get('solver',{})
        if 'initial_sheath_temperature_c' in solver and 'initial_sheath_temperature_k' not in solver:
            solver['initial_sheath_temperature_k']=solver.pop('initial_sheath_temperature_c')+273.15
        return value
    candidates=[c for c in iec['snapshot']['cases'] if c['input']==original['input'] and scope(c['parameters'])==scope(original['parameters'].get('iec',{}))]
    match=next(((a,b) for a in candidates for b in iec['output']['cases'] if b['case_id']==a['case_id'] and b['status']=='succeeded'),None)
    if not match:raise ValueError('领域输入、IEC 电损耗参数或额定口径不同，不能对照。')
    other,output=match;rows=[]
    items=list(chosen['results'])
    keys=lambda r:tuple(r.get(k) for k in ('key','entity','unit','case'))
    items.extend({**item,'status':'unavailable','value':None,'reason':{'code':'NOT_REQUESTED','message':'此保存级别未计算该量值。'}}
                 for item in output['results'] if keys(item) not in {keys(r) for r in chosen['results']})
    for item in items:
        if item['key'] not in ('conductor_temperature','ampacity'):continue
        b=next((r for r in output['results'] if all(r.get(k)==item.get(k) for k in ('key','entity','unit','case'))),{})
        a_value=item.get('value') if item['status']=='available' else None
        b_value=b.get('value') if b.get('status')=='available' else None
        if any(v is not None and (not isinstance(v,(int,float)) or not isfinite(v)) for v in (a_value,b_value)):raise ValueError('保存量值不是有限数。')
        delta=a_value-b_value if a_value is not None and b_value is not None else None
        rows.append({**{k:item.get(k) for k in ('entity','key','unit','case')},'fem':a_value,'iec':b_value,'delta':delta,
                     'relative_percent':delta/b_value*100 if delta is not None and b_value else None,
                     'reason':item.get('reason') or b.get('reason')})
    temperatures=[r for r in rows if r['key']=='conductor_temperature']
    if temperatures and all(r['fem'] is not None and r['iec'] is not None for r in temperatures) and len(temperatures)==sum(r['key']=='conductor_temperature' for r in output['results']):
        a=max(r['fem'] for r in temperatures);b=max(r['iec'] for r in temperatures)
        rows.insert(0,{'entity':'maximum','key':'conductor_temperature','unit':'K','case':'operating','fem':a,'iec':b,'delta':a-b,'relative_percent':(a-b)/b*100})
    for row in rows:
        row['exceeded']=row['delta'] is not None and (abs(row['delta'])>2 if row['unit']=='K' else row['relative_percent'] is not None and abs(row['relative_percent'])>5)
    saved_boundary=chosen.get('artifacts',{}).get('x-cablesim.simulation-bundle',{}).get('result',{}).get('outer_boundary',{})
    boundary=saved_boundary.get('kind') or original['parameters'].get('outer_boundary') or 'ambient_truncated'
    assumptions=chosen.get('artifacts',{}).get('x-cablesim.simulation-bundle',{}).get('result',{}).get('assumptions',[])
    model_scope=[]
    if any(c.get('construction')=='single_core' for c in original['input'].get('cable_types',[])):
        for label,prefix in (('接触假设','相切外护套'),('波纹假设','波纹护套'),('未覆盖','二维均匀环')):
            statement=next((a for a in assumptions if isinstance(a,str) and a.startswith(prefix)),None)
            if statement:model_scope.append({'item':label,'fem':statement,'iec':'保存 IEC 圆环及品字形口径'})
    return {'fem':reference(fem,original),'iec':reference(iec,other),'rows':rows,'outer_boundary':boundary,
            'modelling_assumptions':assumptions,
            'scope':[{'item':'边界','fem':'Kennelly 镜像远场 · 当前迭代实际损耗' if boundary=='kennelly_image' else '环境定温截断','iec':'无限土壤解析外部热阻'},
                     {'item':'地表','fem':'保存环境温度 · 等温','iec':'Kennelly 镜像 · 等温'},
                     {'item':'互热','fem':'二维电缆热域耦合','iec':'IEC 外部互热模型'},
                     {'item':'差异提示','fem':'温差 > 2 K / 电流 > 5%','iec':'界面提示阈值，非标准验收限值'}]+model_scope,
            'relative_temperature_basis':'kelvin', 'engineering_approval':False}


def field_font(size=20):
    """Use the calculation book's embedded CJK face on every platform."""
    import fitz
    from PIL import ImageFont
    return ImageFont.truetype(BytesIO(fitz.Font('cjk').buffer),size=size)


def field_png(field):
    """Rasterize saved display triangles using FieldView's temperature tokens.

    Barycentric interpolation is display-only. It does not refine the FEM mesh.
    """
    import numpy as np
    import re
    from pathlib import Path
    from PIL import Image,ImageDraw
    if field.get('temperature_unit')!='K' or field.get('association')!='node':raise ValueError('不支持的场图单位或节点关联。')
    points=np.asarray(field['mesh']['points'],dtype=float);values=np.asarray(field['temperature_k'],dtype=float)-273.15
    triangles=np.asarray(field['mesh']['triangles'],dtype=int)
    if not np.isfinite(points).all() or not np.isfinite(values).all() or len(points)!=len(values):raise ValueError('场图数据不完整。')
    width,height=1000,600;low=points.min(axis=0);high=points.max(axis=0)
    scale=min(850/max(high[0]-low[0],1e-9),490/max(high[1]-low[1],1e-9))
    screen=np.column_stack((45+(points[:,0]-low[0])*scale,540-(points[:,1]-low[1])*scale))
    raster=np.full((height,width),np.nan);vmin=float(values.min());vmax=float(values.max());span=max(vmax-vmin,1e-9)
    for indexes in triangles:
        p=screen[indexes];temps=values[indexes]
        x0,y0=np.maximum(0,np.floor(p.min(axis=0)).astype(int));x1,y1=np.minimum([width-1,height-1],np.ceil(p.max(axis=0)).astype(int))
        if x1<x0 or y1<y0:continue
        yy,xx=np.mgrid[y0:y1+1,x0:x1+1];xx=xx+.5;yy=yy+.5
        denominator=(p[1,1]-p[2,1])*(p[0,0]-p[2,0])+(p[2,0]-p[1,0])*(p[0,1]-p[2,1])
        if abs(denominator)<1e-15:continue
        a=((p[1,1]-p[2,1])*(xx-p[2,0])+(p[2,0]-p[1,0])*(yy-p[2,1]))/denominator
        b=((p[2,1]-p[0,1])*(xx-p[2,0])+(p[0,0]-p[2,0])*(yy-p[2,1]))/denominator
        mask=(a>=-1e-8)&(b>=-1e-8)&(a+b<=1+1e-8)
        raster[y0:y1+1,x0:x1+1][mask]=(a*temps[0]+b*temps[1]+(1-a-b)*temps[2])[mask]
    tokens=(Path(__file__).resolve().parents[2]/'design'/'tokens.css').read_text(encoding='utf-8')
    palette=[]
    for index in range(1,7):
        match=re.search(r'--temperature-'+str(index)+r'\s*:\s*#([0-9a-fA-F]{6})\s*;',tokens)
        if not match:raise ValueError('温度色阶配置不完整。')
        palette.append([int(match[1][start:start+2],16) for start in (0,2,4)])
    palette=np.asarray(palette,dtype=float)
    def color(x):
        position=np.clip(x,0,1)*5;index=np.minimum(4,np.floor(position).astype(int))
        return np.floor(palette[index]+(palette[index+1]-palette[index])*(position-index)[...,None]+.5).astype(np.uint8)
    t=np.clip(np.nan_to_num((raster-vmin)/span),0,1);rgb=color(np.floor(t*14)/14);rgb[~np.isfinite(raster)]=255
    image=Image.fromarray(rgb);draw=ImageDraw.Draw(image);font=field_font()
    # Isotherms from the same piecewise-linear saved triangles.
    for indexes in triangles:
        p=screen[indexes];temps=values[indexes]
        for level in np.linspace(vmin,vmax,10)[1:-1]:
            if not temps.min()<level<temps.max():continue
            hits=[]
            for a,b in ((0,1),(1,2),(2,0)):
                if (temps[a]<level)!=(temps[b]<level):hits.append(tuple(p[a]+(p[b]-p[a])*(level-temps[a])/(temps[b]-temps[a])))
            if len(hits)==2:draw.line(hits,fill=(40,40,40),width=1)
    for y in range(50,541):
        rgb=tuple(color(np.asarray((540-y)/490)).tolist());draw.line([(915,y),(937,y)],fill=rgb)
    draw.text((910,18),'°C',fill='black',font=font)
    for y,v in ((50,vmax),(530,vmin)):draw.text((942,y),f'{v:.1f}',fill='black',font=font)
    hotspot=field['hotspot'];x=45+(hotspot['point_m'][0]-low[0])*scale;y=540-(hotspot['point_m'][1]-low[1])*scale
    draw.ellipse((x-5,y-5,x+5,y+5),outline='black',fill='white',width=2)
    label=f"最高温度 {hotspot['temperature_k']-273.15:.2f} °C";tx=max(45,min(680,x+12));ty=max(28,y-27)
    draw.rectangle(draw.textbbox((tx,ty),label,font=font),fill='white');draw.text((tx,ty),label,fill='black',font=font)
    draw.text((45,570),f"水平范围 {low[0]:g}～{high[0]:g} m · 高程范围 {low[1]:g}～{high[1]:g} m · 保存有限元网格",fill='black',font=font)
    if field.get('convergence',{}).get('display_decimated'):
        draw.text((45,546),f"显示已降采样，计算用全网格 · {field['convergence']['full_mesh_nodes']} 节点",fill='black',font=font)
    stream=BytesIO();image.save(stream,format='PNG');return stream.getvalue()


def chapter(research,refinements,wid,rid,iec_id,convergence_id=None):
    fem=research.get_run(wid,rid);iec=research.get_run(wid,iec_id);workflow=None;case_id=None
    if convergence_id:
        workflow=refinements.load(convergence_id)
        if workflow['workspace']!=wid or rid not in {r['run_id'] for r in workflow['rows']}:raise HTTPException(409,'收敛研究与引用运行不匹配。')
        proven=verdict(workflow['rows'],workflow['request']['tolerance_k'])
        latest=workflow['rows'][-1]
        if rid!=latest['run_id']:raise HTTPException(409,'请引用收敛研究最终网格与计算域运行，避免套用其他级别的结论。')
        case_id=latest['case_id']
        executions={}
        validation=workflow.get('validation_history')
        proof_rows=workflow['rows']+(validation or {}).get('rows',[])
        for source_id in dict.fromkeys(r['run_id'] for r in proof_rows):
            saved=fem if source_id==rid else research.get_run(wid,source_id)
            executions[source_id]=saved.get('execution')
            for row in (r for r in proof_rows if r['run_id']==source_id):
                actual=observation(saved,row['case_id'],row['kind'])
                if any(actual[k]!=row[k] for k in actual if k not in ('change_k','study_name')):raise HTTPException(409,'收敛记录与封存结果不一致，拒绝引用。')
        attempts=workflow.get('history_attempts',[])+workflow['attempts']
        rows=[{**row,'execution':executions[row['run_id']]} for row in workflow['rows']]
        workflow={**workflow,'rows':rows,'verdict':proven}
        if validation:
            failed=[]
            for source_id in validation.get('run_executions',{}):
                if source_id in executions:continue
                saved=research.get_run(wid,source_id)
                if saved['status'] in ('failed','interrupted'):
                    failed.append({'run_id':source_id,'status':saved['status'],'error':saved.get('error'),'execution':saved.get('execution')})
            workflow['validation_history']={**validation,'rows':[{**row,'execution':executions[row['run_id']]} for row in validation['rows']], 'failed_runs':failed}
    data=compare(fem,iec,case_id);chosen,_=selected_case(fem,case_id)
    data['boundary']=chosen['artifacts'].get('x-cablesim.simulation-bundle',{}).get('result',{}).get('outer_boundary')
    if data['outer_boundary']=='kennelly_image':
        data['boundary_source']={'standard':'IEC 60287-2-1:2023','clause':'4.2.3.2','printed_page':22,'pdf_page':24,
            'kind':'standard_reference','scope':'镜像线热源温升公式；将其用于有限元侧边/底边是本插件的远场边界处理，不是标准新增载流量公式。'}
    data.update(schema_version='cablesim.fem-report-chapter/1',title='有限元温度场与 IEC 对照',
                convergence={k:workflow[k] for k in ('id','status','verdict','reason','rows','attempts','actual_core_hours','per_step_upper_core_hours')} if workflow else fem.get('convergence'),
                execution={**(fem.get('execution') or {}),'core_hours':(fem.get('execution') or {}).get('actual_cpu_seconds',0)/3600},
                preflight_jobs=list(workflow['preflight_executions'].values()) if workflow else [],
                convergence_jobs=([a['execution'] for a in workflow.get('history_attempts',[]) if a.get('execution')]+list(workflow.get('run_executions',{}).values())) if workflow else [],
                field={'artifact_digest':chosen['artifact_digests']['x-cablesim.temperature-field'],
                       'display_decimated':chosen['artifacts']['x-cablesim.temperature-field'].get('convergence',{}).get('display_decimated',False),
                       'full_mesh_nodes':chosen['artifacts']['x-cablesim.temperature-field'].get('convergence',{}).get('full_mesh_nodes'),
                       'image_url':f'/api/hpc/workspaces/{wid}/fields/{rid}.png?case_id={chosen["case_id"]}',
                       'media_type':'image/png','temperature_unit':'degC','length_unit':'m'})
    if workflow and workflow.get('validation_history'):data['convergence']['validation_history']=workflow['validation_history']
    data['chapter_digest']=digest(data)
    return data
