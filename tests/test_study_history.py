"""Study history is independent, revisioned, branching and idempotent."""
from copy import deepcopy
from uuid import uuid4
from test_design_studies import client,workspace,saved_study


def test_undo_redo_preserve_workspace_and_branch_history(client):
    w=workspace(client);s=saved_study(client,w,'cablesim.iec60287')
    root=f"/api/workspaces/{w['id']}/studies/{s['id']}"
    before=client.get(f"/api/workspaces/{w['id']}").json()['domain']
    d=deepcopy(s['definition']);d['title']='Changed'
    updated=client.put(root,json={**d,'expected_revision':w['revision'],'expected_study_revision':s['revision']})
    assert updated.status_code==200,updated.text
    assert updated.json()['can_undo']
    body={'expected_revision':w['revision'],'expected_study_revision':2,'request_id':str(uuid4())}
    undo=client.post(root+'/undo',json=body);assert undo.status_code==200,undo.text
    assert undo.json()['revision']==3 and undo.json()['definition']==s['definition'] and undo.json()['can_redo']
    assert client.post(root+'/undo',json=body).json()==undo.json()
    body['request_id']=str(uuid4())
    assert client.post(root+'/redo',json=body).status_code==409
    body['expected_study_revision']=3
    redo=client.post(root+'/redo',json=body);assert redo.status_code==200,redo.text
    assert redo.json()['revision']==4 and redo.json()['definition']==d
    undo=client.post(root+'/undo',json={**body,'expected_study_revision':4,'request_id':str(uuid4())}).json()
    d['title']='New branch'
    saved=client.put(root,json={**d,'expected_revision':w['revision'],'expected_study_revision':5})
    assert saved.status_code==200 and saved.json()['revision']==6 and not saved.json()['can_redo']
    assert client.get(f"/api/workspaces/{w['id']}").json()['domain']==before
