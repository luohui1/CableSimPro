"""Execute frozen native regression sources inside a Slurm compute allocation."""
from hashlib import sha256
from importlib import metadata
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import time


def main():
    if not os.environ.get('SLURM_JOB_ID'):
        raise RuntimeError('Native regressions require a Slurm compute allocation')
    root=Path(sys.argv[1]).resolve();runtime=root/'runtime';output=root/'raw'
    output.mkdir(exist_ok=True)
    plan=json.loads((root/'plan.json').read_text('utf-8'))
    manifest=json.loads((runtime/'runtime-manifest.json').read_text('utf-8'))
    def digest(value):return sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf-8')).hexdigest()
    if digest(plan)!=json.loads((root/'integrity.json').read_text('utf-8'))['plan_sha256'] or digest(manifest)!=plan['runtime_sha256']:
        raise RuntimeError('Frozen native-test plan/runtime integrity mismatch')
    for name,expected in manifest['files'].items():
        path=(runtime/name).resolve()
        if not path.is_relative_to(runtime) or sha256(path.read_bytes()).hexdigest()!=expected:
            raise RuntimeError('Runtime digest mismatch: '+name)
    started=time.time()
    (runtime/'.data').mkdir(exist_ok=True)
    arguments=[sys.executable,'-m','pytest','-v','--tb=short',
               '--junitxml='+str(output/'junit.xml'),*plan['test_arguments']]
    with (output/'pytest-output.log').open('w',encoding='utf-8') as stream:
        completed=subprocess.run(arguments,cwd=runtime,stdout=stream,stderr=subprocess.STDOUT,
                                 timeout=plan['execution']['sample_timeout_s'])
    validation={}
    for source in sorted((runtime/'artifacts').rglob('*.json')):
        if source.is_symlink() or not source.resolve().is_relative_to(runtime/'artifacts') or source.stat().st_size>16*1024*1024:
            raise RuntimeError('Unsafe native validation artifact')
        relative=source.relative_to(runtime/'artifacts')
        destination=output/'validation'/relative;destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source,destination)
        validation[relative.as_posix()]=sha256(destination.read_bytes()).hexdigest()
    result={'state':'passed' if completed.returncode==0 else 'failed','returncode':completed.returncode,
            'wall_seconds':time.time()-started,'job_id':os.environ['SLURM_JOB_ID'],
            'node':os.environ.get('SLURM_JOB_NODELIST'),'test_arguments':plan['test_arguments'],
            'python':sys.version,'packages':{d.metadata['Name']:d.version for d in metadata.distributions()},
            'runtime_manifest_sha256':sha256((runtime/'runtime-manifest.json').read_bytes()).hexdigest(),
            'validation_artifact_sha256':validation}
    (output/'status.json').write_text(json.dumps(result,sort_keys=True,indent=2),encoding='utf-8')
    return completed.returncode


if __name__=='__main__':raise SystemExit(main())
