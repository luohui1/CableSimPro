"""Bounded pages of saved study conclusions; no solver or substitute values."""
from copy import deepcopy

from fastapi import HTTPException

from .context_builder import encoded, RESULT_BYTES
from .contracts import ToolResult,Diagnostic
from .evidence import run_points


def diagnostic(value):
    if value is None:return None
    if isinstance(value,dict):
        return {key:str(value[key])[:240] for key in ('code','message','path') if key in value} | {'detail_in_saved_run':True}
    return str(value)[:240]


def key_inputs(case):
    """Only frozen case facts; a current workspace is not a historical run input."""
    document=case.get('input') or {};values=[]
    def add(path,value,unit,entity):
        if type(value) in (int,float):values.append({'path':path,'value':value,'unit':unit,'entity':entity})
    token=lambda value:str(value).replace('~','~0').replace('/','~1')
    for material in document.get('materials',[]):
        add('/materials/'+token(material['id'])+'/thermal_resistivity',material.get('thermal_resistivity'),'K·m/W',material['id'])
    for section in document.get('sections',[]):
        for placement in section.get('placements',[]):
            z=placement.get('z')
            path='/sections/'+token(section['id'])+'/placements/'+token(placement['cable'])+'/z'
            if type(z) in (int,float):
                values.append({'path':path,'key':'burial_depth' if z<0 else 'elevation',
                    'value':-z if z<0 else z,'unit':'m','entity':placement['cable'],'saved_z':z,
                    'projection':'-z below ground; z above ground'})
    for load in document.get('load_cases',[]):
        for entity,value in load.get('currents',{}).items():
            add('/load_cases/'+token(load['id'])+'/currents/'+token(entity),value,'A',entity)
    return values


def latest_studies(research, task, after=0, limit=20):
    with research.store.db() as db:
        db.execute('BEGIN')
        current, _ = research.store.load(db, task['workspace_id'])
        rows = db.execute('''SELECT s.rowid AS cursor,s.id,
            (SELECT r.id FROM study_runs r WHERE r.workspace=s.workspace AND r.study=s.id
             ORDER BY r.sequence DESC LIMIT 1) AS run_id
            FROM studies s WHERE s.workspace=? AND s.rowid>? ORDER BY s.rowid LIMIT ?''',
            (task['workspace_id'], after, limit+1)).fetchall()
        studies = [(dict(row), research.definition(db, task['workspace_id'], row['id'])) for row in rows]
        total = db.execute('SELECT COUNT(*) FROM studies WHERE workspace=?',(task['workspace_id'],)).fetchone()[0]
    return current['revision'], studies, total


def conclusions(research, run):
    points = run_points(research, run)
    # Headlines already select the producer's declared entities and conditions.
    # Keep case evidence too: no-positive ratings and non-selection scans need it.
    cases = []
    originals={case['case_id']:case for case in run['snapshot'].get('cases',[])}
    for case in points['cases']:
        values = [q for q in case['results'] if q.get('key') in (
            'ampacity', 'conductor_temperature', 'temperature_margin', 'x-cablesim.emergency-current')]
        values=[{key:(diagnostic(q[key]) if key=='reason' else q[key]) for key in ('key','entity','value','unit','case','condition','status','reason') if key in q} for q in values]
        factors=[{key:value for key,value in factor.items() if key!='source'} for factor in case['factors']]
        cases.append({'case_id':case['case_id'],'status':case['status'],'results':values,
            'factors':factors,'limitations':[str(value)[:240] for value in case['limitations'][:4]],'error':diagnostic(case['error']),
            'input_fields':key_inputs(originals.get(case['case_id'],{}))})
    return {key: deepcopy(points[key]) for key in (
        'run_id','study_id','status','freshness','input_digest','output_digest','method','headlines')} | {
        'cases': cases, 'method_family':points['method_family'],
        'numerical_status':(run.get('convergence') or {}).get('status','unknown'),'engineering_approval': False}


