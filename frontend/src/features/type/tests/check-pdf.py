"""Assertions on the PDF downloaded by the browser, including embedded font bytes."""
import json
import re
import sys
import fitz

with fitz.open(sys.argv[1]) as document:
    audience = sys.argv[3] if len(sys.argv) > 3 else 'internal'
    pages = [page.get_text() for page in document]
    text = '\n'.join(pages)
    compact = ''.join(text.split())
    assert '产品规格书' in compact and '12/20kV' in compact
    assert '铜（第2类·紧压）' in compact and '交联聚乙烯' in compact
    assert '45.2mm' in compact
    if audience == 'customer':
        assert '未计算' not in text
        assert not re.search(r'[0-9a-f]{64}', compact)
        assert all(term not in text for term in ('发布前待完成事项','t_n','来源与运行依据','铅套标称厚度','铅套最薄点'))
        assert document.metadata['subject'] == '客户版产品规格书'
        assert '标准核对表' in text and '余量' in text and '来源与版本' in text
        assert '结构截面' in pages[1] and len(document[1].get_drawings()) > 5
    else:
        assert document.metadata['subject'] == sys.argv[2]
        assert sys.argv[2] in compact
    assert all(word not in text for word in ('core/1','material/cu','material/xlpe','conductor_screen',
        'insulation_screen','outer_diameter_m','mass_kg_per_km','input_digest','output_digest','12000.0','20000.0','浏览器独立方案'))
    fonts = {font[0]:font for page in document for font in page.get_fonts(full=True)}
    embedded = [font[3] for xref,font in fonts.items() if 'DroidSansFallback' in font[3].replace('-', '') and len(document.extract_font(xref)[3]) > 1000]
    assert embedded, '中文字体未嵌入'
    tables = [table for page in document for table in page.find_tables().tables]
    assert len(tables) >= 5
    assert all(table.row_count >= 2 for table in tables), '检测到只有表头的空表'
    assert all('产品规格书' in text and re.search(r'第\s*\d+\s*页\s*/\s*共',text) for text in pages)
    print(json.dumps({'audience':audience,'pages':len(document),'embeddedChinese':embedded,'tables':len(tables),'emptyTables':0,'internalKeys':0,'uncalculated':text.count('未计算'),'visibleDigests':len(re.findall(r'[0-9a-f]{64}',compact))},ensure_ascii=True))
