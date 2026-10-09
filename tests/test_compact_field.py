"""Array serialization / planar hand-field checks; no FEM solver runs locally."""
import copy
import os
import numpy as np
import pytest
from cablesim_sdk.simulation import MeshControls
from cablesim_simulation.compact_field import pack,display,export
from backend.kernel.batch_field_storage import unpack,full_field,sample


def test_display_projection_checks_real_bytes_and_keeps_live_freshness(tmp_path,monkeypatch):
    import json,sqlite3
    from contextlib import contextmanager
    from types import SimpleNamespace
    from fastapi import HTTPException
    from backend.kernel.batch_field_projection import read_display
    from backend.kernel.research import encode
    from backend.kernel.workspace import fingerprint
    path=tmp_path/'fields.sqlite'
    @contextmanager
    def database():
        db=sqlite3.connect(path);db.row_factory=sqlite3.Row
        try:yield db;db.commit()
        finally:db.close()
    snapshot={'definition':{'method':{}},'cases':[]}
    output={'cases':[{'case_id':'c','artifacts':{'x-cablesim.field-part-0':{'blocks':['sealed bytes']},'x-cablesim.summary':{'temperature_k':320}}}]}
    with database() as db:
        db.execute('CREATE TABLE workspaces(id,revision)');db.execute("INSERT INTO workspaces VALUES ('w',1)")
        db.execute('CREATE TABLE study_runs(id,workspace,study,sequence,status,created,finished,input_digest,output_digest,snapshot,output,error)')
        db.execute('INSERT INTO study_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',('r','w','s',1,'succeeded','now','now',fingerprint(snapshot),fingerprint(output),encode(snapshot),encode(output),None))
    calls=[]
    research=SimpleNamespace(store=SimpleNamespace(db=database),executor=SimpleNamespace(),
        definition=lambda *args:{},artifact_status=lambda run:{},
        get_run=lambda *args:calls.append(args) or {'integrity':'corrupt'})
    monkeypatch.setattr('backend.kernel.batch_field_projection.run_state',lambda research,snapshot,wid,revision,study,cache:{'integrity':'verified','freshness':'current' if revision==1 else 'historical'})
    result=read_display(research,'w','r')
    assert result['integrity']=='verified' and result['freshness']=='current' and not calls
    assert result['output']['cases'][0]['artifacts']=={'x-cablesim.summary':{'temperature_k':320}}
    with database() as db:db.execute("UPDATE workspaces SET revision=2 WHERE id='w'")
    assert read_display(research,'w','r')['freshness']=='historical'
    with database() as db:db.execute("UPDATE study_runs SET output=replace(output,'320','321')")
    with pytest.raises(HTTPException) as caught:read_display(research,'w','r')
    assert caught.value.status_code==409 and calls==[('w','r')]
    # Legacy whitespace may be valid; only the full host checker can approve it.
    with database() as db:db.execute('UPDATE study_runs SET output=?',(json.dumps(output,indent=2),))
    research.get_run=lambda *args:{'integrity':'verified','output':output}
    assert read_display(research,'w','r')['output']['cases'][0]['artifacts']=={'x-cablesim.summary':{'temperature_k':320}}
    with pytest.raises(HTTPException) as caught:read_display(research,'other','r')
    assert caught.value.status_code==404


def test_mesh_capacity_and_bit_exact_block_roundtrip():
    assert MeshControls(size_m=.001,far_size_m=.5,transition_m=1,max_nodes=600000).max_nodes==600000
    values=np.linspace(273.15,410.123456789,70001)
    assert np.array_equal(unpack(pack(values,'<f8'),'temperature_k').view('u8'),values.view('u8'))
    for shape,name in [((300,2),'points'),((400,3),'triangles'),((400,),'domain_ids')]:
        data=np.arange(np.prod(shape)).reshape(shape)
        dtype='<f8' if name=='points' else '<u4'
        assert np.array_equal(unpack(pack(data,dtype),name),data)


def test_corrupt_bomb_and_shape_are_rejected():
    from base64 import b64encode
    import zlib
    value=pack([300.,310.,320.],'<f8')
    invalid=copy.deepcopy(value);invalid['sha256']='0'*64
    with pytest.raises(ValueError,match='摘要'):unpack(invalid,'temperature_k')
    invalid=copy.deepcopy(value);invalid['blocks'][0]=b64encode(zlib.compress(b'X'*100000)).decode()
    with pytest.raises(ValueError,match='长度'):unpack(invalid,'temperature_k')
    invalid=copy.deepcopy(value);invalid['shape']=[4000001]
    with pytest.raises(ValueError,match='容量'):unpack(invalid,'temperature_k')


