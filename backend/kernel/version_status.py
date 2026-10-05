"""Compare immutable run references with installed methods and published models."""
from copy import deepcopy
import json

from fastapi import HTTPException
from ..plugin_host import PluginHostError
from .workspace import fingerprint


def summarize(reasons):
    unique = {fingerprint(r): r for r in reasons}
    reasons = list(unique.values())
    return {'status': 'stale' if reasons else 'current', 'reasons': reasons,
            'display_name': '；'.join(r['message'] for r in reasons) if reasons else '当前版本'}


def latest_model(db, reference):
    """Use stable system ID or published family; never guess identity from a name."""
    from .scenarios import system_models, METHOD_DEFAULTS
    model = next((m for m in system_models() if m['id'] == reference['id']), None)
    if model:
        return model
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {'engineering_type_releases', 'engineering_assets'} <= tables:
        return None
    row = db.execute("SELECT a.version,a.content_sha256,t.payload,t.digest,t.workspace FROM engineering_type_releases t "
                     "JOIN engineering_assets a ON a.id=t.asset WHERE t.family=? AND a.status='published' "
                     "ORDER BY t.sequence DESC LIMIT 1", (reference['id'],)).fetchone()
    if row is None:
        return None
    payload = json.loads(row['payload'])
    if fingerprint(payload) != row['digest']:
        raise HTTPException(409, {'code': 'MODEL_INTEGRITY_ERROR', 'message': '最新发布型号摘要不一致，请核对型号库。'})
    cable = payload['document']['cable_types'][0]
    used = {c['conductor']['material'] for c in cable['cores']} | {l['material'] for l in cable['common_layers']} | {
        l['material'] for c in cable['cores'] for l in c['layers']}
    return {'id': reference['id'], 'version': row['version'], 'content_sha256': row['content_sha256'],
            'name': payload['name'], 'state': 'reviewed', 'source': 'published_type',
            'published_workspace': row['workspace'],
            'payload': {'cable_type': cable, 'materials': [m for m in payload['document']['materials'] if m['id'] in used]},
            'method_defaults': deepcopy(METHOD_DEFAULTS)}


def model_reason(old, new):
    if new and (old['version'], old['content_sha256']) != (new['version'], new['content_sha256']):
        return {'kind': 'model', 'code': 'MODEL_VERSION_CHANGED', 'id': old['id'],
                'from_version': old['version'], 'to_version': new['version'],
                'from_digest': old['content_sha256'], 'to_digest': new['content_sha256'],
                'message': f"基于旧版本型号 {old['version']}（{old.get('name', old['id'])}）；当前版本 {new['version']}"}


def methods(definition):
    yield definition['method']
    for item in definition.get('crosschecks', []):
        yield item['method']
    for item in definition.get('candidate_completions', {}).values():
        yield item['method']


def inspect(research, snapshot, cache=None):
    reasons = []
    cache = {} if cache is None else cache
    pins = cache.setdefault('version_pins', {})
    for old in methods(snapshot['definition']):
        pid = old['plugin_id']
        try:
            if pid not in pins:
                pins[pid] = research.pin(research.registry(pid).get(pid))
            new = pins[pid]
            if (old['version'], old['release_digest']) == (new['version'], new['release_digest']):
                continue
            reasons.append({'kind': 'method', 'code': 'METHOD_VERSION_CHANGED', 'id': pid,
                            'from_version': old['version'], 'to_version': new['version'],
                            'from_digest': old['release_digest'], 'to_digest': new['release_digest'],
                            'message': f"基于旧版本方法 {old['version']}（{pid}）；当前安装版本 {new['version']}" +
                                       ('（同版本号发行摘要已变化）' if old['version']==new['version'] else '')})
        except (HTTPException, PluginHostError, ValueError, OSError) as exc:
            reasons.append({'kind': 'method', 'code': 'METHOD_UNAVAILABLE', 'id': pid,
                            'from_version': old['version'], 'to_version': None,
                            'from_digest': old['release_digest'], 'to_digest': None,
                            'message': f"方法 {pid} {old['version']} 当前不可用：{exc}"})
    # A standalone method input is explicitly independent of the workspace model.
    if snapshot['definition'].get('input_source') == 'domain':
        state = snapshot['workspace_state']
        old = state.get('study_cable_reference') or state.get('type_origin_reference')
        if old:
            with research.store.db() as db:
                latest = latest_model(db, old)
                # A release's own runs retain their parent lineage, not a stale
                # external binding to the version they themselves just published.
                own_release = latest and latest.get('published_workspace') == snapshot.get('workspace_id')
                reason = None if own_release and not state.get('study_cable_reference') else model_reason(old, latest)
            if reason:
                reasons.append(reason)
    return summarize(reasons)


def cover_status(runs):
    return summarize([reason for run in runs for reason in run.get('version_status', {}).get('reasons', [])])
