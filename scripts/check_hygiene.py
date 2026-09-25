"""Repository hygiene gate: fail on committed junk, version-named files and dead code.

Rules are documented in AGENTS.md ("仓库卫生规则"). Known legacy violations live in
scripts/hygiene-baseline.txt; that list may only shrink. An entry that no longer
violates must be deleted from the baseline, otherwise this check fails.

Usage: python scripts/check_hygiene.py        (exit 1 on any violation)
"""
from __future__ import annotations

import fnmatch
import posixpath
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / 'scripts/hygiene-baseline.txt'

# Generated output, caches, scratch and bundles never belong in git.
FORBIDDEN = [
    '*/__pycache__/*', '*.pyc', '*.pyo', '.pytest_cache/*', 'node_modules/*', '*/node_modules/*',
    'frontend/dist/*', 'frontend/test-results*', 'frontend/playwright-report*', 'artifacts/*',
    '.data/*', 'data/*', '*.sqlite', '*.sqlite-*', '*.db', '*.log', '*.bin', '*.part[0-9]*',
    '.bootstrap/*', '*chunk-[0-9]*', '.tmp/*', '*/.tmp/*', '*.orig', '*.rej', '*.bak', '*~',
    '.DS_Store', '*/.DS_Store', 'Thumbs.db', '.env', '*/.env', '.codex*', '.development/*',
]
# Versions belong in git tags / CHANGELOG, not in file names.
VERSION_NAME = re.compile(
    r'(?i)(?:^|[-_.])(?:v\d{2,}|v\d+(?:\.\d+)+|r\d+)(?=[-_.]|$)'   # _v04, V073, v0.7, R21_
    r'|(?:19|20)\d{2}-?\d{2}-?\d{2}'                               # 20260908, 2026-09-08
    r'|(?i:(?:^|[-_.])(?:legacy|old|new|final|tmp|temp|backup|copy)(?=[-_.]|$))'
    r'|^(?:Legacy|Old|New|Final|Tmp|Temp|Backup)[A-Z]'
)
MAX_BYTES = 1_000_000
BINARY_EXT = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.glb', '.step', '.stp', '.brep', '.pdf', '.zip', '.woff', '.woff2'}
BINARY_DIRS = ['frontend/public/*', 'docs/*']
FRONTEND_EXT = ('', '.ts', '.tsx', '.js', '.mjs', '.css', '.json', '/index.ts', '/index.tsx')
IMPORT = re.compile(r"""(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]|@import\s+(?:url\()?['"]([^'"]+)['"]""")
# Frontend files consumed by tooling rather than imported from main.tsx.
FRONTEND_TOOLING = {'frontend/src/design-system/tokens.json', 'frontend/src/vite-env.d.ts'}


def tracked() -> list[str]:
    out = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, check=True, capture_output=True).stdout
    return [p for p in out.decode('utf-8').split('\0') if p and (ROOT / p).exists()]


def match(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, p) or fnmatch.fnmatch('/' + path, '*/' + p) for p in patterns)


def forbidden_files(files: list[str]) -> list[str]:
    return [f'forbidden: {f}' for f in files if match(f, FORBIDDEN) and not f.endswith('.env.example')]


def version_names(files: list[str]) -> list[str]:
    return [f'version-or-scratch name: {f}' for f in files if VERSION_NAME.search(PurePosixPath(f).stem)]


def large_or_misplaced_binaries(files: list[str]) -> list[str]:
    issues = []
    for f in files:
        size = (ROOT / f).stat().st_size
        if size > MAX_BYTES:
            issues.append(f'too large ({size // 1024} KB > {MAX_BYTES // 1024} KB): {f}')
        if PurePosixPath(f).suffix.lower() in BINARY_EXT and not match(f, BINARY_DIRS):
            issues.append(f'binary outside frontend/public or docs: {f}')
    return issues


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


def dead_frontend(files: list[str]) -> list[str]:
    src = [f for f in files if f.startswith('frontend/src/')]
    seen: set[str] = set()
    stack = ['frontend/src/main.tsx']
    while stack:
        cur = stack.pop()
        if cur in seen or not (ROOT / cur).is_file():
            continue
        seen.add(cur)
        for m in IMPORT.finditer((ROOT / cur).read_text(encoding='utf-8')):
            spec = next(g for g in m.groups() if g)
            if not spec.startswith('.'):
                continue
            base = posixpath.join(posixpath.dirname(cur), spec)
            for ext in FRONTEND_EXT:
                cand = posixpath.normpath(base + ext)
                if (ROOT / cand).is_file():
                    stack.append(cand)
                    break
    return [f'unreachable from frontend/src/main.tsx: {f}' for f in src if f not in seen and f not in FRONTEND_TOOLING]


def dead_scripts(files: list[str]) -> list[str]:
    consumers = [f for f in files if not f.startswith('docs/') and PurePosixPath(f).suffix in {'.py', '.mjs', '.ts', '.tsx', '.yml', '.yaml', '.json', '.md', '.toml', '.ini', '.css'}]
    texts = {f: (ROOT / f).read_text(encoding='utf-8', errors='ignore') for f in consumers}
    globs = {g for body in texts.values() for g in re.findall(r'scripts/[\w./-]*\*[\w.*/-]*', body)}
    issues = []
    for f in files:
        if not f.startswith('scripts/') or f in {'scripts/hygiene-baseline.txt'}:
            continue
        name, stem = PurePosixPath(f).name, PurePosixPath(f).stem
        used = any(fnmatch.fnmatch(f, g) for g in globs) or any(other != f and (name in body or re.search(rf'\bfrom {re.escape(stem)} import|\bimport {re.escape(stem)}\b', body)) for other, body in texts.items())
        if not used:
            issues.append(f'script not referenced by CI, code, package.json or README: {f}')
    return issues


def main() -> int:
    files = tracked()
    issues = sorted(set(
        forbidden_files(files) + version_names(files) + large_or_misplaced_binaries(files)
        + branch_bound_workflows(files) + dead_frontend(files) + dead_scripts(files)
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
