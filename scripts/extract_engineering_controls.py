"""Extract the second batch of approved control icons without changing batch one.

python scripts/extract_engineering_controls.py --sources /path/to/original-jpegs
Reference pixels are decorative artwork, never parameter values or chart samples.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image
from extract_engineering_kit import SHEETS, isolate

SUBJECTS = [
    ('locked', 'data', (1044, 47, 1116, 126)),
    ('edit', 'data', (1210, 46, 1283, 126)),
    ('database', 'data', (1295, 46, 1370, 126)),
    ('resistance', 'data', (326, 57, 369, 110)),
    ('error', 'data', (734, 166, 770, 203)),
    ('lab', 'data', (733, 425, 772, 470)),
]


def extract(sources: Path, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    entries, source_files = {}, {}
    for name, sheet, bounds in SUBJECTS:
        source = sources / SHEETS[sheet]
        with Image.open(source) as image:
            box = tuple(round(value * image.size[index % 2] /
                              (1408 if index % 2 == 0 else 1056))
                        for index, value in enumerate(bounds))
            subject = isolate(image.crop(box))
        subject.thumbnail((54, 54), Image.Resampling.LANCZOS)
        tile = Image.new('RGBA', (64, 64))
        tile.paste(subject, ((64 - subject.width) // 2, (64 - subject.height) // 2))
        file = output / f'{name}.webp'
        tile.save(file, 'WEBP', quality=82, method=6)
        entries[name] = {
            'sheet': sheet, 'crop_px': box, 'decorative_only': True,
            'file': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
        }
        source_files[sheet] = {'filename': source.name,
                              'sha256': hashlib.sha256(source.read_bytes()).hexdigest()}
    manifest = {
        'version': 1, 'batch': 2, 'icon_size_px': 64,
        'provenance': 'Additional crops from the user-approved CableSimPro UI Kit.',
        'purpose': 'Decorative controls only; numbers, units and diagrams remain native.',
        'sheets': source_files, 'assets': entries,
    }
    (output / 'controls-manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{len(entries)} additional icons, {sum((output / e["file"]).stat().st_size for e in entries.values())} bytes')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'frontend/public/engineering-kit')
    args = parser.parse_args()
    extract(args.sources, args.output)
