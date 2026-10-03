"""CAD geometry must come from valid native solids and retain SI/STEP units."""
from copy import deepcopy
import importlib.util
import json
import math
from pathlib import Path
from base64 import b64decode
from array import array
import pytest
from backend.plugin_host import Executor

ROOT = Path(__file__).resolve().parents[1]
ENTRY = ROOT / 'plugins/cablesim.cable-geometry/src/cablesim_cable_geometry/main.py'
spec = importlib.util.spec_from_file_location('cable_geometry_plugin', ENTRY)
cad = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cad)


def document():
    return {'schema_version': 'cablesim.domain/1',
            'materials': [{'id': 'material/cu', 'category': 'conductor'}, {'id': 'material/xlpe', 'category': 'insulation'}],
            'cable_types': [{'id': 'cable_type/test', 'label': 'Synthetic geometry benchmark', 'construction': 'single_core',
                'cores': [{'id': 'core/1', 'x': 0, 'z': 0, 'conductor': {'diameter': .02, 'form': 'solid_round', 'material': 'material/cu'}, 'layers': []}],
                'common_layers': [{'role': 'insulation', 'material': 'material/xlpe', 'thickness': .005}]}]}


PARAMS = {'cable_type_id': 'cable_type/test', 'length_m': .1}


@pytest.mark.parametrize('change', ['multi_core', 'hollow', 'offset', 'missing-material', 'nan', 'negative', 'corrugated'])
def test_unsupported_or_invalid_geometry_is_refused(change):
    d = document()
    t = d['cable_types'][0]
    if change == 'multi_core': t['construction'] = 'three_core'
    elif change == 'hollow': t['cores'][0]['conductor']['form'] = 'hollow'
    elif change == 'offset': t['cores'][0]['x'] = .001
    elif change == 'missing-material': t['common_layers'][0]['material'] = 'material/missing'
    elif change == 'corrugated': t['common_layers'][0]['form'] = 'corrugated'
    else: t['common_layers'][0]['thickness'] = float('nan') if change == 'nan' else -.001
    with pytest.raises(ValueError):
        cad.prepare(d, PARAMS)


def test_native_geometry_roundtrip_and_units(tmp_path):
    cq = pytest.importorskip('cadquery')
    d = document()
    original = deepcopy(d)
    result = cad.build(d, PARAMS, tmp_path, 'base')
    model = json.loads((tmp_path / 'base.geometry.json').read_text('utf-8'))
    assert d == original
    assert model['outer_diameter_m'] == pytest.approx(.03)
    assert model['geometry_unit'] == 'm' and model['step_unit'] == 'mm' and model['brep_unit'] == 'mm'
    assert model['layers'][0]['volume_m3'] == pytest.approx(math.pi * .01**2 * .1, rel=1e-8)
    assert model['layers'][1]['volume_m3'] == pytest.approx(math.pi * (.015**2-.01**2) * .1, rel=1e-8)
    for index, layer in enumerate(model['layers']):
        brep = tmp_path / f'part-{index}.brep'
        brep.write_text(layer['brep_text'], encoding='utf-8')
        recovered = cq.importers.importBrep(str(brep)).val()
        assert recovered.isValid()
        assert recovered.Volume() * 1e-9 == pytest.approx(layer['volume_m3'], rel=1e-8)
        caps=[f.Center().z for f in recovered.Faces() if f.geomType()=='PLANE']
        assert min(caps)==pytest.approx(0) and max(caps)==pytest.approx(100)
    step = tmp_path / 'roundtrip.step'
    step.write_text(model['step_text'], encoding='utf-8')
    imported = cq.importers.importStep(str(step))
    assert len(imported.solids().vals()) == 2
    assert sum(s.Volume() for s in imported.solids().vals()) * 1e-9 == pytest.approx(math.pi * .015**2*.1, rel=1e-8)
    assert not any('mass' in r['key'] for r in result['results'])


def test_geometry_runs_through_sealed_protocol(tmp_path):
    pytest.importorskip('cadquery')
    host = Executor(jobs_root=tmp_path)
    request = [{'case_id': 'base', 'input': document(), 'parameters': PARAMS}]
    assert host.check('cablesim.cable-geometry', 'concentric-model', request).cases[0].status == 'succeeded'
    result = host.run('cablesim.cable-geometry', 'concentric-model', request)
    case = result.cases[0]
    assert case.status == 'succeeded'
    assert case.value('x-cablesim.outer-diameter', 'cable_type/test') == pytest.approx(.03)
    assert len(case.artifact_digests['x-cablesim.cad-model']) == 64
    assert not list(tmp_path.iterdir())


