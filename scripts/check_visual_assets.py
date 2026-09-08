"""Verify the shipped illustration catalog without contacting an image service."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def check_assets(root: Path = ROOT) -> list[dict]:
    catalog = json.loads((root / 'frontend/src/engineering-visuals/catalog.json').read_text())
    if catalog.get('version') != 1 or set(catalog.get('assets', {})) != {'cable', 'installation', 'documents'}:
        raise ValueError('Missing or unknown illustration slots.')
    checked = []
    for slot, item in catalog['assets'].items():
        src = item.get('src', '')
        if not re.fullmatch(r'/engineering/[a-z0-9-]+\.webp', src):
            raise ValueError('Illustrations must be local WebP files.')
        if item.get('approved_for') != 'illustration-only' or not item.get('review_note') or not item.get('rights_note'):
            raise ValueError('Unreviewed illustration in production catalog.')
        source_id = item.get('source_id', '')
        if any(token in source_id for token in ['://', '?', '&', '\n', '\r']):
            raise ValueError('Stable source IDs only; no signed provider URLs.')
        path = root / 'frontend/public' / src.lstrip('/')
        data = path.read_bytes()
        if len(data) != item['bytes'] or len(data) > 1_000_000 or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError(f'Asset integrity failed: {slot}')
        with Image.open(path) as image:
            if image.format != 'WEBP' or image.size != (1200, 760) or image.size != (item['width'], item['height']):
                raise ValueError(f'Asset dimensions failed: {slot}')
            if image.getexif() or 'xmp' in image.info:
                raise ValueError(f'Private metadata present: {slot}')
        checked.append({'slot': slot, 'bytes': len(data), 'sha256': item['sha256']})
    return checked


if __name__ == '__main__':
    result = check_assets()
    print(json.dumps({'assets': result, 'total_bytes': sum(x['bytes'] for x in result)}, indent=2))
