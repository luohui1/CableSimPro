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
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[4]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cablesim_sdk.cross_sections import core_profile, profile_radius, profiles_overlap

PROTOCOL = 'cablesim.run/2'
VERSION = '1.0.0'
SCENE_VERSION = '1.0.0'
RESIDENT = False
SHAPE_CACHE = OrderedDict()
SCENE_CACHE = OrderedDict()
LAYER_LABELS = {'conductor':'导体','conductor_screen':'导体屏蔽','insulation':'绝缘',
    'insulation_screen':'绝缘屏蔽','metallic_screen':'金属屏蔽','metallic_sheath':'金属护套',
    'bedding':'内衬层','separator':'隔离套','filler':'填充','binder':'包带','armour':'铠装','oversheath':'外护套'}


def positive(value, name, maximum):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value <= maximum:
        raise ValueError(name + '必须是范围内的正数')
    return float(value)


def prepare(document, parameters):
    """Method geometry bounds over a host-validated structural snapshot."""
    types = document.get('cable_types', [])
    target = parameters.get('cable_type_id')
    cable = next((c for c in types if c['id'] == target), None)
    if cable is None:
        raise ValueError('必须选择当前文档中的型号')
    cores = cable.get('cores', [])
    construction = cable.get('construction')
    if construction not in ('single_core', 'three_core', 'multi_core') or not 1 <= len(cores) <= 16:
        raise ValueError('cable_types.cores：当前 CAD 支持 1–16 个明确定位的线芯')
    if construction == 'single_core' and len(cores) != 1 or construction == 'three_core' and len(cores) != 3:
        raise ValueError('cable_types.construction：电缆类型与芯数不一致')
    if len({core['id'] for core in cores}) != len(cores):
        raise ValueError('cable_types.cores：芯标识重复')
    length = positive(parameters.get('length_m', .18), '展示长度', 1)
    materials = {m['id']: m for m in document.get('materials', [])}
    rows, core_profiles = [], []

    def add(role, material, inner, outer, spec, target, profile, inner_profile=None, holes=None):
        suffix = (target['core_id']+'/' if target['scope'] == 'core' and len(cores) > 1 else '')+role
        if material not in materials:
            raise ValueError(suffix+'.material：材料引用缺失')
        rows.append({'role':role, 'material':material, 'inner_radius_m':inner, 'outer_radius_m':outer,
            'construction':spec, 'source_target':target, 'entity':cable['id']+'/'+suffix,
            'label':(('芯 '+str(next(i+1 for i,core in enumerate(cores) if core['id']==target['core_id']))+' · ')
                     if target['scope']=='core' and len(cores)>1 else '')+LAYER_LABELS[role],
            'center_m':{'x':profile['x'], 'z':profile['z']},
            'section_profile':{'outer':profile, 'inner':inner_profile, 'holes':holes or []},
            'category':materials[material]['category']})

    def stack(layers, field):
        if len(layers) > 16 or len({layer['role'] for layer in layers}) != len(layers):
            raise ValueError(field+'：每组最多 16 层，层角色不得重复')
        if any(layer.get('form') == 'corrugated' for layer in layers):
            raise ValueError(field+'：波纹层需专用轮廓，当前 CAD 未覆盖')
        return layers

    for core in cores:
        conductor, cid = core['conductor'], core['id']
        x, z = finite_coordinate(core.get('x',0),cid+'.x'), finite_coordinate(core.get('z',0),cid+'.z')
        if conductor.get('form') not in ('unspecified','solid_round','stranded_round','stranded_round_compacted','segmental','sectoral') or conductor.get('inner_diameter'):
            raise ValueError(cid+'.conductor.form：当前 CAD 不支持中空导体')
        radius = positive(conductor['diameter'], cid+'.conductor.diameter', .2)/2
        profile = core_profile(conductor,x,z)
        if conductor.get('form') in ('stranded_round_compacted','segmental','sectoral'):
            area = positive(conductor.get('nominal_area'),cid+'.conductor.nominal_area',.1)
            envelope_area = radius**2*(profile['angle']/2 if profile['kind']=='sector' else math.pi)
            if area > envelope_area+1e-12:
                raise ValueError(cid+'.conductor.nominal_area：标称截面超过设计轮廓面积')
            if conductor.get('lay_factor') is not None and positive(conductor['lay_factor'],cid+'.conductor.lay_factor（绞入系数）',1e6) < 1:
                raise ValueError(cid+'.conductor.lay_factor：绞入系数不得小于 1')
        target = {'scope':'core','core_id':cid,'role':'conductor'}
        add('conductor',conductor['material'],0.,radius,conductor,target,profile)
        offset = 0.
        for layer in stack(core.get('layers',[]),cid+'.layers'):
            inner_profile = core_profile(conductor,x,z,offset)
            offset += positive(layer['thickness'],cid+'.'+layer['role']+'.thickness',.05)
            if profile['kind']=='sector' and (layer.get('form')=='wires' or layer.get('form')=='tape' and layer.get('tape_application')!='helical_overlap' and layer.get('overlap') is None):
                raise ValueError(cid+'.'+layer['role']+'.form：扇形线芯的离散金属绕包轮廓尚未覆盖，请提供连续层或专用模型')
            target = {'scope':'core','core_id':cid,'role':layer['role']}
            add(layer['role'],layer['material'],radius+inner_profile['offset'],radius+offset,layer,target,
                core_profile(conductor,x,z,offset),inner_profile)
        outer_profile = core_profile(conductor,x,z,offset)
        for other in core_profiles:
            if profiles_overlap(other,outer_profile):
                raise ValueError(cid+'.x / z：绝缘线芯轮廓相互重叠，请核对芯坐标和层厚')
        core_profiles.append(outer_profile)
    radius = max(profile_radius(profile) for profile in core_profiles)
    for index, layer in enumerate(stack(cable.get('common_layers',[]),'common_layers')):
        inner = radius
        radius += positive(layer['thickness'],'common_layers.'+layer['role']+'.thickness',.05)
        profile = {'kind':'circle','x':0.,'z':0.,'radius':radius,'offset':0.}
        fill = layer['role']=='filler' and len(cores)>1 and index==0
        if layer['role']=='filler' and len(cores)>1 and not fill:
            raise ValueError('common_layers.filler：间隙填充必须位于公共层最内侧')
        add(layer['role'],layer['material'],0. if fill else inner,radius,layer,
            {'scope':'common','role':layer['role']},profile,
            None if fill else {**profile,'radius':inner},core_profiles if fill else None)
    if radius > .25 or len(rows)>128:
        raise ValueError('电缆外径不得超过 0.5 m，CAD 结构层不得超过 128 层')
    for row in rows:
        if materials[row['material']].get('density') is not None:
            positive(materials[row['material']]['density'], '材料密度', 1e6)
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
                step = (row['outer_radius_m'] - wire / 2) / rings
                if step < wire or any(2*(step*k)*math.sin(math.pi/(6*k))/math.sqrt(1+(2*math.pi*step*k/pitch)**2) < wire for k in range(1, rings+1)):
                    raise ValueError('单丝直径、外径和节距造成绞线重叠，请核对制造参数')
            else:
                if wire > spec['thickness'] + 1e-12:
                    raise ValueError(row['role'] + '单丝直径超过本层厚度')
                orbit = row['inner_radius_m'] + wire/2
                if count > 1 and 2*orbit*math.sin(math.pi/count)/math.sqrt(1+(2*math.pi*orbit/pitch)**2) < wire:
                    raise ValueError(row['role'] + '丝数、丝径和节距造成重叠')
        if spec.get('form') == 'tape':
            tape_parameters(row)
    core_levels = max(1+len(core.get('layers',[])) for core in cores)
    common_roles = [layer['role'] for layer in cable.get('common_layers',[])]
    maximum_rank = max(1,core_levels+len(common_roles)-1)
    for row in rows:
        target = row['source_target']
        if target['scope']=='core':
            core = next(core for core in cores if core['id']==target['core_id'])
            rank = 0 if row['role']=='conductor' else 1+next(i for i,layer in enumerate(core['layers']) if layer['role']==row['role'])
        else:
            rank = core_levels+common_roles.index(row['role'])
        row['peel_fraction'] = 1-.55*rank/maximum_rank
    return cable, rows, length


