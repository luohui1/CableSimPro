from pathlib import Path
import zipfile
from scripts.package_demo import build_archive


def test_original_library_blobs_never_ship_even_under_source_directory(tmp_path: Path):
    for name in ['frontend/dist/index.html', 'backend/main.py', 'backend/library-blobs/secret.pdf', 'backend/.env', 'docs/private.woff2']:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('test')
    with zipfile.ZipFile(build_archive(tmp_path)) as archive:
        names = archive.namelist()
        assert 'CableSimPro/backend/main.py' in names
        assert not any('library-blobs' in n or '.env' in n or n.endswith('.woff2') for n in names)
