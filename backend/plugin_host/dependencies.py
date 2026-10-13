"""Seal shared SDK and host import closures of reviewed, repository-bundled plugins.

This is provenance, not a Python sandbox. Dynamic imports still require code review.
The lock is an ordinary sealed package file, without extending the v2 wire schema.
"""
import ast
from hashlib import sha256
import json
import os
from pathlib import Path
from functools import lru_cache
from threading import RLock
from contextlib import contextmanager
from contextvars import ContextVar


LOCK_PATH = 'src/host-dependencies.json'
_snapshot = ContextVar('host_dependency_snapshot', default=None)


@contextmanager
def dependency_batch(snapshot):
    token = _snapshot.set(snapshot)
    try:
        yield
    finally:
        _snapshot.reset(token)


@lru_cache(maxsize=256)
def imports(raw):
    """Cache only syntax of exact bytes; filesystem bindings remain fresh."""
    return tuple((0, alias.name, ()) if isinstance(node, ast.Import) else
                 (node.level, node.module or '', tuple(alias.name for alias in node.names))
                 for node in ast.walk(ast.parse(raw))
                 if isinstance(node, (ast.Import, ast.ImportFrom))
                 for alias in (node.names if isinstance(node, ast.Import) else [None]))


class DependencySnapshot:
    """One verification batch's actual import inventory and read source bytes.

    Never retained between requests or executions. The catalogue's SourceWatch
    lease rejects reuse after publication; execution uses its own fresh check.
    """
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.sources = list((self.root / 'plugins').glob('*/src'))
        self.files, self.directories, self.contents, self.checked = set(), set(), {}, set()
        self.lock = RLock()
        for source in [self.root / 'backend', self.root / 'cablesim_sdk', *self.sources]:
            for parent, folders, names in os.walk(source):
                folders[:] = [name for name in folders if name != '__pycache__']
                parent = Path(parent)
                self.directories.add(parent.as_posix())
                self.directories.update((parent / name).as_posix() for name in folders)
                self.files.update((parent / name).as_posix() for name in names if name.endswith('.py'))

    def check(self, file):
        with self.lock:
            if file not in self.checked:
                if file.is_symlink() or not file.resolve().is_relative_to(self.root):
                    raise ValueError('UNSAFE_HOST_DEPENDENCY: ' + str(file))
                self.checked.add(file)

    def read(self, file):
        with self.lock:
            if file not in self.contents:
                self.contents[file] = file.read_bytes()
            return self.contents[file]


def host_dependencies(directory: Path, snapshot=None) -> list[dict]:
    root = directory.parent.parent.resolve()
    snapshot = snapshot or _snapshot.get() or DependencySnapshot(root)
    if snapshot.root != root:
        raise ValueError('HOST_DEPENDENCY_ROOT_MISMATCH')
    pending = list((directory / 'src').rglob('*.py'))
    visited, dependencies = set(), set()
    modules, packages, contents = {}, {}, {}
    sources, files, directories = snapshot.sources, snapshot.files, snapshot.directories

    def add_module(name, required=False):
        if name in modules:
            if required and modules[name] is False:
                raise ValueError('HOST_DEPENDENCY_MISSING: ' + name)
            return
        if name == 'backend' or name.startswith('backend.') or name == 'cablesim_sdk' or name.startswith('cablesim_sdk.'):
            module = root.joinpath(*name.split('.'))
        elif name.startswith('cablesim_'):
            parts = name.split('.')
            if parts[0] not in packages:
                packages[parts[0]] = [source / parts[0] for source in sources
                                      if (source / parts[0]).as_posix() in directories]
            candidates = packages[parts[0]]
            if len(candidates) != 1:
                if required:
                    raise ValueError('SHARED_PLUGIN_DEPENDENCY_MISSING: ' + name)
                return
            module = candidates[0].joinpath(*parts[1:])
        else:
            return
        path = module / '__init__.py' if module.as_posix() in directories else module.with_suffix('.py')
        # The fresh directory index preserves actual case, unlike Windows exists().
        if path.as_posix() not in files:
            modules[name] = False
            if required:
                raise ValueError('HOST_DEPENDENCY_MISSING: ' + name)
            return
        modules[name] = True
        candidates = [path]
        candidates.extend(parent / '__init__.py' for parent in path.parents
                          if parent != root and parent.is_relative_to(root))
        for file in candidates:
            if file in dependencies:
                continue
            if file.as_posix() in files:
                snapshot.check(file)
                if file.is_relative_to(directory/'src'):
                    continue  # Already scanned and sealed as this plugin's own package.
                dependencies.add(file)
                pending.append(file)

    while pending:
        path = pending.pop()
        if path in visited:
            continue
        visited.add(path)
        host_file = path.is_relative_to(root / 'backend') or path.is_relative_to(root / 'cablesim_sdk')
        shared_file = path in dependencies and not host_file
        package = '.'.join(path.relative_to(root).parts[:-1]) if host_file else '.'.join(path.relative_to(root).parts[3:-1]) if shared_file else ''
        raw = snapshot.read(path)
        contents[path] = raw
        for level, module, names in imports(raw):
            if not names:
                add_module(module, required=True)
            else:
                if level:
                    if not host_file and not shared_file:
                        continue  # all plugin-local source files are already sealed and scanned
                    parts = package.split('.')
                    base = '.'.join(parts[:len(parts) - level + 1])
                    name = '.'.join(filter(None, (base, module)))
                else:
                    name = module
                add_module(name, required=True)
                for alias in names:
                    add_module(name + '.' + alias)
    records = []
    for path in sorted(dependencies,key=lambda p:p.relative_to(root).as_posix()):
        data = contents[path]
        records.append({'path': path.relative_to(root).as_posix(), 'sha256': sha256(data).hexdigest(),
                        'size_bytes': len(data)})
    return records


def verify_host_dependencies(directory: Path, snapshot=None) -> None:
    expected = host_dependencies(directory, snapshot)
    lock = directory / LOCK_PATH
    actual = json.loads(lock.read_text('utf-8')) if lock.is_file() else []
    if actual != expected:
        raise ValueError('HOST_DEPENDENCIES_MISMATCH: 宿主契约或导入闭包与插件封签不一致')
