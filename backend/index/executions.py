"""Read scheduler metadata in one authenticated batch, without jobs or archives."""
from uuid import UUID,uuid5


class ExecutionReceipts:
    def __init__(self):
        self.key=None;self.value=None

    def bundled(self):
        from backend.kernel.hpc_evidence import INDEX,WITNESS,evidence_index
        def content():
            return (INDEX.read_bytes(),WITNESS.read_bytes(),(INDEX.parent/'engineering-evidence-schema.json').read_bytes())
        observed=content()
        if self.key==observed:return self.value
        # Drop the prior receipt before attempting validation; corrupt or
        # concurrently published bytes must never fall back to an old catalog.
        self.key=None;self.value=None
        value=evidence_index()
        if content()!=observed:raise ValueError('读取期间超算证据索引变化，请重试。')
        self.key=observed;self.value=value
        return value

    def read(self,executor,runs):
        return receipts(executor,runs,self.bundled)


def receipts(executor,runs,bundle):
    status=getattr(executor,'execution_status',None)
    if status is None:return []
    from backend.kernel.hpc_executor import HpcExecutor
    # Other executors own their receipt contract. Keep their public reader.
    native=getattr(status,'__func__',None) is HpcExecutor.execution_status
    bundled=None;items=[]
    for operation,method in runs:
        if not native:
            value=status(operation,method['plugin_id'],method['capability'])
        else:
            directory=executor.root/str(uuid5(UUID(operation),method['plugin_id']+'/'+method['capability']+'/run'))
            if (directory/'plan.json').is_file():
                value=status(operation,method['plugin_id'],method['capability'])
            else:
                from backend.kernel.hpc_evidence import INDEX
                value=None
                if INDEX.exists():
                    # Reuse only byte-identical validated index/witness/schema.
                    # Never trust TTL, mtime, or a cached missing local plan.
                    if bundled is None:bundled=bundle()
                    catalog,digest=bundled
                    entry=catalog['executions'].get(operation)
                    if entry and entry['plugin_id']==method['plugin_id'] and entry['capability']==method['capability']:
                        # Same saved_execution metadata contract; every value
                        # comes from the authenticated host catalog above.
                        value={**entry['execution'],'saved_evidence':True,'evidence_snapshot':digest,
                            'evidence_label':'超算实算结果','partition':'dg83'}
        if value:items.append((operation,value))
    return items
