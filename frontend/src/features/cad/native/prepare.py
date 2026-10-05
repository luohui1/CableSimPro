"""Prepare production OCCT JS/WASM from SHA256-pinned sources (Windows x64)."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path, PurePosixPath
import struct
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

from build import NATIVE, ROOT, PINS, file_hash, sdk_files


def tree_hashes(directory: Path) -> dict[str, str]:
    paths = []
    for folder, children, files in os.walk(directory):
        parent = Path(folder)
        children[:] = [name for name in children if name != '__pycache__'
                       and parent/name != directory/'upstream/emscripten/cache']
        paths.extend(parent/name for name in files if not name.endswith('.pyc'))
    paths.sort()
    with ThreadPoolExecutor(max_workers=8) as pool:
        return dict(zip((p.relative_to(directory).as_posix() for p in paths), pool.map(file_hash, paths)))


def download(record: dict, cache: Path) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache/(record['sha256']+'.zip')
    if archive.is_file() and file_hash(archive) == record['sha256']:
        return archive
    with tempfile.NamedTemporaryFile(dir=cache, suffix='.part', delete=False) as handle:
        partial = Path(handle.name)
    try:
        print('Downloading '+record['url'], flush=True)
        with urllib.request.urlopen(record['url'], timeout=120) as response, partial.open('wb') as handle:
            shutil.copyfileobj(response, handle, 1024*1024)
        if file_hash(partial) != record['sha256']:
            raise RuntimeError('Download SHA256 mismatch: '+record['url'])
        partial.replace(archive)
    finally:
        partial.unlink(missing_ok=True)
    return archive


def install(name: str, record: dict, cache: Path, home: Path) -> Path:
    print('Checking toolchain: '+name, flush=True)
    destination = home/name
    receipt = home/(name+'.json')
    if receipt.is_file() and destination.is_dir():
        saved = json.loads(receipt.read_text('utf-8'))
        if saved.get('sha256') == record['sha256'] and saved.get('files') == tree_hashes(destination):
            if normalize_version(name, destination):
                saved['files'] = tree_hashes(destination)
                receipt.write_text(json.dumps(saved), encoding='utf-8')
            return destination
    archive = download(record, cache)
    print('Extracting verified archive: '+name, flush=True)
    home.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=home, prefix=name+'-') as scratch:
        extracted = Path(scratch)
        with zipfile.ZipFile(archive) as bundle:
            for entry in bundle.infolist():
                path = PurePosixPath(entry.filename)
                if path.is_absolute() or '..' in path.parts or '\\' in entry.filename or ':' in entry.filename:
                    raise RuntimeError('Unsafe archive entry: '+entry.filename)
                if entry.is_dir():
                    continue
                parts = path.parts[record['strip_components']:]
                if not parts:
                    raise RuntimeError('Unexpected archive layout: '+entry.filename)
                target = extracted.joinpath(record.get('prefix', ''), *parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(entry) as source, target.open('wb') as output:
                    shutil.copyfileobj(source, output)
        # Only replace this tool's dedicated, verified installation directory.
        if destination.resolve().parent != home.resolve():
            raise RuntimeError('Installation escaped toolchain directory')
        if destination.exists():
            shutil.rmtree(destination)
        extracted.rename(destination)
    normalize_version(name, destination)
    receipt.write_text(json.dumps({'sha256': record['sha256'], 'files': tree_hashes(destination)}), encoding='utf-8')
    print('Installed and verified: '+name, flush=True)
    return destination


def normalize_version(name: str, destination: Path) -> bool:
    if name != 'emscripten':
        return False
    # Match emsdk's release installation step: its archive still says VERSION-git.
    version = destination/'upstream/emscripten/emscripten-version.txt'
    value = version.read_text('utf-8').strip().strip('"')
    if value not in (PINS['emscripten'], PINS['emscripten']+'-git'):
        raise RuntimeError('Emscripten archive has an unexpected version')
    normalized = json.dumps(PINS['emscripten'])+'\n'
    if version.read_text('utf-8') == normalized:
        return False
    version.write_text(normalized, encoding='utf-8', newline='\n')
    return True


def source_checkout(home: Path) -> Path:
    source = home/'occt'
    if not source.exists():
        home.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=home, prefix='occt-') as scratch:
            checkout = Path(scratch)/'source'
            subprocess.run(['git', 'init', str(checkout)], check=True)
            subprocess.run(['git', '-C', str(checkout), 'fetch', '--depth', '1',
                            'https://github.com/Open-Cascade-SAS/OCCT.git', PINS['commit']], check=True)
            subprocess.run(['git', '-C', str(checkout), 'checkout', '--detach', 'FETCH_HEAD'], check=True)
            checkout.rename(source)
    revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True).strip()
    if revision != PINS['commit'] or dirty:
        raise RuntimeError('OCCT checkout differs from pinned commit; use a clean checkout')
    return source


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jobs', type=int, default=4)
    parser.add_argument('--download-cache', type=Path, default=ROOT/'.data/occt-downloads')
    args = parser.parse_args()
    if not 1 <= args.jobs <= 32:
        parser.error('jobs must be 1–32')
    node = shutil.which('node')
    if not node:
        parser.error('Node.js is required')
    prepare = NATIVE.parent/'prepare-runtime.mjs'
    checked = subprocess.run([node, str(prepare), '--check-only'], capture_output=True, encoding='utf-8', errors='replace')
    if checked.returncode == 0:
        subprocess.run([node, str(prepare)], check=True)
        return
    if sys.platform != 'win32' or struct.calcsize('P') != 8:
        parser.error('Source bootstrap currently supports Windows x64; a verified existing runtime can be copied on other platforms')
    if not shutil.which('git'):
        parser.error('Git is required to fetch pinned OCCT sources')
    print('No matching production runtime; building from pinned sources.', flush=True)
    records = json.loads((NATIVE/'downloads.lock.json').read_text('utf-8'))
    home = ROOT/'.data/occt-toolchain/bootstrap'
    installed = {name: install(name, record, args.download_cache.resolve(), home)
                 for name, record in records.items()}
    sdk = ROOT/'.data/occt-toolchain/occt'
    bridge_only = False
    if (sdk/'cablesim-build.json').is_file():
        record = json.loads((sdk/'cablesim-build.json').read_text('utf-8'))
        bridge_only = record.get('pins') == PINS and record.get('files') == sdk_files(sdk)
    command = [sys.executable, str(NATIVE/'build.py'),
               '--emsdk', str(installed['emscripten']), '--cmake', str(installed['cmake']/'bin/cmake.exe'),
               '--ninja', str(installed['ninja']/'ninja.exe'), '--jobs', str(args.jobs)]
    if bridge_only:
        command.append('--bridge-only')
    else:
        command.extend(['--source', str(source_checkout(home))])
    subprocess.run(command, check=True)
    subprocess.run([node, str(prepare)], check=True)


if __name__ == '__main__':
    main()
