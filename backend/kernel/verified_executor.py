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
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress

from ..plugin_host import Executor, PluginHostError
from ..plugin_host.registry import Registry
from ..plugin_host.dependencies import LOCK_PATH
from .workspace import fingerprint, stamp

_scope=ContextVar('research_seal_scope',default=None)


@contextmanager
def verification_scope():
    """One request may reuse its read snapshot; executions always rehash below."""
    if _scope.get() is not None:
        yield
        return
    state={}
    token=_scope.set(state)
    try:yield
    finally:
        workers=state.get('source_snapshots',{}).get('readers')
        if workers is not None and not state.get('source_snapshots',{}).get('shared_readers'):
            workers.shutdown(wait=True)
        _scope.reset(token)


def source_inventory(root, workers):
    """One scandir pass: DirEntry metadata avoids repeated Windows stat calls."""
    directories=set();inventory=set();entries={}
    def visit(directory, relative, found):
        dirs,modules,files=found
        dirs.add(relative)
        with os.scandir(directory) as children:
            for entry in children:
                if entry.name=='__pycache__':continue
                name=relative+'/'+entry.name
                if entry.is_symlink():
                    raise PluginHostError('UNSAFE_PACKAGE_PATH','封签来源不允许符号链接。',409)
                if entry.is_dir(follow_symlinks=False):visit(entry.path,name,found)
                elif entry.is_file(follow_symlinks=False):
                    files[name]=entry.path
                    if entry.name.endswith('.py'):modules.add(name)
    sources=['backend','cablesim_sdk']
    try:
        with os.scandir(root/'plugins') as plugins:
            sources.extend('plugins/'+entry.name+'/src' for entry in plugins if entry.is_dir())
    except FileNotFoundError:pass
    def inspect(relative):
        found=(set(),set(),{})
        source=os.path.join(root,*relative.split('/'))
        if os.path.islink(source):raise PluginHostError('UNSAFE_PACKAGE_PATH','封签来源目录不允许符号链接。',409)
        try:visit(source,relative,found)
        except FileNotFoundError:
            found[0].discard(relative)
        return found
    for dirs,modules,files in workers.map(inspect,sources):
        directories.update(dirs);inventory.update(modules);entries.update(files)
    return directories,inventory,entries


def source_digest(plugin, shared=None):
    if shared is None:
        with ThreadPoolExecutor(max_workers=4) as workers:
            return _source_digest(plugin,{'readers':workers})
    if 'readers' not in shared:shared['readers']=ThreadPoolExecutor(max_workers=4)
    return _source_digest(plugin,shared)


