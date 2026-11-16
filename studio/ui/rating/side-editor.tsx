// The givens edited at the side: the drawing stays as it was, the editor takes the conclusion's place, and nothing is written
// to the project until "按新条件计算". Every field shows what the project has until it is changed, and a changed one carries a
// dot and says what it was.
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Disclosure } from '@/kit/disclosure';
import { Icon, Spinner } from '@/kit/icon';
import { Dot } from '@/kit/marks';
import { ChoiceSelect, FormNote, FormRow, UnitInput } from '@/kit/workbench/form';
import { SideEditor, SideEditorSection } from '@/kit/workbench/side-editor';
import { useLibrary } from '@/state/queries';
import { BONDING_NAMES, compact, EDDY_NAMES } from '@shared/format';
import type { ProjectView } from '@shared/types';
import { FormDialog } from './fields';
import { ModelTable } from './models';
import type { Base, GivenKey, Key, Staged, Value } from './pending';

/** The field that takes the focus when a given of the line above the drawing asks for its editor. */
const FIELD_OF: Record<GivenKey, string> = {
  cable: 'edit-cable', layout: 'edit-layout', depth: 'edit-depth', soil: 'edit-soil', ambient: 'edit-ambient', load: 'edit-load',
  system: 'edit-voltage', sheath: 'edit-bonding', method: 'edit-ks',
};

function IconAction({ label, icon, ...props }: { label: string; icon: string } & Omit<ComponentProps<typeof Button>, 'children'>) {
  return <Tooltip>
    <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} {...props} />}><Icon name={icon} /></TooltipTrigger>
    <TooltipContent side="top">{label}</TooltipContent>
  </Tooltip>;
}

