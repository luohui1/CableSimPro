"""Installation geometry preserves the section, world units and region partition."""
from copy import deepcopy
import importlib.util
import json
import math
from pathlib import Path

import pytest

from backend.plugin_host import Executor

ROOT=Path(__file__).resolve().parents[1]
entry=ROOT/'plugins/cablesim.cable-geometry/src/cablesim_cable_geometry/main.py'
spec=importlib.util.spec_from_file_location('installation_geometry',entry)
cad=importlib.util.module_from_spec(spec);spec.loader.exec_module(cad)
PARAMS={'section_id':'section/1','length_m':.4}


def scene_document():
    from design.workbench.scenarios import system_models
    model=next(m for m in system_models() if m['id']=='system.yjq02-110kv-800')
    cable=deepcopy(model['payload']['cable_type']);cable['cores'][0]['conductor']['lay_factor']=1.02
    next(l for l in cable['common_layers'] if l['role']=='insulation')['thickness']=.017
    circuits=[{'id':f'circuit/{j}','label':f'回路 {j+1}','cable_type':cable['id'],
        'cables':[{'id':f'cable/{j}-{p}','phase':p,'parallel_index':1} for p in 'ABC']} for j in range(2)]
    placements=[{'cable':p['id'],'x':(i-2.5)*.11,'z':-.8,'enclosure':None} for i,p in enumerate(p for c in circuits for p in c['cables'])]
    return {'schema_version':'cablesim.domain/1','name':'Explicit synthetic scene benchmark','materials':deepcopy(model['payload']['materials'])+[
        {'id':'material/soil','label':'Test soil','category':'soil'},
        {'id':'material/backfill','label':'Test backfill','category':'backfill'},
        {'id':'material/duct','label':'Test duct','category':'duct'}],
        'cable_types':[cable],'circuits':circuits,'sections':[{'id':'section/1','label':'双回测试截面','kind':'ground',
            'medium':{'material':'material/soil'},'placements':placements,'enclosures':[],
            'backfill':{'id':'region/backfill','label':'Test backfill','material':'material/backfill','x':0,'z':-.8,'width':1.1,'height':.4},
            'soil_layers':[{'id':'region/upper','label':'Upper soil','material':'material/soil','top_z':0,'bottom_z':-.6},
                           {'id':'region/lower','label':'Lower soil','material':'material/soil','top_z':-.6,'bottom_z':-1.2}]}]}


def model(tmp_path,document,parameters=PARAMS,name='scene'):
    cad.build_scene(document,parameters,tmp_path,name)
    return json.loads((tmp_path/(name+'.scene.json')).read_text('utf-8'))


def test_world_scene_reuses_templates_and_partitions_actual_media(tmp_path):
    cq=pytest.importorskip('cadquery');d=scene_document();original=deepcopy(d)
    m=model(tmp_path,d);assert d==original
    assert m['coordinate_frame']=='x/y/z' and m['extrusion_axis']=='+Y' and m['brep_unit']=='mm'
    cables=[o for o in m['objects'] if o['kind']=='cable'];assert len(cables)==6
    assert m['build_stats']['cable_templates']==1 and m['build_stats']['display_parts']>32
    assert all([p['asset_id'] for p in o['parts']]==[p['asset_id'] for p in cables[0]['parts']] for o in cables)
    for o,p in zip(cables,d['sections'][0]['placements']):
        assert o['id']==p['cable'] and o['position_m']=={'x':p['x'],'z':p['z']}
        assert o['outer_diameter_m']==pytest.approx(.0858)
        assert o['bounds_m'][0]==pytest.approx(p['x']-.0429)
        t=o['parts'][0]['transform_mm'];assert t==[1,0,0,p['x']*1000,0,0,1,0,0,-1,0,p['z']*1000]
    assert all(a['brep_text'] and a['display_mesh'] for a in m['assets'].values())
    bf=next(o for o in m['objects'] if o['kind']=='backfill');bv=m['assets'][bf['parts'][0]['asset_id']]['volume_m3']
    assert bv==pytest.approx(1.1*.4*.4-6*math.pi*.0429**2*.4,rel=1e-8)
    for label,ztop,zbottom in [('region/upper',0,-.6),('region/lower',-.6,-1.2)]:
        o=next(o for o in m['objects'] if o['id']==label)
        assert o['bounds_m'][2]==zbottom and o['bounds_m'][5]==ztop
    ground=next(o for o in m['objects'] if o['kind']=='ground');assert ground['bounds_m'][2]==ground['bounds_m'][5]==0
    assert m['assets'][ground['parts'][0]['asset_id']]['topology_dimension']==2
    path=tmp_path/'world.step';path.write_text(m['step_text'],'utf-8')
    bodies=cq.importers.importStep(str(path)).solids().vals();assert len(bodies)==39 and all(b.isValid() for b in bodies)
    b=m['crop_bounds_m'];expected=(b[3]-b[0])*(b[4]-b[1])*(0-b[2])
    assert sum(s.Volume() for s in bodies)*1e-9==pytest.approx(expected,rel=1e-8)
    thin=[s for s in bodies if s.BoundingBox().xlen<90 and s.BoundingBox().zlen<90]
    assert len(thin)==36 and all(s.BoundingBox().ymin==pytest.approx(0,abs=1e-5) and s.BoundingBox().ymax==pytest.approx(400,abs=1e-5) for s in thin)


