"""Native geometry checks against independent cross-section arithmetic."""
from copy import deepcopy
import importlib.util
import json
from math import cos, pi, sin, sqrt
from pathlib import Path

import pytest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('multicore_cad',ROOT/'plugins/cablesim.cable-geometry/src/cablesim_cable_geometry/main.py')
cad=importlib.util.module_from_spec(spec);spec.loader.exec_module(cad)


def document(sector=False):
    conductor={'form':'sectoral' if sector else 'stranded_round_compacted','material':'material/cu',
        'diameter':.04 if sector else .02,'nominal_area':.0003,'lay_factor':1.02}
    radius=.006 if sector else .029/sqrt(3)
    cores=[]
    for i,angle in enumerate((0,120,240)):
        c=deepcopy(conductor)
        if sector:c.update(sector_angle_deg=120,sector_rotation_deg=angle)
        cores.append({'id':f'core/{i+1}','x':radius*cos(angle*pi/180),'z':radius*sin(angle*pi/180),
            'conductor':c,'layers':[{'role':'insulation','material':'material/xlpe','thickness':.0045}]})
    return {'schema_version':'cablesim.domain/1','materials':[
        {'id':'material/cu','label':'铜','category':'conductor','density':8900},
        {'id':'material/xlpe','label':'交联聚乙烯','category':'insulation','density':920},
        {'id':'material/pvc','label':'聚氯乙烯','category':'polymer','density':1400},
        {'id':'material/filler','label':'填充','category':'filler','density':1100},
        {'id':'material/steel','label':'镀锌钢带','category':'metal','density':7850}],
        'cable_types':[{'id':'cable_type/test','label':'Three-core independent geometry','construction':'three_core',
            'cores':cores,'common_layers':[
                {'role':'filler','material':'material/filler','thickness':.001},
                {'role':'bedding','material':'material/pvc','form':'smooth','thickness':.002},
                {'role':'armour','material':'material/steel','form':'tape','thickness':.0016,
                 'nominal_tape_thickness':.0008,'tape_width':.04,'tape_gap':.01,'tape_count':2,'tape_application':'two_tape_gap'},
                {'role':'oversheath','material':'material/pvc','thickness':.0036}]}]}


@pytest.mark.parametrize('sector',[False,True])
def test_multicore_native_volume_stable_targets_and_step(tmp_path,sector):
    import cadquery as cq
    d=document(sector);original=deepcopy(d);length=.06
    cad.build(d,{'cable_type_id':'cable_type/test','length_m':length},tmp_path,'model')
    model=json.loads((tmp_path/'model.geometry.json').read_text('utf-8'))
    assert d==original
    bundle=.0305 if sector else .029/sqrt(3)+.0145
    assert model['outer_diameter_m']==pytest.approx(2*(bundle+.001+.002+.0016+.0036),rel=1e-10)
    rows=model['layers'];assert len(rows)==10 and len({r['entity'] for r in rows})==10
    conductors=[r for r in rows if r['role']=='conductor']
    assert sum(r['mass_kg_per_km'] for r in conductors)==pytest.approx(3*300e-6*1.02*8900*1000)
    assert {r['source_target']['core_id'] for r in conductors}=={'core/1','core/2','core/3'}
    # Steiner's formula for a uniformly offset convex sector: A + perimeter*t + pi*t^2.
    core_area=(.02**2*pi/3+(2*.02+.02*2*pi/3)*.0045+pi*.0045**2) if sector else pi*.0145**2
    filler=next(r for r in rows if r['role']=='filler')
    assert filler['volume_m3']==pytest.approx((pi*(bundle+.001)**2-3*core_area)*length,rel=1e-7)
    assert next(r for r in rows if r['role']=='armour')['solid_count']==2
    path=tmp_path/'model.step';path.write_text(model['step_text'],'utf-8')
    bodies=cq.importers.importStep(str(path)).solids().vals()
    assert bodies and all(body.isValid() for body in bodies)
    assert sum(body.Volume() for body in bodies)*1e-9==pytest.approx(sum(r['volume_m3'] for r in rows),rel=1e-7)


@pytest.mark.parametrize('mode',['trefoil','flat','ducts','backfill'])
def test_touching_single_core_cables_leave_valid_scene_regions(tmp_path,mode):
    import cadquery as cq
    from backend.kernel.scenarios import system_models, apply_layout
    from backend.domain.migration import convert
    from backend.schemas import Scenario
    model=next(m for m in system_models() if m['id']=='system.specification-cu-xlpe-al-400')
    d=convert(Scenario())['document']
    cable=deepcopy(model['payload']['cable_type']);old=d['cable_types'][0]['id']
    d['cable_types']=[cable];used={m['id'] for m in model['payload']['materials']}
    d['materials']=[*deepcopy(model['payload']['materials']),*(m for m in d['materials'] if m['id'] not in used)]
    for circuit in d['circuits']:
        if circuit['cable_type']==old:circuit['cable_type']=cable['id']
    d=apply_layout(d,mode)
    cad.build_scene(d,{'section_id':d['sections'][0]['id'],'length_m':.08},tmp_path,'scene')
    scene=json.loads((tmp_path/'scene.scene.json').read_text('utf-8'))
    for row in scene['assets'].values():
        path=tmp_path/'part.brep';path.write_text(row['brep_text'],'utf-8')
        shape=cq.importers.importBrep(str(path)).val()
        assert shape.isValid()
        if row.get('topology_dimension',3)==3:assert shape.Solids() and shape.Volume()>0
    assert {o['kind'] for o in scene['objects']} >= {'cable','soil','ground'}
    if mode=='ducts':assert any(o['kind']=='enclosure' for o in scene['objects'])
    if mode=='backfill':assert any(o['kind']=='backfill' for o in scene['objects'])
    bounds=scene['crop_bounds_m'];expected=(bounds[3]-bounds[0])*(bounds[4]-bounds[1])*(bounds[5]-bounds[2])
    # Input cable radius is (25 + 2*(.6+5.5+.7+.8+2.5))/2 = 22.6 mm.
    for duct in d['sections'][0].get('enclosures',[]):
        if duct['type']=='duct':expected-=pi*((duct['inner_diameter']/2)**2-.0226**2)*.08
    actual=sum(scene['assets'][part['asset_id']]['volume_m3'] for obj in scene['objects'] for part in obj['parts'])
    assert actual==pytest.approx(expected,rel=1e-8)


def test_sector_tape_envelope_uses_developed_perimeter_not_circumscribed_circle(tmp_path):
    import cadquery as cq
    d=document(True);cable=d['cable_types'][0]
    for core in cable['cores']:
        core['layers'].append({'role':'metallic_screen','material':'material/cu','form':'tape',
            'thickness':.0002,'nominal_tape_thickness':.0001,'tape_width':.04,'overlap':.15,'tape_application':'helical_overlap'})
    cad.build(d,{'cable_type_id':cable['id'],'length_m':.06},tmp_path,'sector')
    model=json.loads((tmp_path/'sector.geometry.json').read_text('utf-8'))
    # Convex parallel-curve perimeter P(t)=P(0)+2*pi*t; mean offset 4.6 mm.
    expected=(.02*(2+2*pi/3)+2*pi*.0046)*.0001*.06/.85
    for row in (r for r in model['layers'] if r['role']=='metallic_screen'):
        assert row['material_volume_m3']==pytest.approx(expected,rel=1e-10)
        assert '扇形搭盖带设计包络' in row['representation']
        path=tmp_path/'screen.brep';path.write_text(row['brep_text'],'utf-8')
        assert cq.importers.importBrep(str(path)).val().isValid()
