"""Verify both batches of approved icon bytes, dimensions and provenance."""
from hashlib import sha256
import json
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'frontend/public/engineering-kit'
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
assert len(manifest['assets']) == 20
assert len(manifest['files']) == 20
size = 0
for name, expected in manifest['files'].items():
    path = root / name
    assert path.parent == root and path.suffix == '.webp'
    data = path.read_bytes()
    assert sha256(data).hexdigest() == expected, f'Asset hash mismatch: {name}'
    with Image.open(path) as image:
        image.load()
        assert image.mode == 'RGBA'
        assert max(image.size) == (128 if name == 'brand.webp' else 64)
    size += len(data)
for name, entry in manifest['assets'].items():
    assert entry['decorative_only'] is True
    assert entry['sheet'] in manifest['sheets']
    assert f'{name}.webp' in manifest['files']

supplement = json.loads((root / 'controls-manifest.json').read_text(encoding='utf-8'))
assert set(supplement['assets']) == {'locked', 'edit', 'database', 'resistance', 'error', 'lab'}
for name, entry in supplement['assets'].items():
    assert entry['decorative_only'] is True
    assert supplement['sheets'][entry['sheet']] == manifest['sheets'][entry['sheet']]
    assert entry['file'] == f'{name}.webp'
    path = root / entry['file']
    data = path.read_bytes()
    assert sha256(data).hexdigest() == entry['sha256'], f'Asset hash mismatch: {name}'
    with Image.open(path) as image:
        image.load()
        assert image.size == (64, 64) and image.mode == 'RGBA'
    size += len(data)
assert size < 65536
print(f'26 approved icon files verified; {size} bytes; no reference-sheet sample values.')
