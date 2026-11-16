// What is given, in one line above the drawing: the cable, the laying and the conditions, the way the method states them.
// Each given opens the editor of that value under it; a value that is not what the shown result was computed from carries a
// dot. The cable, which is chosen from a table, opens a dialog.
import { useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Given, PremiseStrip } from '@/kit/workbench/premise';
import { useLibrary } from '@/state/queries';
import { BONDING_NAMES, compact, EDDY_NAMES } from '@shared/format';
import type { ProjectView, RunRecord } from '@shared/types';
import { same, type Edit, type WriteOp } from './edit';
import { ChoiceField, FormDialog, NumberField, parseNumber, PopoverForm, textOf, useApply, useTexts } from './fields';
import { ModelTable } from './models';

export type GivenKey = 'cable' | 'layout' | 'depth' | 'soil' | 'ambient' | 'load' | 'system' | 'sheath' | 'method';

/** The method's parameters as they were in force: the ones the engineer set, and the library's declared values for the rest. */
const inForce = (resolved: Record<string, unknown> | null | undefined, kept: Record<string, unknown>) => {
  const source = resolved ?? kept;
  return { ks: source.ks, kp: source.kp, eddy: source.eddy };
};

/** The givens whose value now is not the one the shown record was computed from. */
export function changedGivens(view: ProjectView, record: RunRecord | undefined): Set<GivenKey> {
  const changed = new Set<GivenKey>();
  if (!record) return changed;
  const [now, then] = [view.parts, record.inputs];
  const differ = (key: GivenKey, a: unknown, b: unknown) => { if (!same(a, b)) changed.add(key); };
  differ('cable', [now.cable.id, now.cable.content_sha256], [then.cable.id, then.cable.content_sha256]);
  differ('layout', now.installation.layout, then.installation.layout);
  differ('depth', [now.installation.depth_m, now.installation.spacing_m, now.installation.duct, now.installation.backfill],
    [then.installation.depth_m, then.installation.spacing_m, then.installation.duct, then.installation.backfill]);
  differ('soil', now.conditions.soil_thermal_resistivity, then.conditions.soil_thermal_resistivity);
  differ('ambient', now.conditions.ambient_temperature_c, then.conditions.ambient_temperature_c);
  differ('load', now.conditions.currents_a, then.conditions.currents_a);
  differ('system', [now.conditions.system_voltage_v, now.conditions.frequency_hz], [then.conditions.system_voltage_v, then.conditions.frequency_hz]);
  const [forceNow, forceThen] = [inForce(view.preview?.parameters, now.method.parameters), inForce(record.parameters, then.method.parameters)];
  differ('sheath', [now.installation.bonding, forceNow.eddy], [then.installation.bonding, forceThen.eddy]);
  differ('method', [now.method.method, forceNow.ks, forceNow.kp], [then.method.method, forceThen.ks, forceThen.kp]);
  return changed;
}

interface EditorProps { view: ProjectView; onEdit: Edit; onClose: () => void }

const positive = (value: number | null): value is number => value !== null && Number.isFinite(value) && value > 0;

// ---- The editors ----

function CableEditor({ view, onEdit, onClose }: EditorProps) {
  const library = useLibrary();
  const [pick, setPick] = useState(view.parts.cable.id);
  const { busy, error, run } = useApply(onClose);
  return <FormDialog title="换一种电缆" description="换型号后，埋深、土壤和负荷保留；芯数不同的，敷设方式改用新型号的起始方式。" wide busy={busy} error={error} onClose={onClose}
    onSubmit={() => void run(pick === view.parts.cable.id ? [] : [() => onEdit('cable.set', { model_id: pick })])}>
    <div className="flex h-96 min-h-0 flex-col overflow-hidden rounded-field border border-line">
      <ModelTable entries={library.data ?? []} selected={pick} onSelect={entry => setPick(entry.id)} />
    </div>
  </FormDialog>;
}

