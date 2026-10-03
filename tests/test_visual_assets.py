"""Validate the deliverable SVG contract and full coverage from its source brief."""
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SVG = '{http://www.w3.org/2000/svg}'


def test_all_icons_follow_the_visual_asset_contract():
    brief = (ROOT / 'docs/design/VISUAL_ASSETS.md').read_text(encoding='utf-8')
    expected = []
    catalog = brief.split('### 3.1 图标清单', 1)[1].split('### 3.2', 1)[0]
    for group, names in re.findall(r'\| `([^`]+)`(?: ★)? \| (.+)', catalog):
        expected.extend(f'{group}/{name}.svg' for name in re.findall(r'`([^`]+)`', names))
    assert expected
    actual = {p.relative_to(ROOT / 'design/icons').as_posix() for p in (ROOT / 'design/icons').glob('*/*.svg')}
    assert set(expected) == actual
    for relative in expected:
        root = ET.parse(ROOT / 'design/icons' / relative).getroot()
        assert root.attrib['viewBox'] == '0 0 24 24', relative
        assert root.attrib['stroke-width'] == '1.5', relative
        assert not {'width', 'height', 'style'} & root.attrib.keys(), relative
        assert root.find(SVG + 'title').text.strip(), relative
        for node in root.iter():
            assert node.tag in {SVG + tag for tag in ('svg', 'title', 'path', 'circle', 'rect', 'g')}, relative
            assert 'style' not in node.attrib, relative
            for key in ('fill', 'stroke'):
                if key in node.attrib:
                    assert node.attrib[key] in {'none', 'currentColor'}, relative
            if node.tag == SVG + 'circle' and node.get('fill') == 'currentColor':
                assert float(node.attrib['r']) >= 1.5, relative


def test_asset_colors_are_only_in_the_shared_rule_file():
    brief = (ROOT / 'docs/design/FRONTEND_REQUIREMENTS.md').read_text(encoding='utf-8')
    rule = (ROOT / 'design/tokens.css').read_text(encoding='utf-8')
    colors = re.compile(r'#[0-9A-Fa-f]{6}\b')
    assert {c.lower() for c in colors.findall(rule)} <= {c.lower() for c in colors.findall(brief)}
    for folder in ('icons', 'motion', 'brand'):
        for path in (ROOT / 'design' / folder).rglob('*'):
            if path.suffix in {'.svg', '.css', '.js', '.html'}:
                assert not colors.search(path.read_text(encoding='utf-8')), path
