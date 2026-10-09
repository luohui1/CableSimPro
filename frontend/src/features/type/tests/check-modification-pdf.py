"""Inspect the actual customer PDF downloaded in the modification workflow."""
import json
from pathlib import Path
import re
import sys
import fitz


with fitz.open(sys.argv[1]) as pdf:
    pages = [page.get_text() for page in pdf]
    compact = ''.join(''.join(pages).split())
    assert '型号摘要' in pages[0] and '签字' in pages[0] and '草稿' in pages[0]
    assert '结构截面' in pages[1] and len(pdf[1].get_drawings()) > 5
    for term in ('45.8mm','5.8','标准核对表','余量','缺项','未覆盖','来源与版本','kg/km','未绑定资源'):
        assert term in compact, term
    assert not re.search(r'[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f-]{27,}', compact)
    assert all(term not in compact for term in ('core/1','material/cu','conductor_screen','insulation_screen','outer_diameter_m','input_digest','output_digest','cablesim.'))
    fonts = {font[0]:font for page in pdf for font in page.get_fonts(full=True)}
    assert any('DroidSansFallback' in font[3].replace('-','') and len(pdf.extract_font(xref)[3])>1000 for xref,font in fonts.items())
    for page in pdf:
        assert all(25<=word[0]<word[2]<=page.rect.width-25 and 10<=word[1]<word[3]<page.rect.height-10 for word in page.get_text('words')), '正文越界'
        assert '产品规格书' in page.get_text() and '共' in page.get_text()
        header = [span for block in page.get_text('dict')['blocks'] for line in block.get('lines', [])
                  for span in line['spans'] if span['text']=='产品规格书' and span['bbox'][1]<40]
        assert header and all(all(30 <= (span['color'] >> shift) & 255 <= 33 for shift in (0,8,16)) for span in header), '页眉未恢复打印墨色'
    pictures = []
    for index in range(2):
        file = Path(sys.argv[2])/f'specification-page-{index+1}.png'
        pdf[index].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(file)
        pictures.append(str(file.resolve()))
    print(json.dumps({'pages':len(pdf),'pictures':pictures,'internalIds':0,'missingKept':True,'savedVectorSection':True},ensure_ascii=True))
