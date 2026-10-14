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


def _validator_digest(cache=None):
    from pathlib import Path
    kernel = Path(__file__).parent
    def digest():
        return sha256(b''.join(path.read_bytes() for path in [
            *(kernel / name for name in ('read_models.py','headlines.py','answer_witnesses.py','research.py',
                                        'workspace.py','report.py','report_selection.py')),
            *sorted((kernel.parents[1] / 'cablesim_sdk').glob('*.py'))])).hexdigest()
    if cache is None:return digest()
    if 'run_facts_validator' not in cache:cache['run_facts_validator'] = digest()
    return cache['run_facts_validator']


def _receipt_identity(key):
    return fingerprint(('run-facts/2', key[0], key[1], *(value.hex() for value in key[2:5]), key[5]))


def source_facts(research, db, wid, rid, cache):
    """A durable byte-certified receipt, without allocating a lossless envelope.

    A candidate is untrusted until SHA256 of the ACTUAL SQLite blob matches it.
    The blob and metadata belong to the same explicit read transaction. No
    commit counter, declared digest or filename alone authenticates the bytes.
    First read/missing receipt/legacy JSON retains the complete existing check.
    The sidecar is derived data, never part of the engineering backup.
    """
    from .report_reads import saved_observation_receipt
    row=db.execute('SELECT rowid AS source_rowid,'+RUN_COLUMNS.replace('CAST(output AS BLOB) AS output,','')+
                   ' FROM study_runs WHERE workspace=? AND id=?',(wid,rid)).fetchone()
    if row is None:raise HTTPException(404,'保存运行不存在。')
    try:expected=bytes.fromhex(row['output_digest'] or '')
    except ValueError:expected=b''
    if len(expected)==32 and sha256(row['snapshot'] or b'').hexdigest()==row['input_digest']:
        key=(row['input_digest'],row['output_digest'],sha256(row['snapshot']).digest(),expected,
             sha256(row['error'] or b'').digest(),_validator_digest(cache))
        identity=(wid,rid)
        with research.run_read_lock:
            entry=research.run_read_cache.get(identity)
            receipt=entry[1] if entry is not None and entry[0]==key else None
        if receipt is None:receipt=saved_observation_receipt(research,_receipt_identity(key))
        if receipt is not None:
            actual=sha256()
            # Python's blob API works for SQLite TEXT too; these are exactly the
            # original UTF-8 bytes used by canonical saved-output fingerprinting.
            import sqlite3
            authenticated=False
            try:
                with db.blobopen('study_runs','output',row['source_rowid'],readonly=True) as blob:
                    while block:=blob.read(1024*1024):actual.update(block)
                authenticated=actual.digest()==expected
            except sqlite3.Error:pass  # A NULL/damaged source repeats the normal refusal path.
            if authenticated:
                with research.run_read_lock:
                    research.run_read_cache[identity]=(key,receipt)
                    research.run_read_cache.move_to_end(identity)
                    while len(research.run_read_cache)>64:research.run_read_cache.popitem(last=False)
                return row,receipt
    # No actual-byte receipt yet. Preserve original parsing/witness checks,
    # including legacy noncanonical JSON and damaged-row refusal.
    complete=db.execute('SELECT '+RUN_COLUMNS+' FROM study_runs WHERE workspace=? AND id=?',(wid,rid)).fetchone()
    return complete,run_facts(research,complete,cache)


def reference(value):
    if not isinstance(value, dict):
        return None
    return {key: value.get(key) for key in ('id', 'name', 'version', 'content_sha256')}


