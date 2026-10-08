"""Saved finite-element evidence and human-only verification study proposals."""
from copy import deepcopy

from fastapi import HTTPException
from backend.kernel.workspace import fingerprint
from .contracts import ToolResult


def saved(research,wid,rid):
    run=research.get_run(wid,rid)
    if run['integrity']!='verified':raise HTTPException(409,{'code':'RUN_INTEGRITY_FAILED','message':'保存运行完整性未通过，不能作为对照证据。'})
    return run


def latest_ids(research,wid,plugin):
    with research.store.db() as db:
        return [row[0] for row in db.execute("""SELECT r.id FROM study_runs r
            WHERE r.workspace=? AND json_extract(r.snapshot,'$.definition.method.plugin_id')=?
            ORDER BY r.created DESC LIMIT 20""",(wid,plugin))]


def comparisons(research,task,args):
    wid=task['workspace_id'];ids=[args['run_id']] if args.get('run_id') else latest_ids(research,wid,'cablesim.simulation')[:1]
    if not ids:return ToolResult(status='ok',summary='尚无有限元保存运行；未推算偏差。',data={'comparisons':[],
        'limitations':['需先生成复核研究方案，由人在工作台保存、预检、确认核时并提交超算。']})
    run=saved(research,wid,ids[0]);method=run['snapshot']['definition']['method']
    if method['plugin_id']!='cablesim.simulation':raise HTTPException(422,{'code':'FEM_RUN_REQUIRED','message':'请选择有限元保存运行。','path':'/run_id'})
    base={'run_id':run['id'],'study_id':run['study'],'method':method,'freshness':run['freshness'],
        'status':run['status'],'input_digest':run['input_digest'],'output_digest':run.get('output_digest'),'engineering_approval':False}
    if run['status'] not in ('succeeded','partial'):
        return ToolResult(status='ok',summary='有限元运行尚未成功完成，不提供可用偏差结论。',
            data={**base,'comparisons':[],'limitations':['运行未完成或失败；保留原记录，未重新提交。']})
    rows=[]
    for case in (run.get('output') or {}).get('cases',[]):
        if args.get('case_id') and case['case_id']!=args['case_id']:continue
        kind='x-cablesim.iec-fem-comparison';artifact=case.get('artifacts',{}).get(kind)
        if artifact is None:continue
        verified=run.get('artifact_status',{}).get(case['case_id'],{}).get(kind,{}).get('status')=='verified'
        if not verified or case['status']!='succeeded':
            rows.append({'case_id':case['case_id'],'status':'unavailable','reason':'对照工件未通过保存输入/方法/摘要校验。'});continue
        values=[]
        for label in ('iec','fem'):
            result=artifact[label]
            if result['status']!='available':continue
            for field,key,unit in (('ampacity_a','ampacity','A'),('operating_temperature_k','conductor_temperature','K')):
                values.append({'key':key,'value':result[field],'unit':unit,'entity':artifact['rated_circuit'],
                    'condition':'rating' if key=='ampacity' else 'operating','method':label,'basis':result['basis']})
        if artifact['valid']:values.append({'key':'iec_over_fem_percent','value':artifact['iec_over_fem_percent'],
            'unit':'%','entity':artifact['rated_circuit'],'basis':'(IEC/FEM - 1) × 100'})
        rows.append({'case_id':case['case_id'],'status':'converged' if artifact['valid'] else 'unconverged',
            'results':values,'convergence':artifact['convergence'],'conclusion':artifact['conclusion'],
            'limitations':artifact['limitations'],'clauses':artifact['clauses'],
            'source':{'artifact_type':kind,'sha256':case['artifact_digests'][kind]},'authority':'reference_only'})
    if rows:return ToolResult(status='ok',summary='已读取保存 IEC/有限元对照；未收敛不提供有限元偏差结论。',data={**base,'comparisons':rows})

    convergence=run.get('convergence') or {'status':'unknown'}
    if convergence.get('status')!='converged':
        return ToolResult(status='ok',summary='有限元尚未通过数值收敛，不能发布偏差结论。',
            data={**base,'comparisons':[],'convergence':convergence,'limitations':['未收敛；没有将完整性通过当作数值通过。']})
    cid=args.get('case_id') or convergence.get('reference_case_id')
    original=next((case for case in run['snapshot']['cases'] if case['case_id']==cid),None)
    output=next((case for case in run['output']['cases'] if case['case_id']==cid and case['status']=='succeeded'),None)
    if not original or not output:raise HTTPException(422,{'code':'CASE_REQUIRED','message':'请选择已收敛的保存参考工况。','path':'/case_id'})
    refs=[args['iec_run_id']] if args.get('iec_run_id') else latest_ids(research,wid,'cablesim.iec60287')
    for rid in refs:
        reference=saved(research,wid,rid)
        if reference['status'] not in ('succeeded','partial'):continue
        if reference['snapshot']['definition']['method']['plugin_id']!='cablesim.iec60287':continue
        matches=[case for case in reference['snapshot']['cases'] if fingerprint(case['input'])==fingerprint(original['input'])
            and case['parameters']==original['parameters'].get('iec')]
        for matched in matches:
            other=next((case for case in (reference.get('output') or {}).get('cases',[]) if case['case_id']==matched['case_id'] and case['status']=='succeeded'),None)
            if not other:continue
            for quantity in output['results']:
                if quantity['key'] not in ('ampacity','conductor_temperature'):continue
                value=next((item for item in other['results'] if all(item.get(key)==quantity.get(key) for key in ('key','entity','unit','case'))),None)
                if not value or value['status']!='available' or quantity['status']!='available':continue
                # This is arithmetic on two saved producer quantities, never a solve.
                a,b=quantity['value'],value['value'];unit=quantity['unit'];condition=quantity.get('case')
                rows.append({'entity':quantity['entity'],'condition':condition,'case_id':cid,'iec_case_id':matched['case_id'],
                    'results':[{'key':quantity['key'],'method':label,'value':number,'unit':unit,'condition':condition,
                        'run_id':source_id,'case_id':source_case}
                        for label,number,source_id,source_case in (('fem',a,run['id'],cid),('iec',b,rid,matched['case_id']))]+[
                        {'key':'difference.'+quantity['key'],'value':a-b,'unit':unit,'condition':condition},
                        *([{'key':'relative_difference','value':(a-b)/b*100,'unit':'%','basis':'(FEM-IEC)/IEC × 100；绝对温度以 K 为分母'}] if b else [])]})
            if rows:return ToolResult(status='ok',summary='已对照相同输入和相同 IEC 参数的保存运行；差值为保存量值的算术比较。',
                data={**base,'iec_run_id':rid,'iec_method':reference['snapshot']['definition']['method'],
                    'iec_input_digest':reference['input_digest'],'iec_output_digest':reference.get('output_digest'),
                    'convergence':convergence,'comparisons':rows,'authority':'reference_only'})
    return ToolResult(status='ok',summary='尚无相同输入、相同 IEC 参数的保存参考运行，未推算偏差。',
        data={**base,'comparisons':[],'limitations':['请在同一保存工况和 IEC 参数下完成人工运行后再对照。']})


