import { useState } from 'react';
import { text } from '@/api/client';
import { at, fieldSource, pointer } from '@/lib/domain-fields';
import { formatNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NumberField } from '@/components/ui/number-field';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useTypeWorkspace } from './provider';

/** Density is an explicit design fact. Reference drafts never approve themselves. */
export function DensityInput({ materialId }: { materialId: string }) {
  const state = useTypeWorkspace(), path = pointer('materials', materialId, 'density');
  const current = at(state.document, path) as number | null, source = fieldSource(state.document!, path);
  const [open, setOpen] = useState(false), [amount, setAmount] = useState<number | null>(null);
  const [draftText, setDraftText] = useState<string | undefined>();
  const [kind, setKind] = useState('user'), [reference, setReference] = useState(''), [ack, setAck] = useState(false);
  const disabled = state.readOnly || state.busy || state.locked(path);
  return <>
    <div className="type-result-toolbar"><span>材料密度 {current == null ? '缺项' : formatNumber(current, 1) + ' kg/m³'}</span>
      <Button variant="outline" size="compact" disabled={disabled} onClick={() => { setAmount(current ?? null); setDraftText(undefined); const existingKind = text(source.kind); setKind(['standard', 'manufacturer', 'measurement', 'demo', 'user'].includes(existingKind) ? existingKind : 'user'); setReference(text(source.reference)); setAck(false); setOpen(true); }}>填写密度与出处</Button></div>
    <Dialog open={open} onOpenChange={setOpen} title="材料密度与出处" description="填写同一配方、状态与温度下的密度。资源草稿仍需人工审核；教学值仅用于设计演示。"
      actions={<Button variant="primary" disabled={disabled || draftText !== undefined || !ack || amount == null || !Number.isFinite(amount) || amount <= 0 || amount > 1000000 || !reference.trim() || reference.length > 4000} onClick={() => {
        state.edit(path, amount, { kind: kind as 'standard' | 'manufacturer' | 'measurement' | 'demo' | 'user', reference: reference.trim(), reviewed: false }); setOpen(false);
      }}>写入草稿</Button>}>
      <div className="type-create-fields">
        <NumberField label="材料密度" value={amount} draftText={draftText} onDraftChange={setDraftText} unit="kg/m³" precision={1} min={0} minExclusive max={1000000} required onCommit={setAmount} />
        <Select label="密度来源类别" value={kind} onChange={setKind} options={[{ value: 'standard', label: '标准参考值' }, { value: 'manufacturer', label: '厂家值' }, { value: 'measurement', label: '实测值' }, { value: 'demo', label: '教学值' }, { value: 'user', label: '工程输入' }]} />
        <label>密度出处<Input aria-label="密度出处" value={reference} maxLength={4000} onChange={e => setReference(e.target.value)} placeholder="标准版本、条款与页码，或资料版本、页码及适用条件" /></label>
        <label className="type-confirm"><Checkbox checked={ack} onCheckedChange={v => setAck(v === true)} />已核对密度单位、材料配方与使用条件</label>
      </div>
    </Dialog>
  </>;
}
