"""Package source and built UI, excluding runtime data, environments and fonts."""
from __future__ import annotations
import json
import os
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_ROOT_FILES = {'README.md', 'pytest.ini', '.gitignore', '.dockerignore', 'Dockerfile', 'compose.yaml'}
ALLOWED_DIRECTORIES = {'backend', 'frontend', 'scripts', 'docs', 'tests', '.github'}
EXCLUDED_PARTS = {'node_modules', '__pycache__', '.pytest_cache', 'playwright-report', 'test-results', 'test-results-windows', 'playwright-report-windows', '.venv', '.data', '.git'}


def build_archive(root: Path = ROOT) -> Path:
    if not (root / 'frontend/dist/index.html').is_file():
        raise RuntimeError('Build frontend/dist before packaging; the demo must not ship an unbuilt UI.')
    output = root / 'artifacts/CableSimPro-demo.zip'
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        commit = os.environ.get('GITHUB_SHA', 'unavailable')
    count = 0
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(root.rglob('*')):
            relative = path.relative_to(root)
            if not path.is_file() or path.is_symlink():
                continue
            if relative.parts[0] not in ALLOWED_DIRECTORIES and relative.as_posix() not in ALLOWED_ROOT_FILES:
                continue
            if any(part in EXCLUDED_PARTS for part in relative.parts):
                continue
            if path.name in {'providers.json','local-render.cjs'} or path.suffix.lower() in ('.pyc', '.sqlite', '.db', '.ttf', '.otf', '.woff', '.woff2', '.eot') or path.name.startswith('.env'):
                continue
            archive.write(path, 'CableSimPro/' + relative.as_posix())
            count += 1
        info = {'product': 'CableSimPro', 'version': '0.7.4', 'git_checkout_sha': commit,
                'github_run_id': os.environ.get('GITHUB_RUN_ID'), 'includes_prebuilt_frontend': True,
                'engineering_status': 'preview; not a complete IEC implementation or independently certified'}
        archive.writestr('CableSimPro/BUILD_INFO.json', json.dumps(info, ensure_ascii=False, indent=2))
    print(f'Packaged {count} files: {output} ({output.stat().st_size:,} bytes)')
    return output


if __name__ == '__main__':
    from third_party_notices import collect
    collect()
    build_archive()