def shell(cq, inner, outer, length):
    profile = cq.Workplane('XY').circle(outer)
    if inner:
        profile = profile.circle(inner)
    return profile.extrude(length).val()


def profile_wire(cq, profile):
    radius, offset = profile['radius']*1000, profile['offset']*1000
    if profile['kind']=='circle':
        wire = cq.Workplane('XY').circle(radius+offset).val()
    else:
        half = profile['angle']/2
        path = cq.Workplane('XY').moveTo(0,0).lineTo(radius*math.cos(half),-radius*math.sin(half))
        wire = path.threePointArc((radius,0),(radius*math.cos(half),radius*math.sin(half))).close().wire().val()
        if offset:
            wires = wire.offset2D(offset,kind='arc')
            if len(wires)!=1:
                raise ValueError('扇形平行轮廓未形成唯一闭合边界，请核对圆弧直径、夹角和层厚')
            wire = wires[0]
        wire = wire.rotate((0,0,0),(0,0,1),math.degrees(profile['rotation']))
    return wire.translate((profile['x']*1000,profile['z']*1000,0))


def profile_solid(cq, profile, length):
    return cq.Solid.extrudeLinear(profile_wire(cq,profile),[],cq.Vector(0,0,length))


def mean_profile_perimeter(row):
    profiles = row['section_profile']
    def perimeter(profile):
        base = profile['radius']*(2+profile['angle']) if profile['kind']=='sector' else 2*math.pi*profile['radius']
        return base+2*math.pi*profile['offset']
    return (perimeter(profiles['inner'])+perimeter(profiles['outer']))/2


def tape_parameters(row):
    """Resolve only a supplied pitch or a pitch fixed by width and wrap/gap facts."""
    spec = row['construction']
    application = spec.get('tape_application')
    if spec.get('tape_width') is None and spec.get('overlap') is not None:
        return {'application':'envelope', 'reason':'金属带带宽及绕包参数缺项'}
    width = positive(spec.get('tape_width'),row['entity']+'.tape_width',.2)*1000
    if application=='two_tape_gap':
        thickness = positive(spec.get('nominal_tape_thickness'),row['entity']+'.nominal_tape_thickness',.01)*1000
        if spec.get('tape_count')!=2 or not math.isclose(row['outer_radius_m']-row['inner_radius_m'],2*thickness/1000,abs_tol=1e-12):
            raise ValueError(row['entity']+'：双带铠装需两层，径向厚度应等于单带标称厚度的两倍')
        gap = spec.get('tape_gap')
        if isinstance(gap,bool) or not isinstance(gap,(int,float)) or not 0 <= gap <= spec['tape_width']/2:
            raise ValueError(row['entity']+'.tape_gap：双带最大轴向间隙须为 0 至带宽的一半')
        # Fix the shared pitch by the outer tape, which has the largest axial gap.
        circumference = 2*math.pi*(row['outer_radius_m']*1000-thickness/2)
        ratio = width/circumference
        if ratio>=1:
            raise ValueError(row['entity']+'.tape_width：带宽不得达到铠装圆周长')
        g = gap*1000
        pitch = (g+math.sqrt(g*g*ratio*ratio+width*width*(1-ratio*ratio)))/(1-ratio*ratio)
        if spec.get('lay_length') is not None and not math.isclose(spec['lay_length']*1000,pitch,rel_tol=1e-6,abs_tol=1e-6):
            raise ValueError(row['entity']+'.lay_length：节距与带宽、间隙不一致，请核对制造参数')
        return {'application':application,'pitch':pitch,'width':width,'thickness':thickness}
    if application=='helical_overlap' or spec.get('overlap') is not None:
        thickness = positive(spec.get('nominal_tape_thickness'),row['entity']+'.nominal_tape_thickness',.01)*1000
        overlap = spec.get('overlap')
        if isinstance(overlap,bool) or not isinstance(overlap,(int,float)) or not 0 <= overlap < 1:
            raise ValueError(row['entity']+'.overlap：重叠绕包需明确 0–1 的搭盖率')
        if spec.get('tape_count') not in (None,1):
            raise ValueError(row['entity']+'.tape_count：重叠铜带当前仅支持单带')
        circumference = mean_profile_perimeter(row)*1000
        effective = width*(1-overlap)
        if effective>=circumference:
            raise ValueError(row['entity']+'.tape_width：有效带宽不得达到金属层圆周长')
        pitch = effective/math.sqrt(1-(effective/circumference)**2)
        if spec.get('lay_length') is not None and not math.isclose(spec['lay_length']*1000,pitch,rel_tol=1e-6,abs_tol=1e-6):
            raise ValueError(row['entity']+'.lay_length：节距与带宽、搭盖率不一致')
        return {'application':'helical_overlap','pitch':pitch,'width':width,'thickness':thickness,'overlap':overlap}
    return {'application':'single_gap','width':width,
            'pitch':positive(spec.get('lay_length'),row['entity']+'.lay_length',10)*1000}


