"""Resolve explicitly declared first-party Python dependencies before execution.

A sealed src/requirements.txt opts into the project environment. This does not
install packages or add a plugin-specific branch to the executor.
"""
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from .registry import PluginHostError


def environment_python(directory):
    return Path(directory)/('Scripts/python.exe' if os.name == 'nt' else 'bin/python')


def declared_requirements(plugin):
    path = plugin.directory/'src/requirements.txt'
    if not path.is_file():
        return None
    raw = path.read_bytes()
    record = next((item for item in plugin.manifest.files if item.path == 'src/requirements.txt'), None)
    if record is None or record.sha256 != sha256(raw).hexdigest() or record.size_bytes != len(raw):
        raise PluginHostError('PACKAGE_DIGEST_MISMATCH', '插件运行依赖与封签不一致。', 409)
    packages = {}
    for line in raw.decode('utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+-]+)', line)
        if not match:
            raise PluginHostError('RUNTIME_REQUIREMENTS_INVALID', '运行依赖须使用精确版本 name==version。', 409)
        packages[match[1]] = match[2]
    return path, packages


def resolve_python(plugin):
    declared = declared_requirements(plugin)
    if declared is None:
        return sys.executable, {'selection': 'host', 'python_executable': sys.executable}
    path, packages = declared
    root = plugin.directory.parent.parent
    configured = os.environ.get('CABLESIM_PLUGIN_PYTHON')
    if configured:
        interpreter, selection = Path(configured).absolute(), 'configured'
    elif os.environ.get('SLURM_JOB_ID'):
        interpreter, selection = Path(sys.executable).absolute(), 'slurm-profile'
    else:
        interpreter, selection = environment_python(root/'.venv').absolute(), 'project-venv'
    command = f'python scripts/prepare_plugin_environment.py {plugin.manifest.id}'
    message = f'{plugin.manifest.name}运行环境缺失或依赖不匹配；请在仓库根目录运行：{command}。'
    if not interpreter.is_file():
        raise PluginHostError('PLUGIN_ENVIRONMENT_MISSING', message, 503)
    probe = ('import json,sys\nfrom importlib.metadata import version,PackageNotFoundError\n'
             'found={}\nfor name in json.loads(sys.argv[1]):\n'
             ' try:found[name]=version(name)\n except PackageNotFoundError:found[name]=None\n'
             'print(json.dumps({"python":list(sys.version_info[:3]),"packages":found}))')
    try:
        result = subprocess.run([str(interpreter), '-I', '-c', probe, json.dumps(list(packages))],
            env={key: os.environ[key] for key in ('PATH','SYSTEMROOT','WINDIR') if key in os.environ},
            capture_output=True, encoding='utf-8', errors='replace', timeout=20, check=True)
        observed = json.loads(result.stdout)
        actual_python = tuple(observed['python'])
        for requirement in plugin.manifest.runtime.python.split(','):
            bound = re.fullmatch(r'(>=|<=|==|>|<)(\d+)\.(\d+)(?:\.(\d+))?', requirement.strip())
            if not bound:
                raise ValueError('不支持的 Python 版本声明')
            expected = tuple(int(part or 0) for part in bound.groups()[1:])
            valid = {'>=':actual_python>=expected, '<=':actual_python<=expected, '==':actual_python==expected,
                     '>':actual_python>expected, '<':actual_python<expected}[bound[1]]
            if not valid:
                raise ValueError('Python 版本不符合插件声明')
        mismatches = [f'{name} 要求 {version}，实际 {observed["packages"].get(name) or "未安装"}'
                      for name, version in packages.items() if observed['packages'].get(name) != version]
        if mismatches:
            raise ValueError('；'.join(mismatches))
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError) as error:
        raise PluginHostError('PLUGIN_ENVIRONMENT_MISSING', message+' '+str(error), 503) from error
    return str(interpreter), {'selection':selection, 'python_executable':str(interpreter),
        'python':'.'.join(map(str,actual_python)), 'packages':observed['packages'],
        'requirements_sha256':sha256(path.read_bytes()).hexdigest()}