def answer_output(research, raw, snapshot):
    """Project only the saved answer's actual evidence after authenticating bytes.

    A list never displays a field, so validating/decimating its full mesh is not
    part of this read. Keep the original witness, quantities, source artifact,
    producer and assessment; the existing witness checks still authorize each
    headline. The display/full/report readers retain their field verification.
    SQLite parses JSON in C without materializing lossless shards in Python.
    Bind the authenticated bytes themselves, not a second mutable source query.
    """
    paths = ['$.case_id', '$.status', '$.results', '$.evidence.headline', '$.method', '$.artifact_digests']
    types = sorted({value['artifact'] for value in snapshot.get('headline_contract', []) if isinstance(value.get('artifact'), str)})
    sources = sorted({value['source_artifact'] for value in snapshot.get('headline_contract', []) if isinstance(value.get('source_artifact'), str)})
    paths += ['$.artifacts.' + json.dumps(kind) for kind in types]
    # Conclusion reads need the saved boundary declaration, not the display
    # mesh or binary field shards. Extract it from these authenticated bytes.
    paths += ['$.artifacts."x-cablesim.simulation-bundle".result.outer_boundary']
    with research.store.read_snapshot() as db:
        # Generate case indices without json_each: its virtual-table cursor
        # materializes each mesh-bearing case even when only key is selected.
        # Extract the small fields directly from these same authenticated bytes.
        prefix = "'$.cases[' || indices.n || ']' || ?"
        # Reuse one bound blob in every JSON expression. A materialized CTE
        # column loses SQLite's constant-argument JSON parse cache and reparses
        # the full field once for each witness-source type and each case.
        rows = db.execute("WITH RECURSIVE indices(n) AS (SELECT 0 WHERE json_array_length(?1,'$.cases')>0 "
                          "UNION ALL SELECT n+1 FROM indices WHERE n+1<json_array_length(?1,'$.cases')) "
                          'SELECT json_extract(?1,' +
                          ','.join(prefix for _ in paths) + ",'$.assessment','$.default_result','$.run_id')" +
                          ''.join(',json_type(?1,' + prefix + ')' for _ in sources) +
                          " FROM indices",
                          (raw, *(path[1:] for path in paths), *('.artifacts.'+json.dumps(kind) for kind in sources))).fetchall()
    cases = []
    assessment, default, run_id = None, None, None
    for row in rows:
        values = json.loads(row[0])
        case_id, status, results, headline, method, hashes, *artifacts = values[:-3]
        boundary = artifacts.pop()
        assessment, default, run_id = values[-3:]
        cases.append({'case_id':case_id, 'status':status, 'results':results or [],
                      'evidence':{'headline':headline}, 'method':method,
                      'artifact_digests':hashes or {},
                      '_saved_artifact_types':{kind:kind_type for kind,kind_type in zip(sources,row[1:])},
                      'artifacts':{**{kind:value for kind,value in zip(types,artifacts) if value is not None},
                          **({'x-cablesim.simulation-bundle':{'result':{'outer_boundary':boundary}}} if boundary is not None else {})}})
    return {'cases':cases, 'assessment':assessment, 'default_result':default, 'run_id':run_id}


def run_facts(research, row, cache=None):
    """Bounded content-addressed receipt, including corrupt-record detection."""
    from .report_reads import saved_observation_receipt
    # This cache is confined to one snapshot read, never a cross-request source
    # receipt. All original row bytes below are still hashed for every lookup.
    validator = _validator_digest(cache)
    key = (row['input_digest'], row['output_digest'], *(
        sha256(row[name] or b'').digest() for name in ('snapshot', 'output', 'error')), validator)
    identity = (row['workspace'], row['id'])
    with research.run_read_lock:
        previous = research.run_read_cache.get(identity)
        if previous is not None and previous[0] == key:
            research.run_read_cache.move_to_end(identity)
            return previous[1]
    # The source bytes above are authenticated on every lookup. A persistent
    # receipt only retains their immutable witness projection, never currentness.
    # Bind every validator source and SDK contract byte; changed validation code
    # must repeat validation, just as changed input/output bytes do.
    receipt_key = _receipt_identity(key)
    receipt = saved_observation_receipt(research, receipt_key)
    if receipt is not None:
        with research.run_read_lock:
            research.run_read_cache[identity] = (key, receipt)
            while len(research.run_read_cache) > 64:research.run_read_cache.popitem(last=False)
        return receipt
    # Context and conclusion can encounter the same new source together. Both
    # have already hashed their own actual bytes. Share only the immutable
    # witness extraction; different source keys never wait for one another.
    from concurrent.futures import Future
    with research.run_read_lock:
        pending = research.run_read_pending.get(key)
        owner = pending is None
        if owner:
            pending = Future()
            research.run_read_pending[key] = pending
    if not owner:return pending.result()
    try:
        facts = _build_run_facts(research, row, key, identity, receipt_key)
        pending.set_result(facts)
        return facts
    except BaseException as exc:
        pending.set_exception(exc)
        pending.exception()
        raise
    finally:
        with research.run_read_lock:research.run_read_pending.pop(key, None)


