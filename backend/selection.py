"""Finite catalog enumeration against the actual thermal engine, never an area scaling rule."""
import json
from typing import Literal
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import Field
from .schemas import Cable,Scenario,StrictModel
from .workbench import WorkspaceStore,Revision,fingerprint,stamp
from . import agent
from .engine import calculate,ModelError
from .field_analysis import FieldRequest,compute_fields


class CatalogEntry(StrictModel):
    name: str = Field(min_length=1,max_length=120)
    manufacturer: str = Field(default='内部设计模板',max_length=120)
    cable: Cable
    rated_u0_kv: float = Field(ge=1,le=26)
    price_per_m: float | None = Field(default=None,ge=0,le=100000)
    currency: Literal['CNY','USD','EUR'] = 'CNY'
    workspace_id: str | None = None
    source_id: str | None = None
    confirmed: bool = False


class DesignRequest(Revision):
    target_current_a: float = Field(gt=0,le=3000)
    reserve_percent: float = Field(default=10,ge=0,le=50)
    max_diameter_mm: float = Field(default=150,gt=0,le=300)
    conductor: Literal['any','copper','aluminium'] = 'any'
    include_demo: bool = False
    rank_by: Literal['area','loss','cost'] = 'area'
    currency: Literal['CNY','USD','EUR'] = 'CNY'


class SelectCandidate(Revision):
    product_id: str


