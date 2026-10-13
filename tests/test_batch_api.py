"""Lightweight batch configuration validation; native execution runs on Slurm."""
import json
from fastapi.testclient import TestClient
from backend.main import create_app
from test_research import study,request


def configuration(w,s):
    return {'expected_revision':w['revision'],'expected_study_revision':s['revision'],
        'expected_configuration_revision':0,'source_module':None,
        'parameter_space':{'sampling':'latin_hypercube','sample_count':3,'seed':7,'source':'Explicit study sensitivity range',
            'axes':[{'name':'depth','label':'埋深坐标 z','unit':'m','minimum':-.9,'maximum':-.7,'source':'Engineering sensitivity; negative z means depth below ground',
                     'bindings':[{'pointer':f'/input/sections/0/placements/{i}/z','target_unit':'m'} for i in range(3)]}]},
        'execution':{'backend':'local','workers':2,'sample_timeout_s':30,'slurm_wall_seconds':60}}


def test_invalid_axis_and_configuration_conflict_preserve_saved_data(tmp_path):
    with TestClient(create_app(tmp_path/'workspace.sqlite')) as client:
        w,s=study(client);root,_=request(client,w,s);body=configuration(w,s)
        invalid=json.loads(json.dumps(body));invalid['parameter_space']['axes'][0]['unit']='mm'
        assert client.put(root+'/batch-configuration',json=invalid).status_code==422
        invalid=json.loads(json.dumps(body));invalid['parameter_space']['axes'][0]['bindings'][0]['pointer']='/input/missing'
        assert client.put(root+'/batch-configuration',json=invalid).status_code==422
        assert client.put(root+'/batch-configuration',json=body).status_code==200
        assert client.put(root+'/batch-configuration',json=body).status_code==409
        current=client.get(root+'/batch-configuration').json()
        assert current['configuration']['revision']==1
        assert current['configuration']['definition']['parameter_space']['sample_count']==3
        assert client.get(root+'/datasets').json()==[]


def test_shutdown_waits_for_worker_to_finish_saved_state(tmp_path):
    """A real SQLite writer must finish before the host deletes its private DB."""
    import sqlite3
    import threading
    from contextlib import closing
    from types import SimpleNamespace
    from backend.kernel.batch_service import Batches
    from fastapi import HTTPException
    import pytest
    database=tmp_path/'closing.sqlite'
    service=Batches(SimpleNamespace(store=SimpleNamespace(path=database),owner_epoch='closing'))
    opened=threading.Event();finished=threading.Event();failures=[]
    def save_last_state():
        try:
            with closing(sqlite3.connect(database)) as db, db:
                db.execute('CREATE TABLE saved_status(status TEXT)')
                opened.set()
                assert service.shutdown_event.wait(5)
                db.execute("INSERT INTO saved_status VALUES ('interrupted')")
            finished.set()
        except BaseException as exc:failures.append(exc)
    worker=threading.Thread(target=save_last_state)
    service.threads['closing']=worker;worker.start()
    try:
        assert opened.wait(5)
        service.close()
        assert finished.is_set() and not worker.is_alive() and not failures
        with closing(sqlite3.connect(database)) as db:assert db.execute('SELECT status FROM saved_status').fetchone()[0]=='interrupted'
        with pytest.raises(HTTPException) as error:service.start('late')
        assert error.value.status_code==503
        database.unlink();assert not database.exists()
    finally:
        service.shutdown_event.set();worker.join(5)
