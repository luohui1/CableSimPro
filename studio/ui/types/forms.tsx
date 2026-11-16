// The forms the type screens share. A series is declared the same way whether its table is imported or typed in: names,
// voltages, standards, the sizes it states once for all its specifications with the basis of each, and the parameters the
// ampacity method needs that a structure table does not have. Nothing is filled in on the person's behalf.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { DesignationParts, LibraryVocabulary, SeriesDeclaration } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Disclosure } from '@/kit/disclosure';
import { Icon } from '@/kit/icon';
import { ChoiceSelect, FormRow, FormSection, Segmented, SourceTag, UnitInput } from '@/kit/workbench/form';
import { api } from '@/state/api';
import { STRUCTURE_GROUPS } from './model';

export const EMPTY_DECLARATION: SeriesDeclaration = { name: '', manufacturer: '', designation: '', cores: 3, u0_v: 0, u_v: 0, standards: [], common: {}, common_basis: {}, modelling: {}, origin: 'factory' };

/** The value standing for "none of these" in a select, which has no empty choice of its own. */
const NONE = '__none__';

/** A choice among a few named options; an empty value is the "none" option. */
export function Pick({ label, value, options, onValueChange, size }: {
  label: string; value: string; options: { value: string; label: string }[]; onValueChange: (value: string) => void; size?: 'sm' | 'default';
}) {
  return <ChoiceSelect label={label} size={size} value={value === '' ? NONE : value} options={options.map(option => ({ value: option.value === '' ? NONE : option.value, label: option.label }))}
    onValueChange={next => onValueChange(next === NONE ? '' : next)} />;
}

/** What a declaration still lacks before anything can be built from it: the basis of each size it states, the reference of each parameter it gives. */
export function lacking(declaration: SeriesDeclaration, vocabulary: LibraryVocabulary | undefined): string[] {
  const named = (key: string, list: { key: string; label: string }[] | undefined) => list?.find(item => item.key === key)?.label ?? key;
  return [
    ...Object.keys(declaration.common).filter(key => !declaration.common_basis[key]?.trim()).map(key => named(key, vocabulary?.fields)),
    ...Object.entries(declaration.modelling).filter(([, item]) => !String(item.reference ?? '').trim()).map(([key]) => named(key, vocabulary?.modelling)),
  ];
}

/** A voltage in kV in a field whose value the form keeps in volts. */
export function KilovoltInput({ label, prefix, volts, onChange }: { label: string; prefix: string; volts: number | null | undefined; onChange: (volts: number) => void }) {
  return <UnitInput aria-label={label} prefix={prefix} unit="kV" value={volts ? volts / 1000 : null} onValueChange={next => onChange(Math.round((next ?? 0) * 1000000) / 1000)} />;
}

const CORE_OPTIONS = [{ value: '1', label: '单芯' }, { value: '3', label: '三芯' }];
const ORIGINS = [{ value: 'factory', label: '本厂结构表' }, { value: 'public', label: '公开厂家资料' }];
const ARMOURS = [{ value: '', label: '未声明' }, { value: 'steel_galvanized', label: '镀锌钢' }, { value: 'steel_stainless_nonmagnetic', label: '非磁性不锈钢' }];

/** The standards of a series as the labels they are written on, with the way to add one and to take one away. */
function Standards({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => { const text = draft.trim(); if (text && !value.includes(text)) onChange([...value, text]); setDraft(''); };
  return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2">
      {value.map(standard => <span key={standard} className="flex items-center gap-1">
        <Badge variant="outline">{standard}</Badge>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`去掉 ${standard}`} onClick={() => onChange(value.filter(item => item !== standard))}><Icon name="action/close" /></Button>
      </span>)}
      {value.length === 0 && <span className="text-sm text-ink-2">还没有写执行标准</span>}
    </div>
    <div className="flex gap-2">
      <Input aria-label="添加执行标准" placeholder="写到年号，如 GB/T 12706.2-2020" value={draft} onChange={event => setDraft(event.target.value)} onBlur={add}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} />
      <Button type="button" variant="outline" disabled={!draft.trim()} onClick={add}><Icon name="action/add" data-icon="inline-start" />添加</Button>
    </div>
  </div>;
}

/** What a designation says, as the host reads it: the cable it names, in words. Nothing is shown for one it cannot read yet. */
export function useDesignation(text: string) {
  const trimmed = text.trim();
  return useQuery({ queryKey: ['library', 'designation', trimmed], enabled: trimmed.length >= 2, retry: false, staleTime: Infinity,
    queryFn: () => api.op<DesignationParts>('library.designation', { text: trimmed }) });
}

