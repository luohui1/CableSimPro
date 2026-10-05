"""Study-only undo/redo; saved runs and workspace structure never move."""
import json
from uuid import UUID
from fastapi import HTTPException
from pydantic import Field
from ..schemas import StrictModel
from .workspace import fingerprint, stamp


class StudyHistoryRequest(StrictModel):
    expected_revision: int = Field(ge=1, description='Workspace revision; no unit. Structure is not changed.')
    expected_study_revision: int = Field(ge=1, description='Current study revision; restores create a new monotonic revision.')
    request_id: UUID = Field(description='Idempotency key; retries with the same body return the original restore.')


def initialize(db):
    db.executescript('''
        CREATE TABLE IF NOT EXISTS study_history(study TEXT,position INTEGER,version INTEGER,PRIMARY KEY(study,position));
        CREATE TABLE IF NOT EXISTS study_history_cursor(study TEXT PRIMARY KEY,position INTEGER);
        CREATE TABLE IF NOT EXISTS study_history_requests(study TEXT,request TEXT,digest TEXT,result TEXT,PRIMARY KEY(study,request));
    ''')
    for row in db.execute('SELECT id FROM studies WHERE id NOT IN (SELECT study FROM study_history_cursor)').fetchall():
        versions=db.execute('SELECT revision FROM study_versions WHERE study=? ORDER BY revision',(row['id'],)).fetchall()
        for pos,version in enumerate(versions,1):
            db.execute('INSERT INTO study_history VALUES(?,?,?)',(row['id'],pos,version['revision']))
        db.execute('INSERT INTO study_history_cursor VALUES(?,?)',(row['id'],len(versions)))


def record(db,sid,revision):
    row=db.execute('SELECT position FROM study_history_cursor WHERE study=?',(sid,)).fetchone()
    position=row['position'] if row else 0
    db.execute('DELETE FROM study_history WHERE study=? AND position>?',(sid,position))
    db.execute('INSERT INTO study_history VALUES(?,?,?)',(sid,position+1,revision))
    db.execute('INSERT OR REPLACE INTO study_history_cursor VALUES(?,?)',(sid,position+1))


def state(db,sid):
    row=db.execute('SELECT position FROM study_history_cursor WHERE study=?',(sid,)).fetchone()
    maximum=db.execute('SELECT MAX(position) FROM study_history WHERE study=?',(sid,)).fetchone()[0] or 0
    position=row['position'] if row else 0
    return {'can_undo':position>1,'can_redo':position<maximum}


def restore(research,wid,sid,direction,body):
    identity=fingerprint({'direction':direction,**body.model_dump(mode='json')})
    def conflict(code,message):raise HTTPException(409,{'code':code,'message':message})
    with research.store.db(True) as db:
        prior=db.execute('SELECT * FROM study_history_requests WHERE study=? AND request=?',(sid,str(body.request_id))).fetchone()
        # Ownership is checked even for a replay.
        current=research.definition(db,wid,sid)
        if prior:
            if prior['digest']!=identity:conflict('REQUEST_CONFLICT','该请求标识已用于不同撤销/重做操作。')
            return json.loads(prior['result'])
        row,_=research.store.load(db,wid,body.expected_revision,allow_domain=True)
        research.store.assert_mutable(db,wid)
        if current['revision']!=body.expected_study_revision:conflict('STUDY_REVISION_CONFLICT','研究已被更新，请刷新后再撤销或重做。')
        cursor=db.execute('SELECT position FROM study_history_cursor WHERE study=?',(sid,)).fetchone()['position']
        position=cursor+(-1 if direction=='undo' else 1)
        target=db.execute('SELECT version FROM study_history WHERE study=? AND position=?',(sid,position)).fetchone()
        if target is None:conflict('STUDY_HISTORY_BOUNDARY','没有可撤销或重做的研究配置。')
        definition=db.execute('SELECT definition FROM study_versions WHERE study=? AND revision=?',(sid,target['version'])).fetchone()['definition']
        revision=current['revision']+1
        db.execute('INSERT INTO study_versions VALUES(?,?,?,?)',(sid,revision,definition,stamp()))
        db.execute('UPDATE studies SET revision=? WHERE id=?',(revision,sid))
        db.execute('UPDATE study_history_cursor SET position=? WHERE study=?',(position,sid))
        research.store.audit(db,wid,row['revision'],'撤销研究' if direction=='undo' else '重做研究',sid)
        result=research.definition(db,wid,sid)
        db.execute('INSERT INTO study_history_requests VALUES(?,?,?,?)',(sid,str(body.request_id),identity,json.dumps(result,ensure_ascii=False)))
        return result
