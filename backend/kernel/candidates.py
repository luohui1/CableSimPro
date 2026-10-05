"""Versioned domain cable candidates. Confirmation remains a human API action."""
from copy import deepcopy
import json
from uuid import uuid4
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import Field, model_validator
from backend.schemas import StrictModel
from backend.domain.models import CableType, Material, Source
from backend.kernel.workspace import fingerprint


class PublishedValue(StrictModel):
    value: float = Field(gt=0)
    unit: Literal['m', 'm2', 'ohm/m', 'kg/m', 'K', '1']
    basis: Literal['manufacturer', 'standard_nominal', 'standard_limit', 'engineer_given']
    source: str = Field(min_length=1)

    @model_validator(mode='before')
    @classmethod
    def numeric(cls,value):
        if isinstance(value,dict) and (isinstance(value.get('value'),bool) or not isinstance(value.get('value'),(int,float))):
            raise ValueError('value：须填写 SI 数值，不能使用布尔值或字符串')
        return value


class PublishedSpecification(StrictModel):
    """Published facts can be stored without inventing a complete solver model."""
    manufacturer: str = Field(min_length=1, max_length=120)
    designation: str = Field(min_length=1, max_length=40)
    voltage_v: float = Field(gt=0, le=1000000)
    u0_v: float = Field(gt=0, le=1000000)
    cores: int = Field(ge=1, le=100)
    area_m2: float = Field(gt=0, le=.01)
    conductor: Literal['copper_bare', 'copper_coated', 'aluminium']
    values: dict[str, PublishedValue] = Field(min_length=1)
    missing: list[str] = Field(min_length=1, max_length=64)

    @model_validator(mode='after')
    def units(self):
        for key, fact in self.values.items():
            expected = 'kg/m' if key == 'weight' else 'ohm/m' if key == 'r20' else 'K' if key == 'temperature_limit' else '1' if key.endswith('_count') or key.endswith('_overlap') else 'm'
            if fact.unit != expected:
                raise ValueError(key+'：单位应为 '+expected)
            maximum = 1 if expected in ('m', 'ohm/m') else 1000
            if fact.value > maximum:
                raise ValueError(key+'：数值超出范围，请采用 SI 单位')
        return self


class CableModelVersion(StrictModel):
    name: str = Field(min_length=1,max_length=120)
    version: str = Field(min_length=1,max_length=32)
    cable_type: CableType | None = None
    materials: list[Material] = Field(default_factory=list,max_length=64)
    specification: PublishedSpecification | None = None
    sources: dict[str,Source] = Field(min_length=1)
    confirmed: bool = Field(default=False,strict=True)

    @model_validator(mode='after')
    def references(self):
        ids={m.id for m in self.materials}
        cable=self.cable_type
        if self.specification:
            if any(v.source not in self.sources for v in self.specification.values.values()):
                raise ValueError('公开规格的每个值须引用已保存的来源键。')
            if cable is not None:
                raise ValueError('公开规格缺项须补齐后创建独立完整型号版本。')
            if self.confirmed:
                raise ValueError('公开规格尚有结构或物性缺项，不能确认为完整工程型号。')
            if any(not s.reference or not s.reference.strip() for s in self.sources.values()):
                raise ValueError('型号每个来源须有可追溯出处。')
            return self
        if cable is None or not self.materials:
            raise ValueError('完整型号须提供 cable_type 和全部材料；缺项资料请采用 specification。')
        used={c.conductor.material for c in cable.cores}|{l.material for l in cable.common_layers}|{l.material for c in cable.cores for l in c.layers}
        if not used<=ids or len(ids)!=len(self.materials):raise ValueError('型号材料引用缺项或重复，请补齐准确材料。')
        if any(not s.reference or not s.reference.strip() for s in self.sources.values()):raise ValueError('型号每个来源须有可追溯出处。')
        if self.confirmed and (any(c.conductor.r20 is None for c in cable.cores) or any(not s.reviewed or s.kind=='demo' for s in self.sources.values())):
            raise ValueError('已核对型号须有R20且全部来源已核对；演示事实不能确认为工程型号。')
        return self


def initialize(db):
    db.execute('CREATE TABLE IF NOT EXISTS domain_cable_models(id TEXT PRIMARY KEY,payload TEXT NOT NULL,digest TEXT NOT NULL,state TEXT NOT NULL,created TEXT NOT NULL)')


def read(db,cid):
    row=db.execute('SELECT * FROM domain_cable_models WHERE id=?',(cid,)).fetchone()
    if row is None:raise HTTPException(422,'候选型号不存在：'+cid)
    payload=json.loads(row['payload'])
    if fingerprint(payload)!=row['digest']:raise HTTPException(409,'候选型号内容摘要不一致，请重新核对。')
    CableModelVersion.model_validate(payload)
    specification=payload.get('specification')
    dimensions_missing=bool(specification and specification['designation']=='YJLW03' and any(key not in specification['values'] for key in ('conductor_diameter','outer_diameter')))
    return {'id':cid,'state':row['state'],'digest':row['digest'],'payload':payload,
            'display_status':'厂家尺寸缺' if dimensions_missing else '资料缺项' if row['state']=='incomplete' else '已核对' if row['state']=='reviewed' else '待核对'}


