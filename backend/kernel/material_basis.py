"""Freeze readonly basis answers beside actual plugin constants, without changing values."""
from copy import deepcopy
from math import isclose
from threading import Lock

from backend.plugin_host.registry import PluginHostError, Registry
from .workspace import fingerprint

_cache = {}
_lock = Lock()


def compare_constant(constant, receipt=None):
    row = {**constant, 'status':'not_covered', 'status_label':'本库暂未收录'}
    if receipt is None:
        return row
    row['basis'] = deepcopy(receipt)
    if receipt.get('error'):
        row.update(status='unavailable',status_label='依据查询未完成，请核对适用条件',error_code=receipt['error'].get('code'))
        return row
    answer = receipt['answer']
    records = answer.get('records', [])
    if answer.get('status') != 'resolved' or len(records) != 1:
        return row
    record = records[0]
    reference = record.get('value')
    if record.get('verification', {}).get('status') != 'verified' or not isinstance(reference,(int,float)):
        row.update(status='unverified', status_label='依据尚未核验')
        return row
    row.update(reference_value=reference, citation=record['citation'])
    # Comparison requires the same original unit. No silent conversion/rounding.
    if record['quantity']['unit'] != constant['unit']:
        row.update(status='unit_mismatch', status_label='依据单位不同，需核对')
    elif isclose(constant['value'],reference,rel_tol=1e-12,abs_tol=0):
        row.update(status='verified', status_label='依据已核验')
    else:
        row.update(status='different', status_label='与依据值不同', difference=constant['value']-reference)
    return row


def freeze_basis(executor, output):
    cases = [c for c in output['cases'] if c.get('status')=='succeeded' and c.get('evidence',{}).get('material_constants')]
    if not cases:
        return
    queries = {fingerprint(r['query']):r['query'] for c in cases for r in c['evidence']['material_constants'] if r.get('query')}
    receipts = {}
    error = None
    try:
        plugin = Registry(executor.registry.root,plugin_id='cablesim.standards-basis').get('cablesim.standards-basis')
        plugin.verify()
        release = fingerprint(plugin.manifest.model_dump(mode='json',by_alias=True))
        # Same-release, same-query reuse. Every lookup still checks the seal;
        # only successful receipts enter this bounded cache.
        with _lock:
            missing = {k:q for k,q in queries.items() if (release,k) not in _cache}
            if missing:
                result = executor.run(plugin.manifest.id,'lookup',[{'case_id':k,'input':q} for k,q in missing.items()],expected_manifest=plugin.manifest)
                for case in result.cases:
                    if case.status=='succeeded':
                        _cache[(release,case.case_id)] = dict(release_digest=release,request_sha256=result.request_sha256,
                            artifact_sha256=case.artifact_digests['x-cablesim.standards-basis'],
                            answer=case.artifacts['x-cablesim.standards-basis'],query=missing[case.case_id])
                    else:
                        receipts[case.case_id] = {'error':case.error or {'code':'QUERY_FAILED'},'query':missing[case.case_id]}
                while len(_cache)>128:
                    _cache.pop(next(iter(_cache)))
            receipts.update({k:deepcopy(_cache[(release,k)]) for k in queries if (release,k) in _cache})
    except (PluginHostError, OSError, ValueError) as exc:
        # An unavailable source never becomes a successful provenance claim or
        # a fabricated material value; retain the calculated result unchanged.
        error = getattr(exc,'code','BASIS_UNAVAILABLE')
    for case in cases:
        rows = [compare_constant(r,receipts.get(fingerprint(r['query'])) if r.get('query') else None)
                for r in case['evidence']['material_constants']]
        if error:
            for row in rows:
                if row.get('query'):
                    row.update(status='unavailable',status_label='依据库读取失败，请重试核对',error_code=error)
        case['evidence']['material_basis'] = dict(schema='cablesim.material-basis/1',rows=rows)


def saved_rows(case):
    """Presentation only uses frozen receipts; never resolve today's basis here."""
    return case.get('evidence',{}).get('material_basis',{}).get('rows',[])
