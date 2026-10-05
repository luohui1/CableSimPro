"""External executables are administrator-configured, never supplied by a case."""
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import subprocess


class EnvironmentMissing(RuntimeError):
    pass


class SolverFailure(RuntimeError):
    pass


CONFIG = Path(__file__).resolve().parents[4] / '.data' / 'cablesim-solvers.json'
GUIDES = {'getdp': 'https://getdp.info/', 'elmer': 'https://www.elmerfem.org/blog/binaries/'}


def environment(name, work, configuration=None):
    policy=Path(__file__).resolve().parents[4]/'.data/hpc/config.json'
    local_fallback=policy.is_file() and json.loads(policy.read_text('utf-8')).get('allow_local_fallback') is True
    if not os.environ.get('SLURM_JOB_ID') and not local_fallback:
        raise EnvironmentMissing('环境缺失：本机求解已禁用，求解器验证和计算须提交 Slurm。')
    if name not in GUIDES:
        raise ValueError('未知的外部求解器。')
    config = configuration
    if config is None:
        config = json.loads(CONFIG.read_text('utf-8')) if CONFIG.is_file() else {}
    executable = config.get(name) or shutil.which('getdp' if name == 'getdp' else 'ElmerSolver')
    if not executable or not Path(executable).is_file():
        raise EnvironmentMissing(f'环境缺失：{name}。从 {GUIDES[name]} 安装，在 {CONFIG} 配置可执行文件绝对路径，或加入启动宿主的PATH。没有近似回退。')
    executable = Path(executable).resolve()
    env = {k: os.environ[k] for k in ('PATH', 'SYSTEMROOT', 'WINDIR') if k in os.environ}
    env.update(OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1', TMP=str(work), TEMP=str(work))
    env['PATH'] = str(executable.parent) + os.pathsep + env.get('PATH', '')
    if os.name != 'nt' and config.get('library_paths'):
        paths=config['library_paths']
        if not isinstance(paths,list) or any(not isinstance(p,str) or not Path(p).is_absolute() or not Path(p).is_dir() for p in paths):
            raise EnvironmentMissing('管理员 library_paths 必须是存在的绝对目录；不能来自样本输入。')
        env['LD_LIBRARY_PATH']=os.pathsep.join(paths)
    if name == 'elmer':
        root = executable.parent.parent
        env.update(ELMER_HOME=str(root), ELMER_LIB=str(root/'share'/'elmersolver'/'lib'))
        env['PATH'] = str(root/'bin')+os.pathsep+str(root/'lib')+os.pathsep+env['PATH']
    args = ['-version'] if name == 'getdp' else ['-v']
    try:
        process = subprocess.run([str(executable), *args], cwd=work, env=env, capture_output=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise EnvironmentMissing(f'{name}版本检测失败：{exc}') from exc
    banner = (process.stdout+process.stderr).decode('utf-8', errors='replace')
    pattern = r'(?m)^\s*(3\.\d+\.\d+)' if name == 'getdp' else r'(?i)(?:version\s*[:=]?\s*)(\d+\.\d+(?:\.\d+)?)'
    found = re.search(pattern, banner)
    if not found:
        raise EnvironmentMissing(f'{name}无法识别版本：{banner[:1200]}')
    version = found.group(1)
    # The official 26.1 Windows release still reports the solver ABI version 9.0.
    linux_build=config.get('elmer_build') if name=='elmer' and os.name!='nt' else None
    source_build=(isinstance(linux_build,dict) and linux_build.get('version')==version and
                  re.fullmatch(r'[a-f0-9]{64}',linux_build.get('source_archive_sha256','')) is not None)
    supported = version == '3.5.0' if name == 'getdp' else source_build or (version=='9.0' and 'Compiled: 2026-01-20' in banner and os.name=='nt')
    if not supported:
        raise EnvironmentMissing(f'{name}版本{version}未在适配器声明范围内；需要'+('3.5.0' if name == 'getdp' else '官方26.1 Windows包，或带源码与二进制摘要的管理员Linux构建清单')+'。')
    evidence = {'name':name, 'version':version, 'executable_sha256':sha256(executable.read_bytes()).hexdigest(),
                'executable':str(executable), 'version_banner':banner.strip(), 'execution':'separate-process'}
    evidence.update(license_source='hpc-installation' if os.environ.get('SLURM_JOB_ID') else 'local-installation',
                    license_type='open-source',slurm_job_id=os.environ.get('SLURM_JOB_ID'),
                    node=os.environ.get('SLURM_JOB_NODELIST'),threads=1)
    if name=='elmer':
        if os.name!='nt':
            required={'bin/ElmerSolver','lib/elmersolver/libelmersolver.so',
                      'share/elmersolver/lib/HeatSolve.so','share/elmersolver/lib/ResultOutputSolve.so',
                      'share/elmersolver/lib/SaveData.so'}
            files=linux_build.get('files',{})
            if not required<=set(files):raise EnvironmentMissing('Linux Elmer构建清单缺少必需求解器/模块摘要。')
            for relative,expected in files.items():
                path=(root/relative).resolve()
                if not path.is_relative_to(root.resolve()) or not path.is_file() or sha256(path.read_bytes()).hexdigest()!=expected:
                    raise EnvironmentMissing('Linux Elmer文件与管理员构建清单不符：'+relative)
            evidence.update(distribution_release='source-archive/'+linux_build['source_archive_sha256'],
                source_build=linux_build,modules_sha256={p:files[p] for p in sorted(required)})
            return executable,env,evidence
        modules=[executable.parent/'libelmersolver.dll',root/'share/elmersolver/lib/HeatSolve.dll',root/'share/elmersolver/lib/ResultOutputSolve.dll']
        if any(not p.is_file() for p in modules):
            raise EnvironmentMissing('Elmer运行库或HeatSolve/ResultOutputSolve模块缺失；请安装完整官方运行环境。')
        evidence['distribution_release']='26.1'
        evidence['modules_sha256']={p.name:sha256(p.read_bytes()).hexdigest() for p in modules}
    return executable, env, evidence


def execute(executable, args, work, env, timeout_s=240):
    """No shell, no caller-supplied command text; stdout remains an auditable file."""
    try:
        process = subprocess.run([str(executable), *args], cwd=work, env=env, capture_output=True, timeout=timeout_s)
    except subprocess.TimeoutExpired as exc:
        (work/'solver.log').write_bytes((exc.stdout or b'')+(exc.stderr or b''))
        raise SolverFailure('外部求解器超时；未返回上一次或近似结果。') from exc
    log = (process.stdout+process.stderr).decode('utf-8', errors='replace')
    (work/'solver.log').write_text(log, encoding='utf-8')
    if process.returncode or re.search(r'(?im)^\s*(?:ERROR|FATAL)(?:\s|:)', log):
        raise SolverFailure(f'外部求解器失败（退出码{process.returncode}）：{log[-4000:]}')
    return {'returncode':process.returncode, 'log_sha256':sha256((work/'solver.log').read_bytes()).hexdigest()}
