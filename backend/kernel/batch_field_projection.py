"""Read a verified display projection without reserializing full-field shards.

Research.encode writes canonical UTF-8 JSON, so its byte SHA256 is exactly the
saved output fingerprint. Noncanonical legacy rows use the host's full reader.
Currentness and presentation contracts always use the existing host checks.
"""
import json
from hashlib import sha256
from fastapi import HTTPException
from .read_models import RUN_COLUMNS,run_state
from .convergence import has_temperature_field,temperature_convergence


def display_only(run):
    output=run.get('output') or {}
    cases=[{**case,'artifacts':{key:value for key,value in case.get('artifacts',{}).items()
                              if not key.startswith('x-cablesim.field-')}} for case in output.get('cases',[])]
    return {**run,'output':{**output,'cases':cases}}


def read_display(research,wid,rid):
    with research.store.db() as db:
        db.execute('BEGIN')
        workspace=db.execute('SELECT revision FROM workspaces WHERE id=?',(wid,)).fetchone()
        if workspace is None:raise HTTPException(404,'工程不存在。')
        row=db.execute(f'SELECT {RUN_COLUMNS} FROM study_runs WHERE workspace=? AND id=?',(wid,rid)).fetchone()
        if row is None:raise HTTPException(404,'运行不存在或不属于此工程。')
        value=dict(row)
        # Never trust just a declared digest or cached database identity.
        canonical=all(value[name] is None or sha256(value[name]).hexdigest()==value[digest]
                      for name,digest in (('snapshot','input_digest'),('output','output_digest')))
        if canonical:
            try:
                for key in ('snapshot','output','error'):
                    value[key]=json.loads(value[key]) if value[key] else None
                if not isinstance(value['snapshot'],dict) or (value['output'] is not None and not isinstance(value['output'],dict)):
                    raise ValueError('Invalid saved envelope')
            except (ValueError,TypeError) as exc:raise HTTPException(409,'保存场完整性未通过。') from exc
            value=display_only(value)
            study=research.definition(db,wid,value['study'])
            value.update(run_state(research,value['snapshot'],wid,workspace['revision'],study,{}))
    if not canonical:
        value=display_only(research.get_run(wid,rid))
        if value.get('integrity')!='verified':raise HTTPException(409,'保存场完整性未通过。')
        return value
    if hasattr(research.executor,'execution_status'):
        method=value['snapshot']['definition']['method']
        value['execution']=research.executor.execution_status(rid,method['plugin_id'],method['capability'])
        if value['execution'] and value['status'] in ('succeeded','partial','failed','interrupted'):
            value['execution']={**value['execution'],'state':value['status']}
    value['artifact_status']=research.artifact_status(value)
    if has_temperature_field(value):value['convergence']=temperature_convergence(value)
    return value