def case_parts(cases):
    """Page unusually large cases without discarding any conclusion or input fact."""
    parts=[]
    for case in cases:
        if len(encoded(case))<=2400:parts.append(case);continue
        base={key:value for key,value in case.items() if key not in ('results','input_fields','factors')}
        part={**base,'results':[],'input_fields':[],'factors':[],'part':0}
        for key in ('results','factors','input_fields'):
            for value in case[key]:
                if len(encoded(part))+len(encoded(value))>2400 and any(part[k] for k in ('results','factors','input_fields')):
                    parts.append(part);part={**base,'results':[],'input_fields':[],'factors':[],'part':part['part']+1}
                part[key].append(value)
        parts.append(part)
    return parts


def project_digest(research, task, args):
    revision, studies, total = latest_studies(research, task, args.get('after', 0), args.get('limit', 20))
    data = {'workspace_id': task['workspace_id'], 'workspace_revision': revision,
        'session_revision': task['workspace_revision'], 'total_studies':total, 'studies': [], 'next_cursor': None,
        'next_page':None,
        'read_hint': 'next_page 非空时以其参数继续 conclusion_summary；摘要完整后直接解释，只有用户追问细节再读运行。burial_depth为保存负z坐标取反，saved_z保留原件。'}
    result = ToolResult(status='ok', summary='已读取各研究最新保存结论；历史、失败与缺项单独标明。', data=data)
    cache = {}; last = args.get('after', 0)
    for index, (row, study) in enumerate(studies):
        if index >= args.get('limit', 20):
            data['next_cursor'] = last
            break
        item = {'study_id': study['id'], 'title': study['definition']['title'][:120],
            'study_revision': study['revision'], 'run_state': 'not_run', 'latest_run': None}
        if row['run_id']:
            run = research.get_run(task['workspace_id'], row['run_id'], cache)
            item['run_state'] = ('failed' if run['status'] in ('failed','partial','cancelled','interrupted') or run['integrity']!='verified'
                else 'running' if run['status'] not in ('succeeded',)
                else 'stale' if run['freshness']!='current' else 'normal')
            if run['integrity']=='verified':
                item['latest_run'] = conclusions(research, run)
            else:
                item['latest_run'] = {'run_id':run['id'], 'status':run['status'], 'integrity':run['integrity'],
                    'limitations':['运行完整性未通过，不提供数值。']}
            item['latest_run']['error'] = diagnostic(run.get('error'))
        latest = item['latest_run']
        if latest and latest.get('cases'):
            parts=case_parts(latest['cases']);start=args.get('case_after',0) if index==0 else 0
            latest['cases']=[]
            for part_index in range(start,len(parts)):
                latest['cases'].append(parts[part_index])
                trial={**data,'studies':[*data['studies'],item],'next_cursor':last,
                    'next_page':{'after':last,'case_after':part_index}}
                if len(encoded(ToolResult(status=result.status,summary=result.summary,data=trial).model_dump(mode='json')))>RESULT_BYTES:
                    latest['cases'].pop()
                    data['next_cursor']=last;data['next_page']={'after':last,'case_after':part_index if latest['cases'] else start}
                    if latest['cases']:data['studies'].append(item)
                    return ToolResult(status=result.status,summary=result.summary,data=data)
        data['studies'].append(item)
        data['next_cursor'] = row['cursor'] if index+1 < len(studies) else None
        data['next_page']={'after':data['next_cursor']} if data['next_cursor'] is not None else None
        # Include the complete public envelope, not just its data, in the bound.
        result = ToolResult(status=result.status, summary=result.summary, data=data)
        if len(encoded(result.model_dump(mode='json'))) > RESULT_BYTES:
            data['studies'].pop(); data['next_cursor'] = last;data['next_page']={'after':last}
            break
        last = row['cursor']
    if data['next_cursor'] is not None and data['next_page'] is None:data['next_page']={'after':data['next_cursor']}
    return ToolResult(status=result.status, summary=result.summary, data=data)


