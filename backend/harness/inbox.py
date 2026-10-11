"""Bounded shared inbox evidence and deterministic, human-only next steps."""
from copy import deepcopy

from fastapi import HTTPException
from backend.index import get_index
from .contracts import ToolResult,Diagnostic
from .context_builder import RESULT_BYTES,content_digest,fits

CATEGORIES=('review','stale','missing','running')
LABELS={'review':'待审核','stale':'待重算','missing':'缺资料','running':'进行中'}
MAX_TRIAGE_PAGES=4


def home(snapshot,card):
    """Use saved parents, never infer another object's identity from its name."""
    visited=set()
    while card.get('parent') and (card['kind'] in ('proposal','delivery','run','job')
            or card['kind']=='study' and card['parent']['kind']=='type'):
        parent=card['parent'];key=(parent['kind'],parent['id'])
        if key in visited:break
        visited.add(key)
        target=snapshot.cards.get(key)
        if target is None:break
        card=target
    return card


def guidance(snapshot,item):
    card=item['object'];target=home(snapshot,card);category=item['category'];origin=item['origin']
    name='“'+target['name']+'”'
    if category=='review':
        who='人工审核人';approval=True
        if origin=='agent':
            action='在 Agent 任务 '+name+' 的方案卡核对字段差异和基准修订，再由人选择“批准”或“拒绝”；冲突时重新提出方案。'
        elif origin=='document':
            action='在厂家资料 '+name+' 的导入工作台核对原件、页码、字段和单位，再由人点“核对并批准”或拒绝提案。'
        elif origin=='asset':
            action='在资源库 '+name+' 核对物性、单位和来源；'+('由人发布已核对的新版本。' if card['status']['code']=='reviewed' else '由人完成草稿审核，通过后再发布新版本。')
            if card['status']['code']=='reviewed':who='人工发布人';approval=False
        else:
            prefix='在型号设计 '+name+' 的规格书中'
            if card.get('revision')!=target.get('revision'):
                action=prefix+'重新生成当前修订并“提交评审”，由人“人工批准”，之后由人“发布型号版本”；旧提交不能批准为当前设计。'
            elif card['status']['code']=='approved':
                action=prefix+'核对已保存的人工审批回执与当前修订，再由人点“发布型号版本”，不重复批准。'
                who='人工发布人';approval=False
            else:
                action=prefix+'核对当前修订和标准检查，由人点“人工批准”；批准后再由人“发布型号版本”。'
        return target,action,who,approval
    if category=='stale':
        methods=[edge['target'] for source,edge in snapshot.edges if source==(card['kind'],card['id'])
            and edge['role']=='method' and edge['target']['status']['code']=='installed']
        versions='；'.join('“'+method['name']+'” '+method['version'] for method in methods if method.get('version'))
        type_module=target['kind']=='type' and card['kind']=='study'
        action=('在型号工作台 '+name+' 的“'+card['name']+'”模块核对过期原因、结构输入和方法；若方法或资源引用变化，先更新到当前版本'
            if type_module else '在研究工作台 '+name+' 核对过期原因、输入和工况；若方法或型号引用变化，先更新到当前版本')
        if versions:action+='（当前安装方法：'+versions+'）'
        action+=('。保存型号后由人重新检查并运行该模块；有限元或超算须先由人确认核时再提交，旧运行保留为历史。'
            if type_module else '。保存研究后由人点“预检并运行”重算；有限元或超算须先由人确认核时再提交，旧运行保留为历史。')
        return target,action,('型号设计负责人（人工确认运行与核时）' if type_module else '研究负责人（人工确认运行与核时）'),False
    if category=='missing':
        if origin=='validation':
            return target,'在验证页核对复现库当前快照、目录与摘要；由复现库维护人修复或重新发布证据，再重新读取。此条不表示没有算例，也不触发计算。','复现库维护人',False
        elif card['kind']=='cable_version':
            action='在电缆型号版本 '+name+' 查看原因所列缺项，逐项补齐字段、单位和可核对来源；如来自厂家资料，在原件的导入工作台核对并批准完整提案后生成新版本，不改写已发布版本。'
        else:
            action='在厂家资料 '+name+' 的导入工作台核对原件、提取范围及失败原因，修正后由人点“开始离线提取”；新提案仍需人工核对并批准。'
        return target,action,'资料负责人 / 电缆设计工程师',False
    if origin=='document':
        action='在厂家资料 '+name+' 查看现有提取记录并等待完成；失败后核对原因，不重复点击提取。'
    elif origin=='job':
        action='在运行与作业列表打开 '+name+'，查看现有作业回执和进度；需要停止或恢复时由作业负责人确认，不提交重复作业。'
    else:
        action=('在型号工作台 '+name+' 的“'+card['name']+'”模块查看当前运行记录与进度，等待完成；不要重复运行。'
            if target['kind']=='type' else '在研究工作台 '+name+' 查看当前运行记录与进度，等待完成；不要重复运行。')
    return target,action,'原运行或提取负责人',False


