"""Shared test environment: the Agent key store never touches the developer's OS credential store."""
import os
from hashlib import sha256
from tempfile import TemporaryDirectory
from pathlib import Path

import pytest

os.environ.setdefault('CABLESIM_AGENT_KEY_STORE', 'memory')


@pytest.hookimpl(tryfirst=True)
def pytest_configure(config):
    """Three isolated workers for host tests; external acceptance stays serial.

    File scheduling keeps module fixtures together. Each host has its own
    tmp_path SQLite database and random port/mailbox. Real model acceptance
    writes shared reports, and Slurm tests own external jobs: neither is safe
    to distribute. Explicit -n 0 always retains the serial profiling path.
    """
    if hasattr(config, 'workerinput') or not config.pluginmanager.hasplugin('xdist'):
        return
    unsafe = os.environ.get('CABLESIM_AGENT_REAL_USE') == '1' or bool(os.environ.get('SLURM_JOB_ID'))
    unsafe = unsafe or any('plugin-tests' in str(argument).replace('\\', '/').split('/') for argument in config.args)
    workers = config.getoption('numprocesses', default=None)
    if workers is None:
        workers = 0 if unsafe or config.getoption('usepdb', default=False) else 3
        config.option.numprocesses = workers
        config.option.dist = 'loadfile' if workers else 'no'
        # xdist translates -n into its process specifications before configure.
        # Our default is chosen here, so provide the matching isolated workers.
        config.option.tx = ['popen'] * workers
    elif workers and unsafe:
        raise pytest.UsageError('真实模型或 Slurm 验收须串行运行：请使用 -n 0。')

# Saved TB 880:2022 Fig.25–26 pp.63–64, §§4.5.3.1 p.75 / 4.7.5 p.87.
# Numerical reproduction values come from the archived Slurm report identified
# in .data/fem-validation/integration.md; these fixtures never execute a solver.
PUBLIC_CASES=[('B02-1','0-1',821.2764805349443,821.7763334392,75),
              ('B02-2','0-2',667.8823899920255,682.81446487,87)]


def cases():
    items=[{'id':id,'title':'CIGRE TB 880 · Case '+case,'status':'partial','kind':'standard',
        'citation':'CIGRE TB 880:2022','scope':'相切单芯工况；验证包装器，不是发布工程能力',
        'reference_location':'TB 880:2022 p.'+str(page),'inputs':[{'source':'TB 880:2022','pdf_page':page,'printed_page':page}],
        'rows':[{'id':'fem-current','variant':'有限元 · 收敛网格','quantity':'ampacity_a','unit':'A',
            'reference':reference,'open_source':value,'difference':value-reference,
            'relative_difference':(value-reference)/reference,'status':'outside_tolerance',
            'source':'TB 880:2022 p.'+str(page),'tolerance':{'absolute':.001,'unit':'A','source':'项目复现门槛；非报告容差'}}],
        'runs':[{'plugin_id':'cablesim.simulation','plugin_version':'1.1.0','method_version':'tb880-isothermal-p2/1',
                 'engineering_approval':False,'source_sha256':'0b8af10b102252928b738964ca4c6e89c8f6ae1be1774df62fb54001422a2b8a'},
                {'plugin_id':'cablesim.iec60287','plugin_version':'0.4.0','method_version':'iec60287-group/0.3.0'}],
        'convergence_summary':{'passed':True},'report_tolerance':None,
        'limitations':['收敛通过不等于复现通过或工程批准；两例偏差均超过项目复现门槛。',
                       '报告未给数值容差；项目门槛不是 CIGRE 工程容差。']}
        for id,case,value,reference,page in PUBLIC_CASES]
    items[1]['limitations'].extend(['这是夹具中的完整长限制说明。'*600+'此条完整结束。',
                                   '这是另一条完整长限制说明。'*400+'另一条完整结束。'])
    metric=items[1]['rows'][0]
    items[1]['rows']=[{**metric,'id':'history-a','status':'not_assessed'},
                      {**metric,'id':'history-b','status':'not_assessed'},
                      {**metric,'id':'limited-fem','status':'not_comparable'},metric]
    return items


def publish(root,items):
    from backend.harness.context_builder import encoded
    raw=encoded({'schema':'cablesim.reproduction-library/1','created_at':'2026-10-09T06:09:33Z','items':items})
    digest=sha256(raw).hexdigest();(root/'snapshots').mkdir(parents=True,exist_ok=True)
    (root/'snapshots'/(digest+'.json')).write_bytes(raw)
    (root/'index.json').write_bytes(encoded({'current':digest,'history':[{'id':digest}]}))
    return digest



