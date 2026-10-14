"""Execution-side seal reuse; every execution rehashes actual source bytes.

No mtime-only trust and no persistent trusted bit. A content-identical import
tree may reuse the host's immutable seal receipt; a changed tree must reverify.
Read-only resolves within one request share that request's verified snapshot.
"""
from threading import RLock
from contextlib import contextmanager
from contextvars import ContextVar
from concurrent.futures import ThreadPoolExecutor

from ..plugin_host import Executor, PluginHostError
from .source_watch import defer_close
from ..plugin_host.registry import Registry
from .workspace import fingerprint
from ..plugin_host.verification_receipts import source_digest, verify as verified_receipt

_scope=ContextVar('research_seal_scope',default=None)


@contextmanager
def verification_scope():
    """One request may reuse its read snapshot; executions always rehash below."""
    if _scope.get() is not None:
        yield
        return
    state={}
    token=_scope.set(state)
    try:yield
    finally:
        workers=state.get('source_snapshots',{}).get('readers')
        if workers is not None and not state.get('source_snapshots',{}).get('shared_readers'):
            workers.shutdown(wait=True)
        _scope.reset(token)




class SealCache:
    def __init__(self):
        self.records={};self.lock=RLock()
        self.readers=ThreadPoolExecutor(max_workers=4,thread_name_prefix='seal-read')
        self.watches={};self.unchanged={}

    def close(self):
        with self.lock:
            for watch in self.watches.values():watch.close()
            self.watches.clear()
            self.readers.shutdown(wait=True)

    def __del__(self):
        # Never block in a finalizer (see source_watch.defer_close): watches are
        # handed to the notification owner; idle reader threads exit on their own
        # once this executor is collected.
        for watch in getattr(self,'watches',{}).values():
            for handle in getattr(watch,'handles',()):defer_close(handle)

    def verify(self,plugin,*,before_execution=False):
        release=fingerprint(plugin.manifest.model_dump(mode='json',by_alias=True))
        directory=str(plugin.directory.resolve())
        scope=_scope.get();scope_key=(id(self),directory,release)
        if not before_execution and scope is not None and scope_key in scope:
            return {**scope[scope_key],'cache_hit':True,'request_snapshot_reused':True}
        with self.lock:
            from .source_watch import SourceWatch
            root=plugin.directory.parent.parent.resolve()
            if root not in self.watches:self.watches[root]=SourceWatch(root)
            watch=self.watches[root];generation=watch.snapshot()
            prior=self.unchanged.get((directory,release))
            if not before_execution and generation is not None and prior is not None and prior[0]==generation:
                if scope is not None:scope[scope_key]=prior[1]
                return {**prior[1],'cache_hit':True,'request_snapshot_reused':False}
            shared=scope.setdefault('source_snapshots',{}) if scope is not None and not before_execution else {}
            shared.update(readers=self.readers,shared_readers=True)
            content=source_digest(plugin,shared);key=(directory,release,content)
            previous=self.records.get(key)
            if previous is not None:
                if generation is not None and watch.snapshot()==generation:
                    self.unchanged[(directory,release)]=(generation,previous)
                if scope is not None:scope[scope_key]=previous
                return {**previous,'cache_hit':True,'request_snapshot_reused':False}
            receipt=verified_receipt(plugin,plugin._verify,content=content,readers=self.readers)
            record={name:value for name,value in receipt.items() if name!='cache_hit'}
            if len(self.records)>=32:self.records.clear();self.unchanged.clear()
            self.records[key]=record
            if generation is not None and watch.snapshot()==generation:
                self.unchanged[(directory,release)]=(generation,record)
            if scope is not None:scope[scope_key]=record
            return {**record,'cache_hit':receipt['cache_hit'],'request_snapshot_reused':False}


class VerifiedExecutor(Executor):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,verify=False,**kwargs)
        self.seals=SealCache()

    def verify_release(self,plugin):
        return self.seals.verify(plugin)

    def run(self,plugin_id,capability_id,cases,*args,**kwargs):
        plugin=Registry(self.registry.root,plugin_id=plugin_id).get(plugin_id)
        expected=kwargs.get('expected_manifest')
        if expected is not None and expected!=plugin.manifest:
            raise PluginHostError('RELEASE_CHANGED','准备后的插件发行已变化，请重新预检。',409)
        receipt=self.seals.verify(plugin,before_execution=True)
        # Parent still checks protocol, files, output digests, limits and the
        # expected manifest. Only its duplicate full seal scan is replaced above.
        kwargs['expected_manifest']=plugin.manifest
        result=super().run(plugin_id,capability_id,cases,*args,**kwargs)
        result.environment['seal_verification']=receipt
        for case in result.cases:case.evidence['seal_verification']=dict(receipt)
        return result
