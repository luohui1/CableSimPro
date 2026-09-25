"""Delete regenerable intermediates: caches, builds, test output and scratch.

Never touches user engineering data in .data/ except throw-away test databases,
and never touches anything tracked by git.

Usage: python scripts/clean.py [--dry-run]
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIRS = ['.pytest_cache', 'artifacts', '.tmp', 'frontend/dist', 'frontend/.vite']
DIR_GLOBS = ['**/__pycache__', 'frontend/test-results*', 'frontend/playwright-report*']
FILE_GLOBS = ['**/*.pyc', '**/*.pyo', '**/*.log', '.data/pro-e2e.sqlite*', '.data/*-test.sqlite*']
SKIP = {'.git', '.venv', 'node_modules'}


def tracked() -> set[Path]:
    out = subprocess.run(['git', 'ls-files', '-z'], cwd=ROOT, check=True, capture_output=True).stdout
    return {(ROOT / p).resolve() for p in out.decode('utf-8').split('\0') if p}


def candidates() -> list[Path]:
    found = [ROOT / d for d in DIRS if (ROOT / d).exists()]
    for pattern in DIR_GLOBS + FILE_GLOBS:
        found += [p for p in ROOT.glob(pattern) if not SKIP.intersection(p.relative_to(ROOT).parts)]
    keep = tracked()
    unique = sorted({p.resolve() for p in found}, key=lambda p: len(p.parts))
    result: list[Path] = []
    for p in unique:
        if p in keep or any(parent in result for parent in p.parents):
            continue
        if p.is_dir() and any(t.is_relative_to(p) for t in keep):
            continue
        result.append(p)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dry-run', action='store_true', help='list what would be deleted')
    args = parser.parse_args()
    items = candidates()
    for p in items:
        print(('would delete ' if args.dry_run else 'deleted ') + p.relative_to(ROOT).as_posix())
        if not args.dry_run:
            shutil.rmtree(p) if p.is_dir() else p.unlink()
    print(f'{len(items)} intermediate item(s) {"found" if args.dry_run else "removed"}')


if __name__ == '__main__':
    main()