@pytest.fixture
def reproduction_data():
    return {'cases':cases,'publish':publish,'public_cases':PUBLIC_CASES}


@pytest.fixture(scope='session')
def release_seed_copy(tmp_path_factory, request):
    """Build each real release identity once; give every consumer a private copy.

    The source is fresh for this pytest session, never .data/release. Workers
    coordinate with the host's OS owner lock. The first build still exercises
    offline creation with invalid inherited donor paths; no API/plugin/result is
    substituted. Different evidence availability produces a different identity.
    """
    import json
    import shutil
    from time import sleep, monotonic, perf_counter
    from backend.kernel.ownership import OwnerLock
    from backend.kernel.workspace import fingerprint

    base = tmp_path_factory.getbasetemp()
    if hasattr(request.config, 'workerinput'):base = base.parent
    shared = base / 'release-seeds'
    shared.mkdir(exist_ok=True)

    def copy(seed, destination):
        identity = seed.release_identity()
        root = shared / fingerprint(identity)
        root.mkdir(exist_ok=True)
        source = root / 'engineering.sqlite'
        owner = OwnerLock(root / 'build')
        deadline = monotonic() + 600
        while True:
            try:
                owner.acquire()
                break
            except RuntimeError:
                if monotonic() >= deadline:raise
                sleep(.1)
        try:
            if not source.exists():
                started = perf_counter()
                # backend.main also creates its unused default app at import.
                # Bootstrap that module under private valid paths before testing
                # invalid inherited paths, including when this case runs alone.
                with pytest.MonkeyPatch.context() as bootstrap:
                    bootstrap.setenv('CABLESIM_DB', str(root / 'bootstrap.sqlite'))
                    bootstrap.setenv('CABLESIM_DATASETS_DIR', str(root / 'bootstrap-datasets'))
                    bootstrap.setenv('CABLESIM_REPRODUCTION_LIBRARY', str(root / 'bootstrap-library'))
                    from backend.main import create_app  # noqa: F401
                donor = root / 'donor-sentinel'
                donor.write_bytes(b'development database sentinel')
                # All consumers, including the import-only test, share this
                # first-creation guarantee instead of bypassing seed_release.
                with pytest.MonkeyPatch.context() as isolated:
                    for name in ('CABLESIM_DB', 'CABLESIM_DATASETS_DIR', 'CABLESIM_REPRODUCTION_LIBRARY'):
                        isolated.setenv(name, str(donor))
                    isolated.setattr(seed, 'urlopen', lambda *_a, **_k: pytest.fail('Release seed must remain offline'))
                    seed.seed_release(source)
                assert donor.read_bytes() == b'development database sentinel'
                assert json.loads(source.with_suffix('.seed.json').read_text('utf-8'))['identity'] == identity
                (root / 'timing.json').write_text(json.dumps({'build_seconds':perf_counter()-started}), 'utf-8')
            started = perf_counter()
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            receipt = json.loads(source.with_suffix('.seed.json').read_text('utf-8'))
            # Only the transport location changes; saved input/output bytes do not.
            receipt['database'] = str(destination.resolve())
            destination.with_suffix('.seed.json').write_text(json.dumps(receipt, ensure_ascii=False), 'utf-8')
            shutil.copytree(root / 'library', destination.parent / 'library')
            print('Real release seed: '+(root/'timing.json').read_text('utf-8')+
                  f'; private copy {perf_counter()-started:.3f}s', flush=True)
        finally:owner.close()
        return destination

    return copy

@pytest.fixture(autouse=True)
def library(request,reproduction_data):
    # Preserve the previous module scope; unrelated reproduction tests retain
    # their own directories and environment, without reading the live library.
    if not request.path.name.startswith(('test_harness','test_index')):
        yield None
        return
    tmp_path=request.getfixturevalue('tmp_path')
    monkeypatch=request.getfixturevalue('monkeypatch')
    with TemporaryDirectory(prefix='reproductions-',dir=tmp_path) as temporary:
        root=Path(temporary);publish(root,cases())
        monkeypatch.setenv('CABLESIM_REPRODUCTION_LIBRARY',str(root))
        yield root
