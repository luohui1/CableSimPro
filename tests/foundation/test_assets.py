from concurrent.futures import ThreadPoolExecutor
import json
import pytest
from pydantic import ValidationError
from backend.foundation.assets import AssetError, AssetRepository
from backend.foundation.contracts import (AssetRelease, AssetRef, AssetParameter, Quantity,
    SourceReference, PayloadFile, CircularLayer, CircularRecipe, content_hash)


def definition(asset_id='material.test', version='1.0.0', **kwargs):
    base=dict(asset_id=asset_id, version=version, kind='material', name='测试材料（非厂家数据）',
              sources=(SourceReference(kind='project_input', reference='unit-test-fixture', reviewed=False),),
              parameters=(AssetParameter(name='k',quantity=Quantity(value=0.3,unit='W/(m.K)',dimension='thermal_conductivity')),))
    return AssetRelease(**(base | kwargs))


@pytest.fixture
def repo(tmp_path):
    store=AssetRepository(tmp_path/'assets.sqlite');store.initialize();return store


def change(repo, record, action, **kwargs):
    return repo.transition(record['id'],record['revision'],record['content_sha256'],action,
                           kwargs.get('note','人工核对测试说明'),kwargs.get('acknowledge_sources', True))


def publish(repo, release):
    a=repo.create(release);a=change(repo,a,'review');return change(repo,a,'publish')


def test_no_seed_data_reads_are_pure_and_definitions_survive_restart(repo):
    assert repo.list()['total']==0
    a=repo.create(definition());before=repo.get(a['id'])
    reopened=AssetRepository(repo.path);reopened.initialize()
    assert reopened.get(a['id'])==before
    assert before['status']=='draft' and before['revision']==1
    assert len(before['events'])==1 and before['authority']=='local_operator'
    assert not before['release']['sources'][0]['reviewed']


def test_review_publish_deprecate_never_changes_content_or_source_trust(repo):
    a=repo.create(definition());digest=a['content_sha256']
    a=change(repo,a,'review');assert a['status']=='reviewed'
    a=change(repo,a,'publish');assert a['status']=='published'
    a=change(repo,a,'deprecate');assert a['status']=='deprecated'
    assert a['revision']==4 and a['content_sha256']==digest
    assert not a['release']['sources'][0]['reviewed']
    assert [e['action'] for e in a['events']]==['deprecate','publish','review','created']


def test_review_requires_positive_ack_and_real_note(repo):
    a=repo.create(definition())
    with pytest.raises(AssetError,match='明确确认'):
        change(repo,a,'review',acknowledge_sources=False)
    with pytest.raises(AssetError,match='四个字符'):
        change(repo,a,'review',note='   ')
    assert repo.get(a['id'])==a


@pytest.mark.parametrize('action',['publish','deprecate','return_to_draft','run','approve'])
def test_draft_cannot_bypass_lifecycle(repo,action):
    a=repo.create(definition())
    with pytest.raises(AssetError) as e:change(repo,a,action)
    assert e.value.code=='ASSET_INVALID_TRANSITION'
    assert repo.get(a['id'])==a


def test_stale_revision_and_wrong_digest_leave_no_audit_event(repo):
    a=repo.create(definition());b=change(repo,a,'review')
    with pytest.raises(AssetError) as e:change(repo,a,'publish')
    assert e.value.status==409
    with pytest.raises(AssetError):
        repo.transition(a['id'],b['revision'],'b'*64,'publish','测试错误摘要')
    assert repo.get(a['id'])==b


def test_edit_requires_draft_and_preserves_identity(repo):
    a=repo.create(definition());edited=definition(name='新材料名称')
    b=repo.update(a['id'],1,edited)
    assert b['revision']==2 and b['content_sha256']!=a['content_sha256']
    for data in [definition(asset_id='other'),definition(version='2.0.0'),definition(kind='rule')]:
        with pytest.raises(AssetError):repo.update(b['id'],2,data)
    b=change(repo,b,'review')
    with pytest.raises(AssetError):repo.update(b['id'],b['revision'],edited)
    b=change(repo,b,'return_to_draft');assert b['reviewed_sha256'] is None
    b=repo.update(b['id'],b['revision'],definition(name='再次修改'))
    b=change(repo,b,'review');b=change(repo,b,'publish')
    with pytest.raises(AssetError):repo.update(b['id'],b['revision'],edited)


def test_derive_new_version_does_not_change_parent(repo):
    a=publish(repo,definition());old=repo.get(a['id'])
    b=repo.derive(a['id'],a['revision'],a['content_sha256'],'1.0.1')
    assert b['status']=='draft' and b['asset_id']==a['asset_id'] and b['version']=='1.0.1'
    assert b['content_sha256']!=a['content_sha256'] and repo.get(a['id'])==old
    with pytest.raises(AssetError):repo.derive(a['id'],a['revision'],a['content_sha256'],'1.0.1')
    with pytest.raises(ValidationError):repo.derive(a['id'],a['revision'],a['content_sha256'],'latest')