def invalid_baseline(research,task,sid,run,reasons,module=None):
    """Actionable metadata, never promote old/partial quantities into a baseline."""
    def brief(value):
        return {key:value.get(key) for key in ('id','study','status','freshness','integrity')} | {
            'method':(value.get('snapshot') or {}).get('definition',{}).get('method'),
            'workspace_revision':(value.get('snapshot') or {}).get('workspace_revision'),
            'usable_as_baseline':value.get('status')=='succeeded' and value.get('freshness')=='current' and value.get('integrity')=='verified'
                and (value.get('snapshot') or {}).get('workspace_revision')==task['workspace_revision']
                and (value.get('snapshot') or {}).get('module')==module}
    with research.store.db() as db:
        ids=[row[0] for row in db.execute('SELECT id FROM study_runs WHERE workspace=? AND study=? ORDER BY sequence DESC LIMIT 3',
            (task['workspace_id'],sid))]
    recent=[];cache={}
    for rid in ids:
        candidate=run if run and run['id']==rid else research.get_run(task['workspace_id'],rid,cache)
        recent.append(brief(candidate))
    actions=[{'id':'rerun_study','label':'在工作台打开该研究；若方法或型号升级，先更新研究来源到当前版本，核对输入与工况后人工重算并保存正常运行。',
        'workspace_id':task['workspace_id'],'study_id':sid,'module':module,'target':'workbench','requires_human':True},
        {'id':'new_session','label':'重算完成后新建绑定当前研究的 Agent 会话，再请求方案试算对比。',
        'workspace_id':task['workspace_id'],'study_id':sid,'target':'agent','requires_human':True}]
    details={'reasons':reasons,'requested_run':brief(run) if run else None,'latest_run':recent[0] if recent else None,
        'available_runs':recent,'actions':actions,'stale_reference_allowed':False,'proposal_executed':False,'preview_executed':False}
    message='试算基准不可用：'+'；'.join(row['message'] for row in reasons)+'。需要先在工作台重算；本次方案和试算未执行。'
    return ToolResult(status='error',summary=message,data={'baseline':details},
        diagnostics=[Diagnostic(code='BASELINE_INVALID' if run else 'BASELINE_REQUIRED',message=message,path='/run_id',recoverable=True,details=details)],
        next_actions=[action['label'] for action in actions])


