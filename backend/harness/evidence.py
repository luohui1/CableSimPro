"""Read existing evidence without manufacturing verification or model quantities."""
import math
import re

from fastapi import HTTPException

from backend.kernel.headlines import project


def run_points(research,run,case_id=None):
    if run['integrity']!='verified':raise HTTPException(409,{'code':'RUN_INTEGRITY_FAILED','message':'运行完整性未通过，拒绝提供数值。'})
    output=run.get('output') or {}
    selected=[case for case in output.get('cases',[]) if case_id is None or case['case_id']==case_id]
    if case_id is not None and not selected:raise HTTPException(404,'此运行没有指定工况。')
    if case_id is None and run['snapshot']['definition']['driver']['kind']=='selection':
        from backend.kernel.report import recommended_case
        preferred=recommended_case(run)
        selected=[case for case in selected if case['case_id']==preferred] if preferred else []
    cases=[];refs=[]
    for case in selected[:10]:
        cases.append({'case_id':case['case_id'],'status':case['status'],
            'results':case.get('results',[])[:12] if case['status']=='succeeded' else [],
            'error':case.get('error'),'warnings':case.get('warnings',[])[:4]})
        for kind,digest in case.get('artifact_digests',{}).items():
            refs.append({'run_id':run['id'],'case_id':case['case_id'],'artifact_type':kind,'sha256':digest,
                'verification':run.get('artifact_status',{}).get(case['case_id'],{}).get(kind,{}).get('status','unknown')})
    headline=project(run['snapshot'],output,run.get('artifact_status')) if run['status'] in ('succeeded','partial') else []
    headline=[{**value,'display_rounded':round(value['display_value'],1)} for value in headline]
    numerical=run.get('convergence')
    return {'run_id':run['id'],'study_id':run['study'],'status':run['status'],'freshness':run['freshness'],
        'input_digest':run['input_digest'],'output_digest':run.get('output_digest'),'method':run['snapshot']['definition']['method'],
        'headlines':headline,'cases':cases,'assessment':output.get('assessment',[])[:10],
        'checks':{'integrity':'pass','artifact_status':run.get('artifact_status',{}),
            'numerical':numerical if numerical is not None else {'status':'unknown','message':'未取得独立数值收敛检查。'},
            'cad_analysis_qualification':{'status':'unknown','message':'本轮未接入CAD分析资格桥。'},
            'engineering_approval':False},'artifact_refs':refs,'truncated':len(selected)>10}


def numbers(value):
    result=set()
    def visit(item):
        if type(item) in (int,float) and math.isfinite(item):result.add(float(item))
        elif isinstance(item,dict):
            for child in item.values():visit(child)
        elif isinstance(item,list):
            for child in item:visit(child)
    visit(value)
    return result


def quantity_facts(observations):
    facts=[]
    def add(value,unit,key,headline=False):
        if type(value) in (int,float) and math.isfinite(value) and unit:
            facts.append((float(value),unit,key,headline))
            facts.append((round(float(value),1),unit,key,headline))
    def visit(item):
        if isinstance(item,dict):
            key=item.get('key') or item.get('path') or item.get('label')
            if item.get('status')!='unavailable':add(item.get('value'),item.get('unit'),key)
            add(item.get('display_value'),item.get('display_unit'),key,True)
            add(item.get('before'),item.get('unit'),key)
            add(item.get('after'),item.get('unit'),key)
            for child in item.values():visit(child)
        elif isinstance(item,list):
            for child in item:visit(child)
    visit(observations)
    return facts