def apply(document,item):
    """Replace the complete cable definition and material identities, preserving layout/load."""
    d=deepcopy(document)
    if len(d['cable_types'])!=1:raise HTTPException(422,'选型须明确唯一待替换的型号；混合型号线路暂未覆盖。')
    payload=item['payload'];cid=d['cable_types'][0]['id'];cable=deepcopy(payload['cable_type']);cable['id']=cid
    mapping={m['id']:'material/selected-'+m['id'].split('/')[-1] for m in payload['materials']}
    for core in cable['cores']:
        core['conductor']['material']=mapping[core['conductor']['material']]
        for layer in core['layers']:layer['material']=mapping[layer['material']]
    for layer in cable['common_layers']:layer['material']=mapping[layer['material']]
    d['cable_types']=[cable]
    existing={m['id']:m for m in d['materials']}
    for m in payload['materials']:existing[mapping[m['id']]]={**deepcopy(m),'id':mapping[m['id']]}
    d['materials']=list(existing.values())
    for path in list(d.get('provenance',{})):
        if path.startswith('/cable_types/'+cid):d['provenance'].pop(path)
    for path,s in payload['sources'].items():
        bound=path.replace('/cable_type','/cable_types/'+cid,1)
        for original,replacement in mapping.items():bound=bound.replace(original,replacement)
        d['provenance'][bound]=deepcopy(s)
    d['provenance']['/cable_types/'+cid]={'kind':'asset','reference':payload['name']+' @'+payload['version']+' sha256:'+item['digest'],'reviewed':item['state']=='reviewed'}
    return d


def matches(item,filters):
    payload=item['payload'];spec=payload.get('specification')
    if spec:
        area,voltage,kind=spec['area_m2'],spec['voltage_v'],spec['conductor']
    else:
        cable=payload['cable_type'];core=cable['cores'][0]['conductor'];area=core['nominal_area'];voltage=cable['rating']['u']
        kind=next(m for m in payload['materials'] if m['id']==core['material']).get('standard_kind')
    return (not filters.get('voltage_v') or voltage==filters['voltage_v']) and (not filters.get('conductor') or kind==filters['conductor']) and (not filters.get('minimum_area_m2') or area>=filters['minimum_area_m2']) and (not filters.get('maximum_area_m2') or area<=filters['maximum_area_m2'])


def make_router(store):
    router=APIRouter(prefix='/api/domain-cable-models',tags=['Cable model versions'])
    @router.get('')
    def catalogue():
        with store.db(True) as db:
            initialize(db)
            return [read(db,r['id']) for r in db.execute('SELECT id FROM domain_cable_models ORDER BY created DESC')]
    @router.post('',status_code=201)
    def create(body:CableModelVersion):
        from backend.kernel.research import stamp
        payload=body.model_dump(mode='json');cid=str(uuid4());digest=fingerprint(payload)
        with store.db(True) as db:
            initialize(db)
            prior=db.execute('SELECT id FROM domain_cable_models WHERE digest=?',(digest,)).fetchone()
            if prior is not None:return read(db,prior['id'])
            if db.execute('SELECT COUNT(*) FROM domain_cable_models').fetchone()[0]>=200:raise HTTPException(422,'型号版本库已达200条，请整理候选范围。')
            state='incomplete' if body.specification else 'reviewed' if body.confirmed else 'draft'
            db.execute('INSERT INTO domain_cable_models VALUES(?,?,?,?,?)',(cid,json.dumps(payload,ensure_ascii=False),digest,state,stamp()))
            return read(db,cid)
    @router.delete('/{cid}',status_code=204)
    def discard(cid:str,expected_digest:str):
        """Discard only an unused draft with an exact content acknowledgement."""
        with store.db(True) as db:
            initialize(db);item=read(db,cid)
            if item['digest']!=expected_digest:
                raise HTTPException(409,'型号摘要已变化，请重新读取。')
            if item['state']=='reviewed':
                raise HTTPException(409,'已核对型号须保留版本。')
            if any(db.execute('SELECT 1 FROM '+table+' WHERE instr('+column+',?)>0 LIMIT 1',(cid,)).fetchone()
                   for table,column in [('study_versions','definition'),('study_runs','snapshot')]):
                raise HTTPException(409,'型号已被研究引用，须保留原始版本。')
            db.execute('DELETE FROM domain_cable_models WHERE id=?',(cid,))
    return router