function LayoutEditor({ view, onEdit, onClose }: EditorProps) {
  const [layout, setLayout] = useState(view.parts.installation.layout);
  const { busy, error, run } = useApply(onClose);
  return <PopoverForm title="敷设方式" description="换方式后，中心距、管径和回填尺寸按新方式的默认值起步；埋深保留。" busy={busy} error={error} onClose={onClose}
    onSubmit={() => void run(layout === view.parts.installation.layout ? [] : [() => onEdit('installation.set', { layout })])}>
    <ToggleGroup orientation="vertical" aria-label="敷设方式" value={[layout]} onValueChange={next => { if (next[0]) setLayout(next[0]); }}>
      {view.layouts.map(option => <ToggleGroupItem key={option.kind} value={option.kind} className="justify-start">
        {option.label}<span className="ml-auto text-ink-2">{option.circuits} 回</span>
      </ToggleGroupItem>)}
    </ToggleGroup>
  </PopoverForm>;
}

function DepthEditor({ view, onEdit, onClose }: EditorProps) {
  const { installation } = view.parts;
  const resolved = view.preview?.layout.spacing ?? null;
  // The spacing stays here while the laying has one, also when the value set is one the method refuses and nothing is drawn.
  const hasSpacing = resolved !== null || installation.spacing_m !== null;
  const { busy, error, setError, run } = useApply(onClose);
  const { texts, set, changed } = useTexts({
    depth: textOf(installation.depth_m),
    spacing: textOf(installation.spacing_m === null ? null : installation.spacing_m * 1000),
    inner: textOf(installation.duct ? installation.duct.inner_diameter_m * 1000 : null),
    outer: textOf(installation.duct ? installation.duct.outer_diameter_m * 1000 : null),
    width: textOf(installation.backfill?.width),
    height: textOf(installation.backfill?.height),
    rho: textOf(installation.backfill?.thermal_resistivity),
  });
  const submit = () => {
    const patch: Record<string, unknown> = {};
    const problems: string[] = [];
    const read = (key: keyof typeof texts, label: string): number | null => {
      const value = parseNumber(texts[key]);
      if (!positive(value)) problems.push(label);
      return positive(value) ? value : null;
    };
    if (changed('depth')) {
      const depth = read('depth', '中心埋深');
      if (depth !== null) patch.depth_m = depth;
    }
    if (changed('spacing')) {
      if (texts.spacing.trim() === '') patch.spacing_m = null;
      else {
        const spacing = read('spacing', '中心距');
        if (spacing !== null) patch.spacing_m = spacing / 1000;
      }
    }
    if (installation.duct && (changed('inner') || changed('outer'))) {
      const [inner, outer] = [read('inner', '管内径'), read('outer', '管外径')];
      if (inner !== null && outer !== null) patch.duct = { ...installation.duct, inner_diameter_m: inner / 1000, outer_diameter_m: outer / 1000 };
    }
    if (installation.backfill && (changed('width') || changed('height') || changed('rho'))) {
      const next: Record<string, number> = {};
      for (const [key, field, label] of [['width', 'width', '回填宽度'], ['height', 'height', '回填高度'], ['rho', 'thermal_resistivity', '回填热阻率']] as const) {
        if (texts[key].trim() === '') continue;
        const value = read(key, label);
        if (value !== null) next[field] = value;
      }
      patch.backfill = { ...installation.backfill, ...next };
    }
    if (problems.length) return setError(`${problems.join('、')}要填大于 0 的数。`);
    void run(Object.keys(patch).length ? [() => onEdit('installation.set', patch)] : []);
  };
  return <PopoverForm title="埋深与尺寸" description="电缆组中心到地表的距离，以及这种敷设的间距、管径和回填尺寸。" busy={busy} error={error} onClose={onClose} onSubmit={submit}>
    <div className="grid grid-cols-2 gap-3">
      <NumberField autoFocus label="中心埋深" unit="m" value={texts.depth} onChange={set('depth')} />
      {hasSpacing && <NumberField label="中心距" unit="mm" value={texts.spacing} onChange={set('spacing')} placeholder={resolved === null ? '默认' : `默认 ${compact(resolved * 1000)}`} />}
      {installation.duct && <>
        <NumberField label="管内径" unit="mm" value={texts.inner} onChange={set('inner')} />
        <NumberField label="管外径" unit="mm" value={texts.outer} onChange={set('outer')} />
      </>}
      {installation.backfill && <>
        <NumberField label="回填宽度" unit="m" value={texts.width} onChange={set('width')} />
        <NumberField label="回填高度" unit="m" value={texts.height} onChange={set('height')} />
        <NumberField label="回填热阻率" unit="K·m/W" value={texts.rho} onChange={set('rho')} />
      </>}
    </div>
  </PopoverForm>;
}

