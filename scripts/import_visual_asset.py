"""Prepare a reviewed illustration locally. Does not invoke any image provider.

Inputs may be output files from Grok-image or other tools; credentials and signed
URLs are never required. Engineering geometry and numerical result files are not
accepted as target slots. Approval here concerns illustration use, not engineering.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import warnings

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SLOTS = {'cable', 'installation', 'documents'}
MAX_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 24_000_000


def prepare_asset(source: Path, *, slot: str, title: str, alt: str,
                  provider: str, source_id: str, rights_note: str,
                  review_note: str, approved: bool, root: Path = ROOT) -> dict:
    """Validate, normalize and register one illustration; no remote I/O.

    The source identifier is a job id, repository ref, or local filename, not a
    provider download URL (which can contain credentials). CLI is authoring-only.
    """
    if slot not in SLOTS:
        raise ValueError('Only cable, installation and documents illustration slots are allowed.')
    if not approved or not all(isinstance(v, str) and v.strip() for v in
                               (title, alt, provider, source_id, rights_note, review_note)):
        raise ValueError('A source, rights note and explicit illustration review are required.')
    if not re.fullmatch(r'[a-z0-9][a-z0-9._-]{0,63}', provider):
        raise ValueError('Invalid provider name.')
    if '://' in source_id or len(source_id) > 240 or any(c in source_id for c in '?&\n\r'):
        raise ValueError('Use a stable job/ref id, never a signed URL or access token.')
    if any(len(value) > 1200 for value in (title, alt, rights_note, review_note)):
        raise ValueError('Illustration metadata is too long.')
    source = source.resolve(strict=True)
    if not source.is_file() or not 0 < source.stat().st_size <= MAX_BYTES:
        raise ValueError('Image must be a file of at most 20 MiB.')
    raw = source.read_bytes()
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(source) as opened:
            if opened.format not in {'PNG', 'JPEG', 'WEBP'} or getattr(opened, 'n_frames', 1) != 1:
                raise ValueError('Only static PNG, JPEG or WebP illustrations are accepted.')
            if opened.width * opened.height > MAX_PIXELS or min(opened.size) < 64:
                raise ValueError('Unsupported image dimensions.')
            opened.load()
            rgba = ImageOps.exif_transpose(opened).convert('RGBA')
            background = Image.new('RGBA', rgba.size, '#edf3f8')
            normalized = Image.alpha_composite(background, rgba).convert('RGB')
            normalized = ImageOps.pad(normalized, (1200, 760), color='#edf3f8', method=Image.Resampling.LANCZOS)
            # New pixel object strips EXIF, comments, GPS, XMP and source metadata.
            clean = Image.new('RGB', normalized.size)
            clean.paste(normalized)
    catalog_path = root / 'frontend/src/engineering-visuals/catalog.json'
    catalog = json.loads(catalog_path.read_text()) if catalog_path.exists() else {'version': 1, 'assets': {}}
    image_path = root / 'frontend/public/engineering' / (slot + '.webp')
    image_path.parent.mkdir(parents=True, exist_ok=True)
    from io import BytesIO
    encoded = BytesIO()
    clean.save(encoded, format='WEBP', quality=88, method=6)
    data = encoded.getvalue()
    record = {
        'src': '/engineering/' + image_path.name, 'title': title.strip(), 'alt': alt.strip(),
        'width': 1200, 'height': 760, 'bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(), 'source_sha256': hashlib.sha256(raw).hexdigest(),
        'provider': provider, 'source_id': source_id, 'rights_note': rights_note.strip(),
        'review_note': review_note.strip(), 'approved_for': 'illustration-only',
        'scope': '结构或流程示意，不代表当前工程、厂家产品或计算结果。',
    }
    catalog['assets'][slot] = record
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    # Validate and encode fully before replacing the shipped asset or its record.
    image_path.write_bytes(data)
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
    return record


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--slot', choices=sorted(SLOTS), required=True)
    for name in ['title', 'alt', 'provider', 'source-id', 'rights-note', 'review-note']:
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--approve-illustration', action='store_true')
    args = vars(parser.parse_args())
    args['approved'] = args.pop('approve_illustration')
    try:
        record = prepare_asset(**args)
    except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        parser.error(str(exc))
    print(f"Prepared {record['src']} ({record['bytes']} bytes); not a solver result.")


if __name__ == '__main__':
    main()