def tape_shape(cq, inner, outer, width, pitch, length, left=False, phase=0.):
    radius = (inner+outer)/2
    axial_width = width*math.sqrt(pitch*pitch+(2*math.pi*radius)**2)/(2*math.pi*radius)
    if axial_width >= pitch:
        raise ValueError('带宽与节距造成单带自重叠，请核对带宽、节距和间隙')
    paths = [cq.Wire.makeHelix(pitch,length+4*axial_width,r,
        center=(0,0,-2*axial_width+z+phase),lefthand=left)
        for r,z in [(inner,-axial_width/2),(outer,-axial_width/2),(outer,axial_width/2),(inner,axial_width/2)]]
    faces = [cq.Face.makeRuledSurface(paths[i].Edges()[0],paths[(i+1)%4].Edges()[0]) for i in range(4)]
    faces.extend(cq.Face.makeFromWires(cq.Wire.makePolygon([getattr(p,end)() for p in paths],close=True))
                 for end in ('startPoint','endPoint'))
    body = cq.Solid.makeSolid(cq.Shell.makeShell(faces))
    clip = cq.Workplane('XY').box(2*(outer+1),2*(outer+1),length,centered=(True,True,False)).val()
    return body.intersect(clip)


def helix(cq, radius, wire_radius, pitch, length, left=False):
    pad = wire_radius * 3
    path = cq.Wire.makeHelix(pitch, length+2*pad, radius, center=(0,0,-pad), lefthand=left)
    profile = cq.Workplane(cq.Plane(origin=path.startPoint(), normal=path.tangentAt(0))).circle(wire_radius)
    body = profile.sweep(path, isFrenet=True).val()
    clip = cq.Workplane('XY').box(2*(radius+wire_radius+1),2*(radius+wire_radius+1),length,centered=(True,True,False)).val()
    return body.intersect(clip)


def layer_shape(cq, row, length, proof=None):
    spec = row['construction']
    form = spec.get('form')
    inner, outer = row['inner_radius_m']*1000, row['outer_radius_m']*1000
    profile = row['section_profile']
    if profile['outer']['kind']=='sector' or profile['holes']:
        body = profile_solid(cq,profile['outer'],length)
        for hole in ([profile['inner']] if profile['inner'] else [])+profile['holes']:
            body = body.cut(profile_solid(cq,hole,length))
        if proof is not None:
            proof.append((body,1))
        if form=='tape':
            return body, '扇形搭盖带设计包络 · 用料按展开周长、单带厚度及搭盖率', False
        return body, '显式扇形轮廓及等厚平行层' if profile['outer']['kind']=='sector' else '线芯间隙填充实体', True
    if form == 'stranded_round':
        count, wr = spec['wire_count'], spec['wire_diameter']*500
        rings = next(n for n in range(1,7) if 1+3*n*(n+1)==count)
        parts = [shell(cq,0,wr,length)]
        if proof is not None:
            proof.append((parts[0],1))
        for k in range(1,rings+1):
            orbit = (outer-wr)*k/rings
            master = helix(cq,orbit,wr,spec['lay_length']*1000,length,(k%2==0) != (spec.get('lay_direction')=='left'))
            if proof is not None:
                proof.append((master,6*k))
            parts.extend(master.moved(cq.Location((0,0,0),(0,0,1),i*360/(6*k))) for i in range(6*k))
        return cq.Compound.makeCompound(parts), '圆绞合螺旋单丝', True
    if form == 'wires':
        wr, count = spec['wire_diameter']*500, spec['wire_count']
        master = helix(cq,inner+wr,wr,spec['lay_length']*1000,length,spec.get('lay_direction')=='left')
        if proof is not None:
            proof.append((master,count))
        return cq.Compound.makeCompound([master.moved(cq.Location((0,0,0),(0,0,1),i*360/count)) for i in range(count)]), '螺旋单丝', True
    if form == 'tape':
        tape = tape_parameters(row)
        if tape['application'] in ('envelope','helical_overlap'):
            body = shell(cq,inner,outer,length)
            if proof is not None:
                proof.append((body,1))
            return body, '搭盖金属带设计包络 · 用料按单带厚度及搭盖率' if tape['application']=='helical_overlap' else tape['reason'], False
        width, pitch = tape['width'], tape['pitch']
        if tape['application']=='two_tape_gap':
            parts = [tape_shape(cq,inner+i*tape['thickness'],inner+(i+1)*tape['thickness'],width,pitch,length,
                spec.get('lay_direction')=='left',pitch*i/2) for i in range(2)]
            if proof is not None:
                proof.extend((part,1) for part in parts)
            return cq.Compound.makeCompound(parts), '双层金属带螺旋实体 · 外带错开半个节距覆盖内带间隙', True
        body = tape_shape(cq,inner,outer,width,pitch,length,spec.get('lay_direction')=='left')
        if proof is not None:
            proof.append((body,1))
        return body, '同源螺旋带实体', True
    note = ('紧压导体设计外径包络' if form=='stranded_round_compacted' else
            '分割导体设计外径包络 · 未建分割缝' if form=='segmental' else '连续层实体')
    known = form in (
        'solid_round',
        'stranded_round_compacted',
        'segmental',
    ) if row['role']=='conductor' else form=='smooth' if row['role'] in ('metallic_screen','metallic_sheath','armour') else True
    if not known:
        note = '构造包络 · 缺少构造参数'
    body=shell(cq,inner,outer,length)
    if proof is not None:
        proof.append((body,1))
    return body, note, known


