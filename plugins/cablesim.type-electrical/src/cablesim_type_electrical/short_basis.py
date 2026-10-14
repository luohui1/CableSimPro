"""Executable IEC60949 branches consume pinned, Executor-issued snapshots."""
from hashlib import sha256
from pathlib import Path
import json

CATALOG = json.loads(Path(__file__).with_name('short-basis-catalog.json').read_text('utf-8'))


def queries():
    return {key:{'schema_version':'cablesim.standards-query/1','operation':'resolve',**item['query']} for key,item in CATALOG.items()}


def record(parameters, key):
    reference = parameters.get('basis_references',{}).get(key)
    if not reference: return None
    r = reference.get('record',{})
    data = {k:v for k,v in r.items() if k not in ('record_sha256','citation')}
    digest = sha256(json.dumps(data,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()).hexdigest()
    if (reference.get('schema')!='cablesim.standard-basis-ref/1' or reference.get('plugin_id')!='cablesim.standards-basis' or reference.get('plugin_version')!=CATALOG[key]['plugin_version'] or r.get('id')!=key or
        reference.get('record_sha256')!=CATALOG[key]['digest'] or r.get('record_sha256')!=CATALOG[key]['digest'] or
        digest!=CATALOG[key]['digest'] or reference.get('query')!=queries()[key] or
        r.get('verification',{}).get('status')!='verified'):
        raise ValueError('标准依据快照与已封签的判据不一致，请重新查询当前发行。')
    return reference


def material_constants(parameters, kind, *, metal=False):
    name = {'copper_bare':'copper','copper_coated':'copper','aluminium':'aluminium','lead':'lead_or_lead_alloy','steel':'steel','steel_galvanized':'steel','galvanized_steel':'steel'}.get(kind)
    role = 'sheath_screen_armour' if metal and name != 'copper' else 'conductor'
    records = [key for key,item in CATALOG.items() if item['query']['quantity']=='short_circuit_material_k' and item['query']['conditions'].get('material')==name and item['query']['conditions'].get('material_role')==role]
    if len(records)!=1: return None,[]
    prefix = records[0].rsplit('/',1)[0]
    refs = [record(parameters,prefix+'/'+suffix) for suffix in ('K','beta','sigma_c')]
    if any(ref is None for ref in refs): return None,[]
    expected = ('A·s^0.5/mm²','K','J/(m³·K)')
    if any(ref['record']['quantity']['unit']!=unit for ref,unit in zip(refs,expected)):
        raise ValueError('短路材料依据单位不符，请重新核验依据发行。')
    return tuple(ref['record']['value'] for ref in refs),refs


def attach(row, references):
    refs = [r for r in references if r]
    row['basis_references'] = refs
    if refs:
        primary = refs[0]
        row.update(standard=primary['standard']+':'+primary['edition'],clause=primary['locator'],
            printed_page=primary['printed_page'],pdf_page=primary['pdf_page'],source_digest=primary['source_sha256'])
        row['citation'] = '；'.join(dict.fromkeys(f"{r['standard']}:{r['edition']} {r['locator']} · 第 {r['printed_page']} 页（PDF 第 {r['pdf_page']} 页）" for r in refs))
