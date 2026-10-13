"""Canonical object cards and state over existing, read-only metadata."""
from datetime import datetime, timezone
from hashlib import sha256
import json
import sqlite3
import logging
from threading import Event, RLock
from time import time, perf_counter
from types import SimpleNamespace

from fastapi import HTTPException
from backend.kernel.read_models import run_state
from backend.plugin_host import PluginHostError
from .contracts import ObjectCard, ObjectList, Relations, Inbox
from .sources import project, decoded
from .executions import ExecutionReceipts

LABELS={'not_run':'未运行','running':'运行中','current':'当前','outdated':'已过期','failed':'失败',
    'draft':'草稿','reviewed':'已核对','published':'已发布','deprecated':'已停用','incomplete':'资料缺项',
    'pending':'待审核','proposed':'待审核','submitted':'待审核','approved':'已批准','rejected':'已拒绝',
    'saved':'已保存','installed':'已安装','declared':'验证声明','expired':'已到期','unknown':'未登记',
    'planning':'规划中','reviewing':'待审阅','waiting':'等待处理','blocked':'受阻','completed':'已完成',
    'queued':'排队中','preparing':'准备中','validating':'校验中','succeeded':'已完成','partial':'部分成功',
    'cancelled':'已取消','interrupted':'已中断','version_draft':'版本草稿','created':'已创建',
    'accepted':'已接收','unavailable':'不可用','demo':'教学示例'}
ACTIVE={'planning','running','queued','preparing','validating','accepted','dispatching','executing','collecting'}


def parent(card):
    return {key:card[key] for key in ('kind','id','name')} if card else None


