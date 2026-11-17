import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { displayUnit } from '@/lib/display-names';
import type { Field, SeriesDeclaration, Vocabulary } from './api';

export function emptyDeclaration(): SeriesDeclaration {
  return { name: '', manufacturer: '', designation: '', cores: 3, u0_v: 0, u_v: 0, standards: [], origin: 'factory', common: {}, common_basis: {}, modelling: {} };
}
const numberOf = (value: string) => value.trim() === '' || !Number.isFinite(Number(value)) ? undefined : Number(value);
const PARTS = [
  { id: 'conductor', label: '导体', matches: (key: string) => key === 'r20' || key.startsWith('conductor_') && !key.includes('screen') },
  { id: 'insulation', label: '绝缘与屏蔽', matches: (key: string) => key.includes('insulation') || key.includes('screen') },
  { id: 'protection', label: '保护层与外径', matches: (key: string) => !key.startsWith('conductor_') && !key.includes('insulation') && !key.includes('screen') && key !== 'r20' },
];

export function DeclarationForm({ value, onChange, vocabulary, mapped }: {
  value: SeriesDeclaration; onChange: (value: SeriesDeclaration) => void; vocabulary: Vocabulary; mapped: Set<string>;
}) {
  const [part, setPart] = useState('conductor');
  const set = (values: Partial<SeriesDeclaration>) => onChange({ ...value, ...values });
  const common = (key: string, text: string) => {
    const next = { ...value.common }, number = numberOf(text);
    if (number === undefined) delete next[key]; else next[key] = number;
    set({ common: next });
  };
  const fieldRow = (field: Field) => <div className="library-import-value" key={field.key}>
    <label htmlFor={`library-common-${field.key}`}>{field.label}<span className="unit"> / {displayUnit(field.unit)}</span></label>
    <Input id={`library-common-${field.key}`} aria-label={`声明${field.label}`} type="number" min="0" step="any" placeholder="未提供" value={value.common[field.key] ?? ''} onChange={event => common(field.key, event.target.value)} />
    <Input aria-label={`${field.label}依据`} placeholder="原表注释、图纸编号或标准条款" required={value.common[field.key] !== undefined} value={value.common_basis[field.key] || ''} onChange={event => set({ common_basis: { ...value.common_basis, [field.key]: event.target.value } })} />
  </div>;
  return <div className="library-import-stack">
    {value.source?.title && <p className="library-import-source">来源：{value.source.title}{value.source.location && `；${value.source.location}`}</p>}
    <div className="library-import-fields">
      <label className="text-field">系列名称<Input aria-label="系列名称" required maxLength={120} value={value.name} onChange={event => set({ name: event.target.value })} /></label>
      <label className="text-field">制造商<Input aria-label="制造商" maxLength={120} value={value.manufacturer} onChange={event => set({ manufacturer: event.target.value })} /></label>
      <label className="text-field">型号<Input aria-label="型号" required maxLength={60} value={value.designation} onChange={event => set({ designation: event.target.value })} /></label>
      <label className="text-field">额定相电压 U₀ / kV<Input aria-label="额定相电压 kV" required type="number" min="0.001" step="any" value={value.u0_v ? value.u0_v / 1000 : ''} onChange={event => set({ u0_v: (numberOf(event.target.value) ?? 0) * 1000 })} /></label>
      <label className="text-field">额定线电压 U / kV<Input aria-label="额定线电压 kV" required type="number" min="0.001" step="any" value={value.u_v ? value.u_v / 1000 : ''} onChange={event => set({ u_v: (numberOf(event.target.value) ?? 0) * 1000 })} /></label>
      <Select label="芯数" value={String(value.cores)} onChange={cores => set({ cores: Number(cores) })} options={[1, 2, 3, 4, 5].map(cores => ({ value: String(cores), label: `${cores} 芯` }))} />
      <Select label="数据身份" value={value.origin} onChange={origin => set({ origin: origin as SeriesDeclaration['origin'] })} options={[{ value: 'factory', label: '本厂结构表' }, { value: 'public', label: '公开厂家资料' }, { value: 'demo', label: '结构演示' }]} />
      <Select label="铠装材料类别" value={value.armour_material || ''} onChange={armour_material => set({ armour_material: armour_material || undefined })} options={[{ value: '', label: '未声明或无铠装' }, { value: 'steel_galvanized', label: '镀锌钢' }, { value: 'steel_stainless_nonmagnetic', label: '非磁性不锈钢' }]} />
      <label className="text-field">最高系统电压 Uₘ / kV<Input aria-label="最高系统电压 kV" type="number" min="0.001" step="any" value={value.um_v ? value.um_v / 1000 : ''} onChange={event => set({ um_v: numberOf(event.target.value) === undefined ? undefined : Number(event.target.value) * 1000 })} /></label>
      <Select label="导体材料" value={value.conductor || ''} onChange={next => set({ conductor: next as SeriesDeclaration['conductor'] || undefined })} options={[{ value: '', label: '按明确型号识别' }, { value: 'copper', label: '铜' }, { value: 'aluminium', label: '铝' }]} />
      <Select label="绝缘材料" value={value.insulation || ''} onChange={next => set({ insulation: next as SeriesDeclaration['insulation'] || undefined })} options={[{ value: '', label: '按明确型号识别' }, { value: 'XLPE', label: '交联聚乙烯' }, { value: 'PVC', label: '聚氯乙烯' }]} />
      <Select label="外护套材料" value={value.oversheath || ''} onChange={next => set({ oversheath: next as SeriesDeclaration['oversheath'] || undefined })} options={[{ value: '', label: '按明确型号识别' }, { value: 'PVC', label: '聚氯乙烯' }, { value: 'PE', label: '聚乙烯' }]} />
      <Select label="金属套材料与形式" value={value.metal_sheath || ''} onChange={next => set({ metal_sheath: next as SeriesDeclaration['metal_sheath'] || undefined })} options={[{ value: '', label: '未声明或无金属套' }, { value: 'lead', label: '铅套' }, { value: 'corrugated_aluminium', label: '皱纹铝套' }, { value: 'smooth_aluminium', label: '光滑铝套' }]} />
    </div>
    <Select label="原表缺少导体电阻时" value={value.resistance_basis || 'stated'} onChange={next => set({ resistance_basis: next as SeriesDeclaration['resistance_basis'] })} options={[{ value: 'stated', label: '保留缺项，等待厂家提供' }, { value: 'standard_limit', label: '采用 GB/T 3956 表 2 标准上限' }]} />
    {value.resistance_basis === 'standard_limit' && <p className="library-import-source">明确采用 GB/T 3956—2008 表 2 的导体直流电阻上限。它是标准上限，不是厂家实测值；表外规格保持缺项。</p>}
    <label className="text-field">执行标准（每行一项，包含年号）<Textarea aria-label="执行标准" value={value.standards.join('\n')} onChange={event => set({ standards: event.target.value.split('\n') })} onBlur={() => set({ standards: value.standards.map(item => item.trim()).filter(Boolean) })} /></label>
    {!value.source?.sha256 && <div className="library-import-fields library-import-fields-pair">
      <label className="text-field">资料名称<Input aria-label="资料名称" placeholder="厂家结构表或产品手册全名" value={value.source?.title || ''} onChange={event => set({ source: { ...value.source, title: event.target.value } })} /></label>
      <label className="text-field">资料位置<Input aria-label="资料位置" placeholder="原始表号、版本或页码" value={value.source?.location || ''} onChange={event => set({ source: { ...value.source, location: event.target.value } })} /></label>
    </div>}
    <section className="library-import-stack" aria-label="全系列统一尺寸">
      <h2>全系列统一尺寸</h2>
      <p className="muted">原表已有的列按逐行数值导入；其余尺寸需写明取值依据。未提供的参数保留缺项。</p>
      <Tabs value={part} onValueChange={setPart}>
        <TabsList aria-label="结构部位">{PARTS.map(item => <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>)}</TabsList>
        {PARTS.map(item => {
          const fields = vocabulary.fields.filter(field => !['area', 'weight'].includes(field.key) && item.matches(field.key));
          const tableFields = fields.filter(field => mapped.has(field.key));
          return <TabsContent key={item.id} value={item.id} className="library-import-stack">
            {tableFields.length > 0 && <p className="muted">原表已有：{tableFields.map(field => field.label).join('、')}。</p>}
            {fields.filter(field => !mapped.has(field.key)).map(fieldRow)}
          </TabsContent>;
        })}
      </Tabs>
    </section>
    <details className="library-import-details">
      <summary>计算参数与来源</summary>
      <div className="library-import-stack">
        <p className="muted">这些参数参与计算，不由导入器猜测。选用参考值后请逐项核对适用范围。</p>
        <div><Button type="button" onClick={() => set({ modelling: structuredClone(vocabulary.reference_modelling) })}>选用有来源的参考参数</Button></div>
        {vocabulary.modelling.map(field => <div className="library-import-value" key={field.key}>
          <label htmlFor={`library-model-${field.key}`}>{field.label}<span className="unit"> / {displayUnit(field.unit)}</span></label>
          <Input id={`library-model-${field.key}`} aria-label={`参数${field.label}`} value={value.modelling[field.key]?.value ?? ''} onChange={event => {
            const modelling = { ...value.modelling }, raw = event.target.value;
            if (raw === '') delete modelling[field.key];
            else modelling[field.key] = { value: numberOf(raw) ?? raw, reference: modelling[field.key]?.reference || '' };
            set({ modelling });
          }} />
          <Textarea aria-label={`${field.label}参数依据`} required={!!value.modelling[field.key]} placeholder="参数的出处与适用条件" value={value.modelling[field.key]?.reference || ''} onChange={event => {
            const current = value.modelling[field.key];
            if (current) set({ modelling: { ...value.modelling, [field.key]: { ...current, reference: event.target.value } } });
          }} />
        </div>)}
      </div>
    </details>
  </div>;
}
