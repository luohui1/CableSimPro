"""Real import/cache regeneration must not invalidate immutable runtime sources."""
import subprocess

import pytest

from scripts import release_python_runtime as runtime


def test_prune_bytecode_preserves_sources_and_runtime_libraries(tmp_path):
    import py_compile
    prefix = tmp_path / 'runtime'
    prefix.mkdir()
    source = prefix / 'example.py'
    source.write_text('VALUE = 17\n')
    library = prefix / 'python312.dll'
    library.write_bytes(b'unchanged native runtime bytes')
    license_file = prefix / 'LICENSE.txt'
    license_file.write_text('unchanged original notice')
    py_compile.compile(str(source), doraise=True)
    before = {path: path.read_bytes() for path in (source, library, license_file)}
    assert list(prefix.rglob('*.pyc'))
    runtime.prune_bytecode(prefix)
    assert not list(prefix.rglob('*.pyc'))
    assert not list(prefix.rglob('__pycache__'))
    assert all(path.read_bytes() == raw for path, raw in before.items())
    # A subsequent real interpreter import may recreate caches. The source
    # payload stays identical, and caches were never promised immutable.
    subprocess.run([runtime.sys.executable, '-I', '-c',
                    'import sys; sys.path.insert(0, sys.argv[1]); import example; assert example.VALUE == 17',
                    str(prefix)], check=True)
    assert list(prefix.rglob('*.pyc'))
    assert all(path.read_bytes() == raw for path, raw in before.items())


def test_prune_bytecode_refuses_to_delete_sourceless_module(tmp_path):
    source = tmp_path / 'keep.py'
    source.write_text('VALUE = 1\n')
    cache = tmp_path / '__pycache__'
    cache.mkdir()
    (cache / 'keep.cpython-312.pyc').write_bytes(b'regenerable')
    missing = cache / 'missing.cpython-312.pyc'
    missing.write_bytes(b'cannot regenerate')
    with pytest.raises(RuntimeError, match='source-less'):
        runtime.prune_bytecode(tmp_path)
    assert missing.exists()
    assert (cache / 'keep.cpython-312.pyc').exists()