export function GivensEditor({ view, base, staged, changed, stage, settle, focus, problem, applying, canUndo, canRedo, onUndo, onRedo, onDiscard, onApply, onClose }: {
  view: ProjectView;
  base: Base;
  staged: Staged;
  changed: Key[];
  stage: (patch: Staged, group: string) => void;
  /** Ends the group of changes of one field: leaving a field ends it. */
  settle: () => void;
  /** The given whose field takes the focus; `at` counts the asks, so asking again for the same given focuses it again. */
  focus: { key: GivenKey; at: number } | null;
  /** Why the changes could not be applied, in the host's words or the field's. */
  problem: string | null;
  applying: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDiscard: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const library = useLibrary();
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (focus) document.getElementById(FIELD_OF[focus.key])?.focus();
  }, [focus]);

  const val = (key: Key): Value => (key in staged ? (staged[key] as Value) : base[key]);
  const num = (key: Key): number | null => {
    const value = val(key);
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const is = (key: Key) => changed.includes(key);
  const was = (key: Key, unit: string) => {
    if (!is(key)) return undefined;
    const before = base[key];
    return `现在是 ${typeof before === 'number' ? `${compact(before)} ${unit}`.trim() : '空'}`;
  };

  /** A number with its unit, and the dot and the old value when it was changed. */
  const field = (key: Key, label: string, unit: string, id: string) => <FormRow label={label} htmlFor={id} changed={is(key)} hint={was(key, unit)}>
    <UnitInput id={id} unit={unit} value={num(key)} onValueChange={next => stage({ [key]: next }, key)} />
  </FormRow>;

  const layouts = view.layouts.map(option => ({ value: option.kind, label: option.label }));
  const layoutLabel = (kind: Value) => layouts.find(option => option.value === kind)?.label ?? '—';
  // A laying of its own brings its spacing, duct and backfill: until it is applied there is nothing to set for them yet.
  const sameLaying = !is('layout');

  const loads = val('load') as number[];
  const baseLoads = base.load as number[];
  const alike = baseLoads.every(load => load === baseLoads[0]);
  const loadField = (at: number, label: string, id: string) => <FormRow key={id} label={label} htmlFor={id} changed={is('load') && !(Number.isFinite(loads[at]) && loads[at] === baseLoads[at])}
    hint={is('load') && loads[at] !== baseLoads[at] ? `现在是 ${compact(baseLoads[at])} A` : undefined}>
    <UnitInput id={id} unit="A" value={Number.isFinite(loads[at]) ? loads[at] : null}
      onValueChange={next => stage({ load: alike ? baseLoads.map(() => next ?? Number.NaN) : loads.map((load, index) => (index === at ? next ?? Number.NaN : load)) }, 'load')} />
  </FormRow>;

  // Never an identifier in place of a name: until the library has been read, the name of another cable is not known.
  const cableName = (id: Value) => (id === view.parts.cable.id ? view.parts.cable.name : library.data?.find(entry => entry.id === id)?.name ?? '…');
  // The host moves the system voltage with the cable only while it was following the cable.
  const followed = view.parts.conditions.system_voltage_v === (view.parts.cable.summary.u_v ?? null);
  const chosen = library.data?.find(entry => entry.id === val('cable'));
  const newVoltage = chosen?.summary.u_v ?? null;
  const voltageFollows = is('cable') && !is('voltage') && followed && chosen !== undefined && newVoltage !== (view.parts.cable.summary.u_v ?? null);
  const sameCores = (library.data ?? []).filter(entry => entry.summary.cores === view.parts.cable.summary.cores);

  const count = changed.length;
  const nothing = (children: ReactNode) => <p className="m-0 text-sm text-ink-2">{children}</p>;

  return <>
    {/* A little wider than the kit's editor: its footer holds the count, undo and redo as well as the two buttons. */}
    <SideEditor title="已知条件" className="w-104" onClose={onClose} footer={<>
      <span className="mr-auto flex items-center gap-1">
        {count > 0 ? <Badge variant="attention" className="gap-2"><Dot tone="attention" />改了 {count} 项</Badge> : <span className="text-sm text-ink-2">没有改动</span>}
        <IconAction label="撤销上一次改动（Ctrl+Z）" icon="action/undo" disabled={!canUndo || applying} onClick={onUndo} />
        <IconAction label="重做（Ctrl+Y）" icon="action/redo" disabled={!canRedo || applying} onClick={onRedo} />
      </span>
      <Button variant="outline" disabled={count === 0 || applying} onClick={onDiscard}>放弃</Button>
      <Button disabled={count === 0 || applying} onClick={onApply}>{applying ? <Spinner /> : <Icon name="run/run" data-icon="inline-start" />}{applying ? '计算中' : '按新条件计算'}</Button>
    </>}>
      {problem && <FormNote tone="attention" title="没有应用">{problem}</FormNote>}

      {/* While the changes are being written nothing is changed in the editor: what is typed meanwhile would be lost. */}
      <div className="contents" inert={applying || undefined} onBlur={settle}>
      <SideEditorSection title="型号">
        <FormRow label="电缆" htmlFor="edit-cable" changed={is('cable')} hint={is('cable') ? `现在是 ${cableName(base.cable)}` : undefined}>
          {/* The size is at the end of the name: the name wraps rather than losing it. */}
          <div className="flex min-w-0 items-start gap-2">
            <span className="min-w-0 flex-1 py-1 text-sm break-words text-ink">{cableName(val('cable'))}</span>
            <Button id="edit-cable" type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setPicking(true)}>更换型号…</Button>
          </div>
        </FormRow>
      </SideEditorSection>

      <SideEditorSection title="敷设">
        <FormRow label="敷设方式" htmlFor="edit-layout" changed={is('layout')} hint={is('layout') ? `现在是 ${layoutLabel(base.layout)}` : undefined}>
          <ChoiceSelect id="edit-layout" label="敷设方式" value={String(val('layout'))} options={layouts} onValueChange={next => stage({ layout: next }, 'layout')} />
        </FormRow>
        {field('depth', '埋深', 'm', 'edit-depth')}
        {sameLaying && base.spacing !== null && field('spacing', '中心距', 'mm', 'edit-spacing')}
        {sameLaying && base.inner !== null && <>
          {field('inner', '管内径', 'mm', 'edit-inner')}
          {field('outer', '管外径', 'mm', 'edit-outer')}
        </>}
        {sameLaying && base.width !== null && <>
          {field('width', '回填宽度', 'm', 'edit-width')}
          {field('height', '回填高度', 'm', 'edit-height')}
          {field('rho', '回填热阻率', 'K·m/W', 'edit-rho')}
        </>}
        {!sameLaying && <FormNote title="换了敷设方式">中心距、管径和回填尺寸按新方式的默认值起步，算完之后可以再改；埋深保留。</FormNote>}
        <FormRow label="护套接地" htmlFor="edit-bonding" changed={is('bonding')} hint={is('bonding') ? `现在是 ${BONDING_NAMES[String(base.bonding)]}` : undefined}>
          <ChoiceSelect id="edit-bonding" label="护套接地" value={String(val('bonding'))} options={Object.entries(BONDING_NAMES).map(([value, label]) => ({ value, label }))}
            onValueChange={next => stage({ bonding: next }, 'bonding')} />
        </FormRow>
      </SideEditorSection>

      <SideEditorSection title="环境">
        {field('soil', '土壤热阻率', 'K·m/W', 'edit-soil')}
        {field('ambient', '环境温度', '°C', 'edit-ambient')}
      </SideEditorSection>

      <SideEditorSection title="系统">
        {field('frequency', '频率', 'Hz', 'edit-frequency')}
        {field('voltage', '系统电压', 'kV', 'edit-voltage')}
        {voltageFollows && <FormNote title="系统电压跟着型号">系统电压原来就是这款电缆的额定电压，换型号后会改成新型号的{newVoltage === null ? '（没有给出）' : ` ${compact(newVoltage / 1000)} kV`}；在这里填了就按填的。</FormNote>}
      </SideEditorSection>

      <SideEditorSection title="负荷">
        {alike
          ? loadField(0, loads.length > 1 ? '每回负荷电流' : '负荷电流', 'edit-load')
          : loads.map((_, at) => loadField(at, `回路 ${at + 1} 负荷电流`, at === 0 ? 'edit-load' : `edit-load-${at}`))}
      </SideEditorSection>

      {/* The method's own parameters: seldom changed, so folded; unchanged they are what the library declares. */}
      <Disclosure key={focus?.key === 'method' ? `open-${focus.at}` : 'method'} className="-mx-4 border-t border-line" title="方法参数" defaultOpen={focus?.key === 'method'}
        aside={['ks', 'kp', 'eddy'].some(key => is(key as Key)) ? <Dot tone="attention" /> : undefined}>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {nothing('不改就用型号库里声明的值。')}
          {field('ks', '集肤系数 ks', '', 'edit-ks')}
          {field('kp', '邻近系数 kp', '', 'edit-kp')}
          <FormRow label="护套涡流损耗" htmlFor="edit-eddy" changed={is('eddy')} hint={is('eddy') ? `现在是 ${EDDY_NAMES[String(base.eddy)]}` : undefined}>
            <ChoiceSelect id="edit-eddy" label="护套涡流损耗" value={String(val('eddy'))} options={Object.entries(EDDY_NAMES).map(([value, label]) => ({ value, label }))}
              onValueChange={next => stage({ eddy: next }, 'eddy')} />
          </FormRow>
        </div>
      </Disclosure>
      </div>
    </SideEditor>

    {picking && <CablePicker entries={sameCores} selected={String(val('cable'))} onClose={() => setPicking(false)}
      onPick={id => { stage({ cable: id }, 'cable'); setPicking(false); }} />}
  </>;
}

/** The cables a project can change to: those with as many cores as it has now, so its laying stays valid. */
function CablePicker({ entries, selected, onPick, onClose }: { entries: ComponentProps<typeof ModelTable>['entries']; selected: string; onPick: (id: string) => void; onClose: () => void }) {
  const [pick, setPick] = useState(selected);
  return <FormDialog title="换一种电缆" description="只列出和现在芯数相同的型号，敷设方式不变；要换芯数不同的型号，请新建工程。埋深、土壤和负荷保留。" wide applyLabel="用这一款" onClose={onClose} onSubmit={() => onPick(pick)}>
    <ModelTable entries={entries} selected={pick} onSelect={entry => setPick(entry.id)} className="max-h-96" />
  </FormDialog>;
}
