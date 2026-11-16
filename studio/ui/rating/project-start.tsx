// A new calculation: a size from the product library, how it is laid, the conditions; and "建好并计算" makes the project and runs
// the check. The host says what each of them starts from; the form sends only what the engineer changed, so the project begins
// as the method would. The size chosen is shown at the side, as its section and its numbers.
import { useNavigate } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { CableGlyph } from '@/canvas/cable-glyph';
import { reportFailure } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Icon, Spinner } from '@/kit/icon';
import { PropertyList } from '@/kit/properties';
import { ChoiceCards, ChoiceSelect, FormNote, FormRow, FormSection, UnitInput } from '@/kit/workbench/form';
import { PageHeader, Panel } from '@/kit/workbench/page';
import { EmptyState } from '@/kit/workbench/premise';
import { api } from '@/state/api';
import { queryClient, useLibrary } from '@/state/queries';
import { BONDING_NAMES, compact, fixed, STATE_NAMES } from '@shared/format';
import { cableShape } from '@shared/geometry';
import type { RatingStart } from '@shared/rating-types';
import type { LibraryEntry, ProjectView, RunRecord } from '@shared/types';
import { messageOf } from './messages';
import { ModelTable } from './models';
import { useStart } from './queries';

/** What the form holds for one size; numbers are null while their field is empty. */
interface Values {
  layout: string;
  bonding: string;
  depth: number | null;
  soil: number | null;
  ambient: number | null;
  current: number | null;
  /** kV */
  voltage: number | null;
  frequency: number | null;
}

/** The values the host says a project of this size starts from. */
const initial = (start: RatingStart): Values => ({
  layout: start.installation.layout,
  bonding: start.installation.bonding,
  depth: start.installation.depth_m,
  soil: start.conditions.soil_thermal_resistivity,
  ambient: start.conditions.ambient_temperature_c,
  current: start.conditions.currents_a[0] ?? null,
  voltage: start.conditions.system_voltage_v === null ? null : start.conditions.system_voltage_v / 1000,
  frequency: start.conditions.frequency_hz,
});

const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);

/** The cable in section, from the layers of its library entry. */
function SpecFigure({ entry }: { entry: LibraryEntry }) {
  const shape = cableShape(entry.payload.cable_type, entry.payload.materials);
  return <svg viewBox="0 0 100 100" className="size-full" role="img" aria-label="电缆断面">
    <CableGlyph shape={shape} x={50} y={50} scale={42 / shape.radius} />
  </svg>;
}

function Spec({ entry }: { entry: LibraryEntry | undefined }) {
  if (!entry) return <EmptyState icon="object/cable" title="还没选型号" description="从左边的表里选一个规格，它的断面和主要数字在这里。" />;
  const { summary } = entry;
  return <>
    <div className="flex flex-col gap-1 px-4 pt-4">
      <span className="text-h3 text-ink">{entry.name}</span>
      <span className="text-sm text-ink-2">{entry.family} · 第 {entry.version} 版</span>
    </div>
    <div className="mx-4 my-4 aspect-square rounded-card bg-canvas p-4"><SpecFigure entry={entry} /></div>
    <PropertyList className="px-4 pb-4" rows={[
      { label: '截面', value: `${summary.cores > 1 ? `${summary.cores}×` : ''}${compact(summary.area_mm2)}`, unit: 'mm²' },
      { label: '成品外径', value: fixed(summary.outer_diameter_m * 1000, 1), unit: 'mm' },
      { label: '额定电压 U₀/U', value: `${compact(summary.u0_v / 1000)}/${compact((summary.u_v ?? 0) / 1000)}`, unit: 'kV' },
      { label: '数据来源', value: STATE_NAMES[entry.state] ?? entry.state },
    ]} />
  </>;
}