/** What names a series: the same fields wherever a series is made, the designation's own meaning under it once it is read. */
export function SeriesFields({ value, onChange, idPrefix }: {
  value: SeriesDeclaration; onChange: (value: SeriesDeclaration) => void; idPrefix: string;
}) {
  const set = (values: Partial<SeriesDeclaration>) => onChange({ ...value, ...values });
  const hint = useDesignation(value.designation).data?.description;
  return <>
    <FormRow label="系列名称" htmlFor={`${idPrefix}-name`}><Input id={`${idPrefix}-name`} aria-label="系列名称" required maxLength={80} value={value.name} onChange={event => set({ name: event.target.value })} /></FormRow>
    <FormRow label="制造商" htmlFor={`${idPrefix}-maker`}><Input id={`${idPrefix}-maker`} aria-label="制造商" maxLength={80} value={value.manufacturer} onChange={event => set({ manufacturer: event.target.value })} /></FormRow>
    <FormRow label="型号" htmlFor={`${idPrefix}-designation`} hint={hint}>
      <Input id={`${idPrefix}-designation`} aria-label="型号" required maxLength={40} className="w-48" value={value.designation} onChange={event => set({ designation: event.target.value })} />
    </FormRow>
    <FormRow label="芯数"><Segmented label="芯数" value={String(value.cores)} options={CORE_OPTIONS} onValueChange={next => set({ cores: Number(next) as 1 | 3 })} /></FormRow>
    <FormRow label="电压">
      <div className="grid grid-cols-3 gap-2">
        <KilovoltInput label="额定相电压 kV" prefix="U₀" volts={value.u0_v} onChange={volts => set({ u0_v: volts })} />
        <KilovoltInput label="额定线电压 kV" prefix="U" volts={value.u_v} onChange={volts => set({ u_v: volts })} />
        <KilovoltInput label="系统最高电压 kV" prefix="Um" volts={value.um_v} onChange={volts => { const copy = { ...value }; if (volts) copy.um_v = volts; else delete copy.um_v; onChange(copy); }} />
      </div>
    </FormRow>
    <FormRow label="执行标准"><Standards value={value.standards} onChange={standards => set({ standards })} /></FormRow>
    <FormRow label="数据身份"><Pick label="数据身份" value={value.origin ?? 'factory'} options={ORIGINS} onValueChange={next => set({ origin: next as 'factory' | 'public' })} /></FormRow>
    <FormRow label="铠装材料类别"><Pick label="铠装材料类别" value={value.armour_material ?? ''} options={ARMOURS}
      onValueChange={next => { const copy = { ...value }; if (next) copy.armour_material = next; else delete copy.armour_material; onChange(copy); }} /></FormRow>
  </>;
}

/**
 * What a series states once for all its sizes: the dimensions its table does not give, each with the basis of its value, and the
 * parameters the ampacity method needs that a table never has. A field the table already gives is not asked again.
 */
