// The forms the type screens share. A series is declared the same way whether its table is imported or typed in: names,
// voltages, standards, the sizes it states once for all its specifications with the basis of each, and the parameters the
// ampacity method needs that a structure table does not have. Nothing is filled in on the person's behalf.
import { useState, type ReactNode } from 'react';
import type { GivenParameter, LibraryVocabulary, SeriesDeclaration } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Disclosure } from '@/kit/disclosure';
import { cn } from '@/lib/utils';
import { STRUCTURE_GROUPS } from './model';

export const EMPTY_DECLARATION: SeriesDeclaration = { name: '', manufacturer: '', designation: '', cores: 3, u0_v: 0, u_v: 0, standards: [], common: {}, common_basis: {}, modelling: {}, origin: 'factory' };

/** The value standing for "none of these" in a Select, which has no empty choice of its own. */
const NONE = '__none__';

/** A choice among a few named options, with the control the design's Select gives. An empty value is the "none" option. */
export function Pick({ label, value, options, onValueChange, className }: {
  label: string; value: string; options: { value: string; label: string }[]; onValueChange: (value: string) => void; className?: string;
}) {
  const items = options.map(option => ({ value: option.value === '' ? NONE : option.value, label: option.label }));
  return <Select value={value === '' ? NONE : value} items={items} onValueChange={next => { if (next !== null) onValueChange(next === NONE ? '' : String(next)); }}>
    <SelectTrigger aria-label={label} className={cn('h-9 w-full', className)}><SelectValue /></SelectTrigger>
    <SelectContent>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
  </Select>;
}