/** `model` is the library id carried by /workbench?model=<id>: the cable the new project starts with. */
export function StartScreen({ model: asked }: { model?: string }) {
  const navigate = useNavigate();
  const library = useLibrary();
  const [model, setModel] = useState(asked);
  const start = useStart(model);
  const entries = library.data ?? [];
  // What was typed belongs to the size it was typed for: another size starts again from its own starting values.
  const [typed, setTyped] = useState<{ model: string | undefined; values: Values } | null>(null);
  const values = start.data ? (typed && typed.model === model ? typed.values : initial(start.data)) : null;
  const set = (patch: Partial<Values>) => { if (values) setTyped({ model, values: { ...values, ...patch } }); };
  // The name is the engineer's once typed; until then it is the size's own, which follows the size chosen.
  const [named, setNamed] = useState<string | null>(null);
  const name = named ?? (start.data ? `${start.data.model.name} 载流量校核` : '');
  // One project per press: a second press while the first is being made does nothing.
  const making = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leave = () => void navigate({ to: '/workbench' });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (making.current || !start.data || !values) return;
    const first = initial(start.data);
    const refusal = !name.trim() ? '工程名称不能空。'
      : !finite(values.depth) || values.depth <= 0 ? '中心埋深要填大于 0 的数。'
      : !finite(values.soil) || values.soil <= 0 ? '土壤热阻率要填大于 0 的数。'
      : !finite(values.ambient) || values.ambient < -50 || values.ambient > 80 ? '环境温度要在 −50 到 80 °C 之间。'
      : !finite(values.current) || values.current < 0 ? '负荷电流要填不小于 0 的数。'
      : values.voltage !== null && (!finite(values.voltage) || values.voltage <= 0) ? '系统线电压要填大于 0 的数，或留空。'
      : !finite(values.frequency) || values.frequency <= 0 ? '频率要填大于 0 的数。'
      : null;
    if (refusal) return setError(refusal);
    setError(null);

    // Only what differs from the host's starting point is sent: the same value again would change nothing.
    const laying: Record<string, unknown> = {
      ...(values.layout !== first.layout && { layout: values.layout }),
      ...(values.depth !== first.depth && { depth_m: values.depth }),
      ...(values.bonding !== first.bonding && { bonding: values.bonding }),
    };
    const conditions: Record<string, unknown> = {
      ...(values.soil !== first.soil && { soil_thermal_resistivity: values.soil }),
      ...(values.ambient !== first.ambient && { ambient_temperature_c: values.ambient }),
      ...(values.current !== first.current && { current_a: values.current }),
      ...(values.voltage !== first.voltage && { system_voltage_v: values.voltage === null ? null : values.voltage * 1000 }),
      ...(values.frequency !== first.frequency && { frequency_hz: values.frequency }),
    };
    making.current = true;
    setBusy(true);
    let project: string;
    try {
      project = (await api.op<ProjectView>('project.create', { name: name.trim(), model_id: start.data.model.id })).meta.id;
    } catch (failure) {
      setError(messageOf(failure));
      making.current = false;
      setBusy(false);
      return;
    }
    // The project exists. What the form changed is written next, each part on its own: a part the host refuses keeps the
    // starting values, and the notice says which part and why. The check follows either way.
    const notes: string[] = [];
    for (const [part, op, patch] of [['敷设', 'installation.set', laying], ['工况', 'conditions.set', conditions]] as const) {
      if (Object.keys(patch).length === 0) continue;
      try {
        await api.op(op, { project, ...patch });
      } catch (failure) {
        notes.push(`${part}没有按填的改：${messageOf(failure)}`);
      }
    }
    try {
      const made = await api.op<RunRecord>('run.rate', { project });
      queryClient.setQueryData(['run', project, made.id], made);
    } catch (failure) {
      notes.push(`校核没有算出结果：${messageOf(failure)}`);
    }
    if (notes.length) reportFailure(new Error(`工程已建好，但${notes.join('；')}。工程里是起始值，可以在“已知”里再改。`));
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    void navigate({ to: '/p/$projectId', params: { projectId: project }, search: {} });
  };

  const layouts = start.data?.layouts ?? [];
  let settings;
  if (!model) settings = <p className="m-0 text-sm text-ink-2">选好型号后，这里会列出它能用的敷设方式和起始条件。</p>;
  else if (start.isPending) settings = <p className="m-0 text-sm text-ink-2">正在读取这款型号的起点……</p>;
  else if (start.error) settings = <FormNote tone="attention" title="这款型号不能新建工程">{messageOf(start.error)}</FormNote>;
  else if (values) {
    settings = <>
      <FormSection title="敷设方式" description="这款电缆能用的敷设模板。选多回路或排管时，回路间距和排管尺寸按模板的默认值起步，建好后可以改。">
        <ChoiceCards label="敷设方式" columns="grid-cols-3" value={values.layout} onValueChange={layout => set({ layout })} options={layouts.map(layout => ({
          value: layout.kind, title: layout.label, icon: layout.ducted ? 'tool/duct-bank' : 'tool/place-cable',
          detail: `${layout.circuits} 个回路${layout.ducted ? ' · 排管' : ''}`,
        }))} />
        <FormRow label="埋深" htmlFor="new-depth"><UnitInput id="new-depth" unit="m" value={values.depth} onValueChange={depth => set({ depth })} className="w-48" /></FormRow>
        <FormRow label="护套接地"><div className="w-48"><ChoiceSelect label="护套接地" value={values.bonding} onValueChange={bonding => set({ bonding })}
          options={Object.entries(BONDING_NAMES).map(([value, label]) => ({ value, label }))} /></div></FormRow>
      </FormSection>
      <FormSection title="工况" description="方法从这组工况起步，建好后随时可改。">
        <FormRow label="土壤热阻率" htmlFor="new-soil"><UnitInput id="new-soil" unit="K·m/W" value={values.soil} onValueChange={soil => set({ soil })} className="w-48" /></FormRow>
        <FormRow label="环境温度" htmlFor="new-ambient"><UnitInput id="new-ambient" unit="°C" value={values.ambient} onValueChange={ambient => set({ ambient })} className="w-48" /></FormRow>
        <FormRow label="频率" htmlFor="new-frequency"><UnitInput id="new-frequency" unit="Hz" value={values.frequency} onValueChange={frequency => set({ frequency })} className="w-48" /></FormRow>
        <FormRow label="系统电压" htmlFor="new-voltage"><UnitInput id="new-voltage" unit="kV" value={values.voltage} onValueChange={voltage => set({ voltage })} className="w-48" /></FormRow>
        <FormRow label="负荷电流" htmlFor="new-current"><UnitInput id="new-current" unit="A" value={values.current} onValueChange={current => set({ current })} className="w-48" /></FormRow>
      </FormSection>
    </>;
  }

  return <>
    <PageHeader trail={[{ label: '载流量计算', onClick: leave }]} title="新建载流量工程"
      actions={<Button variant="outline" onClick={leave}>取消</Button>}
      primary={<Button type="submit" form="new-project" disabled={!values || busy}>{busy ? <Spinner /> : <Icon name="run/run" data-icon="inline-start" />}{busy ? '计算中' : '建好并计算'}</Button>} />
    <div className="flex min-h-0 flex-1">
      <form id="new-project" onSubmit={event => void submit(event)} className="min-w-0 flex-1 overflow-y-auto bg-surface">
        <div className="mx-auto flex max-w-3xl flex-col gap-10 px-8 py-8">
          <FormSection title="型号" description="从型号库选一个规格，工程按它的最新版本计算。">
            <ModelTable entries={entries} selected={model} onSelect={entry => setModel(entry.id)} />
          </FormSection>
          {settings}
          {values && <FormSection title="工程名称" description="工程在左边的列表里叫这个名字。">
            <FormRow label="名称" htmlFor="project-name"><Input id="project-name" value={name} maxLength={80} onChange={event => setNamed(event.target.value)} /></FormRow>
          </FormSection>}
          {error && <FormNote tone="attention" title="还不能建好">{error}</FormNote>}
        </div>
      </form>
      <Panel title="选中的规格" className="w-80 flex-none border-l border-line"><Spec entry={entries.find(entry => entry.id === model)} /></Panel>
    </div>
  </>;
}
