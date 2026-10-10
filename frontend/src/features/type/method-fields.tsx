import { Suspense } from 'react';
import { contractFields } from '@/lib/heavy-components';
import { Select } from '@/components/ui/select';
import { LoadingState } from '@/components/states';
import { optionalRecord } from '@/api/client';
import type { DomainDocument } from '../drawing/types';
import type { ParameterDraft } from '@/lib/study-config';
const ContractFields = contractFields.Component;

export function TypeMethodFields({ schema, document, namespace, values, readOnly, onChange, fields, onDraftChange, sources }: {
  schema: Record<string, unknown>; document: DomainDocument; namespace: string; values: Record<string, unknown>; readOnly: boolean;
  onChange: (path: string, value: unknown) => void; fields?: Record<string, ParameterDraft>;
  onDraftChange: (field: ParameterDraft | undefined, key: string) => void; sources?: Record<string, { kind?: string }>;
}) {
  const properties = { ...optionalRecord(schema.properties) }; delete properties.cable_type_id; delete properties.circuit_id;delete properties.sources;
  const groups={model:{title:'计算对象',order:0},operating:{title:'工作条件',order:1},physics:{title:'计算条件',order:2},materials:{title:'材料与构造',order:3},numerical:{title:'求解设置',order:4},evidence:{title:'来源与依据',order:5}};
  const visible = { ...schema, properties, 'x-groups':schema['x-groups']||groups };
  return <div className="type-method-fields"><Select label="电缆结构" value={String(values.cable_type_id || '')} disabled={readOnly}
    options={document.cable_types.map(cable=>({value:cable.id,label:cable.label}))} onChange={id=>onChange('/cable_type_id',id)} />
    {!!document.circuits.length && 'circuit_id' in optionalRecord(schema.properties) && <Select label="回路" value={typeof values.circuit_id==='string'?values.circuit_id:''} disabled={readOnly}
      options={document.circuits.map((circuit,index)=>({value:circuit.id,label:circuit.label || `回路 ${index+1}`}))} onChange={id=>onChange('/circuit_id',id)} />}
    <Suspense fallback={<LoadingState title="正在读取参数表单" />}><ContractFields module={namespace} schema={visible} root={visible} values={values} prefix="" readOnly={readOnly} onChange={onChange} draftFields={fields} onDraftChange={onDraftChange} sources={sources} /></Suspense>
  </div>;
}
