"""Small read projections of sealed runs; no result or currentness is invented.

Only immutable validation/projection is retained. Every lookup hashes the actual
stored JSON bytes as well as checking their declared input/output digests. The
input digest binds the saved method releases. Current method/model versions and
workspace/study revisions are evaluated anew for each request.
"""
from copy import deepcopy
from hashlib import sha256
import json

from fastapi import HTTPException
from .contracts import StudyConfiguration
from .workspace import fingerprint
from ..plugin_host import PluginHostError

RUN_COLUMNS = ('id,workspace,study,sequence,status,created,finished,input_digest,output_digest,'
               'CAST(snapshot AS BLOB) AS snapshot,CAST(output AS BLOB) AS output,CAST(error AS BLOB) AS error')


def reference(value):
    if not isinstance(value, dict):
        return None
    return {key: value.get(key) for key in ('id', 'name', 'version', 'content_sha256')}


def run_facts(research, row):
    """Bounded content-addressed receipt, including corrupt-record detection."""
    key = (row['input_digest'], row['output_digest'], *(
        sha256(row[name] or b'').digest() for name in ('snapshot', 'output', 'error')))
    identity = (row['workspace'], row['id'])
    with research.run_read_lock:
        previous = research.run_read_cache.get(identity)
        if previous is not None and previous[0] == key:
            research.run_read_cache.move_to_end(identity)
            return previous[1]
    facts = {'integrity': 'corrupt', 'snapshot': {}, 'method': None, 'error': None}
    try:
        snapshot = json.loads(row['snapshot'])
        output = json.loads(row['output']) if row['output'] else None
        error = json.loads(row['error']) if row['error'] else None
        intact = fingerprint(snapshot) == row['input_digest']
        intact = intact and (output is None or fingerprint(output) == row['output_digest'])
        if intact:
            state = snapshot['workspace_state']
            compact = {name: snapshot.get(name) for name in (
                'workspace_id', 'workspace_revision', 'study_revision', 'module', 'definition', 'lock')}
            compact['workspace_state'] = {name: reference(state[name]) for name in (
                'study_cable_reference', 'type_origin_reference') if state.get(name)}
            facts = {'integrity': 'verified', 'snapshot': compact,
                     'method': snapshot['definition']['method'],
                     'error': {name: str(error.get(name, ''))[:512] for name in ('code', 'message')} if error else None}
    except (ValueError, TypeError, KeyError):
        pass
    with research.run_read_lock:
        research.run_read_cache[identity] = (key, facts)
        research.run_read_cache.move_to_end(identity)
        while len(research.run_read_cache) > 64:
            research.run_read_cache.popitem(last=False)
    return facts


def run_state(research, snapshot, wid, revision, study, cache):
    current = revision == snapshot['workspace_revision']
    try:
        selected = research.module_definition(study['definition'], snapshot.get('module'))
        normalize = lambda value: StudyConfiguration.model_validate(
            {key: item for key, item in value.items() if key != 'modules'}).model_dump()
        current = current and normalize(selected) == normalize(snapshot['definition'])
        current = current and research.lock(None, wid, revision, selected['method']) == snapshot['lock']
    except HTTPException:
        current = False
    availability = {'status': 'available', 'error': None}
    try:
        research.resolve(snapshot['definition']['method'], cache)
        for item in snapshot['definition']['crosschecks']:
            research.resolve(item['method'], cache)
    except (HTTPException, PluginHostError, ValueError, OSError) as exc:
        current = False
        availability = {'status': 'unavailable', 'error': {
            'code': getattr(exc, 'code', 'METHOD_UNAVAILABLE'), 'message': str(exc)}}
    from .version_status import inspect
    version = inspect(research, snapshot, cache)
    return {'freshness': 'current' if current and version['status'] == 'current' else 'historical',
            'integrity': 'verified', 'version_status': version, 'method_availability': availability}


def summary(research, row, revision, study, cache):
    facts = run_facts(research, row)
    value = {name: row[name] for name in ('id', 'workspace', 'study', 'sequence', 'status', 'created', 'finished')}
    value.update(integrity=facts['integrity'], freshness='unknown', version_status=None,
                 snapshot={'module': facts['snapshot'].get('module')},
                 method=deepcopy(facts['method']), error=deepcopy(facts['error']))
    if facts['integrity'] == 'verified':
        state = run_state(research, facts['snapshot'], row['workspace'], revision, study, cache)
        value.update({name: state[name] for name in ('freshness', 'version_status')})
    return value


def model_reference(db, wid):
    """Read display identity without deserializing a workspace/domain payload."""
    row = db.execute('''SELECT revision,json_extract(state,
        '$.study_cable_reference.id','$.study_cable_reference.name','$.study_cable_reference.version','$.study_cable_reference.content_sha256',
        '$.type_origin_reference.id','$.type_origin_reference.name','$.type_origin_reference.version','$.type_origin_reference.content_sha256',
        '$.domain.cable_types[0].id','$.domain.cable_types[0].label') AS display
        FROM workspaces WHERE id=?''', (wid,)).fetchone()
    if row is None:
        raise HTTPException(404, '工程不存在。')
    values = json.loads(row['display'])
    selected = values[:4] if values[0] else values[4:8] if values[4] else values[8:] + [None, None]
    return row['revision'], dict(zip(('id','name','version','content_sha256'), selected)) if any(selected[:2]) else None
