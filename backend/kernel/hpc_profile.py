"""Managed Slurm connection settings. Only an explicit check opens SSH.

No credentials are accepted. Revisions bind saves and undo to exact file bytes;
backups retain the previous file without exposing its contents through the API.
"""
from hashlib import sha256
import glob
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import sqlite3
import subprocess
from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from ..plugin_host.registry import Registry

from .batch_files import atomic, locked, read


LABELS = {'ssh_alias': 'SSH 主机别名', 'partition': 'Slurm 分区',
          'remote_workdir': '远程工作目录', 'environment': '计算环境',
          'kind': '环境类型', 'path': '环境路径', 'budget_core_hours': '单批核时上限',
          'total_budget_core_hours': '累计核时上限', 'expected_revision': '配置版本',
          'undo_token': '撤销记录'}


def remote_path(value):
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+', value) or any(
            part in ('.', '..') for part in value.split('/')) or value.startswith('//') or value == '/':
        raise ValueError('请填写完整的远程绝对路径，只使用字母、数字、下划线、短横线和斜杠。')
    return value.rstrip('/')


class Environment(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    kind: str
    path: str

    @field_validator('kind')
    @classmethod
    def supported(cls, value):
        if value not in ('conda','python'):
            raise ValueError('当前执行链支持 Python 或 Conda 环境目录；镜像环境尚未覆盖，请由部署管理员配置。')
        return value

    @field_validator('path')
    @classmethod
    def valid_path(cls, value):return remote_path(value)


class ProfileRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    ssh_alias: str
    partition: str
    remote_workdir: str
    environment: Environment
    budget_core_hours: float = Field(gt=0, le=2000, allow_inf_nan=False)
    total_budget_core_hours: float = Field(gt=0, le=20000, allow_inf_nan=False)
    expected_revision: str

    @field_validator('ssh_alias', 'partition')
    @classmethod
    def identifier(cls, value):
        if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}', value):
            raise ValueError('请使用已有名称，只使用字母、数字、点、下划线和短横线，不能以短横线开头。')
        return value

    @field_validator('remote_workdir')
    @classmethod
    def valid_path(cls, value):return remote_path(value)

    @field_validator('expected_revision')
    @classmethod
    def revision(cls, value):
        if value != 'missing' and not re.fullmatch(r'[a-f0-9]{64}', value):
            raise ValueError('请先读取配置，再使用返回的版本保存。')
        return value


class UndoRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    undo_token: UUID
    expected_revision: str


def parse_request(model, body):
    try:return model.model_validate(body)
    except ValidationError as exc:
        issues=[]
        for error in exc.errors(include_input=False, include_url=False):
            field='.'.join(str(part) for part in error['loc'])
            label=' · '.join(LABELS.get(str(part), '未支持的配置字段') for part in error['loc'])
            kind=error['type']
            message=(str(error.get('ctx', {}).get('error', '')) if kind == 'value_error' else
                     '请填写此项。' if kind == 'missing' else
                     '不能保存密钥、密码、私钥路径或未声明的配置字段。' if kind == 'extra_forbidden' else
                     '请填写正数，单批不超过 2000 核时、累计不超过 20000 核时。' if 'budget' in field else
                     '请按字段要求填写文本或完整的计算环境。')
            issues.append({'field': field, 'label': label, 'message': message})
        raise HTTPException(422, {'message': '请修正超算配置。', 'issues': issues}) from None


def ssh_aliases(config):
    """Read explicit Host aliases, including bounded local Include files; never keys."""
    config=Path(config);seen=set();aliases=set()
    def visit(path, depth=0):
        path=Path(path).resolve()
        if path in seen or depth > 8 or len(seen) >= 64 or not path.is_file():return
        seen.add(path)
        if path.stat().st_size > 1024*1024:raise ValueError('SSH 配置过大，请由管理员检查。')
        for line in path.read_text('utf-8-sig').splitlines():
            values=shlex.split(line, comments=True)
            if not values:continue
            # OpenSSH permits both "Host name" and "Host=name".
            first=values.pop(0)
            if '=' in first:
                key, value=first.split('=', 1);values.insert(0,value)
            else:key=first;values=[v for v in values if v != '=']
            if key.lower() == 'host':
                aliases.update(v for v in values if re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}',v))
            elif key.lower() == 'include':
                for value in values:
                    target=Path(value).expanduser()
                    if not target.is_absolute():target=config.parent/target
                    for included in glob.glob(str(target)):visit(included, depth+1)
    try:visit(config)
    except (OSError, UnicodeError, ValueError):
        raise HTTPException(422, '无法读取本机 SSH 别名，请由管理员检查 ~/.ssh/config。') from None
    return sorted(aliases)


