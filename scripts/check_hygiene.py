"""Repository hygiene gate: fail on committed junk, version-named files and dead code.

Rules are documented in AGENTS.md ("仓库卫生规则"). Known legacy violations live in
scripts/hygiene-baseline.txt; that list may only shrink. An entry that no longer
violates must be deleted from the baseline, otherwise this check fails.

Usage: python scripts/check_hygiene.py        (exit 1 on any violation)
"""
from __future__ import annotations

import fnmatch
from hashlib import sha256
import json
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / 'scripts/hygiene-baseline.txt'

# Generated output, caches, scratch and bundles never belong in git.
FORBIDDEN = [
    '*/__pycache__/*', '*.pyc', '*.pyo', '.pytest_cache/*', 'node_modules/*', '*/node_modules/*',
    'artifacts/*',
    '.data/*', 'data/*', '*.sqlite', '*.sqlite-*', '*.db', '*.log', '*.bin', '*.part[0-9]*',
    '.bootstrap/*', '*chunk-[0-9]*', '.tmp/*', '*/.tmp/*', '*.orig', '*.rej', '*.bak', '*~',
    '.DS_Store', '*/.DS_Store', 'Thumbs.db', '.env', '*/.env', '.codex*', '.development/*',
]
# Versions belong in git tags / CHANGELOG, not in file names.
VERSION_NAME = re.compile(
    r'(?i)(?:^|[-_.])(?:v\d{2,}|v\d+(?:\.\d+)+|r\d+)(?=[-_.]|$)'   # _v04, V073, v0.7, R21_
    r'|(?:19|20)\d{2}-?\d{2}-?\d{2}'                               # 20260908, 2026-09-08
    r'|(?i:(?:^|[-_.])(?:legacy|old|new|final|tmp|temp|backup|copy)(?=[-_.]|$))'
    # CamelCase suffix detection must stay case-sensitive: Temperature is not TempFile.
    r'|(?-i:^(?:[Ll]egacy|[Oo]ld|[Nn]ew|[Ff]inal|[Tt]mp|[Tt]emp|[Bb]ackup)[A-Z])'
)
MAX_BYTES = 1_000_000
BINARY_EXT = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.glb', '.step', '.stp', '.brep', '.pdf', '.zip', '.woff', '.woff2'}
BINARY_DIRS = ['design/*', 'docs/*']
# The documentation site's product screenshots, regenerated from the real product with
# `npm run screenshots` in site/; only WebP is allowed there.
SITE_SCREENSHOTS = 'site/src/assets/screenshots/'


def tracked() -> list[str]:
    out = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, check=True, capture_output=True).stdout
    return [p for p in out.decode('utf-8').split('\0') if p and (ROOT / p).exists()]


def match(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, p) or fnmatch.fnmatch('/' + path, '*/' + p) for p in patterns)


def forbidden_files(files: list[str]) -> list[str]:
    return [f'forbidden: {f}' for f in files if match(f, FORBIDDEN) and not f.endswith('.env.example')]


def version_names(files: list[str]) -> list[str]:
    # "copy" is the functional action icon mandated by VISUAL_ASSETS.md,
    # not a duplicate-file suffix. Keep the exception confined to that asset.
    return [f'version-or-scratch name: {f}' for f in files
            if f != 'design/icons/action/copy.svg' and VERSION_NAME.search(PurePosixPath(f).stem)]


def large_or_misplaced_binaries(files: list[str]) -> list[str]:
    issues = []
    for f in files:
        size = (ROOT / f).stat().st_size
        if size > MAX_BYTES:
            issues.append(f'too large ({size // 1024} KB > {MAX_BYTES // 1024} KB): {f}')
        if PurePosixPath(f).suffix.lower() in BINARY_EXT and not match(f, BINARY_DIRS) and not site_screenshot(f) and not sealed_plugin_cover(f,files):
            issues.append(f'binary outside design or docs: {f}')
    return issues


def site_screenshot(path: str) -> bool:
    return path.startswith(SITE_SCREENSHOTS) and PurePosixPath(path).suffix.lower() == '.webp'


