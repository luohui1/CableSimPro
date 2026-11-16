// The start of a calculation: choose a cable of the library, choose how it is laid, give the conditions. The host says what
// each of them starts from; the form sends only what the engineer changed, so the project begins as the method would.
import { useNavigate } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { reportFailure } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PageHeader, Panel, Split } from '@/kit/workbench/page';
import { EmptyState } from '@/kit/workbench/premise';
import { api } from '@/state/api';
import { queryClient, useLibrary } from '@/state/queries';
import { BONDING_NAMES } from '@shared/format';
import type { RatingStart } from '@shared/rating-types';
import type { ProjectView } from '@shared/types';
import { messageOf } from './edit';
import { ChoiceField, NumberField, parseNumber, textOf, useTexts } from './fields';
import { ModelTable } from './models';
import { useStart } from './queries';

function ProjectForm({ start, onCreated }: { start: RatingStart; onCreated: (project: string) => void }) {
  const { installation, conditions } = start;
  const [name, setName] = useState(`${start.model.name} 载流量校核`);
  const [layout, setLayout] = useState(installation.layout);
  const [bonding, setBonding] = useState<string>(installation.bonding);
  // One project per press: a second press while the first is being made does nothing.
  const making = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const { texts, set, changed } = useTexts({
    depth: textOf(installation.depth_m),
    soil: textOf(conditions.soil_thermal_resistivity),
    ambient: textOf(conditions.ambient_temperature_c),
    current: textOf(conditions.currents_a[0]),
    voltage: textOf(conditions.system_voltage_v === null ? null : conditions.system_voltage_v / 1000),
    frequency: textOf(conditions.frequency_hz),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (making.current) return;
    const [depth, soil, ambient, current, voltage, frequency] = [texts.depth, texts.soil, texts.ambient, texts.current, texts.voltage, texts.frequency].map(parseNumber);
    const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);
    const refusal = !name.trim() ? '工程名称不能空。'
      : !finite(depth) || depth <= 0 ? '中心埋深要填大于 0 的数。'
      : !finite(soil) || soil <= 0 ? '土壤热阻率要填大于 0 的数。'
      : !finite(ambient) || ambient < -50 || ambient > 80 ? '环境温度要在 −50 到 80 °C 之间。'
      : !finite(current) || current < 0 ? '负荷电流要填不小于 0 的数。'
      : voltage !== null && (!finite(voltage) || voltage <= 0) ? '系统线电压要填大于 0 的数，或留空。'
      : !finite(frequency) || frequency <= 0 ? '频率要填大于 0 的数。'
      : null;
    if (refusal) return setError(refusal);

    // Only what differs from the host's starting point is sent: the same value again would change nothing.
    const laying: Record<string, unknown> = {
      ...(layout !== installation.layout && { layout }),
      ...(changed('depth') && { depth_m: depth }),
      ...(bonding !== installation.bonding && { bonding }),
    };
    const conditionsPatch: Record<string, unknown> = {
      ...(changed('soil') && { soil_thermal_resistivity: soil }),
      ...(changed('ambient') && { ambient_temperature_c: ambient }),
      ...(changed('current') && { current_a: current }),
      ...(changed('voltage') && { system_voltage_v: voltage === null ? null : (voltage as number) * 1000 }),
      ...(changed('frequency') && { frequency_hz: frequency }),
    };
    making.current = true;
    setError(null);
    let project: string | null = null;
    try {
      project = (await api.op<ProjectView>('project.create', { name: name.trim(), model_id: start.model.id })).meta.id;
      if (Object.keys(laying).length) await api.op('installation.set', { project, ...laying });
      if (Object.keys(conditionsPatch).length) await api.op('conditions.set', { project, ...conditionsPatch });
      onCreated(project);
    } catch (failure) {
      if (project) {
        // The project exists: go to it, and say what it did not take.
        reportFailure(failure);
        onCreated(project);
      } else {
        setError(messageOf(failure));
        making.current = false;
      }
    }
  };

  return <form id="new-project" onSubmit={event => void submit(event)} className="flex flex-col gap-6 px-6 py-6">
    <Field>
      <FieldLabel htmlFor="project-name">工程名称</FieldLabel>
      <Input id="project-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} />
    </Field>
    <ChoiceField label="敷设方式">
      <ToggleGroup orientation="vertical" aria-label="敷设方式" value={[layout]} onValueChange={next => { if (next[0]) setLayout(next[0]); }}>
        {start.layouts.map(option => <ToggleGroupItem key={option.kind} value={option.kind} className="justify-start">
          {option.label}<span className="ml-auto text-ink-2">{option.circuits} 回</span>
        </ToggleGroupItem>)}
      </ToggleGroup>
    </ChoiceField>
    <div className="grid grid-cols-2 gap-4">
      <NumberField label="中心埋深" unit="m" value={texts.depth} onChange={set('depth')} />
      <NumberField label="土壤热阻率" unit="K·m/W" value={texts.soil} onChange={set('soil')} />
      <NumberField label="环境温度" unit="°C" value={texts.ambient} onChange={set('ambient')} />
      <NumberField label="负荷电流" unit="A" value={texts.current} onChange={set('current')} />
      <NumberField label="系统线电压" unit="kV" value={texts.voltage} onChange={set('voltage')} />
      <NumberField label="频率" unit="Hz" value={texts.frequency} onChange={set('frequency')} />
    </div>
    <ChoiceField label="护套接地">
      <ToggleGroup aria-label="护套接地" value={[bonding]} onValueChange={next => { if (next[0]) setBonding(next[0]); }}>
        {Object.entries(BONDING_NAMES).map(([value, label]) => <ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>)}
      </ToggleGroup>
    </ChoiceField>
    {error && <FieldError>{error}</FieldError>}
  </form>;
}

/** `model` is the library id carried by /workbench?model=<id>: the cable the new project starts with. */
export function StartScreen({ model: asked }: { model?: string }) {
  const navigate = useNavigate();
  const library = useLibrary();
  const [model, setModel] = useState(asked);
  const start = useStart(model);
  const entries = library.data ?? [];
  const created = (project: string) => {
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    void navigate({ to: '/p/$projectId', params: { projectId: project }, search: {} });
  };

  let form;
  if (!model) form = <EmptyState icon="object/cable" title="先选一款型号" description="从左边的型号库里选一款，这里会列出它能用的敷设方式和起始条件。" />;
  else if (start.isPending) form = <EmptyState icon="status/pending" title="正在读取这款型号的起点" description="请稍等。" />;
  else if (start.error) form = <EmptyState icon="status/error" title="这款型号不能新建工程" description={messageOf(start.error)} />;
  else form = <ProjectForm key={start.data.model.id} start={start.data} onCreated={created} />;

  return <>
    <PageHeader title="新建工程" marks={start.data && <Badge variant="outline">{start.data.model.name}</Badge>}
      primary={<Button type="submit" form="new-project" disabled={!start.data}>创建工程</Button>} />
    <Split panes={[
      { id: 'models', size: 56, min: 36, children: <Panel title="选一款型号" bodyClassName="flex flex-col">
        <ModelTable entries={entries} selected={model} onSelect={entry => setModel(entry.id)} />
      </Panel> },
      { id: 'form', size: 44, min: 32, children: <Panel title="敷设与工况">{form}</Panel> },
    ]} />
  </>;
}
