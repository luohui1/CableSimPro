"""Storage stress fixture, not a physical FEM result; execute only under Slurm."""
import json
import os
from pathlib import Path
import subprocess
import sys
import numpy as np
import pytest
from cablesim_simulation.compact_field import export


@pytest.mark.skipif(not os.environ.get('SLURM_JOB_ID'),reason='Capacity benchmark belongs on dg83')
def test_declared_maximum_shards_and_read_memory(tmp_path,record_property):
    count=4000000
    random=np.random.default_rng(104)
    points=random.random((count,2));values=300+2*points[:,0]+points[:,1]
    base=np.arange(count-2,dtype=np.uint32)
    cells=np.concatenate((np.column_stack((base,base+1,base+2)),np.column_stack((base+2,base+1,base))))
    mesh={'points':points,'triangles':cells,'domain_ids':np.ones(len(cells),dtype=np.uint32),'regions':[{'id':1}]}
    (tmp_path/'output').mkdir();descriptor,refs=export(tmp_path,'capacity',mesh,values)
    maximum=max((tmp_path/r['path']).stat().st_size for r in refs)
    assert maximum<16*1024*1024 and 1<len(refs)<=16
    peak=int(values.argmax())
    manifest={'descriptor':descriptor,'refs':refs,'hotspot':{'temperature_k':float(values[peak]),'point_m':points[peak].tolist()}}
    (tmp_path/'manifest.json').write_text(json.dumps(manifest))
    code='''import json,sys,time
from pathlib import Path
from backend.kernel.batch_field_storage import full_field
root=Path(sys.argv[1]);manifest=json.loads((root/'manifest.json').read_text());start=time.perf_counter()
artifacts={r['type']:json.loads((root/r['path']).read_text()) for r in manifest['refs']}
artifacts.update({'x-cablesim.simulation-bundle':{'field_storage':manifest['descriptor']},'x-cablesim.temperature-field':{'hotspot':manifest['hotspot']}})
arrays=full_field({'artifacts':artifacts})
assert len(arrays['points'])==4000000
status=dict(line.split(':',1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
peak=float(status['VmHWM'].split()[0])/1024
print(json.dumps({'nodes':4000000,'peak_rss_mb':peak,'read_seconds':time.perf_counter()-start}))
assert peak<400
'''
    completed=subprocess.run([sys.executable,'-c',code,str(tmp_path)],cwd=Path(__file__).resolve().parents[1],capture_output=True,text=True)
    assert completed.returncode==0,completed.stdout+'\n'+completed.stderr
    measured=json.loads(completed.stdout);measured.update(parts=len(refs),max_artifact_bytes=maximum)
    record_property('field_capacity_metrics',json.dumps(measured))
