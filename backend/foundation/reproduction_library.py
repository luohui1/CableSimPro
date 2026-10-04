"""Read immutable reproduction evidence snapshots; no solver or engineering decision."""
from hashlib import sha256
import json
from pathlib import Path
import re
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse


class ReproductionLibrary:
    def __init__(self, root):
        self.root=Path(root)

    def read(self, path):
        if path.stat().st_size>16*1024*1024:
            raise ValueError('复现库文件超过16 MiB，请重新生成分项证据。')
        raw=path.read_bytes()
        def invalid(value):raise ValueError('非有限数值：'+value)
        return json.loads(raw,parse_constant=invalid),raw

    def snapshot(self, selected=None):
        index_path=self.root/'index.json'
        if not index_path.exists():
            return {'schema':'cablesim.reproduction-library/1','items':[],'history':[],'snapshot_id':None,'created_at':None,'historical':False}
        index,_=self.read(index_path)
        records=index['history'];current=index['current']
        selected=selected or current
        if not re.fullmatch('[a-f0-9]{64}',selected) or selected not in {r['id'] for r in records}:
            raise HTTPException(404,'复现库版本不存在，请返回当前版本。')
        value,raw=self.read(self.root/'snapshots'/(selected+'.json'))
        if sha256(raw).hexdigest()!=selected:
            raise ValueError('复现库快照完整性校验失败；请重新生成，原始求解记录未改动。')
        if value.get('schema')!='cablesim.reproduction-library/1' or not isinstance(value.get('items'),list):
            raise ValueError('复现库版本不支持，请更新证据导入器。')
        ids=set()
        for item in value['items']:
            if item['id'] in ids or item['status'] not in ('reproduced','partial','missing_data','capability_gap') or item['kind'] not in ('paper','standard','comsol','benchmark'):
                raise ValueError('复现库条目标识、类型或状态不合法。')
            ids.add(item['id'])
        return {**value,'snapshot_id':selected,'history':records,'historical':selected!=current}


def make_router(root):
    api=APIRouter(prefix='/api/foundation/reproductions',tags=['reproduction-library'])
    library=ReproductionLibrary(root)

    def load(snapshot):
        try:return library.snapshot(snapshot)
        except HTTPException:raise
        except (OSError,ValueError,KeyError,TypeError) as exc:
            raise HTTPException(422,'复现库读取失败：'+str(exc)) from None

    @api.get('')
    def catalog(snapshot: str | None=Query(default=None,pattern='^[a-f0-9]{64}$')):
        value=load(snapshot)
        summaries=[{k:v for k,v in item.items() if k not in ('rows','convergence','inputs','evidence','limitations','assumptions')}
                   for item in value['items']]
        return {**value,'items':summaries}

    @api.get('/{target_id}')
    def detail(target_id: str,snapshot: str | None=Query(default=None,pattern='^[a-f0-9]{64}$')):
        value=load(snapshot)
        item=next((i for i in value['items'] if i['id']==target_id),None)
        if item is None:raise HTTPException(404,'复现目标不存在，请返回目标列表。')
        return {**item,'snapshot_id':value['snapshot_id'],'created_at':value['created_at'],'historical':value['historical'],'history':value['history']}

    @api.get('/{target_id}/export')
    def export(target_id: str,snapshot: str | None=Query(default=None,pattern='^[a-f0-9]{64}$')):
        value=detail(target_id,snapshot)
        return JSONResponse(value,headers={'Content-Disposition':'attachment; filename="reproduction-'+re.sub('[^A-Za-z0-9_-]','_',target_id)+'.json"','Cache-Control':'no-store'})

    return api