/** A name over its control. */
export function Labelled({ label, htmlFor, children, className }: { label: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return <div className={cn('flex min-w-0 flex-col gap-1', className)}>
    <Label htmlFor={htmlFor} className="text-sm text-ink-2">{label}</Label>
    {children}
  </div>;
}

/** A name and its unit on the left, its controls on the right: the row of every form that fills in numbers with their basis. */
export function FieldRow({ label, unit, htmlFor, top, children }: { label: ReactNode; unit?: string; htmlFor?: string; top?: boolean; children: ReactNode }) {
  return <div className={cn('flex gap-3', top ? 'items-start' : 'items-center')}>
    <Label htmlFor={htmlFor} className={cn('w-56 shrink-0 text-sm text-ink', top && 'pt-2')}>{label}{unit && <span className="ml-2 text-ink-2">{unit}</span>}</Label>
    <div className="flex min-w-0 flex-1 gap-2">{children}</div>
  </div>;
}

/** A number the person typed, as the number it is; an empty box is no number. */
export const numberOf = (text: string): number | undefined => (text.trim() === '' || !Number.isFinite(Number(text)) ? undefined : Number(text));

export function DeclarationForm({ value, onChange, vocabulary, taken, lead }: {
  value: SeriesDeclaration;
  onChange: (value: SeriesDeclaration) => void;
  vocabulary: LibraryVocabulary | undefined;
  /** Fields a structure table already gives, so they are not declared again. */
  taken?: ReadonlySet<string>;
  /** Fixed first line, e.g. where the declaration came from. */
  lead?: ReactNode;
}) {
  const [part, setPart] = useState(STRUCTURE_GROUPS[0].id);
  const set = (values: Partial<SeriesDeclaration>) => onChange({ ...value, ...values });
  const group = STRUCTURE_GROUPS.find(item => item.id === part)!;
  const declared = (vocabulary?.fields ?? []).filter(field => !['area', 'weight'].includes(field.key) && !taken?.has(field.key) && group.keys.includes(field.key));
  const mapped = (vocabulary?.fields ?? []).filter(field => taken?.has(field.key) && group.keys.includes(field.key));
  const common = (key: string, text: string) => {
    const next = { ...value.common };
    const number = numberOf(text);
    if (number !== undefined) next[key] = number; else delete next[key];
    set({ common: next });
  };
  const modelled = (key: string, unit: string, text: string, reference?: string) => {
    const next = { ...value.modelling };
    if (text === '' && reference === undefined) delete next[key];
    else next[key] = { value: /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(text) ? Number(text) : text, unit, reference: reference ?? next[key]?.reference ?? '' } as GivenParameter;
    set({ modelling: next });
  };
  return <div className="flex flex-col gap-6">
    {lead}
    <div className="grid grid-cols-3 gap-4">
      <Labelled label="系列名称" htmlFor="declare-name"><Input id="declare-name" aria-label="系列名称" required maxLength={80} value={value.name} onChange={event => set({ name: event.target.value })} /></Labelled>
      <Labelled label="制造商" htmlFor="declare-manufacturer"><Input id="declare-manufacturer" aria-label="制造商" maxLength={80} value={value.manufacturer} onChange={event => set({ manufacturer: event.target.value })} /></Labelled>
      <Labelled label="型号" htmlFor="declare-designation"><Input id="declare-designation" aria-label="型号" required maxLength={40} value={value.designation} onChange={event => set({ designation: event.target.value })} /></Labelled>
      <Labelled label="额定相电压 U0 / kV" htmlFor="declare-u0"><Input id="declare-u0" aria-label="额定相电压 kV" required type="number" min="0.001" step="any" value={value.u0_v ? value.u0_v / 1000 : ''} onChange={event => set({ u0_v: (numberOf(event.target.value) ?? 0) * 1000 })} /></Labelled>
      <Labelled label="额定线电压 U / kV" htmlFor="declare-u"><Input id="declare-u" aria-label="额定线电压 kV" required type="number" min="0.001" step="any" value={value.u_v ? value.u_v / 1000 : ''} onChange={event => set({ u_v: (numberOf(event.target.value) ?? 0) * 1000 })} /></Labelled>
      <Labelled label="芯数"><Pick label="芯数" value={String(value.cores)} onValueChange={next => set({ cores: Number(next) as 1 | 3 })} options={[{ value: '1', label: '单芯' }, { value: '3', label: '三芯' }]} /></Labelled>
      <Labelled label="数据身份"><Pick label="数据身份" value={value.origin ?? 'factory'} onValueChange={next => set({ origin: next as 'factory' | 'public' })}
        options={[{ value: 'factory', label: '本厂结构表' }, { value: 'public', label: '公开厂家资料' }]} /></Labelled>
      <Labelled label="铠装材料类别"><Pick label="铠装材料类别" value={value.armour_material ?? ''} onValueChange={next => { const copy = { ...value }; if (next) copy.armour_material = next; else delete copy.armour_material; onChange(copy); }}
        options={[{ value: '', label: '未声明' }, { value: 'steel_galvanized', label: '镀锌钢' }, { value: 'steel_stainless_nonmagnetic', label: '非磁性不锈钢' }]} /></Labelled>
    </div>
    <Labelled label="执行标准（每行一项，写到年号）" htmlFor="declare-standards">
      <Textarea id="declare-standards" aria-label="执行标准" required value={value.standards.join('\n')} onChange={event => set({ standards: event.target.value.split('\n') })}
        onBlur={() => set({ standards: value.standards.map(item => item.trim()).filter(Boolean) })} />
    </Labelled>

    <section className="flex flex-col gap-3">
      <h3 className="m-0 text-h3 text-ink">全系列统一的尺寸</h3>
      <ToggleGroup value={[part]} onValueChange={next => { if (next[0]) setPart(next[0]); }} aria-label="选择部位" className="flex-wrap">
        {STRUCTURE_GROUPS.map(item => <ToggleGroupItem key={item.id} value={item.id}>{item.label}</ToggleGroupItem>)}
      </ToggleGroup>
      {mapped.length > 0 && <p className="m-0 text-sm text-ink">原表已有：{mapped.map(field => field.label).join('、')}。</p>}
      {declared.length === 0 && <p className="m-0 text-sm text-ink">{mapped.length > 0 ? '这一部位的尺寸都由结构表给出，不用再声明。' : '这一部位没有要声明的尺寸。'}</p>}
      {declared.map(field => <FieldRow key={field.key} label={field.label} unit={field.unit} htmlFor={`common-${field.key}`}>
        <Input id={`common-${field.key}`} aria-label={`声明${field.label}`} className="w-32 shrink-0" type="number" min="0.000001" step="any" placeholder="未声明"
          value={value.common[field.key] ?? ''} onChange={event => common(field.key, event.target.value)} />
        <Input aria-label={`${field.label}依据`} placeholder="取值依据，如原表注释、标准条款" required={value.common[field.key] !== undefined}
          value={value.common_basis[field.key] ?? ''} onChange={event => set({ common_basis: { ...value.common_basis, [field.key]: event.target.value } })} />
      </FieldRow>)}
    </section>

    <Disclosure title="计算参数与参考取值" className="-mx-4 border-b-0">
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div><Button type="button" variant="outline" size="sm" onClick={() => set({ modelling: vocabulary?.reference_modelling ?? {} })}>填入标准参考值，供逐项核对</Button></div>
        {vocabulary?.modelling.map(field => <FieldRow key={field.key} top label={field.label} unit={field.unit} htmlFor={`model-${field.key}`}>
          <Input id={`model-${field.key}`} aria-label={`参数${field.label}`} className="w-32 shrink-0" value={value.modelling[field.key]?.value ?? ''} onChange={event => modelled(field.key, field.unit, event.target.value)} />
          <Textarea aria-label={`${field.label}参数依据`} className="min-h-9" placeholder="取值依据" required={Boolean(value.modelling[field.key])} value={value.modelling[field.key]?.reference ?? ''}
            onChange={event => { if (value.modelling[field.key]) modelled(field.key, field.unit, String(value.modelling[field.key].value), event.target.value); }} />
        </FieldRow>)}
      </div>
    </Disclosure>
  </div>;
}

/** The structure of one size, field by field with the basis of each: the part picks which fields show. */
export function StructureFields({ vocabulary, values, basis, onValues, onBasis, taken }: {
  vocabulary: LibraryVocabulary | undefined;
  values: Record<string, string>;
  basis: Record<string, string>;
  onValues: (values: Record<string, string>) => void;
  onBasis: (basis: Record<string, string>) => void;
  /** Fields the series states once for every size; a size need not repeat them. */
  taken?: ReadonlySet<string>;
}) {
  const [part, setPart] = useState(STRUCTURE_GROUPS[0].id);
  const group = STRUCTURE_GROUPS.find(item => item.id === part)!;
  const fields = (vocabulary?.fields ?? []).filter(field => group.keys.includes(field.key));
  return <div className="flex flex-col gap-3">
    <ToggleGroup value={[part]} onValueChange={next => { if (next[0]) setPart(next[0]); }} aria-label="选择部位" className="flex-wrap">
      {STRUCTURE_GROUPS.map(item => <ToggleGroupItem key={item.id} value={item.id}>{item.label}</ToggleGroupItem>)}
    </ToggleGroup>
    {fields.map(field => <FieldRow key={field.key} label={field.label} unit={field.unit} htmlFor={`value-${field.key}`}>
      <Input id={`value-${field.key}`} aria-label={field.key === 'area' ? '标称截面' : `填写${field.label}`} className="w-32 shrink-0" type="number" min="0.000001" step="any" required={field.key === 'area'}
        placeholder={taken?.has(field.key) ? '取系列声明' : '未填'} value={values[field.key] ?? ''} onChange={event => onValues({ ...values, [field.key]: event.target.value })} />
      <Input aria-label={`${field.label}依据`} placeholder="取值依据，如图纸号、标准条款" value={basis[field.key] ?? ''} onChange={event => onBasis({ ...basis, [field.key]: event.target.value })} />
    </FieldRow>)}
  </div>;
}