def grounded_text(text,observations,*,current=None,proposals=None):
    """Block unseen numeric claims before any assistant text is persisted or streamed."""
    known=numbers(observations)
    facts=quantity_facts(observations)
    current=current if current is not None else observations
    if re.search(r'方案(?:已经|已)?(?:生成|创建|提出)',text) and not any(item.get('data',{}).get('proposal') for item in current):
        raise HTTPException(422,{'code':'UNSUPPORTED_OPERATION_CLAIM','message':'本次工具没有生成方案，已拦截与实际操作不符的解释。'})
    if re.search(r'已经?(?:写入|修改|更新|保存)|已(?:写入|修改|更新)|已(?:经)?批准',text):
        if not proposals or any(item['status']=='pending' for item in proposals) or not any(item['status']=='approved' for item in proposals):
            raise HTTPException(422,{'code':'UNSUPPORTED_OPERATION_CLAIM','message':'没有相应人工保存回执，模型不能宣称已保存或批准。'})
    if re.search(r'已(?:经)?发布|已(?:经)?外发|合规认证通过',text):
        raise HTTPException(422,{'code':'ENGINEERING_AUTHORITY_REQUIRED','message':'模型没有发布、外发或工程认证权限。'})
    # Manifest/version identifiers and standard names are references, not quantities.
    clean=re.sub(r'\b(?:IEC|GB|TB)\s*\d+(?:[-.]\d+)*','标准引用',text,flags=re.I)
    if re.search(r'[零〇一二两三四五六七八九十百千万点]+\s*(?:安培|安|伏特|伏|米|摄氏度|度|A\b|K\b|V\b|℃|°C)',clean):
        raise HTTPException(422,{'code':'UNGROUNDED_QUANTITY','message':'工程数值须按工具返回的明确数字与单位引用，不能改写为未核验的中文数值。'})
    quantity=re.compile(r'([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*(K[·*]m/W|J/\(m³[·*]K\)|Ω/m|ohm/m|m²|m2|mm²|mm2|°C|℃|A|K|V|Hz|m|s|%)')
    for match in quantity.finditer(clean):
        number=float(match.group(1));unit=match.group(2).replace('℃','°C').replace('m2','m²').replace('*','·')
        context=clean[max(0,match.start()-18):match.end()+8]
        candidates=[fact for fact in facts if math.isclose(number,fact[0],rel_tol=1e-9,abs_tol=1e-10)
            and unit==fact[1].replace('℃','°C').replace('m2','m²').replace('*','·')]
        if '推荐' in context:candidates=[fact for fact in candidates if fact[3]]
        if re.search(r'允许电流|载流量',context):candidates=[fact for fact in candidates if fact[2] in ('ampacity','x-cablesim.emergency-current')]
        if not candidates:
            raise HTTPException(422,{'code':'UNGROUNDED_QUANTITY','message':'模型解释中的数值、单位或结论归属没有对应工具证据，已拦截。'})
        known.add(number)
    for token in re.findall(r'(?<![A-Za-z0-9_/.:-])[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?(?![A-Za-z0-9_/])',clean):
        number=float(token)
        if not any(math.isclose(number,value,rel_tol=1e-9,abs_tol=1e-10) for value in known):
            raise HTTPException(422,{'code':'UNGROUNDED_NUMBER','message':'模型解释包含工具或输入中没有的数值，已拦截；请读取证据后再说明。'})
    return text


def reconcile(research,tasks,tid,*,persist=False):
    """Query original Run references; an unknown ephemeral preview is never resubmitted."""
    record=tasks.record(tid);unresolved=[];resolved=[]
    for step in record['steps']:
        if step['state']!='unknown':continue
        reference=step.get('execution_ref') or {}
        if not reference.get('run_id') and step['tool']=='run_read':reference=step.get('input_identity') or {}
        if reference.get('run_id'):
            try:
                run=research.get_run(record['workspace_id'],reference['run_id'])
                if run['study']!=step.get('study_id') or run['integrity']!='verified':raise HTTPException(409,'原运行归属或完整性未通过。')
                if run['status'] in ('succeeded','partial','failed','interrupted'):
                    from .contracts import ToolResult
                    data=run_points(research,run,step['arguments'].get('case_id'))
                    refs=data.pop('artifact_refs')
                    result=ToolResult(status='ok',summary='已对账并读取原运行状态；未重新执行。',
                        data=data,artifact_refs=refs,execution_ref={'run_id':run['id'],'study_id':run['study'],'status':run['status']}).model_dump(mode='json')
                    if persist:tasks.reconcile_step(tid,step['operation_id'],result)
                    resolved.append({'operation_id':step['operation_id'],'run_id':run['id'],'status':run['status']})
                    continue
            except HTTPException:pass
        unresolved.append({'operation_id':step['operation_id'],'tool':step['tool'],'reason':'无法确认原步骤结果；没有重新执行。'})
    return {'resolved':resolved,'unknown':unresolved,'reissued':False}