class Snapshot:
    def __init__(self,research,db,reproductions=None,reproduction_error=None,*,previous=None,source_generation=None,execution_reader=None):
        self.research,self.db=research,db
        self.raw=project(db);self.cards={};self.meta={};self.edges=[];self.unresolved={};self.todos=[]
        self.receipts=[];self.reproduction_error=reproduction_error
        self.execution_reader=execution_reader or ExecutionReceipts()
        # Agent events/proposals do not change saved engineering currentness.
        # Reuse only verified source identities and identical non-Agent metadata.
        self.model_identity=sha256(json.dumps({key:value for key,value in self.raw.items()
            if key not in ('tasks','agent_proposals')},sort_keys=True,ensure_ascii=False).encode()).digest()
        same_sources=source_generation is not None and previous and previous['source_generation']==source_generation
        self.registry=previous['registry'] if same_sources else research.registry()
        self.cache={'registries':{pid:self.registry for pid in self.registry.plugins}}
        self.workspaces={r['id']:r for r in self.raw['workspaces']}
        self.studies={r['id']:r for r in self.raw['studies']}
        self.run_states=dict(previous['run_states']) if same_sources and previous['model_identity']==self.model_identity else {}
        self.build_cards()
        if reproductions is not None:
            from .reproductions import build as reproduction_cards,invalid
            baseline_cards=self.cards.copy();baseline_meta=self.meta.copy()
            try:reproduction_cards(self,reproductions)
            except (ValueError,KeyError,TypeError,AttributeError,IndexError) as error:
                self.cards=baseline_cards;self.meta=baseline_meta;self.edges.clear();self.unresolved.clear()
                self.reproduction_error=invalid(error).detail
        if self.reproduction_error:
            from .reproductions import unavailable
            unavailable(self,self.reproduction_error)
        from .relations import build
        build(self)
        from .inbox import build as inbox
        inbox(self)

    def add(self,kind,id,name,status,*,reason=None,updated=None,version=None,revision=None,
            source=None,owner=None,subtype=None,digest=None):
        card=ObjectCard(kind=kind,id=id,name=name or id,version=version,revision=revision,
            status={'code':status,'label':LABELS.get(status,status),'reason':reason},updated=updated,
            source=source,parent=parent(owner),subtype=subtype).model_dump(mode='json')
        self.cards[kind,id]=card;self.meta[kind,id]={'digest':digest}
        return card

    def get(self,kind,id):return self.cards.get((kind,id))

    def workspace(self,id):
        return self.get('project',id) or self.get('type',id)

    def missing(self,key,role,reason):
        value={'role':role,'freshness':'unknown','reason':reason}
        if value not in self.unresolved.setdefault(key,[]):self.unresolved[key].append(value)

    def link(self,source,target,role,*,pin=None,freshness=None,reason=None):
        if source is None or target is None:return
        if freshness is None:
            freshness='unknown' if target['status']['code']=='unknown' else 'current'
            differences=[]
            for field in ('version','revision','digest'):
                old=(pin or {}).get(field)
                new=self.meta.get((target['kind'],target['id']),{}).get('digest') if field=='digest' else target.get(field)
                if old is not None and new is None:freshness='unknown'
                elif old is not None and old!=new:
                    differences.append('引用'+{'version':'版本','revision':'修订','digest':'摘要'}[field]+'已变化')
            if differences:freshness='outdated';reason=reason or '；'.join(differences)
        edge=((source['kind'],source['id']),{'role':role,'target':target,'pinned':pin,'freshness':freshness,'reason':reason})
        if edge not in self.edges:self.edges.append(edge)

    def reference(self,reference):
        if not reference or not reference.get('id'):return None
        rid=reference['id'];rid=rid.removeprefix('candidate:')
        found=self.get('cable_version',rid)
        if found:return found
        found=next((self.get('cable_version',row['asset']) for row in reversed(self.raw['releases']) if row['family']==rid
            and (self.get('cable_version',row['asset']) or {}).get('status',{}).get('code')=='published'),None)
        if found:return found
        # The ID is a real saved reference; it is not a guessed published version.
        return ObjectCard(kind='cable_version',id=reference['id'],name=reference.get('name') or reference['id'],
            version=reference.get('version'),status={'code':'unknown','label':'未登记','reason':'引用未在现有资源索引中登记。'},
            updated=None).model_dump(mode='json')

    def state(self,row):
        if row['id'] in self.run_states:return self.run_states[row['id']]
        snapshot=decoded(row['meta'],{})
        snapshot['workspace_state']={key:value for key,value in snapshot.get('workspace_state',{}).items() if value and value.get('id')}
        study=self.studies.get(row['study']);workspace=self.workspaces.get(row['workspace'])
        reasons=[]
        if row['status'] in ACTIVE:code='running';reason=None
        elif row['status']!='succeeded':
            code='failed';reason=row['error'] or ('运行仅部分成功，不能作为当前完整结论。' if row['status']=='partial' else LABELS.get(row['status'],'运行未成功完成'))
        elif not study or not workspace:code='failed';reason='运行的工程或研究引用缺失。'
        else:
            try:
                detail=run_state(self.research,snapshot,row['workspace'],workspace['revision'],
                    {'revision':study['revision'],'definition':decoded(study['definition'])},self.cache)
                code='current' if detail['freshness']=='current' else 'outdated'
                for value in detail['version_status']['reasons']:
                    if value['code']=='METHOD_VERSION_CHANGED':
                        plugin=self.get('plugin',value['id'])
                        reasons.append('方法 '+(plugin['name'] if plugin else value['id'])+' '+value['from_version']+' → '+value['to_version']+
                            ('（同版本发行摘要变化）' if value['from_version']==value['to_version'] else ''))
                    else:reasons.append(value['message'])
                if snapshot['workspace_revision']!=workspace['revision']:
                    paths=set()
                    for event in self.db.execute('SELECT details FROM workspace_audit WHERE workspace=? AND revision>? AND revision<=?',
                        (row['workspace'],snapshot['workspace_revision'],workspace['revision'])):
                        try:
                            changes=decoded(event['details'])
                            if isinstance(changes,list):paths.update(c['path'] for c in changes if isinstance(c,dict) and 'path' in c)
                        except (ValueError,TypeError):pass
                    reasons.append('输入改了 '+str(len(paths))+' 项' if paths else
                        f"工程输入修订 {snapshot['workspace_revision']} → {workspace['revision']}")
                if detail['method_availability']['status']=='unavailable' and not reasons:
                    reasons.append(detail['method_availability']['error']['message'])
                if code=='outdated' and not reasons:reasons.append('研究参数、工况或保存引用已变化，需在工作台核对并重算。')
                reason='；'.join(reasons) or None
            except (ValueError,KeyError,TypeError):
                code='failed';reason='保存运行的引用元数据不完整或不合法，请在原研究核对。'
        value={'code':code,'reason':reason,'snapshot':snapshot}
        self.run_states[row['id']]=value
        return value

    def build_cards(self):
        for pid,plugin in self.registry.plugins.items():
            manifest=plugin.manifest;pin=self.research.pin(plugin)
            updated=datetime.fromtimestamp((plugin.directory/'plugin.json').stat().st_mtime,timezone.utc).isoformat()
            card=self.add('plugin',pid,manifest.name,'installed',version=pin['version'],updated=updated,
                source={'kind':'installation','label':'安装清单'},digest=pin['release_digest'])
            for capability in manifest.capabilities:
                for name in capability.validation.cases:
                    vid=pid+':'+sha256(name.encode()).hexdigest()[:24]
                    if not self.get('validation',vid):self.add('validation',vid,name,'declared',version=manifest.version,
                        reason='插件清单声明的验证条目；不是本次验证执行或工程批准记录。',updated=updated,owner=card,
                        source={'kind':'plugin','label':manifest.name},subtype='declared')
        from backend.kernel.scenarios import system_models
        for model in system_models():
            self.add('cable_version',model['id'],model['name'],model['state'],version=model['version'],
                source={'kind':'system','label':'系统教学型号；不是厂家实测'},digest=model['content_sha256'])
        plans={r['workspace']:r for r in self.raw['type_plans']}
        submissions={r['workspace']:r for r in self.raw['submissions']}
        for row in self.raw['workspaces']:
            design=row['id'] in plans or row['cable_count']==1 and row['study_reference_type'] in (None,'null')
            kind='type' if design else 'project';plan=plans.get(row['id']);submission=submissions.get(row['id'])
            status=plan['status'] if plan else 'draft' if design else 'saved'
            if submission and submission['revision']==row['revision']:status=submission['status']
            self.add(kind,row['id'],row['name'],status,revision=row['revision'],updated=row['updated'])
        releases={r['asset']:r for r in self.raw['releases']}
        for row in self.raw['assets']:
            release=releases.get(row['id']);owner=self.workspace(release['workspace']) if release else None
            self.add('cable_version' if release else 'asset',row['id'],row['name'],row['status'],version=row['version'],
                revision=row['revision'],updated=row['updated'],owner=owner,subtype=None if release else row['kind'],
                digest=row['content_sha256'],source={'kind':'type' if release else 'asset','label':'型号设计发布' if release else '资源库'})
        for row in self.raw['models']:
            missing=decoded(row['missing'],[])
            self.add('cable_version',row['id'],row['name'],row['state'],version=row['version'],updated=row['created'],
                reason='；'.join(missing) if missing else None,digest=row['digest'],source={'kind':'document','label':'保存的候选型号资料'})
        for row in self.raw['documents']:
            self.add('document',row['id'],row['name'],'saved',updated=row['created'],digest=row['sha256'],
                source={'kind':'manufacturer','label':'厂家原件'})
        # version_status.inspect only needs this identity. Supply the same
        # latest published/system version from metadata, so it never loads a
        # type's full specification/results just to compare its reference pin.
        models=self.cache.setdefault('version_models',{})
        references=[decoded(row[key],{}) for row in self.raw['workspaces'] for key in ('cable_reference','origin_reference')]
        references.extend(ref for row in self.raw['runs'] for ref in decoded(row['meta'],{}).get('workspace_state',{}).values() if ref)
        for reference in references:
            rid=reference.get('id')
            if not rid or rid in models:continue
            release=next((r for r in reversed(self.raw['releases']) if r['family']==rid
                and (self.get('cable_version',r['asset']) or {}).get('status',{}).get('code')=='published'),None)
            card=self.get('cable_version',release['asset']) if release else self.get('cable_version',rid) if rid.startswith('system.') else None
            models[rid]=None if card is None else {'id':rid,'name':card['name'],'version':card['version'],
                'content_sha256':self.meta['cable_version',card['id']]['digest'],
                'published_workspace':release['workspace'] if release else None}
        latest={}
        for row in self.raw['runs']:latest.setdefault(row['study'],row)
        for row in self.raw['studies']:
            run=latest.get(row['id']);state=self.state(run) if run else {'code':'not_run','reason':None}
            self.add('study',row['id'],decoded(row['definition']).get('title') or '未命名研究',state['code'],reason=state['reason'],
                revision=row['revision'],updated=(run['finished'] or run['created']) if run else row['created'],owner=self.workspace(row['workspace']))
        executions=dict(self.execution_reader.read(self.research.executor,[(row['id'],self.state(row)['snapshot']['definition']['method'])
            for row in self.raw['runs'] if self.state(row)['snapshot'].get('definition',{}).get('method')]))
        for row in self.raw['runs']:
            state=self.state(row);owner=self.get('study',row['study']);snapshot=state['snapshot']
            card=self.add('run',row['id'],(owner['name'] if owner else '保存运行')+' · '+str(row['sequence']),state['code'],
                reason=state['reason'],updated=row['finished'] or row['created'],owner=owner,digest=row['output_digest'])
            self.add('input_snapshot',row['id'],'输入快照 · '+str(snapshot.get('workspace_revision','未知')), 'saved',
                revision=snapshot.get('workspace_revision'),updated=row['created'],owner=card,digest=row['input_digest'])
            execution=executions.get(row['id'])
            if execution:
                self.receipts.append((row['id'],execution))
                status=row['status'] if row['status'] in ('validating','succeeded','partial','failed','interrupted','cancelled') else execution.get('state',row['status'])
                self.add('job',row['id'],(owner['name'] if owner else '保存运行')+' · 超算作业',
                    status,updated=execution.get('finished') or execution.get('started') or row['created'],owner=card,
                    source={'kind':'run','label':'已保存的调度回执'})
        for row in self.raw['deliveries']:
            self.add('delivery',row['id'],'计算书 · '+(self.workspace(row['workspace']) or {}).get('name',row['workspace']),
                'saved',updated=row['created'],owner=self.workspace(row['workspace']),digest=row['digest'])
        for row in self.raw['submissions']:
            self.add('delivery',row['id'],(row['name'] or '型号')+' · 规格书',row['status'],revision=row['revision'],
                updated=row['created'],owner=self.workspace(row['workspace']),digest=row['digest'])
        for row in self.raw['tasks']:
            self.add('agent_task',row['id'],row['name'] or 'Agent 任务',row['state'],reason=row['waiting_reason'],
                updated=row['updated'],owner=self.get('study',row['study_id']) or self.workspace(row['workspace_id']),source={'kind':'agent','label':'Agent'})
        for row in self.raw['agent_proposals']:
            expired=row['expires'] is not None and row['expires']<=time()
            self.add('proposal',row['id'],row['name'] or 'Agent 方案',row['decision'] or ('expired' if expired else 'pending'),
                updated=row['created'],owner=self.get('agent_task',row['task_id']),source={'kind':'agent','label':'Agent 方案'},
                reason='方案有效期已结束，需重新提出方案。' if not row['decision'] and expired else None,digest=row['digest'])
        for row in self.raw['document_proposals']:
            self.add('proposal',row['id'],(row['name'] or '资料提取')+' · 提案',row['status'],version=row['version'],
                updated=row['updated'],owner=self.get('document',row['document']),source={'kind':'document','label':'厂家资料提取'},digest=row['digest'])
        for row in self.raw['convergence']:
            self.add('job','convergence:'+row['id'],row['name'] or '有限元收敛复核',row['status'] or 'unknown',
                updated=row['created'],owner=self.get('study',row['study']),source={'kind':'job','label':'保存的收敛工作流'})
        for row in self.raw['datasets']:
            self.add('run',row['id'],'批量数据集 · '+(self.get('study',row['study']) or {}).get('name',row['id']),row['status'],
                updated=row['updated'],owner=self.get('study',row['study']),source={'kind':'study','label':'保存的批量数据集'})