/** One number, one unit, one rule: soil resistivity and ambient temperature. */
function NumberEditor({ title, description, label, unit, initial, check, make, onEdit, onClose }: {
  title: string;
  description?: string;
  label: string;
  unit: string;
  initial: number;
  check: (value: number) => string | null;
  make: (value: number) => [WriteOp, Record<string, unknown>];
  onEdit: Edit;
  onClose: () => void;
}) {
  const [text, setText] = useState(textOf(initial));
  const { busy, error, setError, run } = useApply(onClose);
  const submit = () => {
    const value = parseNumber(text);
    if (value === null || !Number.isFinite(value)) return setError(`${label}要填数字。`);
    const refusal = check(value);
    if (refusal) return setError(refusal);
    // What was typed against what was shown: a value the field rounded for display is not a change.
    void run(text === textOf(initial) ? [] : [() => onEdit(...make(value))]);
  };
  return <PopoverForm title={title} description={description} busy={busy} error={error} onClose={onClose} onSubmit={submit}>
    <NumberField autoFocus label={label} unit={unit} value={text} onChange={setText} />
  </PopoverForm>;
}

function LoadEditor({ view, onEdit, onClose }: EditorProps) {
  const currents = view.parts.conditions.currents_a;
  const circuits = view.preview?.circuit_count ?? currents.length;
  const alike = currents.every(value => value === currents[0]);
  const [texts, setTexts] = useState(alike ? [textOf(currents[0])] : currents.map(value => textOf(value)));
  const { busy, error, setError, run } = useApply(onClose);
  const submit = () => {
    const values = texts.map(parseNumber);
    if (values.some(value => value === null || !Number.isFinite(value) || value < 0)) return setError('负荷电流要填不小于 0 的数。');
    const next = values as number[];
    if (alike ? texts[0] === textOf(currents[0]) : texts.every((text, index) => text === textOf(currents[index]))) return void run([]);
    void run([() => onEdit('conditions.set', alike ? { current_a: next[0] } : { currents_a: next })]);
  };
  return <PopoverForm title="负荷电流" description="各回路带的电流，用来对照允许电流。" busy={busy} error={error} onClose={onClose} onSubmit={submit}>
    <div className="grid grid-cols-2 gap-3">
      {alike
        ? <NumberField autoFocus label={circuits > 1 ? '每回负荷电流' : '负荷电流'} unit="A" value={texts[0]} onChange={text => setTexts([text])} />
        : texts.map((text, index) => <NumberField key={index} autoFocus={index === 0} label={`回路 ${index + 1} 负荷电流`} unit="A" value={text}
          onChange={next => setTexts(list => list.map((item, at) => (at === index ? next : item)))} />)}
    </div>
  </PopoverForm>;
}