def propose(research,proposals,task,args):
    run=saved(research,task['workspace_id'],args['run_id'])
    if task['study_id'] and task['study_id']!=run['study']:raise HTTPException(422,{'code':'SCOPE_VIOLATION','message':'复核方案原工况不属于会话绑定研究。','path':'/run_id'})
    if run['status']!='succeeded' or run['freshness']!='current' or run['snapshot']['workspace_revision']!=task['workspace_revision']:
        raise HTTPException(409,{'code':'BASELINE_INVALID','message':'新建复核研究须使用完整且当前、与会话工程修订一致的保存运行。','path':'/run_id'})
    cases=run['snapshot']['cases'];cid=args.get('case_id')
    if not cid and len(cases)==1:cid=cases[0]['case_id']
    case=next((case for case in cases if case['case_id']==cid),None)
    if case is None:raise HTTPException(422,{'code':'CASE_REQUIRED','message':'请选择要复核的保存工况，不猜批量或扫描工况。','path':'/case_id'})
    capid=args.get('capability','iec-thermal-field')
    plugin=research.registry().plugins['cablesim.simulation'];method={**research.pin(plugin),'capability':capid}
    parameters=deepcopy(args.get('parameters'))
    if parameters is None and run['snapshot']['definition']['method']==method:parameters=deepcopy(case['parameters'])
    if parameters is None:raise HTTPException(422,{'code':'FEM_PARAMETERS_REQUIRED','path':'/parameters',
        'message':'请按封签契约明确有限元边界、网格与来源；不从显示范围猜求解边界。',
        'next_actions':['plugin_inspect(plugin_id="cablesim.simulation", capability="'+capid+'") 读取参数；IEC 参数采用原保存工况。']})
    selection=parameters.get('domain_options',parameters)
    source_parameters=case['parameters'].get('iec',case['parameters'])
    for field,collection in (('section_id','sections'),('load_id','load_cases')):
        rows=case['input'].get(collection,[])
        chosen=source_parameters.get(field) or (rows[0]['id'] if len(rows)==1 else None)
        if not chosen or selection.get(field)!=chosen:raise HTTPException(422,{'code':'FEM_CASE_SELECTION_MISMATCH',
            'path':'/parameters/'+field,'message':'复核截面与负荷须和原保存工况一致；不能改换工况或猜多工况选择。'})
    if run['snapshot']['definition']['method']['plugin_id']=='cablesim.iec60287':
        if 'iec' in parameters and parameters['iec']!=case['parameters']:raise HTTPException(422,{'code':'IEC_PARAMETERS_MISMATCH','message':'复核必须沿用原保存工况的 IEC 参数。','path':'/parameters/iec'})
        parameters['iec']=deepcopy(case['parameters'])
    public=proposals.study(task,method,parameters,args.get('title','有限元核验'),method_input=case['input'],
        source_ref={'run_id':run['id'],'case_id':cid,'input_digest':fingerprint(case['input'])})
    return ToolResult(status='ok',summary='已生成绑定保存工况的新建有限元研究方案；须人工保存、预检并确认核时后提交超算。',
        data={'proposal':public,'source_run_id':run['id'],'source_case_id':cid,'hpc_submitted':False,'engineering_approval':False})