def display_mesh(solid):
    from OCP.BRep import BRep_Tool
    from OCP.TopLoc import TopLoc_Location
    from OCP.TopAbs import TopAbs_Orientation
    groups=[]
    for body in solid.Solids() or [solid]:
        group=next((g for g in groups if g['body'].wrapped.IsPartner(body.wrapped)
                    and g['body'].wrapped.Orientation()==body.wrapped.Orientation()),None)
        if group is None:
            positions=array('f')
            triangles=array('I')
            offset=0
            for face in body.Faces():
                location=TopLoc_Location()
                poly=BRep_Tool.Triangulation_s(face.wrapped,location)
                if poly is None:
                    raise ValueError('有效实体缺少显示网格')
                transform=location.Transformation()
                for i in range(1,poly.NbNodes()+1):
                    positions.extend(poly.Node(i).Transformed(transform).Coord())
                reverse=face.wrapped.Orientation()==TopAbs_Orientation.TopAbs_REVERSED
                for triangle in poly.Triangles():
                    a,b,c=triangle.Get()
                    triangles.extend((a+offset-1,c+offset-1,b+offset-1) if reverse else (a+offset-1,b+offset-1,c+offset-1))
                offset+=poly.NbNodes()
            import sys
            if sys.byteorder!='little':
                positions.byteswap()
                triangles.byteswap()
            group={'body':body,'positions_f32':b64encode(positions.tobytes()).decode('ascii'),
                'triangles_u32':b64encode(triangles.tobytes()).decode('ascii'),
                'node_count':len(positions)//3,'triangle_count':len(triangles)//3,'instances':[]}
            groups.append(group)
        transform=body.wrapped.Location().Transformation().Multiplied(
            group['body'].wrapped.Location().Transformation().Inverted())
        group['instances'].append([round(transform.Value(i,j),12) for i in range(1,4) for j in range(1,5)])
    return {'schema':'cablesim.display-mesh/1','unit':'mm','byte_order':'little','deflection_mm':.08,'angular_deflection_rad':.35,
            'prototypes':[{k:v for k,v in g.items() if k!='body'} for g in groups]}


def native_layer(cq, row, length, out, case_id, previous):
    reused = 0
    spec = row['construction']
    dimensions = {k:spec.get(k) for k in ('form','wire_count','wire_diameter','lay_length','lay_direction','tape_width',
        'nominal_tape_thickness','tape_count','tape_application','tape_gap','overlap')}
    geometry_key = sha256(json.dumps(
        [VERSION, row['role'],row['inner_radius_m'],row['outer_radius_m'],length,dimensions,row['section_profile']],
        sort_keys=True,
    ).encode()).hexdigest()
    row['geometry_key'] = geometry_key
    resident_cached = SHAPE_CACHE.get(geometry_key) if RESIDENT else None
    cached = previous.get(geometry_key)
    proof=[]
    shape_started = perf_counter()
    if resident_cached:
        solid,representation,known,volume,brep_text,mesh=resident_cached
        SHAPE_CACHE.move_to_end(geometry_key)
        cached={**(cached or {}),'brep_text':brep_text}
        reused = 1
    elif cached and cached.get('brep_text'):
        cached_file = out/(case_id+'.reuse.brep')
        cached_file.write_text(cached['brep_text'],'utf-8')
        solid = cq.Shape.importBrep(str(cached_file))
        cached_file.unlink()
        representation, known = cached['representation'], cached['material_volume_m3'] is not None
        reused = 1
    else:
        solid, representation, known = layer_shape(cq,row,length*1000,proof=proof)
        profile = row['section_profile']
        if profile['outer']['kind']=='circle' and not profile['holes']:
            solid = solid.moved(cq.Location((profile['outer']['x']*1000,profile['outer']['z']*1000,0)))
    shape_ms = (perf_counter()-shape_started)*1000
    validate_started = perf_counter()
    if not resident_cached:
        # Every copy is a rigid rotation of an already checked master solid.
        # Rigid placement preserves topology and volume; no sweep or union is substituted.
        checked_shapes=proof or [(solid,1)]
        if any(not master.isValid() or not master.Solids() for master,_ in checked_shapes):
            raise ValueError('Open CASCADE 返回无效实体')
        volume = sum(master.Volume()*count for master,count in checked_shapes)*1e-9
        if volume<=0:
            raise ValueError('Open CASCADE 返回无效实体')
    return solid, representation, known, volume, proof, cached, resident_cached, geometry_key, reused, shape_ms, validate_started


def layer_quantities(document, row, length, solid, representation, known, volume):
    spec = row['construction']
    row['volume_m3'] = volume
    row['envelope_volume_m3'] = math.pi*(row['outer_radius_m']**2-row['inner_radius_m']**2)*length
    if row['section_profile']['outer']['kind']=='sector' or row['section_profile']['holes']:
        row['envelope_volume_m3'] = volume
    row['representation'] = representation
    nominal_quantity = row['role']=='conductor' and spec.get('form') in ('stranded_round_compacted','segmental','sectoral')
    if nominal_quantity:
        known=True
    factor = spec.get('lay_factor')
    material_volume = (spec['nominal_area']*length*factor if factor is not None else None) if nominal_quantity else (volume if known else None)
    row['material_volume_m3'] = material_volume
    row['quantity_basis'] = (f'标称截面 × 展示长度 × 绞入系数（{factor:g}）；包络体积不作铜量' if factor is not None else
        '标称截面 × 展示长度 × 绞入系数；缺少绞入系数') if nominal_quantity else '原始实体体积积分'
    if spec.get('form')=='tape' and tape_parameters(row)['application']=='helical_overlap':
        material_volume = mean_profile_perimeter(row)*spec['nominal_tape_thickness']*length/(1-spec['overlap'])
        row['material_volume_m3'] = material_volume
        row['quantity_basis'] = '设计平均轮廓周长 × 单带标称厚度 × 展示长度 / (1−搭盖率)；径向包络体积不作金属量'
        known = True
    density = next(m for m in document['materials'] if m['id']==row['material']).get('density')
    row['mass_kg'] = material_volume*density if material_volume is not None and density is not None else None
    row['mass_kg_per_km'] = row['mass_kg']/length*1000 if row['mass_kg'] is not None else None
    missing_name={'conductor':'导体构造','metallic_screen':'金属屏蔽构造','metallic_sheath':'金属护套构造','armour':'铠装构造'}.get(row['role'],'结构构造')
    row['quantity_missing'] = [] if known else [missing_name]
    if nominal_quantity and factor is None:
        row['quantity_missing'].append('导体绞入系数')
    if density is None:
        row['quantity_missing'].append('材料密度')
    row['inner_diameter_m'] = row['inner_radius_m']*2
    row['outer_diameter_m'] = row['outer_radius_m']*2
    row['thickness_m'] = spec.get('thickness',row['outer_radius_m']-row['inner_radius_m'])
    row['solid_count'] = len(solid.Solids())
    return known


def layer_display(row, solid, proof, cached, resident_cached, include_exact, out, case_id):
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    # Shared located strands carry one triangulation per master wire. Browser
    # rendering reuses this native cache instead of remeshing every B-spline.
    mesh_ms = 0.
    serialize_ms = 0.
    display_mesh_ms=0.
    brep_text = cached.get('brep_text') if cached else None
    mesh = resident_cached[-1] if resident_cached else None
    if not resident_cached and not cached:
        mesh_started = perf_counter()
        for master,_ in proof or [(solid,1)]:
            BRepMesh_IncrementalMesh(master.wrapped,.08,False,.35)
        mesh_ms = (perf_counter()-mesh_started)*1000
    if include_exact and not brep_text:
        serialize_started = perf_counter()
        brep = out / (case_id + '.part.brep')
        solid.exportBrep(str(brep))
        brep_text = brep.read_text('utf-8')
        brep.unlink()
        serialize_ms = (perf_counter()-serialize_started)*1000
    if include_exact:
        row['brep_text']=brep_text
    if not resident_cached:
        display_started=perf_counter()
        mesh=display_mesh(solid)
        display_mesh_ms=(perf_counter()-display_started)*1000
    row['display_mesh']=mesh
    return brep_text, mesh, mesh_ms, serialize_ms, display_mesh_ms


def build(document, parameters, out, case_id, reuse_artifacts=None, native_layers=None):
    import cadquery as cq
    cable, rows, length = prepare(document, parameters)
    include_exact = parameters.get('include_exact', True)
    if not isinstance(include_exact, bool):
        raise ValueError('include_exact 必须为布尔值')
    started = perf_counter()
    reuse = (reuse_artifacts or {}).get('x-cablesim.cad-model', {})
    previous = {r.get('geometry_key'):r for r in reuse.get('layers', [])}
    solids = []
    reused = 0
    layer_timings = []
    for row in rows:
        layer_started = perf_counter()
        (solid, representation, known, volume, proof, cached, resident_cached,
         geometry_key, reused_layer, shape_ms, validate_started) = native_layer(
             cq, row, length, out, case_id, previous)
        reused += reused_layer
        known = layer_quantities(document, row, length, solid, representation, known, volume)
        validation_ms = (perf_counter()-validate_started)*1000
        brep_text, mesh, mesh_ms, serialize_ms, display_mesh_ms = layer_display(
            row, solid, proof, cached, resident_cached, include_exact, out, case_id)
        profile = row['section_profile']
        contours = [profile['outer'],*([profile['inner']] if profile['inner'] else []),*profile['holes']]
        outline = cq.Compound.makeCompound([profile_wire(cq,contour) for contour in contours])
        outline_file = out/(case_id+'.outline.brep')
        outline.exportBrep(str(outline_file))
        row['section_outline_brep'] = outline_file.read_text('utf-8')
        outline_file.unlink()
        solids.append(solid)
        if native_layers is not None:
            native_layers.append(solid)
        if RESIDENT:
            SHAPE_CACHE[geometry_key]=(solid,representation,known,volume,brep_text,mesh)
            while len(SHAPE_CACHE)>48:
                SHAPE_CACHE.popitem(last=False)
        layer_timings.append({'role':row['role'],'reused':bool(cached),'model_ms':shape_ms,
            'validation_volume_ms':validation_ms,'mesh_ms':mesh_ms,'display_mesh_ms':display_mesh_ms,'brep_serialization_ms':serialize_ms,
            'total_ms':(perf_counter()-layer_started)*1000})
    step = out / (case_id + '.step')
    step_started = perf_counter()
    if include_exact:
        cq.exporters.export(cq.Compound.makeCompound(solids), str(step), exportType='STEP')
    step_ms = (perf_counter()-step_started)*1000
    payload = {'schema': 'cablesim.cad-model/1', 'cable_type_id': cable['id'], 'label': cable['label'],
               'length_m': length, 'outer_diameter_m': max(profile_radius(row['section_profile']['outer']) for row in rows) * 2,
               'geometry_unit': 'm', 'step_unit': 'mm', 'brep_unit': 'mm', 'axis': '+Z',
               'representation': 'parameterized_cable_solids', 'layers': rows,
               'build_stats': {'reused_layers':reused,'generated_layers':len(rows)-reused,
                   'build_ms':(perf_counter()-started)*1000,'layers':layer_timings,'step_export_ms':step_ms},
               'mass_kg_per_km': sum(r['mass_kg_per_km'] for r in rows) if all(r['mass_kg_per_km'] is not None for r in rows) else None,
               'quantity_missing_layers': [r['role'] for r in rows if r['mass_kg_per_km'] is None],
               'display_approximation': 'OCCT 显示缓存：绝对弦差 0.08 mm、角度 0.35 rad；共享单丝细分，原始 BRep 曲面不简化，STEP 导出同源精确实体。',
               'geometry_approximation': '线芯按明确截面位置直线拉伸；扇形使用明确圆弧直径、夹角和朝向，不从截面积猜轮廓。圆丝为理想螺旋，双带按带宽及最大轴向间隙建模。紧压、分割及扇形导体用料按标称截面和明确绞入系数计算；搭盖金属带显示径向包络，用料另按单带厚度和搭盖率计算。不含成缆扭转、接触形变及制造公差。',
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


def finite_coordinate(value, name):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not -1e6 <= value <= 1e6:
        raise ValueError(name+'必须为有效 SI 坐标')
    return float(value)


def prepare_scene(document, parameters):
    section=next((s for s in document.get('sections',[]) if s['id']==parameters.get('section_id')),None)
    if section is None:
        raise ValueError('必须选择当前文档中的敷设截面')
    length=positive(parameters.get('length_m',.4),'展示长度',1)
    placements=section.get('placements',[])
    if not 1<=len(placements)<=32:
        raise ValueError('场景支持 1–32 根电缆')
    types={t['id']:t for t in document['cable_types']}
    instances={p['id']:(c,p) for c in document['circuits'] for p in c['cables']}
    if len({p['cable'] for p in placements})!=len(placements):
        raise ValueError('截面电缆 ID 重复')
    bounds=[]
    cables=[]
    for p in placements:
        circuit,instance=instances[p['cable']]
        t=types[circuit['cable_type']]
        _,rows,_=prepare(document,{'cable_type_id':t['id'],'length_m':length})
        radius=max(profile_radius(row['section_profile']['outer']) for row in rows)
        x,z=finite_coordinate(p['x'],'电缆 x'),finite_coordinate(p['z'],'电缆 z')
        if section['kind']=='ground' and z+radius>1e-12:
            raise ValueError('电缆超出地表')
        cables.append({'placement':p,'circuit':circuit,'instance':instance,'type':t,'radius':radius,'x':x,'z':z})
        bounds.append((x-radius,z-radius,x+radius,z+radius))
    for i,a in enumerate(cables):
        for b in cables[i+1:]:
            if math.hypot(a['x']-b['x'],a['z']-b['z'])<a['radius']+b['radius']-1e-12:
                raise ValueError('截面电缆相互重叠')
    enclosures=section.get('enclosures',[])
    if len(enclosures)>32:
        raise ValueError('场景容纳结构超过 32 个')
    for e in enclosures:
        x,z=finite_coordinate(e['x'],'容纳结构 x'),finite_coordinate(e['z'],'容纳结构 z')
        if e['type']=='duct':
            outer=positive(e.get('outer_diameter'),'管外径',10)/2
            inner=positive(e.get('inner_diameter'),'管内径',10)/2
            if inner>=outer:
                raise ValueError('管内径必须小于外径')
            for c in cables:
                if c['placement'].get('enclosure')==e['id'] and math.hypot(c['x']-x,c['z']-z)+c['radius']>inner+1e-12:
                    raise ValueError('电缆超出管内边界')
            bounds.append((x-outer,z-outer,x+outer,z+outer))
        else:
            w,h=positive(e.get('width'),'容纳结构宽度',100),positive(e.get('height'),'容纳结构高度',100)
            bounds.append((x-w/2,z-h/2,x+w/2,z+h/2))
    backfill=section.get('backfill')
    if backfill:
        x,z=finite_coordinate(backfill['x'],'回填 x'),finite_coordinate(backfill['z'],'回填 z')
        w,h=positive(backfill['width'],'回填宽度',100),positive(backfill['height'],'回填高度',100)
        if z+h/2>1e-12:
            raise ValueError('回填区超出地表')
        bounds.append((x-w/2,z-h/2,x+w/2,z+h/2))
    layers=section.get('soil_layers',[])
    if len(layers)>16:
        raise ValueError('场景土壤分层超过 16 层')
    for i,l in enumerate(layers):
        top,bottom=finite_coordinate(l['top_z'],'层顶 z'),finite_coordinate(l['bottom_z'],'层底 z')
        if top>0 or bottom>=top or i and abs(layers[i-1]['bottom_z']-top)>1e-12:
            raise ValueError('土壤层边界无效或不连续')
    if section['kind']!='ground' and (backfill or layers):
        raise ValueError('回填与土壤分层仅支持地下截面')
    xmin=min(b[0] for b in bounds)
    xmax=max(b[2] for b in bounds)
    zmin=min([b[1] for b in bounds]+[l['bottom_z'] for l in layers])
    zmax=0 if section['kind']=='ground' else max(b[3] for b in bounds)
    margin=max(.15,(xmax-xmin)*.15)
    crop=[xmin-margin,0,zmin-(0 if layers and zmin==layers[-1]['bottom_z'] else .15),xmax+margin,length,zmax]
    if parameters.get('crop_bounds_m') is not None:
        candidate=parameters['crop_bounds_m']
        if not isinstance(candidate,list) or len(candidate)!=6:
            raise ValueError('显示窗口必须为六个 SI 坐标')
        candidate=[finite_coordinate(v,'显示窗口') for v in candidate]
        if candidate[0]>xmin or candidate[3]<xmax or candidate[2]>zmin or candidate[5]<zmax or candidate[1]!=0 or candidate[4]!=length:
            raise ValueError('显示窗口必须包含全部截面对象并沿展示段拉伸')
        if any(candidate[i]>=candidate[i+3] for i in range(3)) or section['kind']=='ground' and candidate[5]!=0:
            raise ValueError('显示窗口边界无效')
        crop=candidate
    return section,cables,length,crop


class _SceneBuild:
    """Assemble native cable, enclosure and soil regions without changing inputs."""

    def __init__(self, document, parameters, out, case_id):
        import cadquery as cq
        self.cq, self.document, self.out, self.case_id = cq, document, out, case_id
        self.started = perf_counter()
        self.section, self.cables, self.length, self.crop = prepare_scene(document, parameters)
        self.include_exact = parameters.get('include_exact', True)
        if not isinstance(self.include_exact, bool):
            raise ValueError('include_exact 必须为布尔值')
        self.assets, self.templates = {}, {}
        self.objects, self.world, self.tools, self.enclosure_tools = [], [], [], []
        self.regions_reused, self.region_timings = 0, []
        self.identity = [1,0,0,0,0,1,0,0,0,0,1,0]
        self.materials = {m['id']:m for m in document['materials']}

    def _box(self, b):
        return self.cq.Workplane('XY').box(
            (b[3]-b[0])*1000, (b[4]-b[1])*1000, (b[5]-b[2])*1000
        ).translate(((b[0]+b[3])*500, (b[1]+b[4])*500, (b[2]+b[5])*500)).val()

    def _asset(self, key,make,material,representation,dimension=3):
        from OCP.BRepMesh import BRepMesh_IncrementalMesh
        include_exact, out, case_id = self.include_exact, self.out, self.case_id
        materials, assets, region_timings = self.materials, self.assets, self.region_timings
        at=perf_counter()
        aid=sha256(json.dumps([VERSION,key],sort_keys=True).encode()).hexdigest()
        cached=SCENE_CACHE.get(aid) if RESIDENT else None
        if cached:
            body,mesh,brep,volume=cached
            SCENE_CACHE.move_to_end(aid)
            self.regions_reused+=1
        else:
            body=make()
            if not body.isValid() or dimension==3 and not body.Solids():
                raise ValueError('场景原生实体无效')
            volume=body.Volume()*1e-9 if dimension==3 else 0.
            if dimension==3 and volume<=0:
                raise ValueError('场景实体体积无效')
            BRepMesh_IncrementalMesh(body.wrapped,.08,False,.35)
            mesh=display_mesh(body)
            brep=None
        if include_exact and brep is None:
            path=out/(case_id+'.scene-part.brep')
            body.exportBrep(str(path))
            brep=path.read_text('utf-8')
            path.unlink()
        row={'geometry_key':aid,'display_mesh':mesh,'material':material,'category':materials.get(material,{}).get('category','soil'),
             'representation':representation,'volume_m3':volume,'topology_dimension':dimension,'solid_count':len(body.Solids())}
        if include_exact:
            row['brep_text']=brep
        assets[aid]=row
        if RESIDENT:
            SCENE_CACHE[aid]=(body,mesh,brep,volume)
            while len(SCENE_CACHE)>48:
                SCENE_CACHE.popitem(last=False)
        region_timings.append({'kind':key[0],'reused':bool(cached),'total_ms':(perf_counter()-at)*1000})
        return aid,body

    def _cables(self):
        cq, document, out, case_id = self.cq, self.document, self.out, self.case_id
        length, include_exact, L = self.length, self.include_exact, self.length*1000
        cables, assets, objects = self.cables, self.assets, self.objects
        world, templates, tools = self.world, self.templates, self.tools
        for ci,c in enumerate(cables):
            tid=c['type']['id']
            if tid not in templates:
                native=[]
                name=case_id+'.type'+str(len(templates))
                build(document,{'cable_type_id':tid,'length_m':length,'include_exact':include_exact},out,name,native_layers=native)
                path=out/(name+'.geometry.json')
                model=json.loads(path.read_text('utf-8'))
                path.unlink()
                templates[tid]=(model,native)
                for row in model['layers']:
                    assets[row['geometry_key']]={k:v for k,v in row.items() if k not in ('entity','construction','mass_kg','mass_kg_per_km')}
            model,native=templates[tid]
            x,z=c['x'],c['z']
            r=c['radius']
            transform=[1,0,0,x*1000,0,0,1,0,0,-1,0,z*1000]
            parts=[]
            for row,body in zip(model['layers'],native):
                parts.append({'asset_id':row['geometry_key'],'transform_mm':transform})
                world.append(body.rotate((0,0,0),(1,0,0),-90).translate((x*1000,0,z*1000)))
            circuit_label=c['circuit'].get('label')
            if not circuit_label or circuit_label.startswith('v0 '):
                circuit_label=f"第{document['circuits'].index(c['circuit'])+1}回路"
            label=circuit_label+' · '+c['instance']['phase']+' 相'
            if c['instance'].get('parallel_index',1)>1:
                label+=' · 并联 '+str(c['instance']['parallel_index'])
            objects.append({'id':c['placement']['cable'],'kind':'cable','label':label,'cable_type_id':tid,'type_label':c['type']['label'],
                'position_m':{'x':x,'z':z},'outer_diameter_m':r*2,'bounds_m':[x-r,0,z-r,x+r,length,z+r],'parts':parts})
            tools.append(shell(cq,0,r*1000,L).rotate((0,0,0),(1,0,0),-90).translate((x*1000,0,z*1000)))

    def _enclosures(self):
        cq, section, length, L = self.cq, self.section, self.length, self.length*1000
        objects, world, enclosure_tools = self.objects, self.world, self.enclosure_tools
        box, asset, identity = self._box, self._asset, self.identity
        enclosure_keys=[]
        for e in section.get('enclosures',[]):
            x,z=e['x'],e['z']
            if e['type']=='duct':
                ri,ro=e['inner_diameter']/2,e['outer_diameter']/2
                b=[x-ro,0,z-ro,x+ro,length,z+ro]
                make=lambda ri=ri,ro=ro,x=x,z=z:shell(cq,ri*1000,ro*1000,L).rotate((0,0,0),(1,0,0),-90).translate((x*1000,0,z*1000))
                tool=shell(cq,0,ro*1000,L).rotate((0,0,0),(1,0,0),-90).translate((x*1000,0,z*1000))
                representation='按输入内外径拉伸的排管壁'
            else:
                b=[x-e['width']/2,0,z-e['height']/2,x+e['width']/2,length,z+e['height']/2]
                make=lambda b=b:box(b)
                tool=box(b)
                representation='矩形容纳结构外包络 · 未指定壁厚'
            key=['enclosure',e,L]
            aid,body=asset(key,make,e.get('material'),representation)
            objects.append({'id':e['id'],'kind':'enclosure','label':e.get('label') or ('排管' if e['type']=='duct' else '容纳结构'),
                'position_m':{'x':x,'z':z},'bounds_m':b,'parts':[{'asset_id':aid,'transform_mm':identity}]})
            world.append(body)
            enclosure_tools.append(tool)
            enclosure_keys.append(key)
        return enclosure_keys

    def _regions(self, enclosure_keys):
        cq, section, cables, length = self.cq, self.section, self.cables, self.length
        crop, L = self.crop, self.length*1000
        objects, world, tools = self.objects, self.world, self.tools
        enclosure_tools = self.enclosure_tools
        box, asset, identity = self._box, self._asset, self.identity
        voids=enclosure_tools+[t for t,c in zip(tools,cables) if not c['placement'].get('enclosure')]
        void_key=[[(c['placement']['cable'],c['x'],c['z'],c['radius']) for c in cables],enclosure_keys]
        def cut_voids(body):
            # A compound of mutually tangent cutters can leave a non-manifold
            # soil shell in OCCT. Sequential regularized differences retain the
            # same circles and coordinates, without opening an artificial gap.
            for void in voids:
                body=body.cut(void)
            return body.clean()
        bf=section.get('backfill')
        backfill_box=None
        if bf:
            b=[bf['x']-bf['width']/2,0,bf['z']-bf['height']/2,bf['x']+bf['width']/2,length,bf['z']+bf['height']/2]
            backfill_box=box(b)
            aid,body=asset(['backfill',b,void_key],lambda:cut_voids(box(b)),bf['material'],'回填区截面拉伸，扣除电缆及容纳结构包络')
            objects.append({
                'id':bf['id'],
                'kind':'backfill',
                'label':bf.get('label','回填区'),
                'bounds_m':b,
                'parts':[{'asset_id':aid,'transform_mm':identity}],
            })
            world.append(body)
        if section['kind']=='ground':
            layers=section.get('soil_layers',[])
            bands=[]
            top=0.
            for l in layers:
                if top>l['top_z']:
                    bands.append((section['id']+'/soil-upper','基准土壤',section['medium'].get('material'),top,l['top_z']))
                bands.append((l['id'],l['label'],l['material'],l['top_z'],l['bottom_z']))
                top=l['bottom_z']
            if top>crop[2]:
                bands.append((section['id']+'/soil-base','基准土壤',section['medium'].get('material'),top,crop[2]))
            for index,(rid,label,material,ztop,zbottom) in enumerate(bands):
                b=[crop[0],0,zbottom,crop[3],length,ztop]
                def soil(b=b):
                    body=box(b)
                    if backfill_box is not None:
                        body=body.cut(backfill_box)
                    return cut_voids(body)
                aid,body=asset(['soil',b,void_key,bf],soil,material,'土壤层截面拉伸，扣除回填及电缆 / 排管包络')
                objects.append({
                    'id':rid,
                    'kind':'soil',
                    'label':label,
                    'bounds_m':b,
                    'tint_index':index,
                    'parts':[{'asset_id':aid,'transform_mm':identity}],
                })
                world.append(body)
            gb=[crop[0],0,0,crop[3],length,0]
            def ground():return cq.Face.makeFromWires(cq.Wire.makePolygon(
                [(crop[0]*1000,0,0),(crop[3]*1000,0,0),(crop[3]*1000,L,0),(crop[0]*1000,L,0)],
                close=True,
            ))
            aid,body=asset(['ground',gb],ground,None,'地表 z=0 参考面，无厚度',dimension=2)
            objects.append({
                'id':section['id']+'/ground',
                'kind':'ground',
                'label':'地表 z=0',
                'bounds_m':gb,
                'parts':[{'asset_id':aid,'transform_mm':identity}],
            })
            world.append(body)

    def _finish(self):
        cq, document, out, case_id = self.cq, self.document, self.out, self.case_id
        section, cables, length, crop = self.section, self.cables, self.length, self.crop
        assets, objects, world = self.assets, self.objects, self.world
        templates, include_exact, started = self.templates, self.include_exact, self.started
        regions_reused, region_timings = self.regions_reused, self.region_timings
        if sum(len(o['parts']) for o in objects)>512:
            raise ValueError('场景显示实体超过 512 个')
        warnings=['场景沿展示长度拉伸，有限土壤窗口仅用于显示，不是数值远场边界。','电缆保留单根建模方法的制造近似；管内空腔和未知构造不补材料。']
        payload={'schema':'cablesim.cad-scene/1','section_id':section['id'],'label':section['label'],'length_m':length,
            'geometry_unit':'m','brep_unit':'mm','step_unit':'mm','coordinate_frame':'x/y/z','extrusion_axis':'+Y',
            'crop_bounds_m':crop,'assets':assets,'objects':objects,'exact_pending':not include_exact,'material_sources':document['materials'],
            'input_sha256':sha256(json.dumps(document,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),'limitations':warnings,
            'build_stats':{'build_ms':(perf_counter()-started)*1000,'cable_instances':len(cables),'cable_templates':len(templates),
                'display_parts':sum(len(o['parts']) for o in objects),'reused_regions':regions_reused,'regions':region_timings,
                'cables':[m['build_stats'] for m,_ in templates.values()]}}
        if include_exact:
            path=out/(case_id+'.scene.step')
            cq.exporters.export(cq.Compound.makeCompound(world),str(path),exportType='STEP')
            payload['step_text']=path.read_text('utf-8')
            path.unlink()
        name=case_id+'.scene.json'
        (out/name).write_text(json.dumps(payload,ensure_ascii=False,allow_nan=False),'utf-8')
        return {'results':[{
            'key':'x-cablesim.scene-extrusion-length',
            'type':'quantity',
            'entity':section['id'],
            'status':'available',
            'value':length,
            'unit':'m',
        }],'artifacts':[{'type':'x-cablesim.cad-scene','path':'output/'+name}],
            'warnings':[{'code':'SCENE_DISPLAY_DOMAIN','message':w} for w in warnings]}


def build_scene(document, parameters, out, case_id):
    scene = _SceneBuild(document, parameters, out, case_id)
    scene._cables()
    enclosure_keys = scene._enclosures()
    scene._regions(enclosure_keys)
    return scene._finish()


def main():
    request = json.loads(Path('input/request.json').read_text('utf-8'))
    from cablesim_sdk.parameter_units import decode_request
    request = decode_request(request, Path(__file__).resolve().parents[2]/'plugin.json')
    if request.get('protocol') == PROTOCOL and request.get('capability') == 'core-layout-proposal' and request.get('phase') in ('check', 'run'):
        from cablesim_cable_geometry.proposal import propose
        cases = []
        for case in request['cases']:
            try:
                artifact = propose(case['input'])
                result = {}
                if request['phase'] == 'run':
                    name = case['case_id'] + '.proposal.json'
                    Path('output', name).write_text(json.dumps(artifact, ensure_ascii=False, allow_nan=False), 'utf-8')
                    result = {'results': [{'key': 'x-cablesim.proposed-conductor-diameter', 'type': 'quantity', 'entity': 'cable_type/design', 'status': 'available', 'value': artifact['rows'][0]['value'], 'unit': 'm'}],
                              'artifacts': [{'type': 'x-cablesim.core-layout-proposal', 'path': 'output/' + name}]}
                cases.append({'case_id': case['case_id'], 'status': 'succeeded', **result})
            except (KeyError, ValueError, TypeError) as exc:
                cases.append({'case_id': case['case_id'], 'status': 'not_applicable', 'error': {'code': 'LAYOUT_INPUT_UNSUPPORTED', 'message': str(exc)}})
        from cablesim_sdk.result_answers import attach_witnesses
        attach_witnesses(request, {'cases': cases}, Path(__file__).resolve().parents[2]/'plugin.json')
        Path('output/result.json').write_text(json.dumps({'protocol': PROTOCOL, 'cases': cases,
            'environment': {'python': platform.python_version(), 'method': '1.0.0', 'native_kernel_loaded': False}}, ensure_ascii=False, allow_nan=False), 'utf-8')
        return
    if request.get('protocol') != PROTOCOL or request.get('capability') not in (
        'concentric-model',
        'installation-scene',
    ) or request.get('phase') not in ('check', 'run'):
        raise ValueError('不支持的协议或能力')
    cases = []
    import_started = perf_counter()
    try:
        import cadquery as cq
        dependency_error = None
    except ImportError:
        cq = None
        dependency_error = '几何环境缺失或 CadQuery / Open CASCADE 无法加载；请运行 python scripts/prepare_plugin_environment.py cablesim.cable-geometry'
    import_ms = (perf_counter()-import_started)*1000
    for case in request['cases']:
        base = {'case_id': case['case_id']}
        if dependency_error:
            cases.append({**base, 'status':'failed', 'error':{'code':'CAD_ENVIRONMENT_MISSING','message':dependency_error}})
            continue
        try:
            scene=request['capability']=='installation-scene'
            (prepare_scene if scene else prepare)(case['input'], case.get('parameters', {}))
            reuse=None
            reuse_path=Path('input/reuse-artifacts.json')
            if reuse_path.is_file():
                raw=reuse_path.read_bytes()
                if sha256(raw).hexdigest()!=case.get('parameters',{}).get('_artifact_reuse_sha256'):
                    raise ValueError('复用工件摘要不一致')
                reuse=json.loads(raw)
            result = {} if request['phase'] == 'check' else build_scene(
                case['input'],
                case.get('parameters',{}),
                Path('output'),
                case['case_id'],
            ) if scene else build(case['input'], case.get('parameters', {}), Path('output'), case['case_id'],reuse_artifacts=reuse)
            cases.append({**base, 'status': 'succeeded', **result})
        except (ValueError, KeyError, TypeError) as exc:
            cases.append({**base, 'status': 'not_applicable', 'error': {'code': 'CAD_INPUT_UNSUPPORTED', 'message': str(exc)}})
        except Exception:
            cases.append({**base, 'status': 'failed', 'error': {'code': 'CAD_BUILD_FAILED', 'message': 'CAD 内核生成失败，未返回替代几何或数值'}})
    from cablesim_sdk.result_answers import attach_witnesses
    attach_witnesses(request,{'cases':cases},Path(__file__).resolve().parents[2]/'plugin.json')
    Path('output/result.json').write_text(json.dumps({'protocol': PROTOCOL, 'cases': cases,
            'environment': {
                'python': platform.python_version(),
                'packages': {'cadquery': cq.__version__ if cq else 'unavailable'},
                'method': SCENE_VERSION if request['capability']=='installation-scene' else VERSION,
            'profiling': {'cadquery_import_ms':import_ms}}},
        ensure_ascii=False, allow_nan=False), 'utf-8')


def resident_warmup():
    global RESIDENT
    try:
        import cadquery
    except ImportError as error:
        raise RuntimeError('几何环境缺失或原生库无法加载；请运行 python scripts/prepare_plugin_environment.py cablesim.cable-geometry。'+str(error)) from error
    RESIDENT=True


def resident_main():
    main()


if __name__ == '__main__':
    main()
