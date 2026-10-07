"""Consistent SQLite snapshots and restore at the next exclusive host startup."""
from contextlib import closing
from hashlib import sha256
import json
import os
from pathlib import Path
import sqlite3
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from fastapi.routing import APIRoute
from pydantic import Field, JsonValue
from backend.schemas import StrictModel
from .ownership import OwnerLock

SCHEMA_VERSION = 2


def fail(code, message, status=409):
    raise HTTPException(status, {'code': code, 'message': message})


def readonly(path):
    return sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro', uri=True, timeout=20)


def check_version(db):
    version = db.execute('PRAGMA user_version').fetchone()[0]
    if version > SCHEMA_VERSION:
        fail('DATABASE_VERSION_TOO_NEW', f'数据库版本 {version} 高于程序支持的 {SCHEMA_VERSION}；已拒绝写入，请升级程序，不要降级数据库。')
    return version


def check_existing(path):
    if Path(path).exists():
        with closing(readonly(path)) as db:
            return check_version(db)
    return 0


def digest(path):
    h=sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
    return h.hexdigest()


def validate(path, expected=None):
    path=Path(path)
    if not path.is_file():fail('DATABASE_SNAPSHOT_NOT_FOUND','备份文件不存在。',404)
    if expected is not None and digest(path)!=expected:
        fail('DATABASE_SNAPSHOT_CORRUPT','备份 SHA256 不一致，未替换工程库。')
    try:
        with closing(readonly(path)) as db:
            version=check_version(db)
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
                fail('DATABASE_SNAPSHOT_CORRUPT','SQLite 完整性校验失败，未替换工程库。')
            names={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not {'workspaces','workspace_history','workspace_audit','workspace_revisions'}<=names:
                fail('DATABASE_SNAPSHOT_INVALID','文件不是可恢复的 CableSimPro 工程库。',422)
            return version
    except sqlite3.DatabaseError as error:
        fail('DATABASE_SNAPSHOT_CORRUPT','无法读取 SQLite 备份：'+str(error))


def atomic_json(path, value):
    path=Path(path);temporary=path.with_name(path.name+'.'+str(uuid4())+'.partial')
    try:
        with temporary.open('x',encoding='utf-8',newline='\n') as stream:
            json.dump(value,stream,ensure_ascii=False,indent=2);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
    finally:
        temporary.unlink(missing_ok=True)


def snapshot(database, destination):
    """SQLite backup includes committed WAL content; never copy the live DB file."""
    from .workspace import stamp
    database=Path(database).resolve();destination=Path(destination).resolve()
    if database==destination:fail('DATABASE_SNAPSHOT_TARGET_INVALID','备份路径不能是当前数据库。',422)
    validate(database)
    destination.parent.mkdir(parents=True,exist_ok=True)
    try:
        with destination.open('xb'):pass
    except FileExistsError:
        fail('DATABASE_SNAPSHOT_EXISTS','目标文件已存在；请选择新备份路径，未覆盖原文件。')
    try:
        with closing(readonly(database)) as source, closing(sqlite3.connect(destination)) as target:
            source.backup(target, pages=256, sleep=.01)
            target.execute('PRAGMA journal_mode=DELETE')
        version=validate(destination)
        value={'schema_version':version,'sha256':digest(destination),'size_bytes':destination.stat().st_size,'created':stamp()}
        atomic_json(str(destination)+'.json',value)
        return value
    except BaseException:
        destination.unlink(missing_ok=True)
        raise


def directory(database):
    return Path(str(Path(database).resolve())+'.snapshots')


def pending_path(database):
    return Path(str(Path(database).resolve())+'.restore.json')


def apply_restore(database, source, expected):
    """Caller owns the database lock; no live host connections are allowed."""
    from .workspace import stamp
    database=Path(database).resolve();source=Path(source).resolve()
    if database==source:fail('DATABASE_RESTORE_SOURCE_INVALID','恢复源不能是目标数据库自身。',422)
    check_existing(database);version=validate(source,expected)
    rescue=None
    if database.exists():
        rescue=directory(database)/('before-restore-'+str(uuid4())+'.sqlite')
        snapshot(database,rescue)
    database.parent.mkdir(parents=True,exist_ok=True)
    # SQLite's backup transaction commits atomically and safely handles WAL.
    with closing(readonly(source)) as original, closing(sqlite3.connect(database,timeout=20)) as target:
        original.backup(target,pages=256,sleep=.01)
    return {'status':'restored','schema_version':version,'source_sha256':expected,
            'safety_snapshot':str(rescue) if rescue else None,'finished':stamp()}


def restore_offline(database, source, expected):
    owner=OwnerLock(database)
    try:
        try:owner.acquire()
        except RuntimeError:fail('DATABASE_IN_USE','请先停止使用此工程库的后端，再执行恢复。')
        if pending_path(database).exists():fail('DATABASE_RESTORE_PENDING','已有待重启恢复请求；请先启动宿主完成它，或取消该请求。')
        return apply_restore(database,source,expected)
    finally:owner.close()


def prepare_startup(database):
    # This runs before any schema DDL or journal-mode write, under OwnerLock.
    check_existing(database)
    pending=pending_path(database)
    if not pending.exists():return
    request=json.loads(pending.read_text('utf-8'))
    receipt=directory(database)/'restores'/(str(UUID(request['request_id']))+'.json')
    if receipt.exists():
        pending.unlink()
        return
    source=directory(database)/(request['backup_id']+'.sqlite')
    if source.parent!=directory(database):fail('DATABASE_RESTORE_INVALID','恢复记录路径非法。')
    result=apply_restore(database,source,request['sha256'])
    receipt.parent.mkdir(parents=True,exist_ok=True)
    atomic_json(receipt,{**request,**result})
    atomic_json(str(database)+'.restore-result.json',{**request,**result})
    pending.unlink()


class SnapshotRequest(StrictModel):
    request_id: UUID = Field(description='Idempotency key; repeat to reuse the same completed backup. No unit.')


class SnapshotInfo(StrictModel):
    id: str = Field(description='Backup identity; not a filesystem path.')
    schema_version: int = Field(description='SQLite user_version supported by this host; no unit.')
    sha256: str = Field(pattern=r'^[0-9a-f]{64}$',description='SHA256 of the standalone SQLite snapshot.')
    size_bytes: int = Field(ge=0,description='Snapshot file size, bytes.')
    created: str = Field(description='UTC creation timestamp.')
    download_url: str = Field(description='Host URL for the verified snapshot download.')


class RestoreRequest(SnapshotRequest):
    backup_id: UUID = Field(description='Backup ID returned by the backup endpoint; no unit.')
    sha256: str = Field(pattern=r'^[0-9a-f]{64}$',description='Reviewed SHA256 of the backup to restore.')
    confirm_replace: bool = Field(strict=True,description='Explicit acknowledgement that restart will replace the entire current engineering library.')


class RestoreInfo(StrictModel):
    status: Literal['pending_restart','restored','none'] = Field(description='Restore phase; pending_restart has not replaced the active database.')
    request_id: str | None = Field(default=None,description='Restore request identity; no unit.')
    backup_id: str | None = Field(default=None,description='Selected backup identity; no unit.')
    sha256: str | None = Field(default=None,description='Selected backup SHA256.')
    safety_snapshot: str | None = Field(default=None,description='Pre-restore safety snapshot, recorded after the restart restore.')
    finished: str | None = Field(default=None,description='UTC restore completion timestamp.')


class DatabaseVersion(StrictModel):
    database_schema_version: int = Field(description='Current SQLite user_version; no unit.')
    supported_schema_version: int = Field(description='Maximum schema version this host supports; no unit.')


class DatabaseError(StrictModel):
    detail: dict[str,str] | list[dict[str,JsonValue]] = Field(description='Stable code/message, or request field validation errors.')


class DatabaseRoute(APIRoute):
    def get_route_handler(self):
        handler=super().get_route_handler()
        async def guarded(request):
            try:return await handler(request)
            except (OSError,sqlite3.Error) as error:
                fail('DATABASE_IO_ERROR','数据库维护操作未完成；请检查磁盘空间和文件权限后重试。'+str(error),503)
        return guarded


def make_router(store):
    from threading import Lock
    router=APIRouter(prefix='/database',tags=['Database maintenance'],route_class=DatabaseRoute,responses={code:{'model':DatabaseError} for code in (404,409,422,503)});guard=Lock()
    folder=directory(store.path)
    def info(identifier):
        path=folder/(str(identifier)+'.sqlite');meta=Path(str(path)+'.json')
        if not meta.is_file():fail('DATABASE_SNAPSHOT_NOT_FOUND','备份不存在或尚未完成。',404)
        value=json.loads(meta.read_text('utf-8'));validate(path,value['sha256'])
        return {'id':str(identifier),**value,'download_url':f'/api/database/backups/{identifier}/file'}

    @router.get('/version',response_model=DatabaseVersion)
    def version():
        return {'database_schema_version':check_existing(store.path),'supported_schema_version':SCHEMA_VERSION}

    @router.post('/backups',response_model=SnapshotInfo,status_code=201)
    def create(body:SnapshotRequest):
        with guard:
            identifier=str(body.request_id);path=folder/(identifier+'.sqlite')
            if not Path(str(path)+'.json').exists():snapshot(store.path,path)
            return info(identifier)

    @router.get('/backups',response_model=list[SnapshotInfo])
    def listing():
        return [info(UUID(path.name.removesuffix('.sqlite.json'))) for path in sorted(folder.glob('*.sqlite.json'))
                if not path.name.startswith('before-restore-')]

    @router.get('/backups/{identifier}/file',response_class=FileResponse,responses={200:{'content':{'application/vnd.sqlite3':{'schema':{'type':'string','format':'binary'}}}}})
    def download(identifier:UUID):
        value=info(identifier)
        return FileResponse(folder/(str(identifier)+'.sqlite'),media_type='application/vnd.sqlite3',filename='cablesim-library.sqlite',headers={'X-Artifact-SHA256':value['sha256']})

    @router.post('/restores',response_model=RestoreInfo,status_code=202)
    def request_restore(body:RestoreRequest):
        if not body.confirm_replace:fail('DATABASE_RESTORE_CONFIRMATION_REQUIRED','请明确确认重启时替换整个工程库；当前数据尚未改变。',422)
        with guard:
            record=body.model_dump(mode='json',exclude={'confirm_replace'});pending=pending_path(store.path)
            receipt=folder/'restores'/(str(body.request_id)+'.json')
            if receipt.exists():
                done=json.loads(receipt.read_text('utf-8'))
                if any(done[k]!=v for k,v in record.items()):fail('DATABASE_RESTORE_CONFLICT','同一请求编号已用于不同恢复操作。')
                return {k:v for k,v in done.items() if k in RestoreInfo.model_fields}
            if pending.exists():
                saved=json.loads(pending.read_text('utf-8'))
                if saved!=record:fail('DATABASE_RESTORE_PENDING','已有不同恢复请求，请先取消或完成它。')
            else:
                value=info(body.backup_id)
                if value['sha256']!=body.sha256:fail('DATABASE_SNAPSHOT_CORRUPT','所选备份摘要已变化，未登记恢复。')
                atomic_json(pending,record)
            return {'status':'pending_restart',**record}

    @router.get('/restores/current',response_model=RestoreInfo)
    def restore_status():
        pending=pending_path(store.path);result=Path(str(store.path)+'.restore-result.json')
        if pending.exists():return {'status':'pending_restart',**json.loads(pending.read_text('utf-8'))}
        if result.exists():
            value=json.loads(result.read_text('utf-8'))
            return {k:v for k,v in value.items() if k in RestoreInfo.model_fields}
        return {'status':'none'}

    @router.delete('/restores/current',status_code=204)
    def cancel_restore(request_id:UUID):
        with guard:
            pending=pending_path(store.path)
            if pending.exists():
                if json.loads(pending.read_text('utf-8'))['request_id']!=str(request_id):fail('DATABASE_RESTORE_CONFLICT','恢复请求已变化。')
                pending.unlink()
    return router