function SystemEditor({ view, onEdit, onClose }: EditorProps) {
  const { conditions } = view.parts;
  const { busy, error, setError, run } = useApply(onClose);
  const { texts, set, changed } = useTexts({ voltage: textOf(conditions.system_voltage_v === null ? null : conditions.system_voltage_v / 1000), frequency: textOf(conditions.frequency_hz) });
  const submit = () => {
    const patch: Record<string, unknown> = {};
    if (changed('voltage')) {
      const voltage = parseNumber(texts.voltage);
      if (voltage !== null && !positive(voltage)) return setError('系统线电压要填大于 0 的数，或留空。');
      patch.system_voltage_v = voltage === null ? null : voltage * 1000;
    }
    if (changed('frequency')) {
      const frequency = parseNumber(texts.frequency);
      if (!positive(frequency)) return setError('频率要填大于 0 的数。');
      patch.frequency_hz = frequency;
    }
    void run(Object.keys(patch).length ? [() => onEdit('conditions.set', patch)] : []);
  };
  return <PopoverForm title="系统" description="介质损耗和交流电阻按系统线电压和频率算。" busy={busy} error={error} onClose={onClose} onSubmit={submit}>
    <div className="grid grid-cols-2 gap-3">
      <NumberField autoFocus label="系统线电压" unit="kV" value={texts.voltage} onChange={set('voltage')} />
      <NumberField label="频率" unit="Hz" value={texts.frequency} onChange={set('frequency')} />
    </div>
  </PopoverForm>;
}

function SheathEditor({ view, onEdit, onClose }: EditorProps) {
  const eddyNow = ((view.preview?.parameters ?? view.parts.method.parameters) as { eddy?: string }).eddy === 'trefoil' ? 'trefoil' : 'ignored';
  const [bonding, setBonding] = useState<string>(view.parts.installation.bonding);
  const [eddy, setEddy] = useState<string>(eddyNow);
  const { busy, error, run } = useApply(onClose);
  const steps = [
    ...(bonding !== view.parts.installation.bonding ? [() => onEdit('installation.set', { bonding })] : []),
    ...(eddy !== eddyNow ? [() => onEdit('method.set', { eddy })] : []),
  ];
  return <PopoverForm title="护套" description="金属护套怎么接地，以及要不要把护套涡流损耗算进去。" busy={busy} error={error} onClose={onClose} onSubmit={() => void run(steps)}>
    <ChoiceField label="护套接地">
      <ToggleGroup aria-label="护套接地" value={[bonding]} onValueChange={next => { if (next[0]) setBonding(next[0]); }}>
        {Object.entries(BONDING_NAMES).map(([value, label]) => <ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>)}
      </ToggleGroup>
    </ChoiceField>
    <ChoiceField label="护套涡流损耗">
      <ToggleGroup aria-label="护套涡流损耗" value={[eddy]} onValueChange={next => { if (next[0]) setEddy(next[0]); }}>
        {Object.entries(EDDY_NAMES).map(([value, label]) => <ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>)}
      </ToggleGroup>
    </ChoiceField>
  </PopoverForm>;
}

function MethodEditor({ view, onEdit, onClose }: EditorProps) {
  const parameters = (view.preview?.parameters ?? view.parts.method.parameters) as { ks?: number; kp?: number };
  const { busy, error, setError, run } = useApply(onClose);
  const { texts, set, changed } = useTexts({ ks: textOf(parameters.ks), kp: textOf(parameters.kp) });
  const submit = () => {
    const patch: Record<string, number> = {};
    for (const [key, label] of [['ks', '集肤效应系数 ks'], ['kp', '邻近效应系数 kp']] as const) {
      if (!changed(key)) continue;
      const value = parseNumber(texts[key]);
      if (!positive(value) || value > 1) return setError(`${label}要在 0 到 1 之间。`);
      patch[key] = value;
    }
    void run(Object.keys(patch).length ? [() => onEdit('method.set', patch)] : []);
  };
  return <PopoverForm title="IEC 60287 稳态" description="方法参数：不改就用型号库里声明的值。" busy={busy} error={error} onClose={onClose} onSubmit={submit}>
    <div className="grid grid-cols-2 gap-3">
      <NumberField autoFocus label="集肤系数 ks" value={texts.ks} onChange={set('ks')} />
      <NumberField label="邻近系数 kp" value={texts.kp} onChange={set('kp')} />
    </div>
  </PopoverForm>;
}

