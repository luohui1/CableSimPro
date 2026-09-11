"""Extract decorative subjects from the five user-approved visual-kit sheets.

Usage: python scripts/extract_engineering_kit.py --sources /path/to/originals
The original sheets are not loaded by the application. No text or plotted values
from a reference sheet are used as engineering data.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageOps
from collections import deque

SHEETS = {
    'data': '065319C6-A053-4DE5-BF4F-99B4659AA36E.jpeg',
    'visualization': '8EE4F743-D326-465A-9CAE-01FC9D449A60.jpeg',
    'shell': '6C4FCA99-6CBC-42CA-9B06-F6802632556E.jpeg',
    'brand': '30B92321-CEEF-47D2-9969-6396919C078E.jpeg',
    'controls': 'C9A62252-FEB0-412A-A73D-240098AC755C.jpeg',
}
# Bounds measured in the displayed 1408 x 1056 coordinate system; scaled to
# each original JPEG's real pixel dimensions before extraction.
SUBJECTS = [
    ('brand', 'brand', (72, 44, 329, 303)),
    ('cable', 'visualization', (1008, 702, 1118, 788)),
    ('copper', 'data', (62, 333, 116, 387)),
    ('aluminium', 'data', (519, 333, 575, 387)),
    ('shield', 'data', (957, 333, 1003, 385)),
    ('document', 'data', (63, 426, 98, 469)),
    ('book', 'data', (392, 425, 435, 467)),
    ('temperature', 'data', (583, 54, 621, 116)),
    ('wave', 'data', (809, 60, 863, 115)),
    ('layers', 'brand', (863, 730, 900, 774)),
    ('settings', 'brand', (773, 730, 810, 773)),
    ('ruler', 'brand', (681, 730, 726, 773)),
    ('folder', 'shell', (220, 364, 254, 398)),
    ('chart', 'shell', (80, 402, 111, 441)),
    ('check', 'shell', (1053, 299, 1100, 347)),
    ('warning', 'shell', (1054, 378, 1099, 420)),
    ('field', 'visualization', (1059, 87, 1278, 228)),
    ('workflow', 'shell', (77, 330, 111, 371)),
    ('info', 'shell', (1054, 528, 1100, 575)),
    ('power', 'controls', (582, 770, 611, 806)),
]

def isolate(subject: Image.Image) -> Image.Image:
    """Remove only edge-connected near-white mat; retain enclosed highlights."""
    subject = subject.convert('RGBA')
    pixels = subject.load()
    width, height = subject.size
    seen = set()
    queue = deque([(x, y) for x in range(width) for y in (0, height - 1)] +
                  [(x, y) for y in range(height) for x in (0, width - 1)])
    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not (0 <= x < width and 0 <= y < height):
            continue
        seen.add((x, y))
        r, g, b, _ = pixels[x, y]
        if min(r, g, b) < 214 or max(r, g, b) - min(r, g, b) > 28:
            continue
        pixels[x, y] = (r, g, b, 0)
        queue.extend(((x-1,y), (x+1,y), (x,y-1), (x,y+1)))
    return subject

def extract(sources: Path, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    images = {key: Image.open(sources / file).convert('RGB') for key, file in SHEETS.items()}
    cell, columns = 64, 5
    entries = {}
    for index, (name, sheet, bounds) in enumerate(SUBJECTS):
        image = images[sheet]
        box = tuple(round(v * image.size[i % 2] / (1408 if i % 2 == 0 else 1056)) for i, v in enumerate(bounds))
        subject = isolate(image.crop(box))
        subject.thumbnail((54, 54), Image.Resampling.LANCZOS)
        tile = Image.new('RGBA', (cell, cell), (0, 0, 0, 0))
        tile.paste(subject, ((cell - subject.width) // 2, (cell - subject.height) // 2))
        # Transparent padding prevents a rectangular white mat on selected controls.
        if name != 'brand':
            tile.save(output / f'{name}.webp', 'WEBP', quality=75, method=6)
        entries[name] = {'index': index, 'sheet': sheet, 'crop_px': box, 'decorative_only': True}
    brand = images['brand'].crop(tuple(round(v * images['brand'].size[i % 2] / (1408 if i % 2 == 0 else 1056)) for i, v in enumerate(SUBJECTS[0][2])))
    brand = ImageOps.contain(isolate(brand), (128, 128), Image.Resampling.LANCZOS)
    brand.save(output / 'brand.webp', 'WEBP', quality=82, method=6)
    manifest = {
        'version': 1, 'provenance': 'User-provided CableSimPro visual-kit sheets, approved in this conversation.',
        'purpose': 'Decorative icons only. Controls and engineering numbers remain native React/HTML and solver data.',
        'icon_size_px': cell, 'brand_size_px': 128,
        'sheets': {key: {'filename': file, 'sha256': hashlib.sha256((sources / file).read_bytes()).hexdigest()} for key, file in SHEETS.items()},
        'assets': entries,
        'files': {file: hashlib.sha256((output / file).read_bytes()).hexdigest() for file in [f'{name}.webp' for name, _, _ in SUBJECTS]},
    }
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{len(entries)} subjects; {sum((output / file).stat().st_size for file in manifest["files"])} image bytes')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'frontend/public/engineering-kit')
    args = parser.parse_args()
    extract(args.sources, args.output)
