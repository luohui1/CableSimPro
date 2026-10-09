"""Verified display cache must not hide corruption, mutations or live state."""
from contextlib import contextmanager
from types import SimpleNamespace
import sqlite3
import pytest
from fastapi import HTTPException
from backend.kernel.batch_field_projection import read_display
from backend.kernel.research import encode
from backend.kernel.workspace import fingerprint


def test_cached_projection_isolated_and_real_bytes_rechecked(tmp_path,monkeypatch):
    path=tmp_path/'database.sqlite'
    @contextmanager
    def database():
        db=sqlite3.connect(path);db.row_factory=sqlite3.Row
        try:yield db;db.commit()
        finally:db.close()
    snapshot={'definition':{'method':{}},'cases':[]}
    output={'cases':[{'artifacts':{'x-cablesim.summary':{'temperature_k':320}}}]}
    with database() as db:
        db.execute('CREATE TABLE workspaces(id,revision)');db.execute("INSERT INTO workspaces VALUES ('w',1)")
        db.execute('CREATE TABLE study_runs(id,workspace,study,sequence,status,created,finished,input_digest,output_digest,snapshot,output,error)')
        db.execute('INSERT INTO study_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',('r','w','s',1,'succeeded','now','now',fingerprint(snapshot),fingerprint(output),encode(snapshot),encode(output),None))
    class Reader:
        store=SimpleNamespace(db=database);executor=SimpleNamespace();checks=0
        def artifact_status(self,run):self.checks+=1;return {}
        def definition(self,*args):return {}
        def get_run(self,*args):return {'integrity':'corrupt'}
    reader=Reader()
    monkeypatch.setattr('backend.kernel.batch_field_projection.run_state',lambda reader,snapshot,wid,revision,*args:{'integrity':'verified','freshness':'current' if revision==1 else 'historical'})
    first=read_display(reader,'w','r');first['output']['cases'][0]['artifacts'].clear()
    second=read_display(reader,'w','r')
    assert reader.checks==1 and second['output']['cases'][0]['artifacts']['x-cablesim.summary']['temperature_k']==320
    with database() as db:
        db.execute("UPDATE workspaces SET revision=2 WHERE id='w'")
        db.execute("UPDATE study_runs SET status='failed'")
    third=read_display(reader,'w','r')
    assert third['freshness']=='historical' and third['status']=='failed'
    with database() as db:db.execute("UPDATE study_runs SET output=replace(output,'320','321')")
    with pytest.raises(HTTPException) as caught:read_display(reader,'w','r')
    assert caught.value.status_code==409
