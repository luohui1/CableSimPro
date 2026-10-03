"""CadQuery/Open CASCADE geometry plugin. No host state or engineering approvals."""
from pathlib import Path
import json
import math
import platform
from time import perf_counter
from hashlib import sha256
from collections import OrderedDict
from array import array
from base64 import b64encode

PROTOCOL = 'cablesim.run/2'
VERSION = 'CAD-CONCENTRIC-0.4.0'
RESIDENT = False
SHAPE_CACHE = OrderedDict()


def positive(value, name, maximum):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 < value <= maximum:
        raise ValueError(name + '必须是范围内的正数')
    return float(value)


def prepare(document, parameters):
    if document.get('schema_version') != 'cablesim.domain/1':
        raise ValueError('只接收有效的 SI 领域文档')
    types = document.get('cable_types', [])
    target = parameters.get('cable_type_id')
    cable = next((c for c in types if c['id'] == target), None)
    if cable is None:
        raise ValueError('必须选择当前文档中的型号')
    cores = cable.get('cores', [])
    if cable.get('construction') != 'single_core' or len(cores) != 1 or cores[0].get('layers'):
        raise ValueError('当前仅支持单芯同心公共层结构')
    core = cores[0]
    if core.get('x', 0) or core.get('z', 0):
        raise ValueError('偏心结构尚未接入')
    conductor = core['conductor']
    if conductor.get('form') not in ('unspecified', 'solid_round', 'stranded_round', 'stranded_round_compacted', 'segmental') or conductor.get('inner_diameter'):
        raise ValueError('扇形与中空导体尚未接入')
    layers = cable.get('common_layers', [])
    if not 1 <= len(layers) <= 16 or len({l['role'] for l in layers}) != len(layers):
        raise ValueError('公共层应为 1–16 层，角色不可重复')
    if any(l.get('form') == 'corrugated' for l in layers):
        raise ValueError('波纹结构尚未接入')
    length = positive(parameters.get('length_m', .18), '展示长度', 1)
    radius = positive(conductor['diameter'], '导体直径', .2) / 2
    materials = {m['id']: m for m in document.get('materials', [])}
    if conductor.get('form') in ('stranded_round_compacted', 'segmental'):
        area = positive(conductor.get('nominal_area'), '导体标称截面积', .1)
        if area > math.pi*radius**2 + 1e-12:
            raise ValueError('导体标称截面积超过设计外径包络')
        if conductor.get('lay_factor') is not None:
            if positive(conductor['lay_factor'], '导体绞入系数', 1e6) < 1:
                raise ValueError('导体绞入系数不得小于 1')
    rows = [{'role': 'conductor', 'material': conductor['material'], 'inner_radius_m': 0., 'outer_radius_m': radius,
             'construction': conductor}]
    for layer in layers:
        inner = radius
        radius += positive(layer['thickness'], '层厚', .05)
        rows.append({'role': layer['role'], 'material': layer['material'], 'inner_radius_m': inner, 'outer_radius_m': radius,
                     'construction': layer})
    if radius > .25:
        raise ValueError('外径超出此建模方法范围')
    for row in rows:
        if row['material'] not in materials:
            raise ValueError('材料引用不存在')
        if materials[row['material']].get('density') is not None:
            positive(materials[row['material']]['density'], '材料密度', 1e6)
        row.update(entity=cable['id'] + '/' + row['role'], category=materials[row['material']]['category'])
        spec = row['construction']
        if spec.get('form') == 'stranded_round' or spec.get('form') == 'wires':
            count = spec.get('wire_count')
            if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 127:
                raise ValueError(row['role'] + '缺少有效单丝根数（1–127）')
            wire = positive(spec.get('wire_diameter'), row['role'] + '单丝直径', .02)
            pitch = positive(spec.get('lay_length'), row['role'] + '绞合节距', 10)
            if wire > row['outer_radius_m'] * 2:
                raise ValueError('单丝直径大于结构包络')
            if spec['form'] == 'stranded_round':
                rings = next((n for n in range(1, 7) if 1 + 3*n*(n+1) == count), None)
                if rings is None:
                    raise ValueError('圆绞合支持 1+6+12…完整同心绞层，请核对根数')
                step = (rows[0]['outer_radius_m'] - wire / 2) / rings
                if step < wire or any(2*(step*k)*math.sin(math.pi/(6*k))/math.sqrt(1+(2*math.pi*step*k/pitch)**2) < wire for k in range(1, rings+1)):
                    raise ValueError('单丝直径、外径和节距造成绞线重叠，请核对制造参数')
            else:
                if wire > spec['thickness'] + 1e-12:
                    raise ValueError(row['role'] + '单丝直径超过本层厚度')
                orbit = row['inner_radius_m'] + wire/2
                if count > 1 and 2*orbit*math.sin(math.pi/count)/math.sqrt(1+(2*math.pi*orbit/pitch)**2) < wire:
                    raise ValueError(row['role'] + '丝数、丝径和节距造成重叠')
        if spec.get('form') == 'tape':
            positive(spec.get('tape_width'), row['role'] + '带宽', .2)
            positive(spec.get('lay_length'), row['role'] + '绕包节距', 10)
    return cable, rows, length


