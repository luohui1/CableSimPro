"""Print saved round section profiles, without rebuilding or solving a cable."""
from math import isfinite
from html import escape


def section_layout(payload, width=510):
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
    extent = max(max(abs(p['x']), abs(p['z']))+p['radius']+p['offset'] for p in profiles)
    if extent <= 0:
        return None
    left_width = width*.48
    scale = min(left_width-38, height-66)/(2*extent)
    cx, cy = left_width/2, height/2+8
    ordered = sorted(enumerate(rows), key=lambda item:(item[1].get('source_target',{}).get('scope')!='common',
                      -(item[1]['section_profile']['outer']['radius']+item[1]['section_profile']['outer']['offset'])))
    return geometry,rows,height,extent,left_width,scale,cx,cy,ordered


def section_drawing(payload, width=510, font='CableChinese'):
    layout=section_layout(payload,width)
    if layout is None:return None
    geometry,rows,height,extent,left_width,scale,cx,cy,ordered=layout
    from reportlab.graphics.shapes import Drawing, Circle, Line, Rect, String
    from reportlab.lib import colors
    drawing = Drawing(width, height)
    drawing.add(Rect(0,0,width,height,fillColor=None,strokeColor=colors.HexColor('#b0b0b0'),strokeWidth=.5))
    drawing.add(String(10,height-19,'结构截面 · 保存的几何轮廓',fontName=font,fontSize=13))
    # Drawing order is visual only: common envelopes first, then each saved core.
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
    # SVG needs only the saved circle profiles. Loading the PDF font/rendering
    # stack on the first HTML read costs over one second on the release host.
    # Both formats share the exact layout, order and unrounded coordinates.
    width=510;layout=section_layout(payload,width)
    if layout is None:
        return '<p class="spec-note">截面图未生成：保存轮廓缺失或超出当前图纸视图范围（圆形、最多 32 层）；请更新结构推导或引用已验证的工程图。</p>'
    geometry,rows,height,extent,left_width,scale,cx,cy,ordered=layout
    shades=('#d0d0d0','#ededed','#b8b8b8','#f5f5f5')
    parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="结构截面 · 保存的几何轮廓">',
           f'<rect x="0" y="0" width="{width}" height="{height}" fill="none" stroke="#b0b0b0" stroke-width="0.5"/>',
           '<g font-size="13" fill="#000000"><text x="10" y="19">结构截面 · 保存的几何轮廓</text>']
    for index,row in ordered:
        p=row['section_profile']['outer']
        parts.append(f'<circle cx="{cx+p["x"]*scale}" cy="{height-cy-p["z"]*scale}" r="{(p["radius"]+p["offset"])*scale}" fill="{shades[index%len(shades)]}" stroke="#404040" stroke-width="0.45"/>')
    diameter=geometry.get('outer_diameter_m')
    if isinstance(diameter,(int,float)) and isfinite(diameter):
        from .type_specification import number
        y=height-22
        parts.append(f'<path d="M {cx-extent*scale} {y} H {cx+extent*scale} M {cx-extent*scale} {y-3} V {y+3} M {cx+extent*scale} {y-3} V {y+3}" fill="none" stroke="#000000" stroke-width="0.6"/>')
        parts.append(f'<text x="{cx}" y="{height-8}" text-anchor="middle">外径 {number(diameter,1,1000)} mm（推导）</text>')
    x=left_width+14
    for index,row in enumerate(rows):
        y=44+index*18
        parts.append(f'<rect x="{x}" y="{y-7}" width="8" height="8" fill="{shades[index%len(shades)]}" stroke="#404040" stroke-width="0.4"/>')
        parts.append(f'<text x="{x+14}" y="{y}">{index+1}. {escape(row.get("label") or "结构层")}</text>')
    parts.append(f'<text x="{x}" y="{height-12}">尺寸以分层表为准</text></g></svg>')
    return ''.join(parts)
