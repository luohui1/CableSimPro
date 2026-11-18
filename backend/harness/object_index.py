"""Bounded Agent views; full cards remain in the read-only index API."""
from copy import deepcopy
from backend.index import get_index
from .contracts import ToolResult
from .context_builder import encoded, fits, RESULT_BYTES


def card_view(card):
    """Omit whole limitation entries, with counts and a pinned source identity."""
    evidence=card.get('validation')
    if not evidence:return card
    view=deepcopy(card);compact=view['validation'];limitations=evidence['limitations']
    compact['limitations']=[]
    compact['total_limitations']=len(limitations)
    compact['detail_ref']={'kind':'validation','id':card['id'],
        'snapshot_digest':evidence['snapshot_digest'],'view':'results'}
    def note():
        omitted=len(limitations)-len(compact['limitations'])
        compact['omitted_limitations']=omitted
        compact['omission_note']=f'限制说明共 {len(limitations)} 条，省略 {omitted} 条；全文在此验证对象的家（结果页），按 detail_ref 查看保存快照。'
    note()
    for limitation in limitations:
        # Never cut a sentence or let unbounded prose displace numeric evidence.
        if len(encoded(compact['limitations']+[limitation]))>640:continue
        compact['limitations'].append(limitation);note()
        if not fits(view,RESULT_BYTES-1536):compact['limitations'].pop();note()
    return view


def entry_view(group,row):
    if group=='items':return card_view(row)
    if group in ('uses','used_by'):return {**row,'target':card_view(row['target'])}
    return row


def exact_matches(index,kind,q):
    """Every card named exactly as asked, whatever page time order puts it on."""
    term=q.casefold().strip()
    if not term:return []
    found,offset=[],0
    while True:
        page=index.objects(kind=kind,q=q,limit=100,offset=offset)
        found+=[{'kind':card['kind'],'id':card['id'],'name':card['name']} for card in page['items']
                if term in (card['name'].casefold().strip(),card['id'].casefold())]
        offset+=100
        if offset>=page['total']:return found


def read(research,name,args):
    index=get_index(research);offset=args.get('offset',0);limit=args.get('limit',10)
    if name=='object_find':
        page=index.objects(kind=args.get('kind'),q=args.get('q',''),limit=limit,offset=offset)
        entries=[('items',row) for row in page['items']];total=page['total']
        data={'items':[],'total':total,'offset':offset,'next_offset':None}
        # Results are newest first; a same-named object can sit behind newer
        # related cards or a similarly named draft. Name the exact ones.
        data['exact_matches']=exact_matches(index,args.get('kind'),args.get('q',''))
    else:
        page=index.relations(args['kind'],args['id'])
        entries=[(group,row) for group in ('uses','used_by','unresolved') for row in page[group]]
        total=len(entries);entries=entries[offset:offset+limit]
        data={group:[] for group in ('uses','used_by','unresolved')}
        data.update(total=total,offset=offset,next_offset=None)
    summary='已读取统一索引名片与保存关联；未批准或修改对象。'
    if data.get('exact_matches'):
        summary+='名称完全一致：'+'、'.join(item['name']+'（'+item['kind']+'）' for item in data['exact_matches'][:5])+'；优先采用。'
    result=ToolResult(status='ok',summary=summary,data=data)
    result.data['source_errors']=page.get('source_errors',[])
    count=0
    for group,row in entries:
        result.data[group].append(entry_view(group,row))
        result.data['next_offset']=offset+count+1 if offset+count+1<total else None
        if not fits(result.model_dump(mode='json'),RESULT_BYTES-256):
            result.data[group].pop();break
        count+=1
    result.data['next_offset']=offset+count if offset+count<total else None
    if entries and not count:
        result.status='error';result.summary='单张名片超过模型上下文上限，请在统一索引界面查看原记录。'
        result.data['next_offset']=None
    if result.data['next_offset'] is not None:
        result.next_actions=['继续用 '+name+'，保持相同筛选参数并传 offset='+str(result.data['next_offset'])+'。']
    return result