def revision(path):
    return sha256(path.read_bytes()).hexdigest() if path.is_file() else 'missing'


def atomic_bytes(path, value):
    temporary=path.with_name(path.name+'.'+uuid4().hex+'.part')
    try:
        with temporary.open('xb') as stream:
            stream.write(value);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
    finally:temporary.unlink(missing_ok=True)


class HpcProfile:
    def __init__(self, executor, *, managed_path=None, ssh_config=None, runner=None):
        self.executor=executor;self.path=Path(executor.profile)
        self.managed_path=Path(managed_path or self.path)
        self.ssh_config=Path(ssh_config or Path.home()/'.ssh/config')
        self.runner=runner or subprocess.run

    def require_managed(self):
        if self.path.resolve() != self.managed_path.resolve():
            raise HTTPException(409, '当前部署使用管理员指定的外部配置，网页不能覆盖；请改用宿主 .data/hpc/config.json 或由管理员更新。')

    def guard_connection(self, old, new):
        changed=old and any(old.get(key)!=new.get(key) for key in ('ssh_alias','partition','remote_root','python'))
        ledger=Path(self.executor.ledger)
        if changed and ledger.is_file():
            # Configuration locks also cover transport reservation, closing the
            # race between this read and a concurrent first submission.
            try:
                with sqlite3.connect(ledger.resolve().as_uri()+'?mode=ro',uri=True) as db:
                    pending=db.execute("SELECT COUNT(*) FROM reservations WHERE state!='accounted'").fetchone()[0]
            except sqlite3.Error:raise HTTPException(409,'核时记账暂不可读，连接参数未修改；请先核对记账文件。') from None
            if pending:raise HTTPException(409,'仍有未结算的超算作业，连接参数不能覆盖；请先结束或取消并核对记账。核时上限可以单独修改。')

    def configuration(self):
        # Fields and revision come from the same read, so a concurrent save can
        # only cause a conflict, never give stale fields a newer revision.
        try:raw=self.path.read_bytes()
        except FileNotFoundError:raw=None
        status=self.executor.profile_status();fields=None
        if status['configured'] and raw is not None:
            try:value=json.loads(raw)
            except ValueError:value={}
            if not isinstance(value,dict):value={}
            # Only values recognized by this editor are returned. Legacy secrets
            # or arbitrary environment dictionaries are never echoed.
            environment=value.get('environment', {})
            if isinstance(environment,dict) and set(environment)=={'kind','path'}:
                try:environment=Environment.model_validate(environment).model_dump()
                except ValidationError:environment=None
            else:environment=None
            partition=value.get('partition','dg83')
            identifier=lambda item:item if isinstance(item,str) and re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}',item) else None
            budget=lambda key,limit:value.get(key,limit) if type(value.get(key,limit)) in (int,float) and 0<value.get(key,limit)<=limit else None
            try:workdir=str(PurePosixPath(remote_path(value.get('remote_root',''))).parent)
            except (ValueError,TypeError):workdir=None
            fields={'ssh_alias':identifier(value.get('ssh_alias')), 'partition':identifier(partition),
                    'remote_workdir':workdir, 'environment':environment,
                    'budget_core_hours':budget('budget_core_hours',2000),
                    'total_budget_core_hours':budget('total_budget_core_hours',20000)}
        current=sha256(raw).hexdigest() if raw is not None else 'missing'
        undo_token=None
        for path in sorted((self.path.parent/'backups').glob('*/receipt.json'),key=lambda item:item.stat().st_mtime,reverse=True):
            try:
                receipt=read(path)
                if not isinstance(receipt,dict):continue
                if receipt.get('after')==current and not receipt.get('undone'):
                    undo_token=str(UUID(path.parent.name));break
            except (OSError,ValueError,TypeError):continue
        return {**status, 'editable':self.path.resolve()==self.managed_path.resolve(),
                'revision':current, 'undo_token':undo_token,
                'ssh_aliases':ssh_aliases(self.ssh_config), 'configuration':fields}

    def save(self, body):
        self.require_managed();request=parse_request(ProfileRequest, body)
        if request.ssh_alias not in ssh_aliases(self.ssh_config):
            raise HTTPException(422, {'message':'请选择本机 SSH 配置中的已有别名。',
                                     'issues':[{'field':'ssh_alias','label':LABELS['ssh_alias'],'message':'先由管理员在 ~/.ssh/config 登记此别名，再重新读取配置。'}]})
        if request.total_budget_core_hours < request.budget_core_hours:
            raise HTTPException(422,'累计核时上限不能小于单批核时上限。')
        self.path.parent.mkdir(parents=True,exist_ok=True)
        try:
            with locked(self.path.with_suffix('.lock')):
                if revision(self.path) != request.expected_revision:raise HTTPException(409,'配置已被其他操作更新，请重新读取后再保存。')
                try:old=read(self.path) if self.path.is_file() else {}
                except ValueError:old={}
                if not isinstance(old,dict):old={}
                self.guard_connection(old,{'ssh_alias':request.ssh_alias,'partition':request.partition,
                    'remote_root':request.remote_workdir+'/jobs','python':request.environment.path+'/bin/python'})
                # Preserve deployed solver paths/routing, never credential keys.
                allowed=('remote_plugins','remote_capabilities','getdp','elmer','elmer_build','comsol',
                         'library_paths','modules','control_python','maximum_array_tasks','maximum_pending_tasks',
                         'accounting_cpus_per_task','max_memory_per_cpu_mb')
                value={key:old[key] for key in allowed if key in old}
                remote=value.get('remote_capabilities',{})
                remote={key:list(values) for key,values in remote.items() if isinstance(values,list) and all(isinstance(item,str) for item in values)} if isinstance(remote,dict) else {}
                registry=self.executor.registry
                if getattr(registry,'root',None):
                    try:registry=Registry(registry.root)
                    except (ValueError,OSError):raise HTTPException(409,'能力清单暂不可读，请完成插件安装或清单修复后再保存。') from None
                for plugin_id,plugin in getattr(registry,'plugins',{}).items():
                    required=[cap.id for cap in plugin.manifest.capabilities if cap.solver=='slurm']
                    if required:remote[plugin_id]=sorted(set(remote.get(plugin_id,[])+required))
                value.update(ssh_alias=request.ssh_alias,partition=request.partition,
                             remote_root=request.remote_workdir+'/jobs',python=request.environment.path+'/bin/python',
                             environment=request.environment.model_dump(),budget_core_hours=request.budget_core_hours,
                             total_budget_core_hours=request.total_budget_core_hours,remote_capabilities=remote)
                token=str(uuid4());folder=self.path.parent/'backups'/token;folder.mkdir(parents=True)
                before=revision(self.path)
                if self.path.is_file():shutil.copyfile(self.path,folder/'config.json')
                atomic(folder/'receipt.json',{'before':before,'after':None})
                atomic(self.path,value)
                after=revision(self.path);atomic(folder/'receipt.json',{'before':before,'after':after})
        except BlockingIOError:raise HTTPException(409,'另一项配置操作正在保存，请稍后重新读取。') from None
        return {**self.executor.profile_status(),'revision':after,'undo_token':token,'connection_checked':False}

    def undo(self, body):
        self.require_managed()
        # UUID strict validation is intentional, using JSON mode for its string form.
        try:request=UndoRequest.model_validate_json(json.dumps(body))
        except ValidationError:raise HTTPException(422,'撤销记录或配置版本无效，请重新读取。') from None
        folder=self.path.parent/'backups'/str(request.undo_token)
        try:
            with locked(self.path.with_suffix('.lock')):
                if not (folder/'receipt.json').is_file():raise HTTPException(404,'撤销记录不存在。')
                try:receipt=read(folder/'receipt.json')
                except ValueError:raise HTTPException(409,'备份记录不可读，保留当前配置并拒绝恢复。') from None
                if not isinstance(receipt,dict):raise HTTPException(409,'备份记录无效，保留当前配置并拒绝恢复。')
                if not receipt.get('after') or revision(self.path)!=receipt['after'] or request.expected_revision!=receipt['after']:
                    raise HTTPException(409,'配置已变化，不能覆盖后续修改；请重新读取。')
                if receipt['before']!='missing' and revision(folder/'config.json')!=receipt['before']:
                    raise HTTPException(409,'备份摘要不一致，保留当前配置并拒绝恢复。')
                try:target=read(folder/'config.json') if receipt['before']!='missing' else {}
                except ValueError:target={}
                self.guard_connection(read(self.path),target if isinstance(target,dict) else {})
                # Keep the replaced configuration too, so undo never destroys it.
                shutil.copyfile(self.path,folder/'replaced.json')
                if receipt['before']=='missing':self.path.unlink()
                else:atomic_bytes(self.path,(folder/'config.json').read_bytes())
                atomic(folder/'receipt.json',{**receipt,'undone':True,'after':None})
        except BlockingIOError:raise HTTPException(409,'另一项配置操作正在保存，请稍后重新读取。') from None
        return {**self.executor.profile_status(),'revision':revision(self.path),'connection_checked':False}

    def check(self):
        if not self.executor.profile_status()['configured']:
            return {'reachable':False,'partition_exists':None,'directory_writable':None,'environment_available':None,
                    'status':'not_configured','message':'超算未配置或配置无效，请先保存完整配置。'}
        value=read(self.path)
        if value['ssh_alias'] not in ssh_aliases(self.ssh_config):raise HTTPException(422,'SSH 别名已不在本机配置中，请重新选择。')
        partition=value.get('partition','dg83');workdir=str(PurePosixPath(value['remote_root']).parent)
        try:remote_path(workdir);remote_path(value['python'])
        except ValueError:raise HTTPException(422,'远程目录或环境路径无效，请重新保存。') from None
        if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}',partition):raise HTTPException(422,'Slurm 分区名称无效。')
        # One connection, three read-only probes; output never includes SSH stderr.
        command=(f'p=$(sinfo -p {shlex.quote(partition)} -h -o %P 2>/dev/null); rc=$?; '
                 'if [ "$rc" -ne 0 ]; then printf "scheduler=unavailable\\n"; '
                 'elif [ -n "$p" ]; then printf "partition=yes\\n"; else printf "partition=no\\n"; fi; '
                 f'if test -d {shlex.quote(workdir)} && test -w {shlex.quote(workdir)}; then printf "directory=yes\\n"; else printf "directory=no\\n"; fi; '
                 f'if test -x {shlex.quote(value["python"])}; then printf "environment=yes\\n"; else printf "environment=no\\n"; fi')
        result={'reachable':False,'partition_exists':None,'directory_writable':None,'environment_available':None}
        try:
            response=self.runner(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10',
                                  '-o','StrictHostKeyChecking=yes',value['ssh_alias'],command],
                                 capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=20)
        except subprocess.TimeoutExpired:return {**result,'status':'timeout','message':'超算连接检查超时，请检查网络和 SSH 配置后重试。'}
        except OSError:return {**result,'status':'ssh_unavailable','message':'本机 SSH 程序不可用，请由管理员安装并配置。'}
        if response.returncode:
            if response.returncode != 255:
                return {**result,'reachable':True,'status':'check_failed','message':'连接已建立，但远端未能完成只读检查；请由管理员核对登录环境和 Slurm 命令。'}
            reason=response.stderr.lower()
            message=('SSH 身份验证失败，请由管理员检查已有别名的登录配置。' if 'permission denied' in reason else
                     'SSH 主机密钥尚未确认或已变化，请由管理员在终端核对。' if 'host key' in reason else
                     '无法连接超算，请检查网络和本机 SSH 别名配置。')
            return {**result,'status':'unreachable','message':message}
        probes=set(response.stdout.splitlines());result.update(reachable=True,
            partition_exists=True if 'partition=yes' in probes else False if 'partition=no' in probes else None,
            directory_writable=True if 'directory=yes' in probes else False if 'directory=no' in probes else None,
            environment_available=True if 'environment=yes' in probes else False if 'environment=no' in probes else None)
        messages=[]
        if result['partition_exists'] is not True:messages.append('无法读取 Slurm 分区，请检查调度器或分区名称' if result['partition_exists'] is None else 'Slurm 分区不存在，请修正分区名称')
        if result['directory_writable'] is not True:messages.append('远程工作目录不存在、不可写或未能检查，请由管理员准备目录')
        if result['environment_available'] is not True:messages.append('环境中的 Python 不可执行或未能检查，请核对环境路径')
        return {**result,'status':'ready' if not messages else 'unavailable',
                'message':'连接、分区、目录和环境路径检查通过；尚未检查求解器依赖，未提交作业。' if not messages else '；'.join(messages)+'。'}
