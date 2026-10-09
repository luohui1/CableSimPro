"""Small projections of verified reproduction snapshots, never new solver results."""
from hashlib import sha256
import math
import os
from pathlib import Path
import re

from fastapi import HTTPException
from backend.foundation.reproduction_library import ReproductionLibrary
from .contracts import ValidationEvidence

LABELS={'reproduced':'已复现','partial':'部分复现','missing_data':'缺资料','capability_gap':'能力未覆盖'}
MAX_METRICS=3


def library():
    # Same default and environment setting as the host's reproduction router.
    return ReproductionLibrary(os.environ.get('CABLESIM_REPRODUCTION_LIBRARY',
        str(Path(__file__).resolve().parents[2]/'.data/simulation/library')))


def identity(reader):
    """Watch the catalog bytes and selected file identity; no TTL or artifact reads."""
    path=reader.root/'index.json'
    if not path.exists():return None
    index,raw=reader.read(path);current=index['current']
    if not isinstance(current,str) or not re.fullmatch('[a-f0-9]{64}',current):
        raise ValueError('当前复现快照 ID 不合法。')
    stat=(reader.root/'snapshots'/(current+'.json')).stat()
    return (sha256(raw).hexdigest(),current,stat.st_mtime_ns,stat.st_ctime_ns,stat.st_size,stat.st_ino)


def finite(value):
    if value is not None and (type(value) not in (int,float) or not math.isfinite(value)):
        raise ValueError('复现结果包含不合法或非有限量值。')
    return value


def projection(item,digest):
    rows=item.get('rows',[])
    for row in rows:
        for key in ('reference','open_source','comsol','difference','relative_difference'):finite(row.get(key))
    # Show out-of-tolerance rows first. The total and outside count cover ALL
    # rows; omitted details remain in the original validation object's home.
    # Incomparable saved results carry important scope warnings and deviations;
    # do not let unevaluated historical rows displace them from the small view.
    priority={'outside_tolerance':0,'not_comparable':1,'matched':2,'not_assessed':3}
    ordered=sorted(rows,key=lambda r:priority.get(r['status'],4))
    metrics=[]
    for row in ordered[:MAX_METRICS]:
        relative=finite(row.get('relative_difference'))
        metrics.append({**{key:row.get(key) for key in ('unit','source','tolerance')},
            'id':row['id'],'variant':row.get('variant') or row['id'],'quantity':row['quantity'],
            **{key:finite(row.get(key)) for key in ('reference','open_source','comsol','difference')},
            'relative_difference':relative,
            'relative_difference_percent':None if relative is None else finite(relative*100),'status':row['status']})
    convergence=item.get('convergence_summary',{}).get('passed')
    if convergence is not None and type(convergence) is not bool:raise ValueError('收敛状态必须为布尔值。')
    return ValidationEvidence(snapshot_digest=digest,citation=item.get('citation',''),
        reference_location=item.get('reference_location',''),source_pages=[
            {key:source[key] for key in ('source','pdf_page','printed_page') if key in source}
            for source in item.get('inputs',[]) if source.get('pdf_page') is not None or source.get('printed_page') is not None],
        scope=item.get('scope',''),metrics=metrics,
        total_metrics=len(rows),outside_tolerance=sum(row['status']=='outside_tolerance' for row in rows),
        convergence_passed=convergence,limitations=item.get('limitations',[]),
        runs=[{key:run[key] for key in ('plugin_id','plugin_version','method_version','source_sha256','engineering_approval') if key in run}
            for run in item.get('runs',[])],report_tolerance=item.get('report_tolerance')).model_dump(mode='json')


def build(index,snapshot):
    # Validate every projection before publishing any card or relation.
    digest=snapshot['snapshot_id']
    prepared=[(item,projection(item,digest)) for item in snapshot['items']]
    for item,evidence in prepared:
        reason=LABELS[item['status']]
        if evidence['outside_tolerance']:reason+='；存在偏差超限（以记录中的容差来源为准）'
        if evidence['convergence_passed'] is True:reason+='；收敛检查通过，不等于整体复现或工程批准。'
        if item['status']=='reproduced':reason+='；只适用于此算例及保存的方法版本，不等于工程批准。'
        card=index.add('validation',item['id'],item['title'],item['status'],reason=reason,
            updated=snapshot.get('created_at'),subtype='reproduced',digest=digest,
            source={'kind':'reproduction_library','label':'保存的复现结果'})
        card['status']['label']=LABELS[item['status']];card['validation']=evidence
        deviations=[row for row in evidence['metrics'] if row['relative_difference_percent'] is not None]
        note=card['status']['label']
        if deviations:
            row=deviations[0]
            note+='；'+row['variant']+'相对参考值偏差 '+format(row['relative_difference_percent'],'.4g')+' %'
        note+='；'+evidence['reference_location']+'；保存方法版本见验证名片，不证明当前安装版本已通过。'
        for pid in dict.fromkeys(run['plugin_id'] for run in item.get('runs',[]) if run.get('plugin_id')):
            plugin=index.get('plugin',pid)
            if plugin:index.link(plugin,card,'validation',pin={'digest':digest},
                reason=note)
            else:index.missing(('validation',item['id']),'plugin','保存运行引用的插件未安装：'+pid)


def invalid(error):
    return HTTPException(503,{'code':'INDEX_REPRODUCTION_INVALID','state':'invalid',
        'source':'reproduction_library','message':'复现库读取或完整性校验失败；未返回空复现库或旧验证证据。请在验证页核对当前快照；其他对象仍可读取。',
        'reason':str(error)})


def unavailable(index,error):
    """Isolate a failed evidence source; never invent missing case identities."""
    reason=error['message']+' '+error['reason']
    card=index.add('validation','reproduction-library','复现库校验失败','unavailable',reason=reason,
        source={'kind':'reproduction_library','label':'复现库状态'})
    for plugin in list(index.cards.values()):
        if plugin['kind']=='plugin':index.missing(('plugin',plugin['id']),'validation',reason)
    index.todos.append({'category':'missing','origin':'validation','title':card['name'],
        'object':card,'reason':reason,'created':None})
