"""CI dependency bisection, not an application workaround or acceptance gate.

Each probe exits naturally. Nonzero exits remain recorded as failures. No user
projects, credentials, library patching, atexit removal or os._exit are involved.
"""
from importlib import metadata
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

IMPORTS = [('OCP',), ('vtk',), ('casadi',), ('nlopt',), ('OCP', 'casadi'),
           ('nlopt', 'casadi'), ('vtk', 'casadi'), ('cadquery',)]


def main():
    output = Path('artifacts'); output.mkdir(exist_ok=True)
    records = []
    for modules in IMPORTS:
        for path_mode in ('inherited-path', 'python-system-path'):
            with tempfile.TemporaryDirectory(prefix='csp-import-probe-') as tmp:
                folder = Path(tmp)
                env = {k: os.environ[k] for k in ('PATH', 'SYSTEMROOT', 'WINDIR') if k in os.environ}
                env.update(HOME=tmp, USERPROFILE=tmp, TMP=tmp, TEMP=tmp, TMPDIR=tmp,
                           PYTHONIOENCODING='utf-8', OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1')
                if path_mode == 'python-system-path':
                    system = Path(os.environ.get('SYSTEMROOT', 'C:/Windows'))
                    env['PATH'] = os.pathsep.join([str(Path(sys.executable).parent), str(system/'System32'), str(system)])
                code = '\n'.join(f'import {m}\nprint({m!r}, "imported", flush=True)' for m in modules)
                if modules == ('cadquery',):
                    code += '\nshape=cadquery.Workplane("XY").circle(10).extrude(250)\nassert shape.val().isValid()\ncadquery.exporters.export(shape,"probe.step")\nprint("step-written",flush=True)'
                code += '\nprint("natural-exit-next",flush=True)'
                try:
                    process = subprocess.run([sys.executable, '-I', '-X', 'faulthandler', '-u', '-c', code],
                                             cwd=folder, env=env, capture_output=True, timeout=40, check=False)
                    row = {'modules': modules, 'path_mode': path_mode, 'exit_code': process.returncode,
                           'stdout': process.stdout.decode('utf-8', errors='replace')[-4000:],
                           'stderr': process.stderr.decode('utf-8', errors='replace')[-8000:],
                           'step_present': (folder/'probe.step').is_file()}
                except subprocess.TimeoutExpired:
                    row = {'modules': modules, 'path_mode': path_mode, 'timeout': True}
                records.append(row)
                print(json.dumps(row), flush=True)
    payload = {'diagnostic_only': True, 'python': sys.version, 'records': records,
               'versions': {name: metadata.version(name) for name in ('cadquery', 'cadquery-ocp', 'vtk', 'casadi', 'nlopt', 'numpy')}}
    (output/'native-import-bisection.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