def test_display_preview_loads_exact_same_solids_on_demand(tmp_path, monkeypatch):
    cq=pytest.importorskip('cadquery')
    monkeypatch.setattr(cad,'RESIDENT',True)
    monkeypatch.setattr(cad,'SHAPE_CACHE',cad.SHAPE_CACHE.__class__())
    d=document();d['materials'][0]['density']=8960;d['materials'][1]['density']=920
    cad.build(d,{**PARAMS,'include_exact':False},tmp_path,'display')
    display=json.loads((tmp_path/'display.geometry.json').read_text('utf-8'))
    assert display['exact_pending'] and 'step_text' not in display
    assert all('brep_text' not in row and row['display_mesh'] for row in display['layers'])
    def no_rebuild(*args,**kwargs):raise AssertionError('Exact export rebuilt cached solids')
    monkeypatch.setattr(cad,'layer_shape',no_rebuild)
    cad.build(d,PARAMS,tmp_path,'exact')
    exact=json.loads((tmp_path/'exact.geometry.json').read_text('utf-8'))
    assert not exact['exact_pending'] and exact['build_stats']['reused_layers']==2
    for name in ['outer_diameter_m','mass_kg_per_km']:assert exact[name]==display[name]
    for a,b in zip(display['layers'],exact['layers']):
        for name in ['geometry_key','volume_m3','mass_kg','solid_count']:assert a[name]==b[name]
        assert b['brep_text']
    step=tmp_path/'exact.step';step.write_text(exact['step_text'],'utf-8')
    solids=cq.importers.importStep(str(step)).solids().vals()
    assert len(solids)==2 and all(s.isValid() for s in solids)


def test_missing_manufacturing_facts_and_bad_density_are_not_invented():
    d=document()
    conductor=d['cable_types'][0]['cores'][0]['conductor']
    conductor['form']='stranded_round'
    with pytest.raises(ValueError,match='根数'):
        cad.prepare(d,PARAMS)
    conductor.update(wire_count=37,wire_diameter=.003,lay_length=.2)
    with pytest.raises(ValueError,match='重叠'):
        cad.prepare(d,PARAMS)
    conductor['form']='solid_round'
    d['materials'][0]['density']=-1
    with pytest.raises(ValueError,match='密度'):
        cad.prepare(d,PARAMS)


def test_strands_screen_reverse_tape_armour_and_step_share_solids(tmp_path):
    cq=pytest.importorskip('cadquery')
    from design.workbench.cable_example import example
    d=example()['document']
    params={'cable_type_id':d['cable_types'][0]['id'],'length_m':.18}
    cad.build(d,params,tmp_path,'stranded')
    model=json.loads((tmp_path/'stranded.geometry.json').read_text('utf-8'))
    rows={r['role']:r for r in model['layers']}
    assert rows['conductor']['solid_count']==37
    assert rows['metallic_screen']['solid_count']==24
    assert rows['armour']['solid_count']==47
    assert rows['binder']['solid_count']==1 and rows['binder']['material_volume_m3']>0
    assert rows['binder']['construction']['lay_direction']=='left'
    assert rows['metallic_screen']['construction']['lay_direction']=='right'
    assert d['name']=='YJV72 8.7/15 kV 1×120 mm²'
    assert d['cable_types'][0]['rating']['u0']==8700 and d['cable_types'][0]['rating']['u']==15000
    assert d['cable_types'][0]['cores'][0]['conductor']['r20']==.000153
    armour_material=next(m for m in d['materials'] if m['id']==rows['armour']['material'])
    assert armour_material['id']=='material/aluminium' and armour_material['density']==2700
    # Analytical wire volume: normal wire area times helical centreline length.
    wr=.00203/2; orbit=(.0145/2-wr)/3
    expected=math.pi*wr**2*.18*(1+sum(6*k*math.sqrt(1+(2*math.pi*orbit*k/.2)**2) for k in range(1,4)))
    assert rows['conductor']['material_volume_m3']==pytest.approx(expected,rel=3e-5)
    for row in model['layers']:
        assert row['material_volume_m3']>0
        mesh=row['display_mesh']
        assert mesh['schema']=='cablesim.display-mesh/1' and mesh['unit']=='mm'
        assert sum(len(p['instances']) for p in mesh['prototypes'])==row['solid_count']
        for prototype in mesh['prototypes']:
            points=array('f');points.frombytes(b64decode(prototype['positions_f32']))
            triangles=array('I');triangles.frombytes(b64decode(prototype['triangles_u32']))
            assert len(points)==prototype['node_count']*3 and len(triangles)==prototype['triangle_count']*3
            assert min(triangles)>=0 and max(triangles)<prototype['node_count']
        density=next(m['density'] for m in d['materials'] if m['id']==row['material'])
        assert row['mass_kg']==pytest.approx(row['material_volume_m3']*density)
        assert row['mass_kg_per_km']==pytest.approx(row['material_volume_m3']/.18*density*1000)
    assert model['mass_kg_per_km']==pytest.approx(sum(r['mass_kg_per_km'] for r in model['layers']))
    assert model['quantity_missing_layers']==[]
    assert len(rows['conductor']['display_mesh']['prototypes'])==4
    assert len(rows['metallic_screen']['display_mesh']['prototypes'])==1
    assert len(rows['armour']['display_mesh']['prototypes'])==1
    step=tmp_path/'stranded.step';step.write_text(model['step_text'],encoding='utf-8')
    solids=cq.importers.importStep(str(step)).solids().vals()
    assert len(solids)==sum(r['solid_count'] for r in model['layers'])
    assert all(s.isValid() for s in solids)
    assert sum(s.Volume() for s in solids)*1e-9==pytest.approx(sum(r['material_volume_m3'] for r in model['layers']),rel=1e-6)
    # BSpline bounding boxes include poles beyond trimmed surfaces; check actual caps.
    planes=[f.Center().z for s in solids for f in s.Faces() if f.geomType()=='PLANE']
    vertices=[v.Center().z for s in solids for v in s.Vertices()]
    assert min(planes)==pytest.approx(0,abs=1e-5) and max(planes)==pytest.approx(180,abs=1e-5)
    assert min(vertices)>=-1e-5 and max(vertices)<=180+1e-5