def test_draft_dependency_is_visible_but_cannot_be_reviewed(repo):
    dep=definition();repo.create(dep)
    parent=repo.create(definition(asset_id='assembly.test',kind='assembly',dependencies=(dep.reference(),)))
    assert parent['issues'][0]['code']=='ASSET_DEPENDENCY_NOT_PUBLISHED'
    with pytest.raises(AssetError):change(repo,parent,'review')


def test_missing_and_mismatched_dependencies_block(repo):
    dep=definition()
    missing=repo.create(definition(asset_id='assembly.missing',kind='assembly',dependencies=(dep.reference(),)))
    with pytest.raises(AssetError) as e:change(repo,missing,'review')
    assert e.value.code=='ASSET_DEPENDENCY_MISSING'
    publish(repo,dep)
    bad=AssetRef(asset_id=dep.asset_id,version=dep.version,content_sha256='b'*64)
    mismatch=repo.create(definition(asset_id='assembly.bad',kind='assembly',dependencies=(bad,)))
    with pytest.raises(AssetError) as e:change(repo,mismatch,'review')
    assert e.value.code=='ASSET_DEPENDENCY_DIGEST'


def test_dependency_deprecated_between_review_and_publish_is_rechecked(repo):
    dep=definition();d=publish(repo,dep)
    p=repo.create(definition(asset_id='assembly.test',kind='assembly',dependencies=(dep.reference(),)))
    p=change(repo,p,'review');change(repo,d,'deprecate')
    with pytest.raises(AssetError):change(repo,p,'publish')
    assert repo.get(p['id'])['status']=='reviewed'
    assert repo.get(d['id'])['content_sha256']==d['content_sha256']


def test_transitive_deprecation_blocks_new_release_without_rewriting_old_refs(repo):
    a=definition();ar=publish(repo,a)
    b=definition(asset_id='component.test',kind='component',dependencies=(a.reference(),));br=publish(repo,b)
    change(repo,ar,'deprecate')
    c=repo.create(definition(asset_id='assembly.test',kind='assembly',dependencies=(b.reference(),)))
    with pytest.raises(AssetError):change(repo,c,'review')
    assert repo.get(br['id'])['status']=='published'
    assert repo.get(br['id'])['release']['dependencies'][0]['content_sha256']==ar['content_sha256']


def test_duplicate_or_payload_manifest_does_not_silently_overwrite(repo):
    a=repo.create(definition())
    with pytest.raises(AssetError):repo.create(definition(name='cannot overwrite'))
    assert repo.get(a['id'])==a
    with pytest.raises(AssetError):
        repo.create(definition(asset_id='payload.asset',files=(PayloadFile(path='file.step',sha256='a'*64,size_bytes=1),)))
    assert repo.list()['total']==1


def test_geometry_is_part_of_asset_content_identity(repo):
    recipe=CircularRecipe(length_m=1.0,layers=(CircularLayer(uid='core',role='conductor',inner_radius_m=0.0,outer_radius_m=.01),))
    a=definition(kind='assembly',geometry_recipe=recipe)
    assert repo.create(a)['release']['geometry_recipe']['layers'][0]['uid']=='core'
    assert content_hash(a)!=content_hash(definition(kind='assembly'))
    with pytest.raises(ValidationError):definition(kind='material',geometry_recipe=recipe)


def test_search_pagination_and_literal_wildcards(repo):
    repo.create(definition(name='Cu_100%'))
    repo.create(definition(asset_id='b',name='Other',kind='rule'))
    assert repo.list(query='%')['total']==1
    assert repo.list(query='_')['total']==1
    assert repo.list(query="' OR 1=1 --")['total']==0
    assert repo.list(kind='rule')['total']==1
    assert repo.list(limit=1)['counts']=={'material':1,'rule':1}
    assert len(repo.list(limit=1,offset=1)['items'])==1


def test_concurrent_review_has_one_winner_and_one_atomic_conflict(repo):
    a=repo.create(definition())
    def try_review(_):
        try:return change(repo,a,'review')['status']
        except AssetError as e:return e.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes=list(pool.map(try_review,range(2)))
    assert sorted(outcomes)==['ASSET_REVISION_CONFLICT','reviewed']
    assert len(repo.get(a['id'])['events'])==2


def test_corrupt_content_is_rejected_not_rehashed_as_trusted(repo):
    a=repo.create(definition())
    with repo.db(True) as db:
        bad=definition(name='tampered').model_dump_json()
        db.execute('UPDATE engineering_assets SET release_json=? WHERE id=?',(bad,a['id']))
    with pytest.raises(AssetError) as e:repo.get(a['id'])
    assert e.value.code=='ASSET_CONTENT_CORRUPT'
    with pytest.raises(AssetError):change(repo,a,'review')
