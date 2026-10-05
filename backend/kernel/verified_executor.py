"""Research-local seal reuse; every execution rehashes actual source bytes.

No mtime-only trust and no persistent trusted bit. A content-identical import
tree may reuse its full manifest/dependency check; a changed tree must reverify.
Read-only resolves within one request share that request's verified snapshot.
"""
from hashlib import sha256
import json
import os
from pathlib import Path
from threading import RLock
from contextlib import contextmanager
from contextvars import ContextVar

from ..plugin_host import Executor, PluginHostError
from ..plugin_host.registry import Registry, package_files
from ..plugin_host.dependencies import LOCK_PATH
from .workspace import fingerprint, stamp

_scope=ContextVar('research_seal_scope',default=None)


@contextmanager
def verification_scope():
    """One request may reuse its read snapshot; executions always rehash below."""
    if _scope.get() is not None:
        yield
        return
    token=_scope.set({})
    try:yield
    finally:_scope.reset(token)


def source_digest(plugin):
    root=plugin.directory.parent.parent.resolve()
    files=set(package_files(plugin.directory));directories=set();inventory=set()
    lock=plugin.directory/LOCK_PATH
    if lock.is_file():
        try:
            for record in json.loads(lock.read_text('utf-8')):
                path=root/record['path']
                if not path.resolve().is_relative_to(root):raise ValueError('dependency outside source root')
                files.add(path)
        except (ValueError,KeyError,TypeError) as exc:
            raise PluginHostError('HOST_DEPENDENCIES_MISMATCH','宿主依赖封签格式或路径无效。',409) from exc
    roots=[root/'backend',root/'cablesim_sdk',*(root/'plugins').glob('*/src')]
    for source in roots:
        for parent,folders,names in os.walk(source):
            folders[:]=[n for n in folders if n!='__pycache__']
            directory=Path(parent)
            for entry in [directory,*(directory/n for n in folders)]:
                if entry.is_symlink():raise PluginHostError('UNSAFE_PACKAGE_PATH','封签来源目录不允许符号链接。',409)
                directories.add(entry.relative_to(root).as_posix())
            inventory.update((directory/n).relative_to(root).as_posix() for n in names if n.endswith('.py'))
    records=[]
    for path in sorted(files):
        if path.is_symlink():raise PluginHostError('UNSAFE_PACKAGE_PATH','封签来源文件不允许符号链接。',409)
        if not path.is_file():raise PluginHostError('HOST_DEPENDENCIES_MISMATCH','封签引用的源码文件已删除。',409)
        raw=path.read_bytes()
        records.append((path.relative_to(root).as_posix(),sha256(raw).hexdigest()))
    # Unchanged importer bytes plus unchanged module inventory preserve the
    # verified static import closure; unrelated modules need not be read again.
    return fingerprint({'files':records,'directories':sorted(directories),'import_inventory':sorted(inventory)})


class SealCache:
    def __init__(self):
        self.records={};self.lock=RLock()

    def verify(self,plugin,*,before_execution=False):
        release=fingerprint(plugin.manifest.model_dump(mode='json',by_alias=True))
        scope=_scope.get();scope_key=(id(self),str(plugin.directory.resolve()),release)
        if not before_execution and scope is not None and scope_key in scope:
            return {**scope[scope_key],'cache_hit':True,'request_snapshot_reused':True}
        with self.lock:
            content=source_digest(plugin);key=(str(plugin.directory.resolve()),release,content)
            previous=self.records.get(key)
            if previous is not None:
                if scope is not None:scope[scope_key]=previous
                return {**previous,'cache_hit':True,'request_snapshot_reused':False}
            plugin.verify()
            if source_digest(plugin)!=content:
                raise PluginHostError('RELEASE_CHANGED','封签核验期间文件发生变化，请完成发布后重试。',409)
            record={'status':'verified','release_digest':release,'source_tree_sha256':content,
                    'verified_at':stamp(),'policy':'content-and-import-inventory/1'}
            if len(self.records)>=32:self.records.clear()
            self.records[key]=record
            if scope is not None:scope[scope_key]=record
            return {**record,'cache_hit':False,'request_snapshot_reused':False}


class VerifiedExecutor(Executor):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,verify=False,**kwargs)
        self.seals=SealCache()

    def verify_release(self,plugin):
        return self.seals.verify(plugin)

    def run(self,plugin_id,capability_id,cases,*args,**kwargs):
        plugin=Registry(self.registry.root,plugin_id=plugin_id).get(plugin_id)
        expected=kwargs.get('expected_manifest')
        if expected is not None and expected!=plugin.manifest:
            raise PluginHostError('RELEASE_CHANGED','准备后的插件发行已变化，请重新预检。',409)
        receipt=self.seals.verify(plugin,before_execution=True)
        # Parent still checks protocol, files, output digests, limits and the
        # expected manifest. Only its duplicate full seal scan is replaced above.
        kwargs['expected_manifest']=plugin.manifest
        result=super().run(plugin_id,capability_id,cases,*args,**kwargs)
        result.environment['seal_verification']=receipt
        for case in result.cases:case.evidence['seal_verification']=dict(receipt)
        return result
