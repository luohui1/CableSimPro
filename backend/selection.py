"""Finite catalog enumeration against the actual thermal engine, never an area scaling rule."""
import json
from typing import Literal
from uuid import uuid4
from fastapi import APIRouter, HTTPException
from pydantic import Field, model_validator
from .schemas import Cable,Scenario,StrictModel
from .workbench import WorkspaceStore,Revision,fingerprint,stamp
from . import agent
from .engine import calculate,ModelError
from .field_analysis import FieldRequest,compute_fields
from .vertical import Vertical, vertical_study


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
    domain: Literal['buried','vertical_air'] = 'buried'
    vertical: Vertical | None = None

    @model_validator(mode='after')
    def explicit_domain(self):
        if self.domain == 'vertical_air' and self.vertical is None:
            raise ValueError('竖向选型必须显式给出高度、空气温度、对流和辐射边界。')
        if self.domain == 'buried' and self.vertical is not None:
            raise ValueError('直埋选型不接受竖向空气边界，防止混用研究域。')
        return self


class VerticalRequest(Revision):
    configuration: Vertical
    compare_mesh: bool = True


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
        products = [p for p in self.entries() if req.include_demo or p['state'] != 'demo']
        if req.domain == 'vertical_air' and len(products) > 40:
            raise HTTPException(422, '竖向研究每次最多 40 个候选，请缩小型号库；未静默截断候选。')
        for product in products:
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
            output=None; vertical_output=None
            try:
                if req.domain == 'buried':
                    model=Scenario.model_validate(candidate)
                else:
                    # A vertical-air study validates Cable and Vertical separately.
                    # It must not reject a candidate because of an unused buried backdrop.
                    model=baseline.model_copy(update={'cable':c,'operating_current_a':req.target_current_a})
                def val(data,path):
                    return data[path.split('.')[0]][path.split('.')[1]] if '.' in path else data[path]
                diff=[{'path':p,'before':val(baseline.model_dump(),p),'after':val(candidate,p)}
                      for p in agent.PATHS if val(candidate,p)!=val(baseline.model_dump(),p)]
                if {d['path'] for d in diff}&set(state['locks']):reasons.append('将改变锁定参数')
            except ValueError:
                model=None;reasons.append('几何/敷设不满足模型边界')
            if not reasons and model is not None:
                try:
                    if req.domain == 'vertical_air':
                        vertical_output=vertical_study(c,req.vertical,req.target_current_a)
                        ampacity=vertical_output['ampacity_a']
                        op=vertical_output['operating']
                        hot=op['max_temperature_c'] if op else None
                        loss=op['single_cable_loss_w']/1000 if op else None
                    else:
                        output=calculate(model,include_field=False)
                        ampacity=output['summary']['ampacity_a']
                        hot=output['summary']['operating_max_temperature_c']
                        loss=output['summary']['circuit_loss_kw']
                    if ampacity+1e-8<required:reasons.append('载流量不满足目标及预留比例')
                except (ModelError,ValueError):reasons.append('无有效稳态解')
            if output is None and vertical_output is None:
                ampacity=hot=loss=None
            price=product['price_per_m']
            if req.rank_by=='cost' and (price is None or product['currency']!=req.currency):reasons.append('缺少同币种价格，不参与成本排序')
            records.append({'product_id':product['id'],'name':product['name'],'manufacturer':product['manufacturer'],
                'state':product['state'],'area_mm2':c.area_mm2,'diameter_mm':diameter,'feasible':not reasons,'reasons':reasons,
                'ampacity_a':ampacity, 'operating_temperature_c':hot, 'loss_kw':loss,
                'circuit_loss_kw':loss if req.domain=='buried' else None,
                'loss_basis':'three_phase_circuit' if req.domain=='buried' else 'single_isolated_cable',
                'cost':(3*baseline.circuit_length_m if req.domain=='buried' else req.vertical.height_m)*price if price is not None else None,'currency':product['currency'],
                'scenario':model.model_dump() if model else None,'catalog_snapshot':product,
                'warnings':vertical_output['warnings'] if vertical_output else output['warnings'] if output else []})
        key={'area':'area_mm2','loss':'loss_kw','cost':'cost'}[req.rank_by]
        records.sort(key=lambda r:(not r['feasible'],r[key] if r[key] is not None else float('inf'),r['area_mm2'],r['product_id']))
        result={'id':str(uuid4()),'workspace':wid,'base_revision':req.expected_revision,
            'constraints':req.model_dump(),'input':baseline.model_dump(),'input_sha256':fingerprint(baseline.model_dump()),
            'domain':req.domain,'vertical':req.vertical.model_dump() if req.vertical else None,
            'required_ampacity_a':required,'candidates':records,'feasible_count':sum(r['feasible'] for r in records),
            'notes':['仅在有限选型库内枚举并逐个调用热网络；不是连续全局最优设计。',
                     '每个候选使用其完整结构与 R20；没有按面积比例放大载流量。',
                     '温度上限不高于原工程，土壤/间距/埋深不变；锁定字段冲突则拒绝。',
                     '电压降、短路热稳定、机械拉力、弯曲半径、接头及保护配合尚未校核。',
                     '成本为三相单芯采购估算 3×线路长度×单芯每米价，不包含施工/附件/税费。']}
        if req.domain=='vertical_air':
            result['notes']=[
                '本次为单根隔离竖向电缆；使用轴向有限体积 + 径向热网络，不使用直埋土壤边界。',
                'h、沿高空气温度及辐射率是显式输入；不求解井道气流、烟囱效应或成束互热。',
                '逐个候选使用完整结构；温度上限不高于原工程与型号；锁条件不放宽。',
                '竖向损耗/采购估算按单根×高度计算，与直埋三相线路总量不能直接比较。',
                '候选送审仅应用电缆定义，不自动触发直埋 F9；竖向结果应在对应研究域复算。',
                '主工程仍有直埋底图。候选与该底图重叠时不能直接应用，但不影响独立竖向候选的计算判定。',
                '没有自重、夹具、拉力、压降、短路、阻燃和通风联动校核；不是工程签审。']
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
        try:
            candidate,diff=agent.patch(Scenario.model_validate(state['scenario']),changes)
        except ValueError:
            raise HTTPException(422,'候选与主工程的直埋底图不兼容，不能直接应用；竖向研究结果保留。请先调整底图或新建工程。') from None
        vertical=study.get('domain')=='vertical_air'
        return store.stage(wid,body.expected_revision,{'ready':True,'action':'import' if vertical else 'calculate','scenario':candidate.model_dump(),
            'changes':diff,'mode':'vertical-catalog' if vertical else 'catalog-enumeration','questions':[],'message':'应用选型候选 '+record['name'],
            'assumptions':study['notes']+['候选状态：'+record['state']], 'events':[],
            'source':{'id':str(uuid4()),'title':'选型库 / '+record['name'],'page':1,'text_sha256':fingerprint(record['catalog_snapshot']),
                'excerpts':[],'catalog_snapshot':record['catalog_snapshot'],'design_study_id':sid,'status':record['state'],
                'research_domain':study.get('domain','buried'),'vertical':study.get('vertical')}})


    @api.post('/{wid}/vertical')
    def vertical(wid:str,req:VerticalRequest):
        with store.db() as db:
            _,state=store.load(db,wid,req.expected_revision)
        scenario=Scenario.model_validate(state['scenario'])
        try:
            result=vertical_study(scenario.cable,req.configuration,scenario.operating_current_a)
            if req.compare_mesh:
                coarse=req.configuration.model_copy(update={'cells':max(10,req.configuration.cells//2)})
                comparison=vertical_study(scenario.cable,coarse,scenario.operating_current_a)
                result['mesh_check']={'cells':req.configuration.cells,'coarse_cells':coarse.cells,
                    'ampacity_difference_percent':100*abs(result['ampacity_a']-comparison['ampacity_a'])/result['ampacity_a'],
                    'coarse_ampacity_a':comparison['ampacity_a']}
        except (ModelError,ValueError) as exc:
            raise HTTPException(422,str(exc)) from None
        payload={'cable':scenario.cable.model_dump(),'configuration':req.configuration.model_dump(),
                 'current_a':scenario.operating_current_a}
        result.update({'id':str(uuid4()),'base_revision':req.expected_revision,'input':payload,
            'input_sha256':fingerprint(payload),'domain':'vertical_air','created_at':stamp()})
        with store.db(True) as db:
            store.load(db,wid,req.expected_revision)
            db.execute('INSERT INTO field_studies VALUES (?,?,?,?,?)',(result['id'],wid,req.expected_revision,json.dumps(result,ensure_ascii=False),stamp()))
            store.audit(db,wid,req.expected_revision,'竖向电热研究',result['id'])
        return result

    @api.get('/{wid}/fields/{sid}')
    def field_snapshot(wid:str,sid:str):
        with store.db() as db:
            store.load(db,wid)
            row=db.execute('SELECT payload FROM field_studies WHERE workspace=? AND id=?',(wid,sid)).fetchone()
            if row is None:raise HTTPException(404,'场研究不存在。')
        return json.loads(row['payload'])

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