def test_compacted_approximation_and_unknown_material_quantity(tmp_path):
    pytest.importorskip('cadquery')
    d=document();conductor=d['cable_types'][0]['cores'][0]['conductor']
    conductor.update(form='stranded_round_compacted',nominal_area=120e-6,lay_factor=1)
    cad.build(d,PARAMS,tmp_path,'compacted')
    model=json.loads((tmp_path/'compacted.geometry.json').read_text('utf-8'))
    row=model['layers'][0]
    assert '设计外径包络' in row['representation']
    assert row['outer_diameter_m']==pytest.approx(.02)
    assert row['material_volume_m3']==pytest.approx(120e-6*.1)
    assert row['mass_kg'] is None and row['quantity_missing']==['材料密度']
    assert row['mass_kg_per_km'] is None and model['mass_kg_per_km'] is None
    assert set(model['quantity_missing_layers'])=={'conductor','insulation'}
    conductor['form']='unspecified'
    cad.build(d,PARAMS,tmp_path,'unknown')
    row=json.loads((tmp_path/'unknown.geometry.json').read_text('utf-8'))['layers'][0]
    assert row['material_volume_m3'] is None and row['mass_kg'] is None
    assert '导体构造' in row['quantity_missing']
    d['materials'][0]['density']=8960
    d['cable_types'][0]['common_layers'].append({'role':'metallic_screen','material':'material/cu','thickness':.001,'form':'unspecified'})
    cad.build(d,PARAMS,tmp_path,'unknown-screen')
    row=json.loads((tmp_path/'unknown-screen.geometry.json').read_text('utf-8'))['layers'][-1]
    assert row['mass_kg'] is None and row['material_volume_m3'] is None
    assert row['quantity_missing']==['金属屏蔽构造']


def test_mass_per_kilometre_does_not_depend_on_display_length(tmp_path):
    pytest.importorskip('cadquery')
    d=document()
    d['materials'][0]['density']=8960
    d['materials'][1]['density']=920
    models=[]
    for name,length in [('short',.05),('long',.2)]:
        cad.build(d,{**PARAMS,'length_m':length},tmp_path,name)
        models.append(json.loads((tmp_path/(name+'.geometry.json')).read_text('utf-8')))
    short,long=models
    for a,b in zip(short['layers'],long['layers']):
        assert b['mass_kg']==pytest.approx(a['mass_kg']*4)
        assert b['mass_kg_per_km']==pytest.approx(a['mass_kg_per_km'])
    assert long['mass_kg_per_km']==pytest.approx(short['mass_kg_per_km'])


