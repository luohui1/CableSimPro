"""Seal the static backend import closure of reviewed, repository-bundled plugins.

This is provenance, not a Python sandbox. Dynamic imports still require code review.
The lock is an ordinary sealed package file, without extending the v2 wire schema.
"""
import ast
from hashlib import sha256
import json
from pathlib import Path


LOCK_PATH = 'src/host-dependencies.json'


def host_dependencies(directory: Path) -> list[dict]:
    root = directory.parent.parent.resolve()
    pending = list((directory / 'src').rglob('*.py'))
    visited, dependencies = set(), set()

    def add_module(name, required=False):
        if not (name == 'backend' or name.startswith('backend.')):
            return
        module = root.joinpath(*name.split('.'))
        path = module / '__init__.py' if module.is_dir() else module.with_suffix('.py')
        if not path.is_file():
            if required:
                raise ValueError('HOST_DEPENDENCY_MISSING: ' + name)
            return
        # A from-import symbol (e.g. Executor) is not executor.py. Windows'
        # case-insensitive lookup must not invent a differently-cased module
        # entry that then fails provenance verification on Linux.
        if path.relative_to(root).as_posix() != path.resolve().relative_to(root).as_posix():
            if required:
                raise ValueError('HOST_DEPENDENCY_CASE_MISMATCH: ' + name)
            return
        candidates = [path]
        candidates.extend(parent / '__init__.py' for parent in path.parents
                          if parent != root and parent.is_relative_to(root))
        for file in candidates:
            if file.is_file():
                if file.is_symlink() or not file.resolve().is_relative_to(root):
                    raise ValueError('UNSAFE_HOST_DEPENDENCY: ' + str(file))
                if file not in dependencies:
                    dependencies.add(file)
                    pending.append(file)

    while pending:
        path = pending.pop()
        if path in visited:
            continue
        visited.add(path)
        host_file = path.is_relative_to(root / 'backend')
        package = '.'.join(path.relative_to(root).parts[:-1]) if host_file else ''
        for node in ast.walk(ast.parse(path.read_text('utf-8-sig'), filename=str(path))):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    add_module(alias.name, required=True)
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    if not host_file:
                        continue  # all plugin-local source files are already sealed and scanned
                    parts = package.split('.')
                    base = '.'.join(parts[:len(parts) - node.level + 1])
                    name = '.'.join(filter(None, (base, node.module)))
                else:
                    name = node.module or ''
                add_module(name, required=True)
                for alias in node.names:
                    add_module(name + '.' + alias.name)
    records = []
    for path in sorted(dependencies,key=lambda p:p.relative_to(root).as_posix()):
        data = path.read_bytes()
        records.append({'path': path.relative_to(root).as_posix(), 'sha256': sha256(data).hexdigest(),
                        'size_bytes': len(data)})
    return records


def verify_host_dependencies(directory: Path) -> None:
    expected = host_dependencies(directory)
    lock = directory / LOCK_PATH
    actual = json.loads(lock.read_text('utf-8')) if lock.is_file() else []
    if actual != expected:
        raise ValueError('HOST_DEPENDENCIES_MISMATCH: 宿主契约或导入闭包与插件封签不一致')