def shell(cq, inner, outer, length):
    profile = cq.Workplane('XY').circle(outer)
    if inner: profile = profile.circle(inner)
    return profile.extrude(length).val()


def helix(cq, radius, wire_radius, pitch, length, left=False):
    pad = wire_radius * 3
    path = cq.Wire.makeHelix(pitch, length+2*pad, radius, center=(0,0,-pad), lefthand=left)
    profile = cq.Workplane(cq.Plane(origin=path.startPoint(), normal=path.tangentAt(0))).circle(wire_radius)
    body = profile.sweep(path, isFrenet=True).val()
    clip = cq.Workplane('XY').box(2*(radius+wire_radius+1),2*(radius+wire_radius+1),length,centered=(True,True,False)).val()
    return body.intersect(clip)


def layer_shape(cq, row, length, proof=None):
    spec = row['construction']; form = spec.get('form')
    inner, outer = row['inner_radius_m']*1000, row['outer_radius_m']*1000
    if form == 'stranded_round':
        count, wr = spec['wire_count'], spec['wire_diameter']*500
        rings = next(n for n in range(1,7) if 1+3*n*(n+1)==count)
        parts = [shell(cq,0,wr,length)]
        if proof is not None:proof.append((parts[0],1))
        for k in range(1,rings+1):
            orbit = (outer-wr)*k/rings
            master = helix(cq,orbit,wr,spec['lay_length']*1000,length,(k%2==0) != (spec.get('lay_direction')=='left'))
            if proof is not None:proof.append((master,6*k))
            parts.extend(master.moved(cq.Location((0,0,0),(0,0,1),i*360/(6*k))) for i in range(6*k))
        return cq.Compound.makeCompound(parts), '圆绞合螺旋单丝', True
    if form == 'wires':
        wr, count = spec['wire_diameter']*500, spec['wire_count']
        master = helix(cq,inner+wr,wr,spec['lay_length']*1000,length,spec.get('lay_direction')=='left')
        if proof is not None:proof.append((master,count))
        return cq.Compound.makeCompound([master.moved(cq.Location((0,0,0),(0,0,1),i*360/count)) for i in range(count)]), '螺旋单丝', True
    if form == 'tape':
        width, pitch = spec['tape_width']*1000, spec['lay_length']*1000
        # Width is measured normal to the helix on the unrolled cylinder.
        radius=(inner+outer)/2
        axial_width=width*math.sqrt(pitch*pitch+(2*math.pi*radius)**2)/(2*math.pi*radius)
        if axial_width >= pitch:
            raise ValueError(row['role'] + '带宽与节距造成绕包自重叠，当前不支持重叠带')
        paths=[cq.Wire.makeHelix(pitch,length+2*axial_width,r,
            center=(0,0,-axial_width+z),lefthand=spec.get('lay_direction')=='left')
            for r,z in [(inner,-axial_width/2),(outer,-axial_width/2),(outer,axial_width/2),(inner,axial_width/2)]]
        faces=[cq.Face.makeRuledSurface(paths[i].Edges()[0],paths[(i+1)%4].Edges()[0]) for i in range(4)]
        faces.extend(cq.Face.makeFromWires(cq.Wire.makePolygon([getattr(p,end)() for p in paths],close=True))
                     for end in ('startPoint','endPoint'))
        body=cq.Solid.makeSolid(cq.Shell.makeShell(faces))
        clip=cq.Workplane('XY').box(2*(outer+1),2*(outer+1),length,centered=(True,True,False)).val()
        body=body.intersect(clip)
        if proof is not None:proof.append((body,1))
        return body, '同源螺旋带实体', True
    note = ('紧压导体设计外径包络' if form=='stranded_round_compacted' else
            '分割导体设计外径包络 · 未建分割缝' if form=='segmental' else '连续层实体')
    known = form in ('solid_round','stranded_round_compacted','segmental') if row['role']=='conductor' else form=='smooth' if row['role'] in ('metallic_screen','metallic_sheath','armour') else True
    if not known: note = '构造包络 · 缺少构造参数'
    body=shell(cq,inner,outer,length)
    if proof is not None:proof.append((body,1))
    return body, note, known