def test_position_changes_reuse_cables_and_rebuild_regions_without_stale_mesh(tmp_path,monkeypatch):
    pytest.importorskip('cadquery');monkeypatch.setattr(cad,'RESIDENT',True);monkeypatch.setattr(cad,'SHAPE_CACHE',cad.SHAPE_CACHE.__class__());monkeypatch.setattr(cad,'SCENE_CACHE',cad.SCENE_CACHE.__class__())
    d=scene_document();params={**PARAMS,'include_exact':False};a=model(tmp_path,d,params,'before')
    for p in d['sections'][0]['placements'][3:]:p['x']+=.02
    b=model(tmp_path,d,params,'after')
    assert a['input_sha256']!=b['input_sha256'] and 'step_text' not in b and b['exact_pending']
    assert b['build_stats']['cables'][0]['generated_layers']==0 and b['build_stats']['cables'][0]['reused_layers']==6
    for before,after in zip(a['objects'][:6],b['objects'][:6]):assert [p['asset_id'] for p in before['parts']]==[p['asset_id'] for p in after['parts']]
    assert b['objects'][3]['position_m']['x']==pytest.approx(a['objects'][3]['position_m']['x']+.02)
    for kind in ['backfill','soil']:
        x=next(o for o in a['objects'] if o['kind']==kind and o['bounds_m'][2]<-.6)
        y=next(o for o in b['objects'] if o['id']==x['id']);assert x['parts'][0]['asset_id']!=y['parts'][0]['asset_id']
    full=model(tmp_path,d,PARAMS,'exact');assert full['input_sha256']==b['input_sha256'] and full['objects']==b['objects']
    assert full['build_stats']['reused_regions']==len(full['build_stats']['regions'])


def test_duct_void_is_not_double_counted_or_filled_with_invented_air(tmp_path):
    cq=pytest.importorskip('cadquery');d=scene_document();sec=d['sections'][0]
    sec['placements']=sec['placements'][:1];p=sec['placements'][0];p.update(x=0,enclosure='enclosure/pipe')
    sec['enclosures']=[{'id':'enclosure/pipe','type':'duct','x':0,'z':-.8,'inner_diameter':.1,'outer_diameter':.12,'material':'material/duct','contains':[p['cable']]}]
    m=model(tmp_path,d);pipe=next(o for o in m['objects'] if o['kind']=='enclosure');a=m['assets'][pipe['parts'][0]['asset_id']]
    assert a['volume_m3']==pytest.approx(math.pi*(.06**2-.05**2)*.4,rel=1e-8)
    path=tmp_path/'duct.step';path.write_text(m['step_text'],'utf-8');solids=cq.importers.importStep(str(path)).solids().vals()
    b=m['crop_bounds_m'];expected=(b[3]-b[0])*.4*(-b[2])-math.pi*(.05**2-.0429**2)*.4
    assert sum(s.Volume() for s in solids)*1e-9==pytest.approx(expected,rel=1e-8)
    assert all(s.isValid() for s in solids)


@pytest.mark.parametrize('kind',['missing-section','overlap','nonfinite','small-crop','bad-layer','unsupported-core'])
def test_invalid_scene_is_refused(kind):
    d=scene_document();p=dict(PARAMS);s=d['sections'][0]
    if kind=='missing-section':p['section_id']='section/missing'
    elif kind=='overlap':s['placements'][1]['x']=s['placements'][0]['x']
    elif kind=='nonfinite':s['placements'][0]['z']=float('nan')
    elif kind=='small-crop':p['crop_bounds_m']=[-.1,0,-1.2,.1,.4,0]
    elif kind=='bad-layer':s['soil_layers'][1]['top_z']=-.7
    else:d['cable_types'][0]['construction']='three_core'
    with pytest.raises(ValueError):cad.prepare_scene(d,p)


def test_scene_runs_through_the_generic_sealed_protocol(tmp_path):
    pytest.importorskip('cadquery');result=Executor(jobs_root=tmp_path).run('cablesim.cable-geometry','installation-scene',[{'case_id':'scene','input':scene_document(),'parameters':PARAMS}])
    case=result.cases[0];assert case.status=='succeeded'
    assert case.value('x-cablesim.scene-extrusion-length','section/1')==.4
    assert case.artifacts['x-cablesim.cad-scene']['schema']=='cablesim.cad-scene/1'
    assert len(case.artifact_digests['x-cablesim.cad-scene'])==64 and not list(tmp_path.iterdir())
