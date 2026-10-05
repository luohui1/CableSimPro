import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as documents from '@/api/documents';
import { message } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { LoadingState } from '@/components/states';
import { displayName } from '@/lib/display-names';
import { engineeringQuantity } from '@/lib/format';
import { downloadJson } from '@/lib/download';

export type QueuedProposal = Omit<documents.ProposalInput, 'request_id'>;
export function BatchProposals({did, batchId, items, onRemove, onCreated}: {
  did:string; batchId:string; items:QueuedProposal[]; onRemove:(id:string)=>void; onCreated:(id:string)=>void;
}) {
  const cache=useQueryClient(), lock=useRef(false), ids=useRef(new Map<string,string>());
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [open,setOpen]=useState(false), [ack,setAck]=useState(false), [approver,setApprover]=useState('');
  const saved=useQuery({queryKey:['document-batch',did,batchId],queryFn:({signal})=>documents.batchInfo(did,batchId,signal),enabled:!!batchId});
  const id=(key:string)=>{if(!ids.current.has(key))ids.current.set(key,crypto.randomUUID());return ids.current.get(key)!;};
  async function perform(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof TypeError?'连接中断，批量清单已保留；请重试同一操作。':message(e));}finally{lock.current=false;setBusy(false);}}
  if (!items.length && !batchId) return null;
  return <section className="document-batch" aria-label="多规格批量提案">
    <div className="document-batch-controls"><h2>{saved.data?.status==='approved'?'批量型号草稿已生成':'多规格批量提案'}</h2>
    {!batchId && <Button disabled={items.length<2} loading={busy} onClick={()=>void perform(async()=>{
      const body={items:items.map(item=>({...item,request_id:id('item:'+JSON.stringify(item))}))};
      const batch=await documents.batchPropose(did,{...body,request_id:id('batch:'+JSON.stringify(body))});
      cache.setQueryData(['document-batch',did,batch.id],batch);onCreated(batch.id);
    })}>生成 {items.length} 个规格提案</Button>}
    {saved.data?.status==='proposed' && <Button disabled={busy} onClick={()=>{setAck(false);setOpen(true);}}>核对并批准整批</Button>}
    {saved.data && <Button onClick={()=>downloadJson(saved.data,'多规格资料提案.json')}>下载批量提案</Button>}</div>
    {saved.data?.status==='approved' && <Button size="compact" onClick={()=>{for(const item of items)onRemove(item.extraction_id);onCreated('');}}>新建批量清单</Button>}
    {(error || saved.error) && <p className="field-error" role="alert">{error || message(saved.error)}{saved.error && <Button onClick={()=>saved.refetch()}>重试批量提案</Button>}</p>}
    {!!batchId && saved.isPending ? <LoadingState title="正在读取批量提案"/> : saved.data ? <>
      <p className="muted">{saved.data.proposals.length} 个规格 · {saved.data.status==='approved'?'草稿，尚未发布':'等待人工批准'}</p>
      {saved.data.proposals.map(proposal=><details key={proposal.id} className="document-batch-item"><summary>{proposal.draft.name} · {proposal.changes.length} 项变更</summary>
        <table><thead><tr><th>参数</th><th>草稿值</th></tr></thead><tbody>{proposal.changes.map((change,i)=>{
          const after=change.after as {value?:number;unit?:string};const q=engineeringQuantity(String(change.field),after?.value??null,after?.unit||'');
          return <tr key={i}><td>{displayName(String(change.field))}</td><td>{q.text} {q.unit}</td></tr>;
        })}</tbody></table><p className="digest">{proposal.sha256}</p>
      </details>)}<p className="digest">{saved.data.sha256}</p>
    </> : <table><thead><tr><th>规格</th><th>版本</th><th>操作</th></tr></thead><tbody>{items.map(item=><tr key={item.extraction_id}><td>{item.new_model?.name}</td><td>{item.version}</td><td><Button size="compact" disabled={busy} onClick={()=>onRemove(item.extraction_id)} aria-label={'移除 '+item.new_model?.name}>移除</Button></td></tr>)}</tbody></table>}
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}} initialFocus="form" title="批准多规格型号草稿" actions={<Button variant="primary" disabled={!ack || !approver.trim() || !saved.data} loading={busy} onClick={()=>void perform(async()=>{
      const body={proposal_sha256:saved.data!.sha256,approver:approver.trim(),human_approved:true as const};
      const result=await documents.batchApprove(did,batchId,{...body,request_id:id('approve:'+batchId+JSON.stringify(body))});
      cache.setQueryData(['document-batch',did,batchId],result);setOpen(false);
    })}>批准并生成 {saved.data?.proposals.length} 个草稿</Button>}>
      {error && <p role="alert" className="field-error">{error}</p>}
      <ul>{saved.data?.proposals.map(p=><li key={p.id}>{p.draft.name} · {p.draft.version}</li>)}</ul>
      <p className="digest">{saved.data?.sha256}</p>
      <label>批准人<input aria-label="批量批准人" maxLength={100} value={approver} onChange={e=>setApprover(e.target.value)}/></label>
      <label className="document-checkbox"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>我已核对整批逐项变更，批准生成以上型号草稿</label>
    </Dialog>
  </section>;
}
