"""Saved-release proof, never version-number heuristics or output recomputation."""
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.kernel.method_identity import classify, computation_identity, historical_manifests, current_for_read
from backend.kernel.workspace import fingerprint
from backend.plugin_host import Registry
from backend.plugin_host.manifest import Manifest
from backend.plugin_host.registry import Plugin
from test_research import client, study, request


def pin(manifest):
    return {'plugin_id':manifest['id'],'version':manifest['version'],'release_digest':fingerprint(manifest),'capability':'steady-rating'}


@pytest.mark.parametrize('change,expected', [('description','presentation_only'),('source','calculation_changed'),('method_version','calculation_changed')])
def test_changes_compare_sealed_content_not_patch_versions(change, expected):
    old = deepcopy(next(iter(historical_manifests().values())))
    new = deepcopy(old)
    new['version'] = '1.1.2'
    if change == 'description':
        new['description'] += '说明已更新。'
        new['capabilities'][1]['description'] += '中文说明。'
        new['capabilities'][1]['parameter_schema']['description'] = '参数说明'
    elif change == 'source':
        next(row for row in new['files'] if row['path'].endswith('/method.py'))['sha256'] = '1'*64
    else:
        next(row for row in new['capabilities'] if row['id']=='steady-rating')['method_version'] = '9.0.0'
    proof = classify(pin(old), pin(new), old, new)
    assert proof['classification'] == expected
    assert proof['rule'] == 'sealed-computation-and-contract/2'
    assert (proof['from_computation_digest']==proof['to_computation_digest']) == (expected=='presentation_only')
    assert classify(pin(old),pin(new),None,new)['classification']=='unproven'
    tampered=deepcopy(old);tampered['description']+='tampered'
    assert classify(pin(old),pin(new),tampered,new)['classification']=='unproven'
    assert classify({**pin(old),'version':'0.0.0'},pin(new),old,new)['classification']=='unproven'


def test_read_presentation_update_keeps_saved_output_and_summary_task(client, monkeypatch):
    w,s=study(client);root,body=request(client,w,s)
    saved=client.post(root+'/runs',json=body).json()
    assert saved['status']=='succeeded',saved
    service=client.app.state.research
    old_plugin=service.registry('cablesim.iec60287').get('cablesim.iec60287')
    raw=old_plugin.manifest.model_dump(mode='json',by_alias=True)
    raw['description']+='只改说明的测试。';raw['version']='1.1.99'
    plugin=Plugin(old_plugin.directory,Manifest.model_validate(raw))
    monkeypatch.setattr(service,'registry',lambda *_:SimpleNamespace(get=lambda _:plugin))
    monkeypatch.setattr(service.executor,'run',lambda *a,**kw:pytest.fail('saved reads must not compute'))
    summary=client.get(root+'/runs?view=summary').json()['items'][-1]
    detail=client.get(root+'/runs/'+saved['id']+'?view=full').json()
    assert summary['freshness']==detail['freshness']=='current'
    assert summary['version_status']['reasons']==[]
    notice=summary['version_status']['notices'][0]
    assert notice['code']=='METHOD_PRESENTATION_UPDATED'
    assert notice['from_digest']==saved['snapshot']['definition']['method']['release_digest']
    assert notice['to_digest']==service.pin(plugin)['release_digest']
    assert detail['output_digest']==saved['output_digest'] and detail['snapshot']==saved['snapshot']
    assert summary['task']==saved['snapshot']['definition']['task']
    assert summary['driver']==saved['snapshot']['definition']['driver']
    assert '允许电流' in summary['headline'] and 'A' in summary['headline']
    assert summary['headline']==saved['output']['cases'][0]['evidence']['headline']
    # A corrupt current seal cannot be cleared by identical computation identity.
    from backend.plugin_host import PluginHostError
    monkeypatch.setattr(plugin,'verify',lambda:(_ for _ in ()).throw(PluginHostError('PLUGIN_SEAL_INVALID','broken',409)))
    with pytest.raises(PluginHostError):
        current_for_read(service,saved['snapshot']['definition']['method'],saved['snapshot'],{})