def _source_digest(plugin, shared):
    root=plugin.directory.parent.parent.resolve()
    if root not in shared:shared[root]=(*source_inventory(root,shared['readers']),{})
    directories,inventory,entries,contents=shared[root]
    prefix=plugin.directory.relative_to(root).as_posix()+'/src/'
    files={name for name in entries if name.startswith(prefix) and not name.endswith('.pyc')}
    # Assets are sealed but intentionally outside the Python import inventory.
    def package_files(directory, relative):
        try:
            with os.scandir(directory) as children:
                for entry in children:
                    if entry.name=='__pycache__':continue
                    name=relative+'/'+entry.name
                    if entry.is_symlink():raise PluginHostError('UNSAFE_PACKAGE_PATH','封签来源文件不允许符号链接。',409)
                    if entry.is_dir(follow_symlinks=False):package_files(entry.path,name)
                    elif entry.is_file(follow_symlinks=False) and not name.endswith('.pyc'):
                        files.add(name);entries[name]=entry.path
        except FileNotFoundError:pass
    if not files:package_files(plugin.directory/'src',prefix.rstrip('/'))
    package_files(plugin.directory/'assets',plugin.directory.relative_to(root).as_posix()+'/assets')
    lock=plugin.directory/LOCK_PATH
    try:lock_bytes=lock.read_bytes()
    except FileNotFoundError:lock_bytes=None
    if lock_bytes is not None:
        try:
            contents[lock.relative_to(root).as_posix()]=sha256(lock_bytes).hexdigest()
            for record in json.loads(lock_bytes):
                name=record['path']
                if not isinstance(name,str) or '\\' in name or any(part in ('','..','.') for part in name.split('/')) or ':' in name:
                    raise ValueError('dependency outside source root')
                if name not in entries and not (root/name).resolve().is_relative_to(root):raise ValueError('dependency outside source root')
                files.add(name)
        except (ValueError,KeyError,TypeError) as exc:
            raise PluginHostError('HOST_DEPENDENCIES_MISMATCH','宿主依赖封签格式或路径无效。',409) from exc
    pending=[]
    for name in sorted(files):
        if name not in contents:
            path=entries.get(name)
            if path is None:
                path=root/name
                if path.is_symlink():raise PluginHostError('UNSAFE_PACKAGE_PATH','封签来源文件不允许符号链接。',409)
                if not path.is_file():raise PluginHostError('HOST_DEPENDENCIES_MISMATCH','封签引用的源码文件已删除。',409)
            pending.append((name,path))
    # Bounded parallel file reads hide local filesystem latency, not computation.
    # map finishes these reads before returning; the shared pool closes with the host.
    if len(pending)>8:
        contents.update(shared['readers'].map(read_digest,pending))
    else:contents.update(map(read_digest,pending))
    records=[(name,contents[name]) for name in sorted(files)]
    # Unchanged importer bytes plus unchanged module inventory preserve the
    # verified static import closure; unrelated modules need not be read again.
    return fingerprint({'files':records,'directories':sorted(directories),'import_inventory':sorted(inventory)})


def read_digest(item):
    name,path=item
    with open(path,'rb') as file:return name,sha256(file.read()).hexdigest()


class SealCache:
    def __init__(self):
        self.records={};self.lock=RLock()
        self.readers=ThreadPoolExecutor(max_workers=4,thread_name_prefix='seal-read')
        self.watches={};self.unchanged={}

    def close(self):
        with self.lock:
            for watch in self.watches.values():watch.close()
            self.watches.clear()
            self.readers.shutdown(wait=True)

    def __del__(self):
        with suppress(Exception):self.close()

    def verify(self,plugin,*,before_execution=False):
        release=fingerprint(plugin.manifest.model_dump(mode='json',by_alias=True))
        directory=str(plugin.directory.resolve())
        scope=_scope.get();scope_key=(id(self),directory,release)
        if not before_execution and scope is not None and scope_key in scope:
            return {**scope[scope_key],'cache_hit':True,'request_snapshot_reused':True}
        with self.lock:
            from .source_watch import SourceWatch
            root=plugin.directory.parent.parent.resolve()
            if root not in self.watches:self.watches[root]=SourceWatch(root)
            watch=self.watches[root];generation=watch.snapshot()
            prior=self.unchanged.get((directory,release))
            if not before_execution and generation is not None and prior is not None and prior[0]==generation:
                if scope is not None:scope[scope_key]=prior[1]
                return {**prior[1],'cache_hit':True,'request_snapshot_reused':False}
            shared=scope.setdefault('source_snapshots',{}) if scope is not None and not before_execution else {}
            shared.update(readers=self.readers,shared_readers=True)
            content=source_digest(plugin,shared);key=(directory,release,content)
            previous=self.records.get(key)
            if previous is not None:
                if generation is not None and watch.snapshot()==generation:
                    self.unchanged[(directory,release)]=(generation,previous)
                if scope is not None:scope[scope_key]=previous
                return {**previous,'cache_hit':True,'request_snapshot_reused':False}
            plugin.verify()
            if source_digest(plugin,{'readers':self.readers})!=content:
                raise PluginHostError('RELEASE_CHANGED','封签核验期间文件发生变化，请完成发布后重试。',409)
            record={'status':'verified','release_digest':release,'source_tree_sha256':content,
                    'verified_at':stamp(),'policy':'content-and-import-inventory/1'}
            if len(self.records)>=32:self.records.clear();self.unchanged.clear()
            self.records[key]=record
            if generation is not None and watch.snapshot()==generation:
                self.unchanged[(directory,release)]=(generation,record)
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