def display_mesh(solid):
    from OCP.BRep import BRep_Tool
    from OCP.TopLoc import TopLoc_Location
    from OCP.TopAbs import TopAbs_Orientation
    groups=[]
    for body in solid.Solids():
        group=next((g for g in groups if g['body'].wrapped.IsPartner(body.wrapped)
                    and g['body'].wrapped.Orientation()==body.wrapped.Orientation()),None)
        if group is None:
            positions=array('f');triangles=array('I');offset=0
            for face in body.Faces():
                location=TopLoc_Location();poly=BRep_Tool.Triangulation_s(face.wrapped,location)
                if poly is None:raise ValueError('有效实体缺少显示网格')
                transform=location.Transformation()
                for i in range(1,poly.NbNodes()+1):positions.extend(poly.Node(i).Transformed(transform).Coord())
                reverse=face.wrapped.Orientation()==TopAbs_Orientation.TopAbs_REVERSED
                for triangle in poly.Triangles():
                    a,b,c=triangle.Get()
                    triangles.extend((a+offset-1,c+offset-1,b+offset-1) if reverse else (a+offset-1,b+offset-1,c+offset-1))
                offset+=poly.NbNodes()
            import sys
            if sys.byteorder!='little':positions.byteswap();triangles.byteswap()
            group={'body':body,'positions_f32':b64encode(positions.tobytes()).decode('ascii'),
                'triangles_u32':b64encode(triangles.tobytes()).decode('ascii'),
                'node_count':len(positions)//3,'triangle_count':len(triangles)//3,'instances':[]}
            groups.append(group)
        transform=body.wrapped.Location().Transformation().Multiplied(
            group['body'].wrapped.Location().Transformation().Inverted())
        group['instances'].append([round(transform.Value(i,j),12) for i in range(1,4) for j in range(1,5)])
    return {'schema':'cablesim.display-mesh/1','unit':'mm','byte_order':'little','deflection_mm':.08,'angular_deflection_rad':.35,
            'prototypes':[{k:v for k,v in g.items() if k!='body'} for g in groups]}


def build(document, parameters, out, case_id, reuse_artifacts=None):
    import cadquery as cq
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    cable, rows, length = prepare(document, parameters)
    include_exact = parameters.get('include_exact', True)
    if not isinstance(include_exact, bool):raise ValueError('include_exact 必须为布尔值')
    started = perf_counter()
    reuse = (reuse_artifacts or {}).get('x-cablesim.cad-model', {})
    previous = {r.get('geometry_key'):r for r in reuse.get('layers', [])}
    solids = []; reused = 0; layer_timings = []
    for row in rows:
        layer_started = perf_counter()
        spec = row['construction']
        dimensions = {k:spec.get(k) for k in ('form','wire_count','wire_diameter','lay_length','lay_direction','tape_width')}
        geometry_key = sha256(json.dumps([VERSION, row['role'],row['inner_radius_m'],row['outer_radius_m'],length,dimensions],sort_keys=True).encode()).hexdigest()
        row['geometry_key'] = geometry_key
        resident_cached = SHAPE_CACHE.get(geometry_key) if RESIDENT else None
        cached = previous.get(geometry_key)
        proof=[]
        shape_started = perf_counter()
        if resident_cached:
            solid,representation,known,volume,brep_text,mesh=resident_cached
            SHAPE_CACHE.move_to_end(geometry_key)
            cached={**(cached or {}),'brep_text':brep_text}
            reused += 1
        elif cached and cached.get('brep_text'):
            cached_file = out/(case_id+'.reuse.brep')
            cached_file.write_text(cached['brep_text'],'utf-8')
            solid = cq.Shape.importBrep(str(cached_file)); cached_file.unlink()
            representation, known = cached['representation'], cached['material_volume_m3'] is not None
            reused += 1
        else:
            solid, representation, known = layer_shape(cq,row,length*1000,proof=proof)
        shape_ms = (perf_counter()-shape_started)*1000
        validate_started = perf_counter()
        if not resident_cached:
            # Every copy is a rigid rotation of an already checked master solid.
            # Rigid placement preserves topology and volume; no sweep or union is substituted.
            checked_shapes=proof or [(solid,1)]
            if any(not master.isValid() or not master.Solids() for master,_ in checked_shapes):
                raise ValueError('Open CASCADE 返回无效实体')
            volume = sum(master.Volume()*count for master,count in checked_shapes)*1e-9
            if volume<=0:raise ValueError('Open CASCADE 返回无效实体')
        row['volume_m3'] = volume
        row['envelope_volume_m3'] = math.pi*(row['outer_radius_m']**2-row['inner_radius_m']**2)*length
        row['representation'] = representation
        nominal_quantity = row['role']=='conductor' and spec.get('form') in ('stranded_round_compacted','segmental')
        if nominal_quantity:known=True
        factor = spec.get('lay_factor')
        material_volume = (spec['nominal_area']*length*factor if factor is not None else None) if nominal_quantity else (volume if known else None)
        row['material_volume_m3'] = material_volume
        row['quantity_basis'] = (f'标称截面 × 展示长度 × 绞入系数（{factor:g}）；包络体积不作铜量' if factor is not None else
            '标称截面 × 展示长度 × 绞入系数；缺少绞入系数') if nominal_quantity else '原始实体体积积分'
        density = next(m for m in document['materials'] if m['id']==row['material']).get('density')
        row['mass_kg'] = material_volume*density if material_volume is not None and density is not None else None
        row['mass_kg_per_km'] = row['mass_kg']/length*1000 if row['mass_kg'] is not None else None
        missing_name={'conductor':'导体构造','metallic_screen':'金属屏蔽构造','metallic_sheath':'金属护套构造','armour':'铠装构造'}.get(row['role'],'结构构造')
        row['quantity_missing'] = [] if known else [missing_name]
        if nominal_quantity and factor is None:row['quantity_missing'].append('导体绞入系数')
        if density is None: row['quantity_missing'].append('材料密度')
        row['inner_diameter_m'] = row['inner_radius_m']*2
        row['outer_diameter_m'] = row['outer_radius_m']*2
        row['thickness_m'] = row['outer_radius_m']-row['inner_radius_m']
        row['solid_count'] = len(solid.Solids())
        validation_ms = (perf_counter()-validate_started)*1000
        # Shared located strands carry one triangulation per master wire. Browser
        # rendering reuses this native cache instead of remeshing every B-spline.
        mesh_ms = 0.; serialize_ms = 0.; display_mesh_ms=0.
        brep_text = cached.get('brep_text') if cached else None
        if not resident_cached and not cached:
            mesh_started = perf_counter()
            for master,_ in proof or [(solid,1)]:BRepMesh_IncrementalMesh(master.wrapped,.08,False,.35)
            mesh_ms = (perf_counter()-mesh_started)*1000
        if include_exact and not brep_text:
            serialize_started = perf_counter()
            brep = out / (case_id + '.part.brep')
            solid.exportBrep(str(brep))
            brep_text = brep.read_text('utf-8')
            brep.unlink()
            serialize_ms = (perf_counter()-serialize_started)*1000
        if include_exact:row['brep_text']=brep_text
        if not resident_cached:
            display_started=perf_counter()
            mesh=display_mesh(solid)
            display_mesh_ms=(perf_counter()-display_started)*1000
        row['display_mesh']=mesh
        solids.append(solid)
        if RESIDENT:
            SHAPE_CACHE[geometry_key]=(solid,representation,known,volume,brep_text,mesh)
            while len(SHAPE_CACHE)>48:SHAPE_CACHE.popitem(last=False)
        layer_timings.append({'role':row['role'],'reused':bool(cached),'model_ms':shape_ms,
            'validation_volume_ms':validation_ms,'mesh_ms':mesh_ms,'display_mesh_ms':display_mesh_ms,'brep_serialization_ms':serialize_ms,
            'total_ms':(perf_counter()-layer_started)*1000})
    step = out / (case_id + '.step')
    step_started = perf_counter()
    if include_exact:cq.exporters.export(cq.Compound.makeCompound(solids), str(step), exportType='STEP')
    step_ms = (perf_counter()-step_started)*1000
    payload = {'schema': 'cablesim.cad-model/1', 'cable_type_id': cable['id'], 'label': cable['label'],
               'length_m': length, 'outer_diameter_m': rows[-1]['outer_radius_m'] * 2,
               'geometry_unit': 'm', 'step_unit': 'mm', 'brep_unit': 'mm', 'axis': '+Z',
               'representation': 'parameterized_cable_solids', 'layers': rows,
               'build_stats': {'reused_layers':reused,'generated_layers':len(rows)-reused,
                   'build_ms':(perf_counter()-started)*1000,'layers':layer_timings,'step_export_ms':step_ms},
               'mass_kg_per_km': sum(r['mass_kg_per_km'] for r in rows) if all(r['mass_kg_per_km'] is not None for r in rows) else None,
               'quantity_missing_layers': [r['role'] for r in rows if r['mass_kg_per_km'] is None],
               'display_approximation': 'OCCT 显示缓存：绝对弦差 0.08 mm、角度 0.35 rad；共享单丝细分，原始 BRep 曲面不简化，STEP 导出同源精确实体。',
               'geometry_approximation': '圆丝为理想螺旋扫掠；紧压与分割导体按设计外径建包络，未建单丝压实或分割缝，用料按标称截面及明确绞入系数计算，包络体积不代表铜量；螺旋带按展开圆柱面法向带宽建模，不支持重叠绕包；不含接触形变与制造公差。',
               'exact_pending': not include_exact, 'material_sources': document.get('materials', []),
               'input_sha256': sha256(json.dumps(document, sort_keys=True, ensure_ascii=False).encode()).hexdigest()}
    if include_exact:
        payload['step_text']=step.read_text('utf-8')
        step.unlink()
    name = case_id + '.geometry.json'
    json_started = perf_counter()
    encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False)
    payload['build_stats']['json_serialization_ms'] = (perf_counter()-json_started)*1000
    (out / name).write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), 'utf-8')
    results = [{'key': 'x-cablesim.outer-diameter', 'type': 'quantity', 'entity': cable['id'], 'status': 'available',
                'value': payload['outer_diameter_m'], 'unit': 'm'}]
    results += [{'key': 'x-cablesim.envelope-volume', 'type': 'quantity', 'entity': r['entity'],
                 'status': 'available', 'value': r['envelope_volume_m3'], 'unit': 'm3'} for r in rows]
    results += [{'key':'x-cablesim.material-volume','type':'quantity','entity':r['entity'],
                 'status':'available','value':r['material_volume_m3'],'unit':'m3'} for r in rows if r['material_volume_m3'] is not None]
    return {'results': results, 'artifacts': [{'type': 'x-cablesim.cad-model', 'path': 'output/' + name}],
            'warnings': [{'code': 'IDEALIZED_GEOMETRY', 'message': payload['geometry_approximation']}]}


