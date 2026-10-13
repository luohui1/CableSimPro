"""Pinned standards evidence; live lookup belongs to the host Executor."""
from hashlib import sha256
import json
import math
from pathlib import Path

RECORDS=json.loads((Path(__file__).parent/'basis-records.json').read_text('utf-8'))

def digest(value):
    return sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()

def queries(checker):
    from .manufacturing import plan as manufacturing_plan
    cable, family = checker.cable, checker.family
    hv = family == 'hv'
    standard, edition = ('GB/T 11017.2', '2024') if hv else ('GB/T 12706.'+{'mv1':'1','mv2':'2','mv3':'3'}.get(family,'2'), '2020')
    result = {}
    for row in checker.rows:
        row['basis_missing_fields'] = []
        key, target = row['id'].rsplit(':', 1)[-1], row['target']
        core = next((c for c in cable['cores'] if c['id'] == target.get('core_id')), cable['cores'][0])
        escape = lambda token: token.replace('~', '~0').replace('/', '~1')
        root = '/cable_types/'+escape(cable['id'])+'/cores/'+escape(core['id'])
        def missing(field, label):
            row['basis_missing_fields'].append({'field':field,'label':label})
        conditions = {'area_m2':core['conductor']['nominal_area'], 'u0_v':cable['rating']['u0'], 'u_v':cable['rating']['u']}
        query = {'schema_version':'cablesim.standards-query/1', 'standard':standard, 'edition':edition, 'conditions':{}}
        manufacturing_query = manufacturing_plan(checker,row)
        if manufacturing_query:
            query = manufacturing_query
        elif key == 'insulation-nominal':
            layer = next((l for l in core['layers']+cable['common_layers'] if l['role']=='insulation'), {})
            kind = checker.materials.get(layer.get('material'), {}).get('standard_kind')
            if kind is None:
                missing('/materials/'+escape(layer.get('material',''))+'/standard_kind','绝缘材料标准类别')
            if hv and kind != 'XLPE': continue
            query.update(locator='表 2' if hv else '表 6' if family=='mv3' else '表 7',quantity='insulation_nominal',conditions=conditions if hv else {**conditions,'insulation':kind})
        elif key == 'r20':
            kind = checker.materials[core['conductor']['material']].get('standard_kind')
            if kind is None:
                missing('/materials/'+escape(core['conductor']['material'])+'/standard_kind','导体材料标准类别')
            if kind not in ('copper_bare','copper_coated','aluminium'): continue
            if core['conductor'].get('conductor_class') is None:
                missing(root+'/conductor/conductor_class','导体类别')
            query.update(standard='GB/T 3956',edition='2008',locator={1:'表 1',2:'表 2',5:'表 3',6:'表 4'}.get(core['conductor'].get('conductor_class'),'表 2'),quantity='resistance_20_max',conditions={
                'area_m2':core['conductor']['nominal_area'],'conductor_class':core['conductor'].get('conductor_class'),
                'conductor_material':'aluminium' if kind=='aluminium' else 'copper','coating':'metal_coated' if kind=='copper_coated' else 'plain'})
            if kind=='aluminium': query['conditions'].pop('coating')
        elif key=='oversheath-nominal':
            query.update(locator='表 4' if hv else '14.3' if family!='mv1' else '13.3',quantity='oversheath_nominal',conditions=conditions if hv else {'core_count':len(cable['cores'])})
        elif key=='sheath-nominal' and hv:
            layer=next((l for l in core['layers']+cable['common_layers'] if l['role']=='metallic_sheath'), {})
            if layer.get('material') and checker.materials.get(layer['material'],{}).get('standard_kind') is None:
                missing('/materials/'+escape(layer['material'])+'/standard_kind','金属材料标准类别')
            continue
        elif key=='oversheath-minimum' and not hv:
            query.update(locator='17.5.3' if family!='mv1' else '15.5.3',quantity='nonmetal_sheath_min')
        elif key=='insulation-minimum' and not hv:
            query.update(locator='17.5.2' if family!='mv1' else '15.5.2',quantity='insulation_min')
        elif key=='insulation-uniformity' and not hv and family!='mv1':
            query.update(locator='17.5.2',quantity='insulation_eccentricity_max')
        elif key in ('screen-tape-nominal','screen-tape-minimum','screen-overlap','screen-overlap-minimum') and not hv:
            layer=next((l for l in core['layers']+cable['common_layers'] if l['role']=='metallic_screen'),{})
            metal=checker.materials.get(layer.get('material'),{}).get('standard_kind')
            if metal is None:
                missing('/materials/'+escape(layer.get('material',''))+'/standard_kind','屏蔽材料标准类别')
            elif metal not in ('copper_bare','copper_coated'):
                continue
            query.update(locator='10.2.2' if family=='mv3' else '10.2.3',quantity={'screen-tape-nominal':'screen_tape_nominal_min',
                'screen-tape-minimum':'screen_tape_measured_min','screen-overlap':'screen_tape_overlap_nominal',
                'screen-overlap-minimum':'screen_tape_overlap_min'}[key],conditions={'core_count':len(cable['cores'])} if key=='screen-tape-nominal' else {})
        else: continue
        if not row['basis_missing_fields'] and all(v is not None for v in query['conditions'].values()): result[row['id']]=query
    return result