export function CommonSizes({ value, onChange, vocabulary, taken }: {
  value: SeriesDeclaration;
  onChange: (value: SeriesDeclaration) => void;
  vocabulary: LibraryVocabulary | undefined;
  /** Fields a structure table already gives, so they are not declared again. */
  taken?: ReadonlySet<string>;
}) {
  const [part, setPart] = useState(STRUCTURE_GROUPS[0].id);
  const set = (values: Partial<SeriesDeclaration>) => onChange({ ...value, ...values });
  const group = STRUCTURE_GROUPS.find(item => item.id === part)!;
  const declared = (vocabulary?.fields ?? []).filter(field => !['area', 'weight'].includes(field.key) && !taken?.has(field.key) && group.keys.includes(field.key));
  const mapped = (vocabulary?.fields ?? []).filter(field => taken?.has(field.key) && group.keys.includes(field.key));
  const common = (key: string, number: number | null) => {
    const next = { ...value.common };
    if (number !== null && number > 0) next[key] = number; else delete next[key];
    set({ common: next });
  };
  const modelled = (key: string, unit: string, text: string, reference?: string) => {
    const next = { ...value.modelling };
    if (text === '' && reference === undefined) delete next[key];
    else next[key] = { value: /^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(text) ? Number(text) : text, unit, reference: reference ?? next[key]?.reference ?? '' };
    set({ modelling: next });
  };
  return <>
    <FormSection title="表里没有、另行取值" description="结构表没列的尺寸，取值和依据记进每个规格；原表已有的不用再写。"
      aside={<Segmented label="选择部位" value={part} options={STRUCTURE_GROUPS.map(item => ({ value: item.id, label: item.label }))} onValueChange={setPart} />}>
      {mapped.length > 0 && <p className="m-0 text-sm text-ink-2">原表已有：{mapped.map(field => field.label).join('、')}。</p>}
      {declared.length === 0 && <p className="m-0 text-sm text-ink-2">{mapped.length > 0 ? '这一部位的尺寸都由结构表给出，不用再声明。' : '这一部位没有要声明的尺寸。'}</p>}
      {declared.map(field => <FormRow key={field.key} label={field.label} htmlFor={`common-${field.key}`}>
        <div className="flex flex-col gap-2">
          <UnitInput id={`common-${field.key}`} aria-label={`声明${field.label}`} unit={field.unit} placeholder="未声明" className="w-48" min={0}
            value={value.common[field.key] ?? null} onValueChange={number => common(field.key, number)} />
          <Input aria-label={`${field.label}依据`} placeholder="取值依据，如原表注释、标准条款" required={value.common[field.key] !== undefined}
            value={value.common_basis[field.key] ?? ''} onChange={event => set({ common_basis: { ...value.common_basis, [field.key]: event.target.value } })} />
        </div>
      </FormRow>)}
    </FormSection>
    <Disclosure title="计算参数与参考取值" className="-mx-4 border-b-0">
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div><Button type="button" variant="outline" size="sm" onClick={() => set({ modelling: vocabulary?.reference_modelling ?? {} })}>填入标准参考值，供逐项核对</Button></div>
        {vocabulary?.modelling.map(field => <FormRow key={field.key} wide label={`${field.label} ${field.unit}`} htmlFor={`model-${field.key}`}>
          <div className="flex flex-col gap-2">
            <Input id={`model-${field.key}`} aria-label={`参数${field.label}`} className="w-48" value={value.modelling[field.key]?.value ?? ''} onChange={event => modelled(field.key, field.unit, event.target.value)} />
            <Textarea aria-label={`${field.label}参数依据`} className="min-h-9" placeholder="取值依据" required={Boolean(value.modelling[field.key])} value={value.modelling[field.key]?.reference ?? ''}
              onChange={event => { if (value.modelling[field.key]) modelled(field.key, field.unit, String(value.modelling[field.key].value), event.target.value); }} />
          </div>
        </FormRow>)}
      </div>
    </Disclosure>
  </>;
}

/** The structure of one size, layer by layer from the conductor out: each value with where it came from, and an optional basis. */
export const LAYER_ORDER = ['conductor_diameter', 'conductor_wire_count', 'conductor_wire_diameter', 'conductor_screen_thickness', 'insulation_thickness', 'insulation_screen_thickness',
  'screen_tape_thickness', 'screen_tape_width', 'screen_tape_overlap', 'binder_thickness', 'bedding_thickness', 'armour_tape_thickness', 'armour_tape_width',
  'armour_wire_diameter', 'armour_wire_count', 'oversheath_thickness', 'outer_diameter', 'weight', 'r20'];

export function StructureFields({ vocabulary, values, basis, onValues, onBasis, taken }: {
  vocabulary: LibraryVocabulary | undefined;
  values: Record<string, number | null>;
  basis: Record<string, string>;
  onValues: (values: Record<string, number | null>) => void;
  onBasis: (basis: Record<string, string>) => void;
  /** Fields the series states once for every size; a size need not repeat them. */
  taken?: ReadonlySet<string>;
}) {
  const fields = (vocabulary?.fields ?? []).filter(field => field.key !== 'area').sort((a, b) => LAYER_ORDER.indexOf(a.key) - LAYER_ORDER.indexOf(b.key));
  return <>
    {fields.map(field => <FormRow key={field.key} label={field.label} htmlFor={`value-${field.key}`} wide>
      <div className="flex items-center gap-3">
        <UnitInput id={`value-${field.key}`} aria-label={`填写${field.label}`} unit={field.unit} className="w-36 shrink-0" min={0} placeholder={taken?.has(field.key) ? '取系列声明' : undefined}
          value={values[field.key] ?? null} onValueChange={number => onValues({ ...values, [field.key]: number })} />
        <SourceTag kind="manual" className="shrink-0" />
        <Input aria-label={`${field.label}（本规格）依据`} placeholder="依据（可选）" className="min-w-0 flex-1" value={basis[field.key] ?? ''} onChange={event => onBasis({ ...basis, [field.key]: event.target.value })} />
      </div>
    </FormRow>)}
  </>;
}