def read(research,args):
    index=get_index(research);snapshot=index.snapshot();inbox=index.inbox(snapshot)
    items=sorted(inbox['items'],key=lambda row:CATEGORIES.index(row['category']))
    digest=content_digest({'items':items,'counts':inbox['counts']})
    if args.get('expected_digest',digest)!=digest:
        raise HTTPException(409,{'code':'INBOX_CHANGED','path':'/expected_digest',
            'message':'分页期间待办已变化；请从 offset=0 重新读取，不把不同版本清单拼成全部待办。',
            'next_actions':['保留原筛选条件，从 offset=0 重读待办。']})
    category=args.get('category');offset=args.get('offset',0);limit=args.get('limit',10)
    selected=[item for item in items if category is None or item['category']==category]
    data={'scope':'library_read_only','category':category,'counts':inbox['counts'],'total':len(selected),
        'offset':offset,'items':[],'next_offset':None,'next_page':None,'inbox_digest':digest}
    result=ToolResult(status='ok',summary='已读取统一待办；原因保留原文，下一步仅供人工处理，未执行审核、保存、重算或超算提交。',data=data)
    data=result.data
    base={'limit':limit,'expected_digest':digest,**({'category':category} if category else {})}
    def cursor(count):
        next_offset=offset+count if offset+count<len(selected) else None
        data.update(next_offset=next_offset,next_page={**base,'offset':next_offset} if next_offset is not None else None)
    cursor(0)
    for item in selected[offset:offset+limit]:
        target,action,who,approval=guidance(snapshot,item)
        data['items'].append({**deepcopy(item),'home':target,'next_step':action,
            'title':target['name']+' · '+item['object']['name'] if target['kind']=='type' and target['id']!=item['object']['id'] else item['title'],
            'handled_by':who,'requires_human_approval':approval})
        cursor(len(data['items']))
        if not fits(result.model_dump(mode='json'),RESULT_BYTES-256):
            data['items'].pop();cursor(len(data['items']));break
    if offset<len(selected) and not data['items']:
        result.status='error';result.summary='单项待办超过上下文上限，请在待办中心打开原对象；未截断原因或编造下一步。'
        data.update(next_offset=None,next_page=None)
        result.diagnostics=[Diagnostic(code='INBOX_ITEM_TOO_LARGE',message=result.summary,path='/offset',recoverable=True)]
    elif data['next_page']:
        result.next_actions=['按 next_page 原参数继续 inbox_read；未展开条目不能称为已检查或已处理。']
    if not fits(result.model_dump(mode='json'),RESULT_BYTES):
        # Even a single overlong source reason is never emitted outside the cap.
        result.data={key:data[key] for key in ('scope','category','total','offset','inbox_digest','counts')}
        result.data.update(items=[],next_page=None,next_offset=None)
    return result


def report(steps):
    """Host-authored list guarantees every observed item has its exact reason."""
    results=[step['result'] for step in steps if step['tool']=='inbox_read' and step.get('result')]
    if not results:return '',[],None
    items=[];seen=set();cursor=None;latest=results[-1];digest=None;first_offset=0;filter_category=None
    for result in results:
        if result['status']!='ok':continue
        data=result['data']
        if data['inbox_digest']!=digest:
            items=[];seen=set();digest=data['inbox_digest'];first_offset=data['offset'];filter_category=data['category']
        for item in data['items']:
            key=(item['category'],item['origin'],item['object']['kind'],item['object']['id'])
            if key not in seen:items.append(item);seen.add(key)
        cursor=data.get('next_page')
    if not items and latest['status']=='error':
        return '待办清单未完整取得：'+latest['summary']+'；请回待办中心核对原记录。',[],{
            'items':0,'complete':False,'category':latest.get('data',{}).get('category'),'offset':latest.get('data',{}).get('offset',0),
            'next_page':None,'inbox_digest':digest,'scope':'library_read_only','engineering_writes':False}
    lines=['本次读取的统一待办处理清单（仅供人工操作）：'];refs=[]
    for category in CATEGORIES:
        group=[item for item in items if item['category']==category]
        if not group:continue
        lines.append(LABELS[category]+'：')
        combined={}
        for item in group:
            # Home names personalise a shared operation; only remove that exact
            # saved name when comparing actions, never rewrite the source reason.
            action=item['next_step'].replace(' “'+item['home']['name']+'”','')
            key=(item['reason'],action,item['handled_by'],item['requires_human_approval'])
            combined.setdefault(key,[]).append(item)
        for (reason,action,who,approval),members in combined.items():
            lines.append('、'.join(('“'+item['home']['name']+'” · ' if item['home']['kind']=='type'
                and item['home']['id']!=item['object']['id'] else '')+'“'+item['object']['name']+'”' for item in members))
            if len(members)>1:
                homes={}
                for item in members:
                    target=item['home']
                    if (target['kind'],target['id'])!=(item['object']['kind'],item['object']['id']):
                        homes.setdefault((target['kind'],target['id']),target)
                if homes:lines.append('对象的家：'+'、'.join('“'+target['name']+'”' for target in homes.values()))
            lines.extend(['原因：'+reason,
                '下一步：'+(action if len(members)>1 else members[0]['next_step']),
                '处理人：'+who+('；需人批准。' if approval else '。')])
            for item in members:refs.extend([item['object'],item['home']])
    if not items:lines.append('本次筛选范围内没有待办；未执行任何业务操作。')
    if first_offset:lines.append('此前待办尚未展开；本次从位置 '+str(first_offset)+' 开始整理。')
    if cursor:
        lines.append('其余待办尚未展开；可继续整理下一页（起始位置 '+str(cursor['offset'])+'），不能据此宣称全部检查完成。')
    if latest['status']=='error':lines.append('续读停止：'+latest['summary']+'；上述清单仅代表已读取的保存索引，待办可能已变化，请重新整理。')
    return '\n'.join(lines),refs,{'items':len(items),'complete':first_offset==0 and cursor is None and latest['status']=='ok',
        'category':filter_category,'offset':first_offset,
        'next_page':cursor,'inbox_digest':digest,'scope':'library_read_only','engineering_writes':False}