def criterion(reference, unit, inputs):
    record=reference['record']; value, role=record['value'],record['criterion']
    comparison='<=' if role=='maximum' else '>=' if role in ('nominal','minimum') else None
    if comparison is None or value is None: return None,comparison,'此条依据没有可执行的标称、最小或最大判据。'
    if isinstance(value,dict):
        if value.get('kind')=='ratio' and value.get('expression')=='(maximum-minimum)/maximum' and role=='maximum':
            value=value.get('maximum')
        else:
            if value.get('rounding'): return None,comparison,'依据已核验；此公式尚未绑定完整附录 A/B 计算链，本项保留未覆盖。'
            x=inputs.get('t_n_mm') if value.get('x') in ('nominal_thickness','t_n','nominal_lining_thickness') else inputs.get('d_mm') if value.get('x')=='diameter' else None
            if value.get('kind')=='affine' and x is not None and {'a','b'}<=value.keys(): value=max(value.get('floor',-math.inf),value['a']*x+value['b'])
            else: return None,comparison,'依据已核验；此公式的参数或计算分支本轮未覆盖。'
    scale={('mm','mm'):1,('m','mm'):1000,('ohm/km','Ω/km'):1,('ohm/m','Ω/km'):1000,('1','1'):1}.get((record['quantity']['unit'],unit))
    if scale is None: return None,comparison,'依据与实际值单位不兼容，本项未比较。'
    if not isinstance(value,(int,float)) or isinstance(value,bool) or not math.isfinite(value): raise ValueError('basis_references：判据不是有限数值。')
    return value*scale,comparison,None

def validate(ref,query):
    if ref.get('schema')!='cablesim.standard-basis-ref/1' or ref.get('query')!=query: raise ValueError('basis_references：依据与当前型号条件不一致，请重新取依据。')
    record=ref.get('record',{});bare={k:v for k,v in record.items() if k not in ('record_sha256','citation')}
    # Whole-library digests remain in the receipt for traceability. Adding an
    # unrelated table must not invalidate a pinned, individually sealed record.
    if ref.get('plugin_version')!=RECORDS['plugin_version'] or RECORDS['records'].get(record.get('id'))!=ref.get('record_sha256'):
        raise ValueError('basis_references：依据不属于此方法已封签的依据发行；请重新核对版本。')
    if digest(bare)!=ref.get('record_sha256') or record.get('verification',{}).get('status')!='verified': raise ValueError('basis_references：依据记录摘要或核验状态不一致。')
    if ref.get('query_sha256')!=digest(query) or (record.get('standard'),record.get('edition'))!=(query['standard'],query['edition']): raise ValueError('basis_references：固定标准版本或查询摘要不一致。')
    if record.get('quantity',{}).get('key')!=query['quantity'] or query['locator'] not in (record.get('table'),record.get('clause')):
        raise ValueError('basis_references：依据的物理量或条款不一致。')
    for key,predicate in record.get('conditions',{}).items():
        actual=query['conditions'].get(key)
        if isinstance(predicate,dict):
            operators={'eq':lambda a,b:math.isclose(a,b,rel_tol=1e-12) if isinstance(a,(int,float)) and isinstance(b,(int,float)) else a==b,
                       'gt':lambda a,b:a>b and not math.isclose(a,b,rel_tol=1e-12,abs_tol=0),
                       'gte':lambda a,b:a>=b or math.isclose(a,b,rel_tol=1e-12,abs_tol=0),
                       'lt':lambda a,b:a<b and not math.isclose(a,b,rel_tol=1e-12,abs_tol=0),
                       'lte':lambda a,b:a<=b or math.isclose(a,b,rel_tol=1e-12,abs_tol=0),
                       'in':lambda a,b:any(math.isclose(a,item,rel_tol=1e-12,abs_tol=0) if isinstance(a,(int,float)) and isinstance(item,(int,float)) else a==item for item in b)}
            if actual is None or any(op not in operators or not operators[op](actual,expected) for op,expected in predicate.items()):
                raise ValueError('basis_references：依据行条件与当前型号不一致。')
        elif not (math.isclose(actual,predicate,rel_tol=1e-12) if isinstance(actual,(int,float)) and isinstance(predicate,(int,float)) else actual==predicate):
            raise ValueError('basis_references：依据行条件与当前型号不一致。')
    return record