def _build_run_facts(research, row, key, identity, receipt_key):
    from .report_reads import saved_observation_receipt
    facts = {'integrity': 'corrupt', 'snapshot': {}, 'method': None, 'error': None, 'headlines': [], 'headline': None, 'task': None, 'driver': None, 'answer': None}
    try:
        snapshot = json.loads(row['snapshot'])
        small_answer=(snapshot.get('definition',{}).get('method',{}).get('capability')=='iec-thermal-field'
                      or snapshot.get('definition',{}).get('method',{}).get('plugin_id')=='cablesim.iec60287')
        if (small_answer
                and key[2].hex()==row['input_digest'] and row['output']
                and key[3].hex()==row['output_digest']):
            output=answer_output(research,row['output'],snapshot)
        else:output=json.loads(row['output']) if row['output'] else None
        error = json.loads(row['error']) if row['error'] else None
        # Saved canonical JSON already has the exact digest being verified.
        # Hash those bytes once; retain semantic verification for legacy JSON.
        # Never trust only the declared digest or the database revision.
        intact = key[2].hex() == row['input_digest'] or fingerprint(snapshot) == row['input_digest']
        intact = intact and (output is None or key[3].hex() == row['output_digest'] or fingerprint(output) == row['output_digest'])
        if intact:
            from .headlines import project
            state = snapshot['workspace_state']
            compact = {name: snapshot.get(name) for name in (
                'workspace_id', 'workspace_revision', 'study_revision', 'module', 'definition', 'lock', 'method_manifests')}
            compact['workspace_state'] = {name: reference(state[name]) for name in (
                'study_cable_reference', 'type_origin_reference') if state.get(name)}
            compact['workspace_state_digest'] = fingerprint(state)
            from .answer_witnesses import status
            witness_status = {case['case_id']:{'x-cablesim.headline-witness':status({'snapshot':snapshot,'output':output},case,
                              source_artifact_types=case.get('_saved_artifact_types'))}
                              for case in (output or {}).get('cases',[]) if 'x-cablesim.headline-witness' in case.get('artifacts',{})}
            answers = project(snapshot, output, witness_status) if snapshot.get('headline_contract') else []
            selected_case = answers[0]['case_id'] if answers else None
            # Only forward the producer's saved text for the same verified case.
            # Older/missing witnesses stay empty rather than inventing a summary.
            producer = next((case.get('evidence', {}).get('headline') for case in (output or {}).get('cases', [])
                             if case['case_id'] == selected_case and case.get('status') == 'succeeded'), None)
            facts = {'integrity': 'verified', 'snapshot': compact,
                     'method': snapshot['definition']['method'],
                     'headlines': answers,
                     'headline': producer if isinstance(producer, str) and 0 < len(producer) <= 500 else None,
                     'task': snapshot['definition'].get('task'), 'driver': deepcopy(snapshot['definition'].get('driver')),
                     'error': {name: str(error.get(name, ''))[:512] for name in ('code', 'message')} if error else None,
                     # Only the authenticated small projection may persist. A
                     # complete legacy envelope must not enter this sidecar.
                     'answer':output if output and key[2].hex()==row['input_digest']
                         and key[3].hex()==row['output_digest']
                         and small_answer else None}
    except (ValueError, TypeError, KeyError):
        pass
    saved_observation_receipt(research, receipt_key, facts)
    with research.run_read_lock:
        research.run_read_cache[identity] = (key, facts)
        research.run_read_cache.move_to_end(identity)
        while len(research.run_read_cache) > 64:
            research.run_read_cache.popitem(last=False)
    return facts


def same_workspace_input(research, snapshot, wid, revision, cache):
    """Undo/redo can restore identical input under a new optimistic-lock revision."""
    if revision == snapshot['workspace_revision']:
        return True
    key = ('workspace_content', wid, revision)
    if key not in cache:
        with research.store.read_snapshot() as db:
            row, state = research.store.load(db, wid)
        cache[key] = fingerprint(state) if row['revision'] == revision else None
    saved = snapshot.get('workspace_state_digest') or fingerprint(snapshot['workspace_state'])
    return cache[key] == saved


def run_state(research, snapshot, wid, revision, study, cache):
    current = same_workspace_input(research, snapshot, wid, revision, cache)
    try:
        selected = research.module_definition(study['definition'], snapshot.get('module'))
        normalize = lambda value: StudyConfiguration.model_validate(
            {key: item for key, item in value.items() if key != 'modules'}).model_dump()
        current = current and normalize(selected) == normalize(snapshot['definition'])
        current = current and selected['method'] == snapshot['lock']['method']
    except HTTPException:
        current = False
    availability = {'status': 'available', 'error': None}
    try:
        from .method_identity import current_for_read
        current_for_read(research, snapshot['definition']['method'], snapshot, cache)
        for item in snapshot['definition']['crosschecks']:
            current_for_read(research, item['method'], snapshot, cache)
    except (HTTPException, PluginHostError, ValueError, OSError) as exc:
        current = False
        availability = {'status': 'unavailable', 'error': {
            'code': getattr(exc, 'code', 'METHOD_UNAVAILABLE'), 'message': str(exc)}}
    from .version_status import inspect
    version = inspect(research, snapshot, cache)
    return {'freshness': 'current' if current and version['status'] == 'current' else 'historical',
            'integrity': 'verified', 'version_status': version, 'method_availability': availability}


def summary(research, row, revision, study, cache, facts=None):
    facts = run_facts(research, row, cache) if facts is None else facts
    value = {name: row[name] for name in ('id', 'workspace', 'study', 'sequence', 'status', 'created', 'finished')}
    value.update(integrity=facts['integrity'], freshness='unknown', version_status=None,
                 snapshot={'module': facts['snapshot'].get('module')},
                 method=deepcopy(facts['method']), error=deepcopy(facts['error']),
                 task=facts['task'], driver=deepcopy(facts['driver']))
    value['headlines'] = deepcopy(facts['headlines']) if row['status'] in ('succeeded', 'partial') else []
    value['headline'] = facts['headline'] if row['status'] in ('succeeded', 'partial') else None
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
