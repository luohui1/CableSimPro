from __future__ import annotations
import json
from pathlib import Path
import pytest
from PIL import Image
from scripts.import_visual_asset import prepare_asset
from scripts.check_visual_assets import check_assets


def options(tmp_path: Path) -> dict:
    source = tmp_path / 'source.png'
    image = Image.new('RGBA', (96, 96), (0, 0, 0, 0))
    image.save(source)
    return dict(source=source, slot='cable', title='结构说明', alt='结构示意图',
                provider='test-provider', source_id='test-job-001', rights_note='Test fixture',
                review_note='Illustration review only, not engineering review', approved=True,
                root=tmp_path / 'repo')


def test_asset_import_requires_explicit_illustration_approval(tmp_path):
    args = options(tmp_path)
    args['approved'] = False
    with pytest.raises(ValueError, match='explicit illustration review'):
        prepare_asset(**args)
    assert not args['root'].exists()


@pytest.mark.parametrize('slot', ['../result', '/etc/config', 'temperature', 'solver-output'])
def test_only_explanatory_slots_are_allowed(tmp_path, slot):
    args = options(tmp_path)
    args['slot'] = slot
    with pytest.raises(ValueError, match='illustration slots'):
        prepare_asset(**args)


@pytest.mark.parametrize('source_id', ['https://example.com/image?token=secret', 'x?secret=y', 'a&key=b', 'a\nb'])
def test_signed_urls_are_not_stored_as_provenance(tmp_path, source_id):
    args = options(tmp_path)
    args['source_id'] = source_id
    with pytest.raises(ValueError, match='stable job/ref id'):
        prepare_asset(**args)


def test_normalized_webp_flattens_transparency_and_preserves_source(tmp_path):
    args = options(tmp_path)
    source_bytes = args['source'].read_bytes()
    item = prepare_asset(**args)
    assert args['source'].read_bytes() == source_bytes
    with Image.open(args['root'] / 'frontend/public' / item['src'].lstrip('/')) as image:
        assert image.size == (1200, 760)
        assert image.format == 'WEBP'
        assert not image.getexif()
        # Transparent pixels must be flattened over the light workspace, not black.
        assert min(image.convert('RGB').getpixel((600, 380))) > 225
    assert item['approved_for'] == 'illustration-only'
    assert item['provider'] == 'test-provider'


def test_non_images_are_rejected_without_creating_output(tmp_path):
    args = options(tmp_path)
    args['source'].write_text('<svg onload="alert(1)"></svg>')
    with pytest.raises(OSError):
        prepare_asset(**args)
    assert not args['root'].exists()


def test_existing_catalog_passes_integrity_check():
    result = check_assets()
    assert len(result) == 3
    assert sum(x['bytes'] for x in result) < 100_000


def test_tampered_image_fails_integrity_check(tmp_path):
    args = options(tmp_path)
    for slot in ['cable', 'installation', 'documents']:
        args['slot'] = slot
        prepare_asset(**args)
    check_assets(args['root'])
    image = args['root'] / 'frontend/public/engineering/cable.webp'
    image.write_bytes(image.read_bytes() + b'tampered')
    with pytest.raises(ValueError, match='integrity failed'):
        check_assets(args['root'])


def test_remote_catalog_entry_is_rejected(tmp_path):
    args = options(tmp_path)
    for slot in ['cable', 'installation', 'documents']:
        args['slot'] = slot
        prepare_asset(**args)
    catalog_path = args['root'] / 'frontend/src/engineering-visuals/catalog.json'
    catalog = json.loads(catalog_path.read_text())
    catalog['assets']['cable']['src'] = 'https://untrusted.example/image.webp'
    catalog_path.write_text(json.dumps(catalog))
    with pytest.raises(ValueError, match='local WebP'):
        check_assets(args['root'])