def apply(checker,parameters):
    from .manufacturing import execute
    plan=queries(checker)
    for row in checker.rows:
        row['basis_query']=plan.get(row['id'])
        if row['basis_missing_fields']:
            row.update(limit=None,margin=None,verdict='missing',source_status='input-missing',reason='缺字段：'+'、'.join(item['label'] for item in row['basis_missing_fields'])+'；补齐后按固定标准版本查询依据。')
    if 'basis_references' not in parameters: return
    if parameters.get('basis_cable_sha256')!=digest(checker.cable): raise ValueError('basis_references：型号输入已变化，请重新取依据。')
    refs=parameters['basis_references']
    if not isinstance(refs,dict): raise ValueError('basis_references：请提供逐项固定依据引用。')
    for row in checker.rows:
        if row['basis_missing_fields']: continue
        ref=refs.get(row['id'])
        if not ref or row['id'] not in plan:
            row.update(limit=None,margin=None,verdict='uncovered',source_status='not-collected',reason='本库暂未收录 · 下一轮；保留此标准版本与要求。');continue
        record=validate(ref,plan[row['id']])
        row.update(basis_reference=ref,citation=record['citation'],source_status='original-verified',source_digest=record['source_sha256'],printed_page=record['printed_page'],pdf_page=record['pdf_page'],standard=record['standard']+'—'+record['edition'],clause=record['table'] or record['clause'],criterion=record['criterion'])
        if execute(checker,row,record): continue
        if row['id'].endswith(':screen-tape-minimum'):
            nominal=next((r for r in checker.rows if r['id'].endswith(':screen-tape-nominal')
                and r['path'].rsplit('.',1)[0]==row['path'].rsplit('.',1)[0]),{})
            limit,actual=nominal.get('limit'),nominal.get('actual')
            row['formula_inputs']={'t_n_mm':max(limit,actual) if limit is not None and actual is not None else None}
        limit,comparison,reason=criterion(ref,row['unit'],row.get('formula_inputs') or {})
        row.update(basis_reference=ref,citation=record['citation'],source_status='original-verified',source_digest=record['source_sha256'],printed_page=record['printed_page'],pdf_page=record['pdf_page'],standard=record['standard']+'—'+record['edition'],clause=record['table'] or record['clause'],criterion=record['criterion'],limit=limit,comparison=comparison or row['comparison'])
        actual=row['actual'];row['margin']=None if actual is None or limit is None else actual-limit if comparison=='>=' else limit-actual
        row['verdict']='uncovered' if limit is None else 'missing' if actual is None else 'passed' if row['margin']>=-1e-12 else 'failed'
        row['reason']=(reason or row['reason'] or '缺字段：'+row['title']+'；补录相应输入或实测值后重新核对。') if row['verdict'] in ('missing','uncovered') else None
