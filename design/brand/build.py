"""Rebuild app.ico from mark.svg geometry and the canonical light theme tokens.

Usage from design/: npm run brand (requires Pillow).
The icon uses a neutral paper disk so its outline remains visible on either taskbar.
"""
from pathlib import Path
import re
import xml.etree.ElementTree as ET

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
tokens = (HERE.parent / 'tokens.css').read_text(encoding='utf-8').split('[data-theme="dark"]')[0]
colors = dict(re.findall(r'--([a-z-]+):\s*(#[0-9A-Fa-f]{6});', tokens))
root = ET.parse(HERE / 'mark.svg').getroot()
scale = 32
canvas = Image.new('RGBA', (24 * scale, 24 * scale))
draw = ImageDraw.Draw(canvas)
draw.ellipse((scale, scale, 23 * scale, 23 * scale), fill=colors['panel'])

def color(value):
    if value == 'currentColor':
        return colors['text']
    return colors[re.search(r'var\(--([a-z-]+)', value)[1]]

for node in root.findall('{http://www.w3.org/2000/svg}circle'):
    x, y, radius = [float(node.attrib[k]) for k in ('cx', 'cy', 'r')]
    width = float(node.get('stroke-width', '0'))
    # Pillow draws the stroke inward; expand by half the SVG stroke first.
    outer = radius + width / 2
    box = tuple(v * scale for v in (x - outer, y - outer, x + outer, y + outer))
    if node.get('stroke'):
        draw.ellipse(box, outline=color(node.get('stroke')), width=round(width * scale))
    else:
        draw.ellipse(box, fill=color(node.get('fill')))
canvas.save(HERE / 'app.ico', sizes=[(s, s) for s in (16, 24, 32, 48, 256)])
print('app.ico: 16 / 24 / 32 / 48 / 256')