def main():
    request = json.loads(Path('input/request.json').read_text('utf-8'))
    if request.get('protocol') != PROTOCOL or request.get('capability') != 'concentric-model' or request.get('phase') not in ('check', 'run'):
        raise ValueError('不支持的协议或能力')
    cases = []
    import_started = perf_counter()
    try:
        import cadquery as cq
        dependency_error = None
    except ImportError:
        cq = None
        dependency_error = '运行 Python 缺少 CadQuery / Open CASCADE；请安装 plugins/requirements-native.txt 中的 CAD 依赖'
    import_ms = (perf_counter()-import_started)*1000
    for case in request['cases']:
        base = {'case_id': case['case_id']}
        try:
            if dependency_error:
                raise ValueError(dependency_error)
            prepare(case['input'], case.get('parameters', {}))
            reuse=None;reuse_path=Path('input/reuse-artifacts.json')
            if reuse_path.is_file():
                raw=reuse_path.read_bytes()
                if sha256(raw).hexdigest()!=case.get('parameters',{}).get('_artifact_reuse_sha256'):
                    raise ValueError('复用工件摘要不一致')
                reuse=json.loads(raw)
            result = {} if request['phase'] == 'check' else build(case['input'], case.get('parameters', {}), Path('output'), case['case_id'],reuse_artifacts=reuse)
            cases.append({**base, 'status': 'succeeded', **result})
        except (ValueError, KeyError, TypeError) as exc:
            cases.append({**base, 'status': 'not_applicable', 'error': {'code': 'CAD_INPUT_UNSUPPORTED', 'message': str(exc)}})
        except Exception:
            cases.append({**base, 'status': 'failed', 'error': {'code': 'CAD_BUILD_FAILED', 'message': 'CAD 内核生成失败，未返回替代几何或数值'}})
    Path('output/result.json').write_text(json.dumps({'protocol': PROTOCOL, 'cases': cases,
        'environment': {'python': platform.python_version(), 'packages': {'cadquery': cq.__version__ if cq else 'unavailable'}, 'method': VERSION,
            'profiling': {'cadquery_import_ms':import_ms}}},
        ensure_ascii=False, allow_nan=False), 'utf-8')


def resident_warmup():
    global RESIDENT
    import cadquery
    RESIDENT=True


def resident_main():
    main()


if __name__ == '__main__':
    main()

