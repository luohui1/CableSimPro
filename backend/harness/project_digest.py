"""Bounded pages of saved study conclusions; no solver or substitute values."""
from copy import deepcopy

from fastapi import HTTPException

from .context_builder import encoded, RESULT_BYTES
from .contracts import ToolResult
from .evidence import run_points


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
    headline_keys={(q['key'],q['entity'],q.get('condition')) for q in points['headlines']}
    for case in points['cases']:
        values = [q for q in case['results'] if q.get('key') in (
            'ampacity', 'conductor_temperature', 'temperature_margin', 'x-cablesim.emergency-current')
            and (q.get('key'),q.get('entity'),q.get('condition',q.get('case'))) not in headline_keys]
        values=[{key:q[key] for key in ('key','entity','value','unit','case','condition','status','reason') if key in q} for q in values]
        cases.append({'case_id':case['case_id'],'status':case['status'],'results':values,
            'factors':case['factors'],'limitations':case['limitations'],'error':case['error']})
    return {key: deepcopy(points[key]) for key in (
        'run_id','study_id','status','freshness','input_digest','output_digest','method','headlines')} | {
        'cases': cases, 'engineering_approval': False}


def project_digest(research, task, args):
    revision, studies, total = latest_studies(research, task, args.get('after', 0), args.get('limit', 20))
    data = {'workspace_id': task['workspace_id'], 'workspace_revision': revision,
        'session_revision': task['workspace_revision'], 'total_studies':total, 'studies': [], 'next_cursor': None,
        'read_hint': 'next_cursor 非空时用 project_digest(after=next_cursor) 继续；细节用 run_read(study_id,run_id)。'}
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
            item['latest_run']['error'] = run.get('error')
        # A large study never consumes the whole page silently. Preserve the run
        # identity and advertise omitted sections for an explicit detail read.
        latest = item['latest_run']
        if latest and len(encoded(item)) > 4000:
            # Retain declared limiting/hottest identities even when detailed
            # case quantities need a separate read.
            latest['cases']=[{key:case[key] for key in ('case_id','status','factors','limitations')}
                for case in latest.get('cases',[])[:3]]
            latest['details_omitted'] = True
            if len(encoded(item)) > 4000:
                latest = {'run_id':row['run_id'], 'status':latest['status'], 'details_omitted':True,
                    'limitations':['结论超过单页容量，请用 run_read 读取此研究。']}
                item['latest_run'] = latest
        data['studies'].append(item)
        data['next_cursor'] = row['cursor'] if index+1 < len(studies) else None
        # Include the complete public envelope, not just its data, in the bound.
        result = ToolResult(status=result.status, summary=result.summary, data=data)
        if len(encoded(result.model_dump(mode='json'))) > RESULT_BYTES:
            data['studies'].pop(); data['next_cursor'] = last
            break
        last = row['cursor']
    return ToolResult(status=result.status, summary=result.summary, data=data)


def study_baseline(research, task, args):
    """Bind comparison to one current saved case before creating any proposal."""
    sid = args.get('study_id') or task['study_id']
    if not sid:
        raise HTTPException(422, {'code':'STUDY_REQUIRED','message':'试算对比须明确研究；先用 project_digest 选择。','path':'/study_id'})
    if task['study_id'] and sid != task['study_id']:
        raise HTTPException(422, {'code':'SCOPE_VIOLATION','message':'会话绑定另一研究。','path':'/study_id'})
    rid = args.get('run_id')
    with research.store.db() as db:
        research.definition(db, task['workspace_id'], sid)
        if not rid:
            row = db.execute('SELECT id FROM study_runs WHERE workspace=? AND study=? ORDER BY sequence DESC LIMIT 1',
                (task['workspace_id'],sid)).fetchone()
            rid = row['id'] if row else None
    if not rid:
        raise HTTPException(422, {'code':'BASELINE_REQUIRED','message':'此研究尚无保存运行，无法比较；请先人工运行。','path':'/run_id'})
    try:
        run = research.get_run(task['workspace_id'],rid)
    except HTTPException as error:
        if error.status_code!=404:raise
        raise HTTPException(404, {'code':'BASELINE_NOT_FOUND','message':'原运行不存在或不属于本工程；请从 project_digest 选择保存运行。','path':'/run_id'}) from None
    if run['study']!=sid or run['freshness']!='current' or run['integrity']!='verified' or run['status']!='succeeded':
        raise HTTPException(409, {'code':'BASELINE_INVALID','message':'请选择本研究完整、正常且当前的保存运行。','path':'/run_id'})
    if run['snapshot']['workspace_revision']!=task['workspace_revision'] or run['snapshot'].get('module')!=args.get('module'):
        raise HTTPException(409, {'code':'BASELINE_INVALID','message':'原运行与会话修订或模块不一致。','path':'/run_id'})
    if task['study_id']==sid and run['snapshot']['study_revision']!=task['study_revision']:
        raise HTTPException(409, {'code':'BASELINE_INVALID','message':'研究已变化，请使用对应保存修订的会话。','path':'/study_id'})
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
