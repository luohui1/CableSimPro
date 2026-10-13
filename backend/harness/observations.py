"""Explicit, pageable Agent views; originals remain in durable tool steps."""
from copy import deepcopy

from fastapi import HTTPException

from .context_builder import fits, RESULT_BYTES


def workspace(result,args):
    source=result.data
    offset=args.get('offset',0);limit=args.get('limit',20)
    view=args.get('view','outline')
    if view=='locks' and args.get('paths'):
        raise HTTPException(422,{'code':'TOOL_INPUT_INVALID','path':'/paths',
            'message':'锁路径列表使用 view=locks；指定输入路径请用 view=outline。'})
    base={key:deepcopy(source[key]) for key in ('workspace_id','workspace_revision','current_revision','freshness','name') if key in source}
    locks=source.get('locks',[])
    entries=[]
    if view=='locks':
        entries=[('locks',value) for value in locks]
    elif 'fields' in source:
        entries=[('fields',value) for value in source['fields']]
    else:
        for kind,objects in source.get('objects',{}).items():
            for card in objects:
                if fits(card,1800):entries.append((kind,card));continue
                identity={key:value for key,value in card.items() if key not in ('fields','placements')}
                for field in card.get('fields',[]):entries.append((kind,{**identity,'fields':[field],'object_part':True}))
                for placement in card.get('placements',[]):entries.append((kind,{**identity,'fields':[],'placements':[placement],'object_part':True}))
                if not card.get('fields') and not card.get('placements'):entries.append((kind,card))
    data={**base,'projection':'workspace_input','view':view,'offset':offset,'total_parts':len(entries),
        'next_page':None,'coverage':{'complete':False,'scope':'固定工程修订的输入概览，或所请求路径；不代表方法预检或来源已批准。'}}
    if view=='locks':data['locks']=[]
    elif 'fields' in source:data['fields']=[]
    else:data['objects']={}
    if view!='locks' and 'locks' in source:
        data['lock_summary']={'total':len(locks),'omitted':len(locks),
            'read_hint':{'tool':'workspace_read','arguments':{'view':'locks','offset':0}},
            'reason':'锁路径用于编辑前核对；完整列表按页读取，不用于判断输入是否缺项。'}
    def cursor(end):
        data['coverage']['complete']=offset==0 and end>=len(entries)
        data['coverage']['omitted_parts']=max(0,len(entries)-end)
        data['next_page']={**args,'view':view,'offset':end} if end<len(entries) else None
    cursor(offset)
    projected={**result.model_dump(mode='json'),'data':data}
    end=offset
    for kind,item in entries[offset:offset+limit]:
        selected=data[kind] if kind in ('locks','fields') else data['objects'].setdefault(kind,[])
        selected.append(deepcopy(item));cursor(end+1)
        if not fits(projected,RESULT_BYTES-128):
            selected.pop();cursor(end)
            if end==offset:
                raise HTTPException(422,{'code':'INPUT_VIEW_TOO_LARGE','path':item.get('path') if isinstance(item,dict) else item,
                    'message':'单项输入过大，请按稳定标量字段路径读取；全文在工程工作台。'})
            break
        end+=1
    source['projection']='workspace_input';source['agent_projection']=data
    return result


def preflight(result,*,study_id,workspace_id,workspace_revision,study_revision,module):
    original=result.data
    cases=original.get('cases',[]);checks=original.get('crosschecks',[])
    data={key:deepcopy(original[key]) for key in ('ready','partial','input_digest','lock_digest','runnable_case_ids') if key in original}
    data.update(projection='study_preflight',study_id=study_id,workspace_id=workspace_id,
        workspace_revision=workspace_revision,study_revision=study_revision,module=module,
        coverage={'scope':'当前保存方法及所选模块的输入预检；不是求解结果或工程合格结论。',
            'case_count':len(cases),'crosscheck_count':len(checks),
            'not_checked':['现场输入真实性','厂家来源和标准的人工批准','正式计算与超算结果'],
            'details_in':'研究工作台预检记录；完整工具步骤'},
        cases=[{key:deepcopy(row[key]) for key in ('case_id','status','error','warnings') if key in row} for row in cases],
        crosschecks=[{key:deepcopy(row[key]) for key in ('method','status','error','warnings') if key in row} for row in checks])
    # Method limitations are already repeated in method_scopes. Keep exact
    # counts here rather than letting them crowd readiness/field diagnostics out.
    data['limitations']={'total':len(original.get('limitations',[])),
        'omitted':len(original.get('limitations',[])),'details_in':'研究工作台的方法适用范围'}
    original['projection']='study_preflight';original['agent_projection']=data
    return result
