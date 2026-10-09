import {useState} from 'react';
import type {ComponentProps} from 'react';
import {message} from '@/api/client';
import {at, change, entityLabel, isLocked, type DomainDocument} from '@/lib/domain-fields';
import {StudyDrawing} from './study-drawing';
import {useStudy} from './study-provider';
import {Dialog} from './ui/dialog';
import {Button} from './ui/button';
import {DataTable} from './data-table';

type Changes = Parameters<NonNullable<ComponentProps<typeof StudyDrawing>['onPropose']>>[0];
export type GeometryProposal = {changes: Changes; revision: number; studyRevision: number};
/** Geometry supplies changes; an engineer reviews them before they enter the ordinary unsaved draft. */
export function StudyGeometryProposal({proposal,onClose}: {proposal?: GeometryProposal;onClose:()=>void}) {
  const context=useStudy(), [error,setError]=useState('');
  const rows=(proposal?.changes || []).map(item=>({id:item.path,...item}));
  function adopt() {
    try {
      if(!proposal || !context.domain || context.dirty || context.workspace.revision!==proposal.revision || context.study.revision!==proposal.studyRevision)
        throw Error('工程或研究已变化，请重新试算；方案内容保留。');
      let next=context.domain;
      for(const item of proposal.changes) {
        if(item.unit!=='m' || !Number.isFinite(item.value) || at(next,item.path)!==item.previousValue || isLocked(context.workspace.locks,item.path))
          throw Error('字段原值或锁定状态已变化，请重新核对。');
        next=change(next,item.path,item.value);
      }
      context.editDomainDocument(next as DomainDocument,'section',rows.map(row=>row.path));
      onClose(); setError('');
    } catch(problem) {setError(message(problem));}
  }
  const label=(path:string)=>{
    const parts=path.split('/').map(p=>p.replaceAll('~1','/').replaceAll('~0','~'));
    return `${entityLabel(context.domain,parts.at(-2) || '')} · ${parts.at(-1)==='x'?'水平位置':parts.at(-1)==='z'?'高程':parts.at(-1)}`;
  };
  return <Dialog open={!!proposal} onOpenChange={open=>{if(!open){onClose();setError('');}}} title="审核几何方案" description="采纳后进入未保存草稿；保存和正式运行仍由工程师执行。"
    actions={<Button variant="primary" disabled={!rows.length || context.saving} onClick={adopt}>采纳为草稿</Button>}>
    <DataTable label="几何方案改动" columns={[
      {id:'field',label:'字段',wrap:true,render:row=>label(row.path)},
      {id:'before',label:'原值',unit:'m',numeric:true,render:row=>row.previousValue.toFixed(4)},
      {id:'after',label:'新值',unit:'m',numeric:true,render:row=>row.value.toFixed(4)},
    ]} groups={[{id:'changes',label:'改动',rows}]} showGroups={false} rowLabel={row=>label(row.path)} />
    {error && <p role="alert" className="field-error">{error}</p>}
  </Dialog>;
}