def test_legacy_evidence_exact_digest_only():
    from backend.kernel.method_identity import saved_manifest
    digest,manifest=next(iter(historical_manifests().items()))
    assert fingerprint(manifest)==digest
    assert saved_manifest({},digest)==manifest
    assert saved_manifest({},'0'*64) is None
    assert saved_manifest({'method_manifests':None},'0'*64) is None
    # Unit/default/unknown executable metadata is deliberately not ignored.
    changed=deepcopy(manifest);changed['runtime']['entry']+='-changed'
    assert computation_identity(changed,'steady-rating')!=computation_identity(manifest,'steady-rating')
    from backend.kernel.method_identity import schema_identity
    assert schema_identity({'default':{'description':'input value'},'properties':{'title':{'description':'label','default':1}}}) == {'default':{'description':'input value'},'properties':{'title':{'default':1}}}


def test_saved_engineering_job_is_not_invalidated_by_evidence_catalogue():
    """Real job 811855, frozen before its evidence catalogue was appended.

    No solver or output substitute: authenticate the actual saved input. Isolate
    catalogue changes from later solver releases; a current release with new
    calculations must not be assumed presentation-only. The manifest mutations
    below exercise publication/diagnostic rules, never create engineering output.
    """
    import json
    from pathlib import Path
    import sqlite3
    database = Path('.data/fix-round/simulation-transient/current-fem/workspace.sqlite')
    if not database.exists():
        pytest.skip('作业 811855 的真实保存库未提供；不制造有限元结果')
    from contextlib import closing
    with closing(sqlite3.connect(f'file:{database.resolve().as_posix()}?mode=ro', uri=True)) as db:
        row = db.execute('SELECT snapshot,input_digest FROM study_runs WHERE id=?',
                         ('00c54351-4a2c-49f5-bf88-7e86e6a9615f',)).fetchone()
    if row is None:
        pytest.skip('真实保存库未包含作业 811855 的运行')
    snapshot = json.loads(row[0])
    assert fingerprint(snapshot) == row[1]
    old = snapshot['definition']['method']
    manifest = snapshot['method_manifests'][old['release_digest']]
    plugin = Registry(Path('plugins'), plugin_id=old['plugin_id']).get(old['plugin_id'])
    current = plugin.manifest.model_dump(mode='json', by_alias=True)
    current_pin = {'plugin_id': current['id'], 'version': current['version'],
                   'release_digest': fingerprint(current), 'capability': old['capability']}
    before = next(cap for cap in manifest['capabilities'] if cap['id']==old['capability'])
    after = next(cap for cap in current['capabilities'] if cap['id']==old['capability'])
    if before['method_version'] != after['method_version']:
        assert classify(old,current_pin,manifest,current)['classification']=='calculation_changed'
    # Only the two real catalogue receipts change in this diagnostic comparison.
    # Preserve the frozen method, source/dependency receipts and all unknown data.
    catalogue = deepcopy(manifest)
    from backend.kernel.method_identity import EVIDENCE_ASSETS
    actual = {item['path']:item for item in current['files']}
    for item in catalogue['files']:
        if item['path'] in EVIDENCE_ASSETS:
            item.update({key:actual[item['path']][key] for key in ('sha256','size_bytes')})
    new = {**old,'release_digest':fingerprint(catalogue)}
    proof = classify(old, new, manifest, catalogue)
    assert proof['classification'] == 'presentation_only', proof
    assert proof['from_computation_digest'] == proof['to_computation_digest']
    assert {item['path'] for item in proof['non_computation_asset_changes']} == {
        'assets/engineering-evidence-index.json', 'assets/engineering-evidence-schema.json'}
    for change in ('source', 'method', 'unknown_file_metadata'):
        changed = deepcopy(catalogue)
        if change == 'source':
            next(item for item in changed['files'] if item['path'].endswith('/main.py'))['sha256'] = '0'*64
        elif change == 'method':
            next(item for item in changed['capabilities'] if item['id'] == old['capability'])['method_version'] = '99.0.0'
        else:
            next(item for item in changed['files'] if item['path'].endswith('engineering-evidence-index.json'))['unrecognized'] = True
        altered = {**new, 'release_digest': fingerprint(changed)}
        assert classify(old, altered, manifest, changed)['classification'] == 'calculation_changed'