def test_full_field_keeps_linear_hand_values_and_display_extrema(tmp_path,monkeypatch):
    import json
    x,z=np.meshgrid(np.linspace(0,1,40),np.linspace(0,1,40));points=np.column_stack((x.ravel(),z.ravel()))
    triangles=[]
    for j in range(39):
        for i in range(39):
            a=j*40+i;triangles.extend([[a,a+1,a+40],[a+1,a+41,a+40]])
    mesh={'points':points.tolist(),'triangles':triangles,'domain_ids':[1]*len(triangles),'regions':[{'id':1}]}
    values=300+10*points[:,0]+20*points[:,1]
    shown,temps=display(mesh,values,maximum=200)
    assert len(shown['points'])<=200 and max(temps)==330 and min(temps)==300
    assert np.allclose(temps,300+10*np.asarray(shown['points'])[:,0]+20*np.asarray(shown['points'])[:,1])
    monkeypatch.setattr('cablesim_simulation.compact_field.PART_BYTES',512)
    (tmp_path/'output').mkdir();description,refs=export(tmp_path,'case',mesh,values)
    assert description['schema_version']=='cablesim.full-field/2' and len(refs)>1
    artifacts={r['type']:json.loads((tmp_path/r['path']).read_text('utf-8')) for r in refs}
    artifacts.update({'x-cablesim.simulation-bundle':{'field_storage':description},'x-cablesim.temperature-field':{
        'hotspot':{'temperature_k':330.,'point_m':[1,1]}}})
    decoded=full_field({'artifacts':artifacts})
    assert np.array_equal(decoded['temperature_k'],values) and np.array_equal(decoded['triangles'],triangles)
    assert sample(decoded,[[.25,.75],[.5,.5],[2,2]])==pytest.approx([317.5,315.,None])
    artifacts['x-cablesim.temperature-field']['hotspot']['temperature_k']=329.
    with pytest.raises(ValueError,match='热点'):full_field({'artifacts':artifacts})


@pytest.mark.skipif(not os.environ.get('SLURM_JOB_ID'),reason='Large serialization benchmark runs only inside Slurm')
def test_six_hundred_thousand_node_storage_peak_memory(tmp_path,record_property):
    import json,subprocess,sys
    x,z=np.meshgrid(np.linspace(-8,8,800),np.linspace(-8,0,750));points=np.column_stack((x.ravel(),z.ravel()))
    base=(np.arange(749)[:,None]*800+np.arange(799)[None,:]).ravel()
    triangles=np.concatenate((np.column_stack((base,base+1,base+800)),np.column_stack((base+1,base+801,base+800))))
    temperatures=350+2*points[:,0]+3*points[:,1]
    fields={'points':pack(points,'<f8'),'triangles':pack(triangles,'<u4'),
            'domain_ids':pack(np.ones(len(triangles)),'<u4'),'temperature_k':pack(temperatures,'<f8')}
    sizes={}
    for name,value in fields.items():
        payload=json.dumps(value,separators=(',',':'));sizes[name]=len(payload.encode())
        assert sizes[name]<16*1024*1024
        (tmp_path/(name+'.json')).write_text(payload)
    code='''import json,sys,resource,time
from pathlib import Path
from backend.kernel.batch_field_storage import unpack
start=time.perf_counter();arrays={}
for path in Path(sys.argv[1]).glob('*.json'):
    arrays[path.stem]=unpack(json.loads(path.read_text()),path.stem)
assert len(arrays['points'])==600000
status=dict(line.split(':',1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
# VmHWM belongs to this exec's address space. ru_maxrss can inherit the pytest
# parent's high-water mark across fork/exec, including earlier native solves.
peak=float(status['VmHWM'].split()[0])/1024
print(json.dumps({'nodes':600000,'peak_rss_mb':peak,'fork_rusage_mb':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,'read_seconds':time.perf_counter()-start}))
assert peak<300
'''
    from pathlib import Path
    result=subprocess.run([sys.executable,'-c',code,str(tmp_path)],cwd=Path(__file__).resolve().parents[1],capture_output=True,text=True)
    assert result.returncode==0,result.stdout+'\n'+result.stderr
    measured=json.loads(result.stdout);measured['artifact_bytes']=sizes
    record_property('field_capacity_metrics',json.dumps(measured))
    print('FIELD_CAPACITY_METRICS='+json.dumps(measured),flush=True)


def test_transport_archive_never_publishes_an_incomplete_cache(tmp_path,monkeypatch):
    from backend.kernel.batch_runtime import transport_archive
    import tarfile,gzip
    (tmp_path/'plan.json').write_text('{}');(tmp_path/'integrity.json').write_text('{}')
    target=tmp_path/'input.tar.gz';transport_archive(tmp_path,target);original=target.read_bytes()
    with gzip.open(target,'rb') as stream:assert stream.read()
    monkeypatch.setattr(tarfile.TarFile,'add',lambda *a,**k: (_ for _ in ()).throw(OSError('simulated interruption')))
    with pytest.raises(OSError):transport_archive(tmp_path,target)
    assert target.read_bytes()==original