def study_baseline(research, task, args):
    """Bind comparison to one current saved case before creating any proposal."""
    sid = args.get('study_id') or task['study_id']
    if not sid:
        raise HTTPException(422, {'code':'STUDY_REQUIRED','message':'试算对比须明确研究；先用 project_digest 选择。','path':'/study_id'})
    if task['study_id'] and sid != task['study_id']:
        raise HTTPException(422, {'code':'SCOPE_VIOLATION','message':'会话绑定另一研究。','path':'/study_id'})
    rid = args.get('run_id')
    with research.store.db() as db:
        study=research.definition(db, task['workspace_id'], sid)
        current,_=research.store.load(db,task['workspace_id'])
        if not rid:
            row = db.execute('SELECT id FROM study_runs WHERE workspace=? AND study=? ORDER BY sequence DESC LIMIT 1',
                (task['workspace_id'],sid)).fetchone()
            rid = row['id'] if row else None
    if not rid:
        return invalid_baseline(research,task,sid,None,[{'code':'NO_SAVED_RUN','message':'此研究尚无保存运行'}],args.get('module'))
    try:
        run = research.get_run(task['workspace_id'],rid)
    except HTTPException as error:
        if error.status_code!=404:raise
        raise HTTPException(404, {'code':'BASELINE_NOT_FOUND','message':'原运行不存在或不属于本工程；请从 project_digest 选择保存运行。','path':'/run_id'}) from None
    if run['study']!=sid:raise HTTPException(422,{'code':'SCOPE_VIOLATION','message':'保存运行不属于所选研究。','path':'/run_id'})
    reasons=[{key:value for key,value in row.items() if key in ('kind','code','message','id','from_version','to_version','from_digest','to_digest')}
        for row in run.get('version_status',{}).get('reasons',[])]
    def reason(code,message,**details):reasons.append({'code':code,'message':message,**details})
    snapshot=run.get('snapshot') or {}
    if run['integrity']!='verified':reason('INTEGRITY_FAILED','保存运行完整性未通过，不能作为比较证据')
    if run['status']!='succeeded':reason('PARTIAL_SUCCESS' if run['status']=='partial' else 'RUN_NOT_SUCCEEDED',
        '保存运行仅部分成功，不能作为完整基准' if run['status']=='partial' else '保存运行未正常成功完成',status=run['status'])
    if snapshot.get('workspace_revision')!=current['revision']:
        reason('INPUT_REVISION_CHANGED','工程输入修订已变化',saved_revision=snapshot.get('workspace_revision'),current_revision=current['revision'])
    try:selected=research.module_definition(study['definition'],args.get('module'))
    except HTTPException:selected=None;reason('MODULE_UNAVAILABLE','所选研究模块已不可用')
    if selected is not None and snapshot.get('definition'):
        old=snapshot['definition']
        if selected['method']!=old['method'] and not any(row['code'].startswith('METHOD_') for row in reasons):
            reason('METHOD_CONFIGURATION_CHANGED','研究的方法或插件配置已变化',saved_method=old['method'],current_method=selected['method'])
        if any(selected.get(key)!=old.get(key) for key in ('parameters','driver','input_source','method_input','crosschecks')):
            reason('STUDY_INPUT_CHANGED','研究输入、方法参数或工况配置已变化')
    if snapshot.get('workspace_revision')!=task['workspace_revision']:
        reason('SESSION_REVISION_MISMATCH','保存基准与会话绑定的工程修订不一致')
    if snapshot.get('module')!=args.get('module'):reason('MODULE_MISMATCH','保存基准属于另一研究模块')
    if task['study_id']==sid and snapshot.get('study_revision')!=task['study_revision']:
        reason('SESSION_STUDY_REVISION_MISMATCH','保存基准与会话绑定的研究修订不一致')
    if run['freshness']!='current' and not reasons:reason('HISTORICAL_BASELINE','保存运行已过期或属于历史版本')
    if reasons:return invalid_baseline(research,task,sid,run,reasons,args.get('module'))
    cid = args.get('case_id')
    if cid is None:
        kind = run['snapshot']['definition']['driver']['kind']
        if kind=='selection':
            from backend.kernel.report import recommended_case
            cid = recommended_case(run)
        elif kind=='single':
            primary = [case for case in run['output']['cases'] if not case.get('method') and not case['case_id'].startswith('crosscheck-')]
            if len(primary)==1: cid=primary[0]['case_id']
    if not cid:
        raise HTTPException(422, {'code':'CASE_REQUIRED','message':'扫描或批量研究须选择原保存工况。','path':'/case_id'})
    case=next((case for case in run['output']['cases'] if case['case_id']==cid and not case.get('method')
        and not case['case_id'].startswith('crosscheck-')),None)
    if case is None or case['status']!='succeeded':
        raise HTTPException(422, {'code':'BASELINE_CASE_INVALID','message':'请选择原保存运行中成功的主工况，不能用交叉校核或失败工况试算。','path':'/case_id'})
    points = run_points(research,run,cid)
    return ToolResult(status='ok',summary='已绑定当前保存工况；后续试算保持其方法与工况身份。',
        data={**points,'source_run_id':rid,'source_case_id':cid},
        execution_ref={'run_id':rid,'study_id':sid,'case_id':cid,'status':run['status']})
