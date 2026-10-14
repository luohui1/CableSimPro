"""Replay real saved job identities; corrupt only the private test copies."""
import json
from pathlib import Path
import shutil
import sqlite3

import pytest


def test_saved_job_receipts_detect_database_commit_and_plan_byte_change(tmp_path):
    from backend.kernel.workspace import WorkspaceStore
    from backend.kernel.research import Research
    from backend.kernel.batch_job_reads import study_identities, plan_identity
    source=Path('.data/release/engineering.sqlite').resolve()
    if not source.exists():pytest.skip('缺少真实发布库，不制造研究或超算记录。')
    database=tmp_path/'jobs.sqlite'
    with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as db,sqlite3.connect(database) as target:db.backup(target)
    service=Research(WorkspaceStore(database))
    try:
        with service.read_responses.lock:service.read_responses.initialize(True)
        first=study_identities(service)
        if not first:pytest.skip('真实发布库没有保存运行。')
        assert study_identities(service)==first
        # State changes are made in a disposable copy, never on the release DB.
        with service.store.db(True) as db:db.execute("UPDATE study_runs SET status='interrupted' WHERE id=?",(first[0]['id'],))
        second=study_identities(service)
        assert second[0]['status']=='interrupted'
        assert first[0]['status']!='interrupted'
        first[0]['method_identity']='caller mutation'
        assert study_identities(service)==second
        plans=list(service.executor.root.glob('*/plan.json'))
        if not plans:pytest.skip('缺少真实冻结超算计划，未编造计划。')
        destination=tmp_path/'plan.json';shutil.copyfile(plans[0],destination)
        original=plan_identity(destination)
        original['execution']={'mutated':True}
        assert plan_identity(destination).get('execution')!={'mutated':True}
        document=json.loads(destination.read_bytes());document['operation_id']='damaged saved binding'
        destination.write_text(json.dumps(document),'utf-8')
        assert plan_identity(destination)['operation_id']=='damaged saved binding'
        destination.write_bytes(b'{invalid')
        with pytest.raises(ValueError):plan_identity(destination)
    finally:service.close()
