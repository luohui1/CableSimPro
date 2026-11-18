"""Executable IEC60949 branches consume pinned standard-reference content.

Content and issuer receipts are sealed here. A request SHA identifies a whole
Executor batch, including its random run ID; it remains an opaque trace receipt,
not proof that this consumer revalidated that execution.
"""
from pathlib import Path
import json
from .basis_identity import SCHEMA, content_digest

CATALOG = json.loads(Path(__file__).with_name('short-basis-catalog.json').read_text('utf-8'))


def queries():
    return {key:{'schema_version':'cablesim.standards-query/1','operation':'resolve',**item['query']} for key,item in CATALOG.items()}


def record(parameters, key):
    reference = parameters.get('basis_references',{}).get(key)
    if reference is None: return None
    message = '标准依据快照与已封签的判据不一致，请重新查询当前发行。'
    if not isinstance(reference, dict) or not isinstance(reference.get('record'), dict):
        raise ValueError(message)
    r = reference.get('record',{})
    data = {k:v for k,v in r.items() if k not in ('record_sha256','citation')}
    digest = content_digest(data)
    # A browser may serialize 3450000.0 as 3450000 without changing its value.
    # The issuer's original SHA and version stay pinned; the separate content
    # SHA is generated from that verified record and sealed with this consumer.
    if (reference.get('schema')!='cablesim.standard-basis-ref/1' or reference.get('plugin_id')!='cablesim.standards-basis' or reference.get('plugin_version')!=CATALOG[key]['plugin_version'] or r.get('id')!=key or
        reference.get('record_sha256')!=CATALOG[key]['digest'] or r.get('record_sha256')!=CATALOG[key]['digest'] or
        CATALOG[key].get('content_digest_schema')!=SCHEMA or digest!=CATALOG[key].get('content_sha256') or
        content_digest(reference.get('query'))!=content_digest(queries()[key]) or
        r.get('verification',{}).get('status')!='verified'):
        raise ValueError(message)
    if (any(reference.get(field) != CATALOG[key][field]
            for field in ('data_sha256', 'query_sha256', 'release_digest', 'artifact_digest'))
            or r.get('citation') != CATALOG[key]['citation']):
        raise ValueError(message)
    expected_metadata = {field:r.get(field) for field in ('standard','edition','printed_page','pdf_page')}
    expected_metadata.update(record_id=key, source_sha256=r.get('source_sha256'), locator=r.get('table') or r.get('clause'))
    if content_digest({field:reference.get(field) for field in expected_metadata}) != content_digest(expected_metadata):
        raise ValueError(message)
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