def sealed_plugin_cover(path: str, files: list[str]) -> bool:
    """Only the declared, byte-verified first-party presentation cover is an exception."""
    if not re.fullmatch(r'plugins/[a-z][a-z0-9.-]*/assets/cover\.webp',path):return False
    plugin='/'.join(path.split('/')[:2]);manifest=plugin+'/plugin.json'
    if manifest not in files:return False
    try:
        data=json.loads((ROOT/manifest).read_text(encoding='utf-8'))
        asset=next((item for item in data.get('presentation',{}).get('assets',[]) if item.get('role')=='cover'
            and item.get('path')=='assets/cover.webp' and item.get('media_type')=='image/webp'),None)
        record=next((item for item in data.get('files',[]) if item.get('path')=='assets/cover.webp'),None)
        if not asset or not record:return False
        raw=(ROOT/path).read_bytes()
        return (len(raw)>=12 and raw[:4]==b'RIFF' and raw[8:12]==b'WEBP'
            and len(raw)==record['size_bytes'] and sha256(raw).hexdigest()==record['sha256'])
    except (OSError,ValueError,TypeError,KeyError):return False


def branch_bound_workflows(files: list[str]) -> list[str]:
    issues = []
    for f in files:
        if not fnmatch.fnmatch(f, '.github/workflows/*.y*ml'):
            continue
        text = (ROOT / f).read_text(encoding='utf-8')
        on_block = text.split('\njobs:', 1)[0]
        for branches in re.findall(r'branches:\s*\[([^\]]*)\]', on_block):
            if 'main' not in re.split(r"[\s,'\"]+", branches):
                issues.append(f'workflow bound to branches without main: {f} [{branches.strip()}]')
        if 'pull_request' not in on_block and not re.search(r'branches:\s*\[[^\]]*\bmain\b', on_block):
            issues.append(f'workflow runs neither on main nor on pull_request: {f}')
    return issues


def dead_scripts(files: list[str]) -> list[str]:
    consumers = [f for f in files if PurePosixPath(f).suffix in {'.py', '.mjs', '.ts', '.tsx', '.yml', '.yaml', '.json', '.md', '.toml', '.ini', '.css'}]
    texts = {f: (ROOT / f).read_text(encoding='utf-8', errors='ignore') for f in consumers}
    globs = {g for body in texts.values() for g in re.findall(r'scripts/[\w./-]*\*[\w.*/-]*', body)}
    issues = []
    for f in files:
        validation = fnmatch.fnmatch(f, 'plugins/*/validation/*.py')
        if not validation and (not f.startswith('scripts/') or f in {'scripts/hygiene-baseline.txt'}):
            continue
        name, stem = PurePosixPath(f).name, PurePosixPath(f).stem
        if validation:
            parent=PurePosixPath(f).parent.as_posix()
            plugin='/'.join(f.split('/')[:2])
            local=f[len(plugin)+1:]
            used=any(other != f and (f in body or other.startswith(plugin+'/') and local in body or
                (PurePosixPath(other).parent.as_posix()==parent or parent in body) and
                re.search(rf'\bfrom {re.escape(stem)} import|\bimport {re.escape(stem)}\b',body)) for other,body in texts.items())
        else:
            used = any(fnmatch.fnmatch(f, g) for g in globs) or any(other != f and (name in body or re.search(rf'\bfrom {re.escape(stem)} import|\bimport {re.escape(stem)}\b', body)) for other, body in texts.items())
        if not used:
            issues.append(f'script not referenced by CI, code, package.json or docs: {f}')
    return issues


def main() -> int:
    files = tracked()
    issues = sorted(set(
        forbidden_files(files) + version_names(files) + large_or_misplaced_binaries(files)
        + branch_bound_workflows(files) + dead_scripts(files)
    ))
    baseline = {line.strip() for line in BASELINE.read_text(encoding='utf-8').splitlines()
                if line.strip() and not line.startswith('#')} if BASELINE.exists() else set()
    new = [i for i in issues if i not in baseline]
    stale = sorted(baseline - set(issues))
    for i in new:
        print(f'NEW   {i}')
    for i in stale:
        print(f'STALE {i}  (fixed - delete this line from scripts/hygiene-baseline.txt)')
    print(f'hygiene: {len(new)} new, {len(stale)} stale baseline entries, {len(baseline) - len(stale)} legacy items pending removal')
    return 1 if new or stale else 0


if __name__ == '__main__':
    sys.exit(main())