class Index:
    MAX_WAIT_SECONDS = 3

    def __init__(self,research):
        self.research=research;self.lock=RLock();self.runs=[]
        self.next_expiry=None;self.expiry_generation=0
        self.runtime_generation=0;self.runtime_hash=None
        self.warm_done=Event();self.warm_state='pending'
        self.previous=None;self.last_build=None;self.startup_wait_ms=None
        self.last_read=None
        self.execution_reader=ExecutionReceipts()
        from .reproductions import library
        self.reproduction_library=library()

    def warm(self,stop=None):
        if stop is not None and stop.is_set():return
        self.warm_state='building'
        try:
            self.snapshot()
            self.warm_state='ready'
        except Exception:
            self.warm_state='unavailable'
            logging.getLogger(__name__).warning('Object index warm-up unavailable; reads may retry',exc_info=True)
        finally:self.warm_done.set()

    def runtime_identity(self):
        # Job receipts live outside SQLite. Read the executor's small local
        # receipt, never refresh SSH/Slurm or load result archives.
        return sha256(json.dumps(self.execution_reader.read(self.research.executor,self.runs),sort_keys=True,ensure_ascii=False).encode()).digest()

    def load(self):
        started=perf_counter()
        from .reproductions import invalid,identity
        reproduction_error=None;reproductions=None
        try:
            observed=identity(self.reproduction_library)
            reproductions=self.reproduction_library.snapshot()
            if identity(self.reproduction_library)!=observed:raise ValueError('读取期间复现库变化，请重试。')
        except (OSError,ValueError,KeyError,TypeError,AttributeError,IndexError,HTTPException) as error:
            reproductions=None;reproduction_error=invalid(error).detail
        with self.research.store.db() as db:
            db.execute('PRAGMA query_only=ON');db.execute('PRAGMA busy_timeout=250');db.execute('BEGIN')
            cache=self.research.read_responses
            with cache.lock:generation=cache.generation(True)
            source_generation=generation[1] if generation is not None else None
            view=Snapshot(self.research,db,reproductions,reproduction_error,
                previous=self.previous,source_generation=source_generation,execution_reader=self.execution_reader)
        self.runs=[(r['id'],view.state(r)['snapshot']['definition']['method']) for r in view.raw['runs']
            if view.state(r)['snapshot'].get('definition',{}).get('method')]
        # Baseline exactly the receipts used for these cards. A fresh reread here
        # could hide a completion that happened during construction.
        self.runtime_hash=sha256(json.dumps(view.receipts,sort_keys=True,ensure_ascii=False).encode()).digest()
        now=time();deadlines=[r['expires'] for r in view.raw['agent_proposals'] if not r['decision'] and r['expires'] and r['expires']>now]
        self.next_expiry=min(deadlines,default=None)
        payload=json.dumps({'cards':list(view.cards.values()),'edges':view.edges,
            'unresolved':[[*key,notes] for key,notes in view.unresolved.items()],'todos':view.todos,
            'reproduction_error':view.reproduction_error},ensure_ascii=False,allow_nan=False).encode()
        self.last_build={'elapsed_ms':(perf_counter()-started)*1000,'cards':len(view.cards),
            'reused_run_states':bool(self.previous and source_generation is not None
                and self.previous['source_generation']==source_generation and self.previous['model_identity']==view.model_identity)}
        self.previous={'source_generation':source_generation,'model_identity':view.model_identity,
            'registry':view.registry,'run_states':view.run_states}
        return payload

    def snapshot(self):
        started=perf_counter();metrics={}
        # Leave room for the HTTP error response within the public wait budget.
        if not self.lock.acquire(timeout=max(0,self.MAX_WAIT_SECONDS-.1)):
            raise HTTPException(503,{'code':'INDEX_BUILDING','state':'building',
                'message':'统一索引正在完整构建；本次等待已达上限，请稍后重试。',
                'max_wait_seconds':self.MAX_WAIT_SECONDS},headers={'Retry-After':'1'})
        try:
            metrics['lock_ms']=(perf_counter()-started)*1000;phase=perf_counter()
            if self.next_expiry is not None and time()>=self.next_expiry:
                self.expiry_generation+=1;self.next_expiry=None
            observed=self.runtime_identity()
            if self.runtime_hash is not None and observed!=self.runtime_hash:
                self.runtime_generation+=1
            self.runtime_hash=observed
            metrics['execution_ms']=(perf_counter()-phase)*1000;phase=perf_counter()
            from .reproductions import identity,invalid
            try:reproduction_identity=identity(self.reproduction_library)
            except (OSError,ValueError,KeyError,TypeError,AttributeError,IndexError,HTTPException) as error:
                path=self.reproduction_library.root/'index.json'
                try:
                    stat=path.stat();stamp=(stat.st_mtime_ns,stat.st_ctime_ns,stat.st_size,stat.st_ino)
                except OSError:stamp=None
                reproduction_identity=('invalid',stamp,type(error).__name__,str(error))
            key=('object-index',self.expiry_generation,self.runtime_generation,reproduction_identity)
            metrics['reproduction_identity_ms']=(perf_counter()-phase)*1000;phase=perf_counter()
            cache=self.research.read_responses
            payload=cache.get(key,True)
            metrics['cache_hit']=payload is not None
            if payload is None:payload=cache.build(key,None,self.load,True)
            metrics['cache_ms']=(perf_counter()-phase)*1000;phase=perf_counter()
            value=json.loads(payload)
            metrics['decode_ms']=(perf_counter()-phase)*1000
            return SimpleNamespace(cards={(card['kind'],card['id']):card for card in value['cards']},
                edges=[(tuple(source),edge) for source,edge in value['edges']],
                unresolved={(kind,id):notes for kind,id,notes in value['unresolved']},todos=value['todos'],
                reproduction_error=value.get('reproduction_error'))
        except sqlite3.OperationalError as error:
            raise HTTPException(503,{'code':'INDEX_UNAVAILABLE','message':'统一索引暂时无法读取；原数据未改变，请稍后重试。'},headers={'Retry-After':'1'}) from error
        except (PluginHostError,OSError,ValueError) as error:
            raise HTTPException(503,{'code':'INDEX_SOURCE_UNAVAILABLE','message':'安装清单或保存引用暂时不可用，请核对原模块。'}) from error
        except MemoryError as error:
            raise HTTPException(503,{'code':'INDEX_RESOURCE_PRESSURE','message':'统一索引暂时内存不足；未返回部分索引，请稍后重试。'},headers={'Retry-After':'1'}) from error
        finally:
            metrics['elapsed_ms']=(perf_counter()-started)*1000;self.last_read=metrics
            self.lock.release()

    def objects(self,*,kind=None,q='',limit=50,offset=0):
        if kind is not None and kind not in ObjectCard.model_fields['kind'].annotation.__args__:
            raise HTTPException(422,{'code':'INDEX_KIND_INVALID','path':'/kind','message':'请选择已注册的对象类别。'})
        if not 1<=limit<=100 or offset<0 or len(q)>200:raise HTTPException(422,'索引查询参数超出范围。')
        snapshot=self.snapshot();term=q.casefold().strip()
        if kind=='validation' and snapshot.reproduction_error:
            # Exact declared-card identities remain readable even when the
            # independent reproduction source is unavailable.
            declared=next((card for card in snapshot.cards.values() if card.get('subtype')=='declared'
                and term in (card['id'].casefold(),card['name'].casefold())),None)
            if declared is None:raise HTTPException(503,snapshot.reproduction_error)
        items=[card for card in snapshot.cards.values() if (kind is None or card['kind']==kind)
            and (not term or term in card['name'].casefold() or term in card['id'].casefold())]
        items.sort(key=lambda card:(card['updated'] or '',card['kind'],card['id']),reverse=True)
        if kind=='validation':
            items.sort(key=lambda card:(bool((card.get('validation') or {}).get('metrics')),
                (card.get('validation') or {}).get('convergence_passed') is True,
                card.get('subtype')=='reproduced'),reverse=True)
        return ObjectList(items=items[offset:offset+limit],total=len(items),
            source_errors=[snapshot.reproduction_error] if snapshot.reproduction_error else []).model_dump(mode='json')

    def relations(self,kind,id):
        snapshot=self.snapshot();key=(kind,id)
        if kind=='validation' and snapshot.reproduction_error and (snapshot.cards.get(key) or {}).get('subtype')!='declared':
            raise HTTPException(503,snapshot.reproduction_error)
        if key not in snapshot.cards:raise HTTPException(404,{'code':'INDEX_OBJECT_NOT_FOUND','message':'对象未在现有索引中登记。'})
        uses=[edge for source,edge in snapshot.edges if source==key]
        if kind=='plugin':
            uses.sort(key=lambda edge:(bool((edge['target'].get('validation') or {}).get('metrics')),
                (edge['target'].get('validation') or {}).get('convergence_passed') is True),reverse=True)
        used_by=[{**edge,'target':snapshot.cards[source]} for source,edge in snapshot.edges if (edge['target']['kind'],edge['target']['id'])==key]
        return Relations(uses=uses,used_by=used_by,unresolved=snapshot.unresolved.get(key,[]),
            source_errors=[snapshot.reproduction_error] if snapshot.reproduction_error else []).model_dump(mode='json')

    def inbox(self,snapshot=None):
        snapshot=snapshot if snapshot is not None else self.snapshot();items=snapshot.todos
        items.sort(key=lambda item:(item['created'] or '',item['category'],item['object']['id']),reverse=True)
        return Inbox(items=items,counts={key:sum(item['category']==key for item in items) for key in ('review','stale','missing','running')},
            source_errors=[snapshot.reproduction_error] if snapshot.reproduction_error else []).model_dump(mode='json')
