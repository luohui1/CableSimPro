import { useMemo } from 'react';
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns, type DataChange } from './data-grid/data-grid';
import { useDataGridFill } from './data-grid-fill/data-grid-fill';
import { TooltipProvider } from './ui/tooltip';
import { Button } from './ui/button';
import { useStudy } from './study-provider';
import { change, displayed, entityLabel, fieldSource, isLocked, parseInput, type DomainDocument, type NumericInput } from '@/lib/domain-fields';
import { message, text } from '@/api/client';
import type { InputRow } from './study-inputs';

type Quantity = 'area' | 'diameter' | 'r20' | 'thickness';
type Row = { id: string; label: string; material: string; source: string; original: InputRow; specs: Partial<Record<Quantity, NumericInput>>; locked: Partial<Record<Quantity, boolean>> } & Record<Quantity, number | null>;
const quantities: {id: Quantity; label: string; suffix: string}[] = [
  {id:'area',label:'导体标称截面 / mm²',suffix:'/nominal_area'},
  {id:'diameter',label:'导体外径 / mm',suffix:'/diameter'},
  {id:'thickness',label:'层厚度 / mm',suffix:'/thickness'},
  {id:'r20',label:'R₂₀ / Ω/km',suffix:'/r20'},
];
export default function CableLayerGrid({rows, document, historical, onSelect}: {rows: InputRow[]; document: DomainDocument; historical: boolean; onSelect:(row:InputRow)=>void}) {
  const context = useStudy();
  const data: Row[] = useMemo(() => rows.map(row => {
    const result: Row = {id:row.fields[0]?.path || row.id,label:row.label,material:row.material ? entityLabel(document,row.material) : '—',source:'',original:row,specs:{},locked:{},area:null,diameter:null,r20:null,thickness:null};
    const sources = new Set<string>();
    for (const quantity of quantities) {
      const spec = row.fields.find(field => field.path.endsWith(quantity.suffix));
      if (!spec) continue;
      result.specs[quantity.id] = spec;
      result[quantity.id] = displayed(document,spec);
      const source = fieldSource(document,spec.path);
      result.locked[quantity.id] = source.kind === 'derived' || isLocked(context.workspace.locks,spec.path);
      sources.add(source.kind === 'derived' ? '推导值 · 只读' : result.locked[quantity.id] ? '固定引用 · 只读' : source.kind === 'user' ? '用户录入' : source.kind === 'library' ? '库引用' : '领域文档');
    }
    result.source = [...sources].join(' · ');
    return result;
  }), [rows, document, context.workspace.locks]);
  const columns = useMemo(() => defineColumns<Row>()([
    {id:'label',header:'分层',accessorKey:'label',readOnly:true,width:230},
    {id:'material',header:'材料',accessorKey:'material',readOnly:true,width:125},
    ...quantities.map(quantity => ({id:quantity.id,header:quantity.label,accessorKey:quantity.id,type:'number' as const,width:155,
      readOnly:(row:Row) => !row.specs[quantity.id] || !!row.locked[quantity.id],
      validate:(value:unknown,row:Row) => { const spec=row.specs[quantity.id]; if(!spec)return '此分层没有该输入'; try{parseInput(spec,value===null||value===undefined?'':String(value));return null;}catch(error){return message(error);}},
      cellClassName:'numeric',headerClassName:'numeric',
    })),
    {id:'source',header:'来源',accessorKey:'source',readOnly:true,width:155},
  ]), []);
  const disabled = historical || context.saving;
  const fill = useDataGridFill({disabled});
  const FillHandleTracker = fill.FillHandleTracker;
  const overlayPlugins = useMemo(() => [fill.plugin], [fill.plugin]);
  function update(_next: readonly Row[], edit: DataChange<Row>) {
    if(disabled)return;
    let nextDocument = document;
    const consumed:string[]=[];
    for(const op of edit.ops) {
      if(op.type!=='update')continue;
      for(const quantity of quantities) {
        const spec=op.prev.specs[quantity.id];
        if(!spec || op.prev.locked[quantity.id] || op.row[quantity.id]===op.prev[quantity.id])continue;
        const value=parseInput(spec,op.row[quantity.id]===null||op.row[quantity.id]===undefined?'':String(op.row[quantity.id]));
        nextDocument=change(nextDocument,spec.path,value); consumed.push(spec.path);
      }
    }
    if(consumed.length)context.editDomainDocument(nextDocument,'cable',consumed);
  }
  return <section className="layer-grid-module" aria-label="电缆分层">
    <div className="toolbar"><span className="muted">框选后粘贴；拖动选区右下角填充。推导量只读。</span><div className="spacer" /><Button size="compact" disabled={disabled||!context.canUndo} onClick={()=>void context.undo()}>撤销</Button><Button size="compact" disabled={disabled||!context.canRedo} onClick={()=>void context.redo()}>重做</Button><Button size="compact" disabled={disabled||!context.domainDraft} onClick={()=>void context.save()}>保存分层</Button></div>
    <TooltipProvider><DataGridProvider data={data} columns={columns} getRowId={row=>row.id} onDataChange={update} onUndo={()=>void context.undo()} onRedo={()=>void context.redo()} overlayPlugins={overlayPlugins}>
      <DataGridRoot<Row> className="layer-grid" readOnly={disabled} onRowClick={({row})=>onSelect(row.original)}><DataGridHeader /><DataGridBody /><FillHandleTracker /></DataGridRoot>
    </DataGridProvider></TooltipProvider>
    {!!context.saveError && <p className="field-error" role="alert">{message(context.saveError)}</p>}
    <span className="visually-hidden">{text(context.workspace.name)}</span>
  </section>;
}