class Designs:
    def __init__(self,store:WorkspaceStore):self.store=store

    def initialize(self):
        with self.store.db() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS catalog_entries (id TEXT PRIMARY KEY, payload TEXT, state TEXT, created TEXT);
            CREATE TABLE IF NOT EXISTS design_studies (id TEXT PRIMARY KEY, workspace TEXT, base_revision INTEGER, payload TEXT, created TEXT);
            CREATE TABLE IF NOT EXISTS field_studies (id TEXT PRIMARY KEY, workspace TEXT, revision INTEGER, payload TEXT, created TEXT);
            ''')
            for conductor in ('copper','aluminium'):
                for area in (95,150,240,300,400,630):
                    c=Cable(conductor=conductor,area_mm2=area,name=f'演示 {conductor} 12/20 kV 1×{area}')
                    item=CatalogEntry(name=c.name,cable=c,rated_u0_kv=12,manufacturer='演示假设 / 非厂家型号')
                    db.execute('INSERT OR IGNORE INTO catalog_entries VALUES (?,?,?,?)',
                        (f'demo-{conductor}-{area}',item.model_dump_json(),'demo',stamp()))

    def entries(self):
        with self.store.db() as db:
            return [{'id':r['id'],'state':r['state'],'created_at':r['created'],**json.loads(r['payload'])}
                    for r in db.execute('SELECT * FROM catalog_entries ORDER BY created,id')]

    def design(self,wid:str,req:DesignRequest):
        with self.store.db() as db:
            _,state=self.store.load(db,wid,req.expected_revision)
        baseline=Scenario.model_validate(state['scenario'])
        required=req.target_current_a*(1+req.reserve_percent/100)
        records=[]
        for product in self.entries():
            reasons=[]
            if product['state']=='demo' and not req.include_demo:continue
            c=Cable.model_validate(product['cable'])
            if req.conductor!='any' and c.conductor!=req.conductor:reasons.append('导体材料不符')
            if product['rated_u0_kv']<baseline.cable.u0_kv:reasons.append('U₀ 额定值低于设计要求')
            diameter=c.radii_mm()[-1]*2
            if diameter>req.max_diameter_mm:reasons.append('外径超过约束')
            c.max_temperature_c=min(c.max_temperature_c,baseline.cable.max_temperature_c)
            c.u0_kv=baseline.cable.u0_kv
            c.frequency_hz=baseline.cable.frequency_hz
            candidate=baseline.model_dump();candidate['cable']=c.model_dump();candidate['operating_current_a']=req.target_current_a
            try:
                model=Scenario.model_validate(candidate)
                changes=[agent.Change(path=p,value=(candidate[p.split('.')[0]][p.split('.')[1]] if '.' in p else candidate[p]))
                         for p in agent.PATHS if p not in ('name',)]
                _,diff=agent.patch(baseline,changes)
                if {d['path'] for d in diff}&set(state['locks']):reasons.append('将改变锁定参数')
            except ValueError:
                model=None;reasons.append('几何/敷设不满足模型边界')
            output=None
            if not reasons and model is not None:
                try:
                    output=calculate(model,include_field=False)
                    if output['summary']['ampacity_a']+1e-8<required:reasons.append('载流量不满足目标及预留比例')
                except (ModelError,ValueError):reasons.append('无有效稳态解')
            price=product['price_per_m']
            if req.rank_by=='cost' and (price is None or product['currency']!=req.currency):reasons.append('缺少同币种价格，不参与成本排序')
            records.append({'product_id':product['id'],'name':product['name'],'manufacturer':product['manufacturer'],
                'state':product['state'],'area_mm2':c.area_mm2,'diameter_mm':diameter,'feasible':not reasons,'reasons':reasons,
                'ampacity_a':output['summary']['ampacity_a'] if output else None,
                'operating_temperature_c':output['summary']['operating_max_temperature_c'] if output else None,
                'circuit_loss_kw':output['summary']['circuit_loss_kw'] if output else None,
                'cost':3*baseline.circuit_length_m*price if price is not None else None,'currency':product['currency'],
                'scenario':model.model_dump() if model else None,'catalog_snapshot':product,
                'warnings':output['warnings'] if output else []})
        key={'area':'area_mm2','loss':'circuit_loss_kw','cost':'cost'}[req.rank_by]
        records.sort(key=lambda r:(not r['feasible'],r[key] if r[key] is not None else float('inf'),r['area_mm2'],r['product_id']))
        result={'id':str(uuid4()),'workspace':wid,'base_revision':req.expected_revision,
            'constraints':req.model_dump(),'input':baseline.model_dump(),'input_sha256':fingerprint(baseline.model_dump()),
            'required_ampacity_a':required,'candidates':records,'feasible_count':sum(r['feasible'] for r in records),
            'notes':['仅在有限选型库内枚举并逐个调用热网络；不是连续全局最优设计。',
                     '每个候选使用其完整结构与 R20；没有按面积比例放大载流量。',
                     '温度上限不高于原工程，土壤/间距/埋深不变；锁定字段冲突则拒绝。',
                     '电压降、短路热稳定、机械拉力、弯曲半径、接头及保护配合尚未校核。',
                     '成本为三相单芯采购估算 3×线路长度×单芯每米价，不包含施工/附件/税费。']}
        with self.store.db(True) as db:
            self.store.load(db,wid,req.expected_revision)
            db.execute('INSERT INTO design_studies VALUES (?,?,?,?,?)',(result['id'],wid,req.expected_revision,json.dumps(result,ensure_ascii=False),stamp()))
            self.store.audit(db,wid,req.expected_revision,'反向选型研究',result['id'])
        return result


def make_router(designs:Designs):
    api=APIRouter(prefix='/api/design')
    store=designs.store

    @api.get('/catalog')
    def catalog():return designs.entries()

    @api.post('/catalog',status_code=201)
    def add(body:CatalogEntry):
        if not body.confirmed:raise HTTPException(422,'请核对全部电缆参数后确认入库。')
        if body.rated_u0_kv<body.cable.u0_kv:raise HTTPException(422,'声明的额定 U₀ 低于模板工况电压。')
        source=None
        if body.source_id:
            if not body.workspace_id:raise HTTPException(422,'资料引用缺少工程。')
            with store.db() as db:
                _,state=store.load(db,body.workspace_id)
            source=next((s for s in state['sources'] if s['id']==body.source_id),None)
            if not source:raise HTTPException(422,'引用不存在或不属于该工程。')
            for item in source['excerpts']:
                if item['path'].startswith('cable.') and getattr(body.cable,item['path'].split('.')[1])!=item['value']:
                    raise HTTPException(422,'当前电缆参数与所选资料引用不一致，请重新校对。')
        payload={**body.model_dump(),'source_snapshot':source}
        pid=str(uuid4())
        with store.db(True) as db:
            if db.execute('SELECT COUNT(*) FROM catalog_entries').fetchone()[0]>=200:
                raise HTTPException(422,'预览版型号库限制为 200 条。')
            db.execute('INSERT INTO catalog_entries VALUES (?,?,?,?)',(pid,json.dumps(payload,ensure_ascii=False),'user_reviewed',stamp()))
        return {'id':pid,'state':'user_reviewed',**payload}

    @api.post('/{wid}/selection')
    def selection(wid:str,req:DesignRequest):return designs.design(wid,req)

    @api.get('/{wid}/selection')
    def history(wid:str):
        with store.db() as db:
            store.load(db,wid)
            return [{'id':r['id'],'base_revision':r['base_revision'],'created':r['created']} for r in db.execute('SELECT id,base_revision,created FROM design_studies WHERE workspace=? ORDER BY created DESC LIMIT 30',(wid,))]

    @api.get('/{wid}/selection/{sid}')
    def read(wid:str,sid:str):
        with store.db() as db:
            store.load(db,wid)
            row=db.execute('SELECT payload FROM design_studies WHERE workspace=? AND id=?',(wid,sid)).fetchone()
            if not row:raise HTTPException(404,'选型研究不存在。')
            return json.loads(row['payload'])

    @api.post('/{wid}/selection/{sid}/propose')
    def propose(wid:str,sid:str,body:SelectCandidate):
        study=read(wid,sid)
        if study['base_revision']!=body.expected_revision:raise HTTPException(409,'研究基于旧版本，请重新选型。')
        with store.db() as db:
            _,state=store.load(db,wid,body.expected_revision)
        record=next((r for r in study['candidates'] if r['product_id']==body.product_id),None)
        if not record or not record['feasible']:raise HTTPException(422,'不能应用不存在或不满足约束的候选。')
        data=record['scenario']
        changes=[agent.Change(path=p,value=data[p.split('.')[0]][p.split('.')[1]] if '.' in p else data[p]) for p in agent.PATHS]
        candidate,diff=agent.patch(Scenario.model_validate(state['scenario']),changes)
        return store.stage(wid,body.expected_revision,{'ready':True,'action':'calculate','scenario':candidate.model_dump(),
            'changes':diff,'mode':'catalog-enumeration','questions':[],'message':'应用选型候选 '+record['name'],
            'assumptions':study['notes']+['候选状态：'+record['state']], 'events':[],
            'source':{'id':str(uuid4()),'title':'选型库 / '+record['name'],'page':1,'text_sha256':fingerprint(record['catalog_snapshot']),
                'excerpts':[],'catalog_snapshot':record['catalog_snapshot'],'design_study_id':sid,'status':record['state']}})

    @api.post('/{wid}/fields')
    def fields(wid:str,req:FieldRequest):
        with store.db() as db:
            _,state=store.load(db,wid,req.expected_revision)
        try:result=compute_fields(Scenario.model_validate(state['scenario']),req.kind,req.resolution)
        except (ModelError,ValueError) as exc:raise HTTPException(422,str(exc)) from None
        result.update({'id':str(uuid4()),'base_revision':req.expected_revision})
        with store.db(True) as db:
            store.load(db,wid,req.expected_revision)
            db.execute('INSERT INTO field_studies VALUES (?,?,?,?,?)',(result['id'],wid,req.expected_revision,json.dumps(result,ensure_ascii=False),stamp()))
            store.audit(db,wid,req.expected_revision,'场分析 · '+req.kind,result['id'])
        return result
    return api
