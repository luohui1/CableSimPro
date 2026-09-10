"""Local, versioned asset definitions. Publication is not engineering certification.

No CAD files, code, solver models, or manufacturer datasets are executed/imported.
Lifecycle events and content changes use the same SQLite transaction and CAS guard.
Published content cannot be overwritten; project inputs are never upgraded implicitly.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from uuid import uuid4

from .contracts import AssetRelease, content_hash


class AssetError(Exception):
    def __init__(self, code: str, message: str, status: int = 422):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


def stamp() -> str:
    return datetime.now(timezone.utc).isoformat()


class AssetRepository:
    """Metadata definitions in the application's local DB, not a multiuser authority."""

    def __init__(self, path: Path | str):
        self.path = Path(path)

    @contextmanager
    def db(self, write: bool = False):
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            db.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.db(True) as db:
            # Individual DDL statements: executescript would implicitly commit.
            db.execute('''CREATE TABLE IF NOT EXISTS engineering_assets (
              id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, version TEXT NOT NULL,
              kind TEXT NOT NULL, name TEXT NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('draft','reviewed','published','deprecated')),
              revision INTEGER NOT NULL CHECK(revision>0), release_json TEXT NOT NULL,
              content_sha256 TEXT NOT NULL, reviewed_sha256 TEXT,
              created TEXT NOT NULL, updated TEXT NOT NULL,
              UNIQUE(asset_id,version))''')
            db.execute('''CREATE TABLE IF NOT EXISTS engineering_asset_events (
              id TEXT PRIMARY KEY, asset TEXT NOT NULL REFERENCES engineering_assets(id),
              revision INTEGER NOT NULL, action TEXT NOT NULL, note TEXT NOT NULL,
              content_sha256 TEXT NOT NULL, created TEXT NOT NULL,
              UNIQUE(asset, revision))''')
            db.execute('CREATE INDEX IF NOT EXISTS asset_catalog_filter ON engineering_assets(kind,status,updated)')

    @staticmethod
    def _load(db, rid: str, revision: int | None = None):
        row = db.execute('SELECT * FROM engineering_assets WHERE id=?', (rid,)).fetchone()
        if row is None:
            raise AssetError('ASSET_NOT_FOUND', '资产不存在。', 404)
        if revision is not None and row['revision'] != revision:
            raise AssetError('ASSET_REVISION_CONFLICT', '资产已被其他操作更新，请刷新后再审查。', 409)
        return row

    @staticmethod
    def _summary(row) -> dict:
        return {key: row[key] for key in ('id', 'asset_id', 'version', 'kind', 'name', 'status',
                                         'revision', 'content_sha256', 'created', 'updated')}

    @staticmethod
    def _event(db, row, action: str, note: str) -> None:
        db.execute('INSERT INTO engineering_asset_events VALUES (?,?,?,?,?,?,?)',
                   (str(uuid4()), row['id'], row['revision'], action, note,
                    row['content_sha256'], stamp()))

    def _insert(self, db, release: AssetRelease, note: str) -> str:
        # This lane imports JSON definitions only, not unverified payload manifests.
        if release.files:
            raise AssetError('ASSET_PAYLOAD_NOT_SUPPORTED', '本批仅接收 JSON 定义；文件载荷须先接入隔离校验服务。')
        if any(d.asset_id == release.asset_id and d.version == release.version for d in release.dependencies):
            raise AssetError('ASSET_SELF_DEPENDENCY', '资产不能依赖自身版本。')
        rid, now = str(uuid4()), stamp()
        try:
            db.execute('INSERT INTO engineering_assets VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                       (rid, release.asset_id, release.version, release.kind, release.name, 'draft', 1,
                        release.model_dump_json(), content_hash(release), None, now, now))
        except sqlite3.IntegrityError as exc:
            raise AssetError('ASSET_VERSION_EXISTS', '相同资产版本已存在；请新建版本，不能覆盖。', 409) from exc
        self._event(db, self._load(db, rid), 'created', note)
        return rid

    def create(self, release: AssetRelease, note: str = '导入 JSON 定义；创建本地草稿。') -> dict:
        with self.db(True) as db:
            rid = self._insert(db, release, note)
            return self._detail(db, self._load(db, rid))

    def _issues(self, db, release: AssetRelease) -> list[dict]:
        issues: list[dict] = []
        # Published dependencies themselves have passed this gate; traverse again
        # to catch deprecation of a transitive dependency after initial publication.
        visited: set[tuple[str, str]] = set()
        def visit(ref, depth=0):
            key = (ref.asset_id, ref.version)
            if key in visited:
                return
            if depth > 64 or len(visited) >= 1024:
                issues.append({'code':'ASSET_GRAPH_LIMIT', 'message':'依赖图超过预检上限。'})
                return
            visited.add(key)
            row = db.execute('SELECT * FROM engineering_assets WHERE asset_id=? AND version=?', key).fetchone()
            if row is None:
                issues.append({'code':'ASSET_DEPENDENCY_MISSING', 'message':f'缺少依赖 {ref.asset_id}@{ref.version}。'})
                return
            if row['content_sha256'] != ref.content_sha256:
                issues.append({'code':'ASSET_DEPENDENCY_DIGEST', 'message':f'依赖 {ref.asset_id}@{ref.version} 的内容摘要不匹配。'})
                return
            if row['status'] != 'published':
                issues.append({'code':'ASSET_DEPENDENCY_NOT_PUBLISHED', 'message':f'依赖 {ref.asset_id}@{ref.version} 不是可新引用的已发布版本。'})
                return
            dependency = AssetRelease.model_validate_json(row['release_json'])
            if content_hash(dependency) != row['content_sha256']:
                issues.append({'code':'ASSET_CONTENT_CORRUPT', 'message':f'依赖 {ref.asset_id} 的存储内容异常。'})
                return
            for child in dependency.dependencies:
                visit(child, depth+1)
        for ref in release.dependencies:
            visit(ref)
        return issues

    def _detail(self, db, row) -> dict:
        release = AssetRelease.model_validate_json(row['release_json'])
        if content_hash(release) != row['content_sha256']:
            raise AssetError('ASSET_CONTENT_CORRUPT', '资产内容摘要异常，已阻止继续使用。', 409)
        return {**self._summary(row), 'release': release.model_dump(mode='json'),
                'issues': self._issues(db, release), 'reviewed_sha256':row['reviewed_sha256'],
                'events': [dict(e) for e in db.execute(
                    'SELECT revision,action,note,content_sha256,created FROM engineering_asset_events WHERE asset=? ORDER BY revision DESC LIMIT 100', (row['id'],))],
                'authority':'local_operator', 'applied_to_workspace':False}

    def get(self, rid: str) -> dict:
        with self.db() as db:
            return self._detail(db, self._load(db, rid))

    def list(self, *, kind: str | None = None, status: str | None = None,
             query: str = '', limit: int = 50, offset: int = 0) -> dict:
        if limit < 1 or limit > 100 or offset < 0:
            raise AssetError('INVALID_PAGE', '分页范围无效。')
        clauses, args = [], []
        for key, val in (('kind',kind), ('status',status)):
            if val:
                clauses.append(f'{key}=?'); args.append(val)
        if query.strip():
            pattern='%'+query.strip().replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
            clauses.append("(name LIKE ? ESCAPE '\\' OR asset_id LIKE ? ESCAPE '\\')")
            args.extend([pattern,pattern])
        where=' WHERE '+' AND '.join(clauses) if clauses else ''
        with self.db() as db:
            total=db.execute('SELECT COUNT(*) FROM engineering_assets'+where,args).fetchone()[0]
            rows=db.execute('SELECT * FROM engineering_assets'+where+' ORDER BY updated DESC,id LIMIT ? OFFSET ?',[*args,limit,offset])
            counts={r['kind']:r['n'] for r in db.execute('SELECT kind,COUNT(*) n FROM engineering_assets GROUP BY kind')}
            return {'items':[self._summary(r) for r in rows], 'total':total,
                    'counts':counts, 'limit':limit, 'offset':offset, 'authority':'local_operator'}

    def update(self, rid: str, revision: int, release: AssetRelease) -> dict:
        with self.db(True) as db:
            row=self._load(db,rid,revision)
            if row['status'] != 'draft':
                raise AssetError('ASSET_CONTENT_LOCKED', '仅草稿可编辑；已发布版本请派生新版本。', 409)
            if (release.asset_id,release.version,release.kind)!=(row['asset_id'],row['version'],row['kind']):
                raise AssetError('ASSET_IDENTITY_IMMUTABLE', '编辑不能更改资产标识、版本或分类。')
            if release.files:
                raise AssetError('ASSET_PAYLOAD_NOT_SUPPORTED','本批不接收文件载荷。')
            if any(d.asset_id == release.asset_id and d.version == release.version for d in release.dependencies):
                raise AssetError('ASSET_SELF_DEPENDENCY','资产不能依赖自身版本。')
            db.execute('UPDATE engineering_assets SET name=?,revision=revision+1,release_json=?,content_sha256=?,reviewed_sha256=NULL,updated=? WHERE id=?',
                       (release.name,release.model_dump_json(),content_hash(release),stamp(),rid))
            row=self._load(db,rid); self._event(db,row,'edited','编辑草稿定义。')
            return self._detail(db,row)

    def transition(self, rid: str, revision: int, digest: str, action: str,
                   note: str, acknowledge_sources: bool = False) -> dict:
        edges={('draft','review'):'reviewed',('reviewed','publish'):'published',
               ('reviewed','return_to_draft'):'draft',('published','deprecate'):'deprecated'}
        if len(note.strip())<4 or len(note)>1000:
            raise AssetError('ASSET_REVIEW_NOTE_REQUIRED','请输入至少四个字符的核对说明。')
        with self.db(True) as db:
            row=self._load(db,rid,revision)
            if row['content_sha256']!=digest:
                raise AssetError('ASSET_CONTENT_CHANGED','资产内容已变化，请重新审查。',409)
            state=edges.get((row['status'],action))
            if state is None:
                raise AssetError('ASSET_INVALID_TRANSITION','当前状态不能执行此操作。',409)
            release=AssetRelease.model_validate_json(row['release_json'])
            if content_hash(release)!=digest:
                raise AssetError('ASSET_CONTENT_CORRUPT','存储内容与摘要不一致。',409)
            if action in ('review','publish'):
                issues=self._issues(db,release)
                if issues:
                    raise AssetError(issues[0]['code'],issues[0]['message'])
            if action=='review' and not acknowledge_sources:
                raise AssetError('ASSET_REVIEW_ACK_REQUIRED','须明确确认已核对定义及来源；不会自动提升原始来源的可信度。')
            if action=='publish' and row['reviewed_sha256']!=digest:
                raise AssetError('ASSET_REVIEW_STALE','核对记录不属于当前内容。',409)
            review_digest=digest if action=='review' else None if action=='return_to_draft' else row['reviewed_sha256']
            db.execute('UPDATE engineering_assets SET status=?,revision=revision+1,reviewed_sha256=?,updated=? WHERE id=?',
                       (state,review_digest,stamp(),rid))
            row=self._load(db,rid);self._event(db,row,action,note.strip())
            return self._detail(db,row)

    def derive(self, rid: str, revision: int, digest: str, new_version: str) -> dict:
        with self.db(True) as db:
            row=self._load(db,rid,revision)
            if row['content_sha256']!=digest:
                raise AssetError('ASSET_CONTENT_CHANGED','资产内容已变化。',409)
            if row['status'] not in ('published','deprecated'):
                raise AssetError('ASSET_DERIVE_REQUIRES_RELEASE','请从已发布或弃用版本派生。',409)
            self._detail(db, row)  # Revalidate source bytes before deriving.
            definition=json.loads(row['release_json']); definition['version']=new_version
            release=AssetRelease.model_validate(definition)
            new_id=self._insert(db,release,f'从 {row["asset_id"]}@{row["version"]} 派生；原版本不变。')
            return self._detail(db,self._load(db,new_id))