@pytest.mark.parametrize('form',['stranded_round_compacted','segmental'])
def test_design_envelope_does_not_inflate_nominal_copper_quantity(tmp_path,monkeypatch,form):
    cq=pytest.importorskip('cadquery')
    monkeypatch.setattr(cad,'RESIDENT',True)
    monkeypatch.setattr(cad,'SHAPE_CACHE',cad.SHAPE_CACHE.__class__())
    d=document();d['materials'][0]['density']=8900;d['materials'][1]['density']=920
    c=d['cable_types'][0]['cores'][0]['conductor']
    c.update(form=form,nominal_area=.0008,diameter=.034,lay_factor=1.02)
    models=[]
    for name,diameter,length,factor in [('design',.034,.1,1.02),('wider',.036,.2,1.02),('factor',.036,.2,1.03),('area',.036,.2,1.03)]:
        c.update(diameter=diameter,lay_factor=factor)
        if name=='area':c['nominal_area']=.00075
        cad.build(d,{**PARAMS,'length_m':length},tmp_path,name)
        m=json.loads((tmp_path/(name+'.geometry.json')).read_text('utf-8'));models.append(m)
        row=m['layers'][0]
        assert row['outer_diameter_m']==pytest.approx(diameter)
        assert m['outer_diameter_m']==pytest.approx(diameter+.01)
        assert row['volume_m3']==pytest.approx(math.pi*(diameter/2)**2*length)
        assert row['material_volume_m3']==pytest.approx(c['nominal_area']*length*factor)
        assert row['mass_kg_per_km']==pytest.approx(c['nominal_area']*8900*factor*1000)
        assert row['material_volume_m3']!=pytest.approx(row['volume_m3'])
        assert row['quantity_missing']==[] and '包络体积不作铜量' in row['quantity_basis']
    assert models[0]['layers'][0]['mass_kg_per_km']==models[1]['layers'][0]['mass_kg_per_km']
    assert models[1]['layers'][1]['mass_kg_per_km']>models[0]['layers'][1]['mass_kg_per_km']
    assert models[2]['build_stats']['reused_layers']==2 and models[3]['build_stats']['reused_layers']==2
    path=tmp_path/'envelope.step';path.write_text(models[0]['step_text'],'utf-8')
    bodies=cq.importers.importStep(str(path)).solids().vals()
    assert len(bodies)==2 and all(b.isValid() for b in bodies)
    assert min(b.BoundingBox().xlen for b in bodies)==pytest.approx(34)
    c.pop('lay_factor')
    cad.build(d,{**PARAMS,'length_m':.2},tmp_path,'missing')
    missing=json.loads((tmp_path/'missing.geometry.json').read_text('utf-8'))
    assert missing['outer_diameter_m']==pytest.approx(.046)
    assert missing['layers'][0]['mass_kg_per_km'] is None
    assert missing['layers'][0]['material_volume_m3'] is None
    assert missing['layers'][0]['quantity_missing']==['导体绞入系数']
    assert missing['mass_kg_per_km'] is None


@pytest.mark.parametrize('factor',[.99,0,-1,True,float('nan')])
def test_bad_compacted_lay_factor_is_refused(factor):
    d=document();c=d['cable_types'][0]['cores'][0]['conductor']
    c.update(form='stranded_round_compacted',nominal_area=120e-6,lay_factor=factor)
    with pytest.raises(ValueError,match='绞入系数'):cad.prepare(d,PARAMS)


def test_reuse_only_unchanged_layers_and_recompute_material_quantities(tmp_path,monkeypatch):
    pytest.importorskip('cadquery')
    d=document();d['materials'][0]['density']=8960;d['materials'][1]['density']=920
    cad.build(d,PARAMS,tmp_path,'original')
    original=json.loads((tmp_path/'original.geometry.json').read_text('utf-8'))
    build_layer=cad.layer_shape;generated=[]
    def tracked(cq,row,length,**options):
        generated.append(row['role']);return build_layer(cq,row,length,**options)
    monkeypatch.setattr(cad,'layer_shape',tracked)
    d['cable_types'][0]['common_layers'][0]['thickness']=.0045
    cad.build(d,PARAMS,tmp_path,'changed',reuse_artifacts={'x-cablesim.cad-model':original})
    changed=json.loads((tmp_path/'changed.geometry.json').read_text('utf-8'))
    assert generated==['insulation']
    assert changed['build_stats']['reused_layers']==1
    assert changed['layers'][0]['brep_text']==original['layers'][0]['brep_text']
    assert changed['layers'][1]['outer_radius_m']==pytest.approx(.0145)
    generated.clear();d['materials'][0]['density']=8000
    cad.build(d,PARAMS,tmp_path,'density',reuse_artifacts={'x-cablesim.cad-model':changed})
    density=json.loads((tmp_path/'density.geometry.json').read_text('utf-8'))
    assert generated==[] and density['build_stats']['reused_layers']==2
    assert density['layers'][0]['mass_kg']==pytest.approx(changed['layers'][0]['mass_kg']*8000/8960)


def test_standard_nominals_in_cad_example():
    from design.workbench.cable_example import example
    d=example()['document'];t=d['cable_types'][0];layers={l['role']:l for l in t['common_layers']}
    assert layers['insulation']['thickness']==.0045
    assert layers['bedding']['thickness']==.0012
    assert layers['armour']['wire_diameter']==.002
    assert layers['oversheath']['thickness']==.0021
    xlpe=next(m for m in d['materials'] if m['id']=='material/insulation')
    assert xlpe['relative_permittivity']==2.5 and xlpe['loss_tangent']==.004
    assert t['rating']['um']==17500
    assert any('表7' in s['reference'] for s in d['provenance'].values())
    assert any('表3' in s['reference'] for s in d['provenance'].values())

