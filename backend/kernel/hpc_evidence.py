"""Offline import of byte-preserved, accepted engineering runs. Never a solver.

The sealed index binds every archive and member. The payloads retain canonical
snapshot/output bytes, including full-field shards; no results are regenerated.
"""
from hashlib import sha256
import json
import lzma
import os
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[2]
PLUGIN = ROOT/'plugins/cablesim.simulation'
INDEX = PLUGIN/'assets/engineering-evidence-index.json'
WITNESS = PLUGIN/'validation/engineering-evidence.sha256'
TABLES = {
    'workspaces': 'id', 'studies': 'id', 'study_versions': None,
    'workspace_revisions': None, 'workspace_history': None,
    'hpc_convergence': 'id', 'deliveries': 'id', 'delivery_requests': None,
    'study_runs': 'id',
}


def checksum(path):
    result = sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''): result.update(block)
    return result.hexdigest()


def evidence_index():
    """Small authenticated receipt, also used for saved scheduler provenance."""
    raw = INDEX.read_bytes()
    expected = WITNESS.read_text('ascii').strip()
    if len(raw) > 1024*1024 or sha256(raw).hexdigest() != expected:
        raise ValueError('随附超算实算证据索引摘要不一致；停止导入。')
    value = json.loads(raw)
    from jsonschema import Draft202012Validator
    schema = json.loads((INDEX.parent/'engineering-evidence-schema.json').read_text('utf-8'))
    Draft202012Validator(schema).validate(value)
    names = [entry['path'] for entry in value['archives']]
    members = [entry['name'] for entry in value['members']]
    if len(set(names)) != len(names) or len(set(members)) != len(members):
        raise ValueError('随附证据包含重复文件身份。')
    return value, expected


def evidence_directory():
    """Large accepted payloads are local deployment data, never plugin assets."""
    configured = os.environ.get('CABLESIM_ENGINEERING_EVIDENCE', '').strip()
    return (Path(configured).expanduser() if configured else ROOT/'.data/simulation/engineering-evidence').resolve()


def archive_path(entry):
    # Schema permits only fixed basenames, optionally under chengnan/. Keep
    # separately accepted bundles independent without a plugin-directory fallback.
    return evidence_directory()/entry['path'].removeprefix('validation/engineering-evidence/')


def scoped_index(value, scope):
    if scope not in ('primary','chengnan'): raise ValueError('不支持的实算证据范围。')
    supplementary=scope=='chengnan'
    archives=[a for a in value['archives'] if ('/chengnan/' in a['path'])==supplementary]
    names={a['path'] for a in archives}
    receipts=value.get('supplementary_receipts',[]) if supplementary else [value['receipt']]
    if len(receipts)!=1 or not archives:
        raise FileNotFoundError('尚未封存城南有限元实算证据。' if supplementary else '尚未封存有限元实算证据。')
    return {**value,'archives':archives,'members':[m for m in value['members'] if m['archive'] in names], 'receipt':receipts[0]}


def evidence_availability(*, verify=False, scope='primary'):
    """Report presence without preparing inputs or submitting a solver job.

    With verify=True, reject damaged present files even in an incomplete set.
    Missing files are an optional deployment resource, not fabricated results.
    """
    value, identity = evidence_index()
    try: value=scoped_index(value,scope)
    except FileNotFoundError as exc:
        return {'available':False,'verified':False,'directory':str(evidence_directory()/'chengnan'),
                'snapshot_id':identity,'missing':[],'message':str(exc)}
    missing = []
    for entry in value['archives']:
        path = archive_path(entry)
        if not path.is_file():
            missing.append({'file':path.name, 'destination':str(path),
                            'size':entry['size'], 'sha256':entry['sha256']})
        elif verify and (path.stat().st_size != entry['size'] or checksum(path) != entry['sha256']):
            raise ValueError(f'超算实算证据包长度或摘要不一致：{path.name}；位置：{path}；索引摘要：{identity}。停止导入，请取得与索引一致的证据包。')
    message = ('超算实算证据包齐全。' if not missing else
        '超算实算证据包缺失：'+'；'.join(f'{item["file"]}，请放到 {item["destination"]}' for item in missing)+f'；索引摘要：{identity}。输入齐全，等待超算提交。')
    return {'available':not missing, 'verified':verify and not missing,
            'directory':str(evidence_directory()), 'snapshot_id':identity,
            'missing':missing, 'message':message}


def verify_archives(*, scope='primary'):
    status = evidence_availability(verify=True,scope=scope)
    if not status['available']: raise FileNotFoundError(status['message'])
    value, identity = evidence_index()
    value=scoped_index(value,scope)
    if identity != status['snapshot_id']: raise ValueError('核验期间超算证据索引已更新；停止导入。')
    return value, identity