// ---- The strip ----

export function Premise({ view, asked, changed, onEdit }: { view: ProjectView; asked: ReactNode; changed: ReadonlySet<GivenKey>; onEdit: Edit }) {
  const [open, setOpen] = useState<GivenKey | null>(null);
  const { cable, installation, conditions, method } = view.parts;
  const close = () => setOpen(null);
  const layout = view.layouts.find(option => option.kind === installation.layout)?.label ?? installation.layout;
  const circuits = view.preview?.circuit_count ?? conditions.currents_a.length;
  const alike = conditions.currents_a.every(value => value === conditions.currents_a[0]);
  const load = alike ? `${compact(conditions.currents_a[0])} A${circuits > 1 ? ` × ${circuits} 回` : ''}` : `${conditions.currents_a.map(value => compact(value)).join(' / ')} A`;
  const editor = { view, onEdit, onClose: close };
  /** A given and the editor that opens under it. */
  const name = (key: GivenKey, label: string, value: string) => `${label} ${value}${changed.has(key) ? '，已改' : ''}`;
  const given = (key: GivenKey, label: string, value: string, form: ReactNode) => <Popover open={open === key} onOpenChange={next => setOpen(next ? key : null)}>
    <PopoverTrigger render={<Given label={label} value={value} changed={changed.has(key)} aria-label={name(key, label, value)} />} />
    <PopoverContent align="start" className="w-80 gap-4 p-4">{open === key && form}</PopoverContent>
  </Popover>;
  return <>
    <PremiseStrip asked={asked}>
      <Given label="型号" value={cable.name} changed={changed.has('cable')} aria-label={name('cable', '型号', cable.name)} onClick={() => setOpen('cable')} />
      {given('layout', '敷设', layout, <LayoutEditor {...editor} />)}
      {given('depth', '埋深', `${compact(installation.depth_m)} m`, <DepthEditor {...editor} />)}
      {given('soil', '土壤热阻率', `${compact(conditions.soil_thermal_resistivity)} K·m/W`, <NumberEditor title="土壤热阻率" description="埋设处土壤的热阻率，越大散热越差。" label="土壤热阻率" unit="K·m/W"
        initial={conditions.soil_thermal_resistivity} check={value => (value > 0 ? null : '土壤热阻率要大于 0。')} make={value => ['conditions.set', { soil_thermal_resistivity: value }]} onEdit={onEdit} onClose={close} />)}
      {given('ambient', '环境', `${compact(conditions.ambient_temperature_c)} °C`, <NumberEditor title="环境温度" description="地表（环境）温度。" label="环境温度" unit="°C"
        initial={conditions.ambient_temperature_c} check={value => (value >= -50 && value <= 80 ? null : '环境温度要在 −50 到 80 °C 之间。')} make={value => ['conditions.set', { ambient_temperature_c: value }]} onEdit={onEdit} onClose={close} />)}
      {given('load', '负荷', load, <LoadEditor {...editor} />)}
      {given('system', '系统', `${conditions.system_voltage_v === null ? '' : `${compact(conditions.system_voltage_v / 1000)} kV · `}${compact(conditions.frequency_hz)} Hz`, <SystemEditor {...editor} />)}
      {given('sheath', '护套', BONDING_NAMES[installation.bonding], <SheathEditor {...editor} />)}
      {given('method', '方法', method.method === 'iec60287.steady' ? 'IEC 60287 稳态' : method.method, <MethodEditor {...editor} />)}
    </PremiseStrip>
    {open === 'cable' && <CableEditor {...editor} />}
  </>;
}
