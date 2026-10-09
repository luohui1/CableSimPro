"""Print saved round section profiles, without rebuilding or solving a cable."""
from math import isfinite


def section_drawing(payload, width=510, font='CableChinese'):
    from reportlab.graphics.shapes import Drawing, Circle, Line, Rect, String
    from reportlab.lib import colors
    geometry = payload.get('results', {}).get('geometry', {}).get('artifact', {})
    rows = geometry.get('layers', [])
    profiles = [row.get('section_profile', {}).get('outer', {}) for row in rows]
    # Never replace an unsupported saved contour with a guessed round diameter.
    if not profiles or len(profiles)>32 or any(p.get('kind') != 'circle' or
                           not all(isinstance(p.get(k), (int, float)) and isfinite(p[k]) for k in ('x','z','radius','offset'))
                           or p['radius']+p['offset']<=0
                           for p in profiles):
        return None
    height = max(240, 62+len(rows)*18)
    drawing = Drawing(width, height)
    extent = max(max(abs(p['x']), abs(p['z']))+p['radius']+p['offset'] for p in profiles)
    if extent <= 0:
        return None
    left_width = width*.48
    scale = min(left_width-38, height-66)/(2*extent)
    cx, cy = left_width/2, height/2+8
    drawing.add(Rect(0,0,width,height,fillColor=None,strokeColor=colors.HexColor('#b0b0b0'),strokeWidth=.5))
    drawing.add(String(10,height-19,'结构截面 · 保存的几何轮廓',fontName=font,fontSize=13))
    # Drawing order is visual only: common envelopes first, then each saved core.
    ordered = sorted(enumerate(rows), key=lambda item:(item[1].get('source_target',{}).get('scope')!='common',
                      -(item[1]['section_profile']['outer']['radius']+item[1]['section_profile']['outer']['offset'])))
    shades = [colors.HexColor(value) for value in ('#d0d0d0','#ededed','#b8b8b8','#f5f5f5')]
    for index, row in ordered:
        p = row['section_profile']['outer']
        drawing.add(Circle(cx+p['x']*scale,cy+p['z']*scale,(p['radius']+p['offset'])*scale,
                           fillColor=shades[index%len(shades)],strokeColor=colors.HexColor('#404040'),strokeWidth=.45))
    diameter = geometry.get('outer_diameter_m')
    if isinstance(diameter,(int,float)) and isfinite(diameter):
        from .type_specification import number
        y = 22
        drawing.add(Line(cx-extent*scale,y,cx+extent*scale,y,strokeWidth=.6))
        for x in (cx-extent*scale,cx+extent*scale):
            drawing.add(Line(x,y-3,x,y+3,strokeWidth=.6))
        drawing.add(String(cx,8,'外径 '+number(diameter,1,1000)+' mm（推导）',textAnchor='middle',fontName=font,fontSize=13))
    x = left_width+14
    for index,row in enumerate(rows):
        y = height-44-index*18
        drawing.add(Rect(x,y-1,8,8,fillColor=shades[index%len(shades)],strokeColor=colors.HexColor('#404040'),strokeWidth=.4))
        drawing.add(String(x+14,y,f"{index+1}. {row.get('label') or '结构层'}",fontName=font,fontSize=13))
    drawing.add(String(x,12,'尺寸以分层表为准',fontName=font,fontSize=13))
    return drawing


def section_svg(payload):
    try:
        from reportlab.graphics import renderSVG
    except ImportError:
        return '<p class="spec-note">截面预览环境缺失：请安装宿主依赖 ReportLab；已保存的结构和核对结果保留。</p>'
    # Browser fonts follow the host typography. PDF uses its embedded CJK face.
    drawing = section_drawing(payload, font='Helvetica')
    if drawing is None:
        return '<p class="spec-note">截面图未生成：保存轮廓缺失或超出当前图纸视图范围（圆形、最多 32 层）；请更新结构推导或引用已验证的工程图。</p>'
    svg = renderSVG.drawToString(drawing)
    start = svg.index('<svg')
    return svg[start:].replace('width="510"','width="100%"')
