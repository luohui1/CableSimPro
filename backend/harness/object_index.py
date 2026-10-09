"""Bounded Agent views of the exact cards used by the read-only index API."""
from backend.index import get_index
from .contracts import ToolResult
from .context_builder import fits, RESULT_BYTES


def read(research,name,args):
    index=get_index(research);offset=args.get('offset',0);limit=args.get('limit',10)
    if name=='object_find':
        page=index.objects(kind=args.get('kind'),q=args.get('q',''),limit=limit,offset=offset)
        entries=[('items',row) for row in page['items']];total=page['total']
        data={'items':[],'total':total,'offset':offset,'next_offset':None}
    else:
        page=index.relations(args['kind'],args['id'])
        entries=[(group,row) for group in ('uses','used_by','unresolved') for row in page[group]]
        total=len(entries);entries=entries[offset:offset+limit]
        data={group:[] for group in ('uses','used_by','unresolved')}
        data.update(total=total,offset=offset,next_offset=None)
    result=ToolResult(status='ok',summary='已读取统一索引名片与保存关联；未批准或修改对象。',data=data)
    count=0
    for group,row in entries:
        result.data[group].append(row)
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
