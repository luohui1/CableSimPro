"""Bounded process-local seal receipts, authenticated by current source bytes.

No database, executor, mutable manifest, timestamp lease or trusted disk bit is
shared. Fresh package/lock digests and import inventory bind every lookup;
closure validation is reused only after those actual bytes match.
"""
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from threading import RLock

from .dependencies import LOCK_PATH

_records = OrderedDict()
_lock = RLock()


def fingerprint(value):
    return sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def source_inventory(root, workers):
    from .registry import PluginHostError
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
    from .registry import PluginHostError
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


def verify(plugin, check, *, content=None, readers=None):
    """Return an isolated receipt; never let a caller mutate the shared proof."""
    from .registry import PluginHostError
    release = fingerprint(plugin.manifest.model_dump(mode='json', by_alias=True))
    try:
        content = content or source_digest(plugin)
    except (PluginHostError, OSError):
        # Preserve package-before-host diagnostics for incomplete installations.
        # No receipt is reused or published after an unreadable source snapshot.
        check()
        raise
    key = (str(plugin.directory.resolve()), release, content)
    with _lock:
        previous = _records.get(key)
        if previous is not None:
            _records.move_to_end(key)
            return {**previous, 'cache_hit': True}
    check()
    shared = {'readers': readers} if readers is not None else None
    if source_digest(plugin, shared) != content:
        raise PluginHostError('RELEASE_CHANGED', '封签核验期间文件发生变化，请完成发布后重试。', 409)
    record = {'status': 'verified', 'release_digest': release, 'source_tree_sha256': content,
              'verified_at': datetime.now(timezone.utc).isoformat(),
              'policy': 'content-and-import-inventory/1'}
    with _lock:
        _records[key] = record
        _records.move_to_end(key)
        while len(_records) > 128:
            _records.popitem(last=False)
    return {**record, 'cache_hit': False}