def saved_execution(operation, plugin_id, capability, phase='run'):
    if phase != 'run' or not INDEX.exists(): return None
    value, identity = evidence_index()
    result = value['executions'].get(operation)
    if not result or result['plugin_id'] != plugin_id or result['capability'] != capability: return None
    return {**result['execution'], 'saved_evidence': True, 'evidence_snapshot': identity,
            'evidence_label': '超算实算结果', 'partition': 'dg83'}


def import_evidence(store, expected_identity, *, scope='primary'):
    """One database transaction; exact bytes and immutable original identities.

    SQLite incremental BLOB I/O keeps large JSON out of Python strings during
    restoration; CAST changes storage type to TEXT after verification. Archives
    are streamed sequentially with a bounded 80 MiB XZ dictionary.
    """
    value, identity = verify_archives(scope=scope)
    if identity != expected_identity: raise ValueError('生成期间超算证据已更新；停止导入。')
    with store.db(True) as db:
        db.execute('CREATE TABLE IF NOT EXISTS hpc_convergence (id TEXT PRIMARY KEY,request_id TEXT UNIQUE,request_digest TEXT,state TEXT)')
        db.execute('CREATE TABLE IF NOT EXISTS bundled_engineering_evidence (snapshot TEXT PRIMARY KEY,receipt TEXT NOT NULL)')
        import_key=identity if scope=='primary' else identity+':'+scope
        existing = db.execute('SELECT receipt FROM bundled_engineering_evidence WHERE snapshot=?', (import_key,)).fetchone()
        if existing: return json.loads(existing[0])
        expected = {entry['name']: entry for entry in value['members']}
        seen = set()
        for archive in value['archives']:
            with lzma.open(archive_path(archive), 'rb') as compressed, tarfile.open(fileobj=compressed, mode='r|') as bundle:
                for member in bundle:
                    entry = expected.get(member.name)
                    if not entry or entry['archive'] != archive['path'] or member.name in seen or not member.isfile() or member.size != entry['size']:
                        raise ValueError('随附证据文件清单或长度不一致。')
                    seen.add(member.name)
                    stream = bundle.extractfile(member)
                    if entry['kind'] == 'record':
                        if member.size > 8*1024*1024: raise ValueError('随附证据记录超过容量。')
                        raw = stream.read()
                        if sha256(raw).hexdigest() != entry['sha256']: raise ValueError('随附证据记录摘要不一致。')
                        row = json.loads(raw); table = entry['table']
                        if table not in TABLES: raise ValueError('随附证据表不受支持。')
                        columns = {info['name'] for info in db.execute('PRAGMA table_info('+table+')')}
                        if not row or not set(row) <= columns: raise ValueError('随附证据记录字段不受支持。')
                        # The convergence receipt binds the original sequence too.
                        # Import before fresh seed computations reserve these IDs;
                        # never silently renumber or overwrite a different run.
                        if table == 'study_runs' and db.execute('SELECT 1 FROM study_runs WHERE sequence=?',(row['sequence'],)).fetchone():
                            raise ValueError('随附运行序号已被占用；请在首次种子计算前导入，未覆盖现有运行。')
                        names = list(row)
                        db.execute('INSERT INTO '+table+'('+','.join(names)+') VALUES ('+','.join('?' for _ in names)+')', tuple(row.values()))
                    else:
                        column = entry['column']; identifier = entry['run_id']
                        if column not in ('snapshot','output') or member.size > 100*1024*1024: raise ValueError('随附运行容量或字段不受支持。')
                        db.execute('UPDATE study_runs SET '+column+'=zeroblob(?) WHERE id=?', (member.size, identifier))
                        rowid = db.execute('SELECT rowid FROM study_runs WHERE id=?', (identifier,)).fetchone()[0]
                        digest = sha256()
                        with db.blobopen('study_runs', column, rowid) as target:
                            for block in iter(lambda: stream.read(1024*1024), b''):
                                target.write(block); digest.update(block)
                        if digest.hexdigest() != entry['sha256']: raise ValueError('随附运行原文摘要不一致。')
                        digest_column = 'input_digest' if column == 'snapshot' else 'output_digest'
                        stored = db.execute('SELECT '+digest_column+' FROM study_runs WHERE id=?', (identifier,)).fetchone()[0]
                        if stored != entry['sha256']: raise ValueError('随附运行摘要与封存身份不同。')
                        db.execute('UPDATE study_runs SET '+column+'=CAST('+column+' AS TEXT) WHERE id=?', (identifier,))
        if seen != set(expected): raise ValueError('随附证据缺少文件；导入已撤回。')
        receipt = {**value['receipt'], 'snapshot_id': identity, 'kind':'saved_evidence'}
        db.execute('INSERT INTO bundled_engineering_evidence VALUES (?,?)', (import_key,json.dumps(receipt,ensure_ascii=False)))
        store.audit(db,receipt['workspace'],value['workspace_revision'],'导入超算实算结果',identity)
    return receipt
