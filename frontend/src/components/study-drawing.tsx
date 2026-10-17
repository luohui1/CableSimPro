import { useEffect, useRef } from 'react';
import { api, ApiError, numeric, record, responseData } from '@/api/client';
import type { components } from '@/api/generated/schema';
import { CableSection, LayingSection, type DrawingCommand, type LayerTarget, type SectionSelection } from '@/features/drawing';
import type { Section } from '@/features/drawing/types';
import { at, change, commitFields, isLocked, pointer, type DomainDocument, type NumericInput } from '@/lib/domain-fields';
import { useViewState } from '@/lib/use-view-state';
import { studyRootRoute } from '@/router';
import { useStudy } from './study-provider';
import { Select } from './ui/select';
import { StudyGeometry } from './study-geometry';
import type { InputSelection } from './study-inputs';

const emptyDrawingView = { chosen: '', layer: null as LayerTarget | null, selection: null as SectionSelection };

function sectionPath(section: Section, field: string): string {
  for (const [collection, ids] of [
    ['placements', section.placements.map(item => item.cable)],
    ['enclosures', (section.enclosures || []).map(item => item.id)],
    ['soil_layers', (section.soil_layers || []).map(item => item.id)],
  ] as const) for (const id of ids) {
    const prefix = collection + '.' + id + '.';
    if (field.startsWith(prefix)) return pointer('sections', section.id, collection, id, ...field.slice(prefix.length).split('.'));
  }
  if (section.backfill) {
    const prefix = 'backfill.' + section.backfill.id + '.';
    if (field.startsWith(prefix)) return pointer('sections', section.id, 'backfill', ...field.slice(prefix.length).split('.'));
  }
  if (field.startsWith('backfill.')) return pointer('sections', section.id, 'backfill', ...field.slice(9).split('.'));
  throw new ApiError(422, '未知画布字段：' + field);
}
function cablePath(id: string, target: LayerTarget) {
  return target.scope === 'common' ? pointer('cable_types', id, 'common_layers', target.role, 'thickness')
    : target.role === 'conductor' ? pointer('cable_types', id, 'cores', target.coreId, 'conductor', 'diameter')
    : pointer('cable_types', id, 'cores', target.coreId, 'layers', target.role, 'thickness');
}
function sectionContains(section: Section | undefined, value: SectionSelection): boolean {
  if (!section || !value) return false;
  if (value.kind === 'cable') return section.placements.some(item => item.cable === value.id);
  if (value.kind === 'enclosure') return (section.enclosures || []).some(item => item.id === value.id);
  if (value.kind === 'soil') return (section.soil_layers || []).some(item => item.id === value.id);
  return section.backfill?.id === value.id;
}

export function StudyDrawing({ document, historical, kind, onSelect }: {
  document: DomainDocument;
  historical: boolean;
  kind: 'cable' | 'section' | 'scene';
  onSelect: (selection: InputSelection) => void;
}) {
  const context = useStudy();
  const search = studyRootRoute.useSearch();
  const current = useRef(context); current.current = context;
  const notify = useRef(onSelect); notify.current = onSelect;
  // Both laying views intentionally share one scope. Frozen runs never share current selection.
  const key = JSON.stringify([context.study.workspace, context.study.id, historical ? search.run : 'current', kind === 'cable' ? 'cable-drawing' : 'laying-drawing']);
  const [view, setView] = useViewState(key, emptyDrawingView);
  const cable = document.cable_types.find(item => item.id === view.chosen) || document.cable_types[0];
  const section = document.sections.find(item => item.id === view.chosen) || document.sections[0];
  const selection = sectionContains(section, view.selection) ? view.selection : null;
  const candidateLayer = view.layer;
  const layer = candidateLayer && cable && (candidateLayer.scope === 'common'
    ? cable.common_layers.some(item => item.role === candidateLayer.role)
    : cable.cores.some(core => core.id === candidateLayer.coreId &&
      (candidateLayer.role === 'conductor' || core.layers.some(item => item.role === candidateLayer.role)))) ? candidateLayer : null;
  const editable = !historical && !context.saving;

  function command(value: DrawingCommand) {
    if (value === 'save') {
      const focused = window.document.activeElement;
      if (focused instanceof HTMLInputElement) focused.blur();
      setTimeout(() => void current.current.save(), 0);
    } else void context[value]();
  }
  function describeSection(value: SectionSelection) {
    if (!value || !section) { notify.current({ id: '', title: '未选择对象', groups: [] }); return; }
    const fields: NumericInput[] = value.kind === 'cable' ? ['x', 'z'].map(axis => ({ path: pointer('sections', section.id, 'placements', value.id, axis), label: axis + ' 坐标', unit: 'm', precision: 3 })) : [];
    notify.current({ id: value.id, title: value.id, fields: fields.length ? fields : undefined,
      groups: [{ label: '敷设对象', items: [{ label: '类型', value: { cable: '电缆', enclosure: '构筑物', backfill: '回填', soil: '土壤层' }[value.kind] }] }] });
  }
  function describeLayer(target: LayerTarget | null) {
    if (!target || !cable) { notify.current({ id: '', title: '未选择对象', groups: [] }); return; }
    const path = cablePath(cable.id, target);
    notify.current({ id: path, title: target.role,
      fields: [{ path, label: target.role === 'conductor' ? '导体外径' : '层厚度', unit: 'mm', scale: 1000, precision: 3 }], groups: [] });
  }
  const restoreSelection = useRef(() => {});
  restoreSelection.current = () => { if (kind === 'cable') describeLayer(layer); else describeSection(selection); };
  useEffect(() => { restoreSelection.current(); }, [key, kind, section?.id, cable?.id, selection?.id, selection?.kind, layer?.scope, layer?.role, layer && 'coreId' in layer ? layer.coreId : '']);

  function selectSection(value: SectionSelection) {
    setView(previous => ({ ...previous, selection: value }));
    describeSection(value);
  }
  const templates: { id: components['schemas']['LayoutPreview']['kind']; label: string }[] = cable && cable.cores.length > 1
    ? [{ id: 'three_core_buried_single', label: '三芯直埋' }, { id: 'three_core_buried_horizontal', label: '三芯多回水平' }, { id: 'three_core_ducts_horizontal', label: '三芯排管' }]
    : [{ id: 'trefoil', label: '单回品字' }, { id: 'flat', label: '单回水平' }, { id: 'double_trefoil', label: '双回品字' }, { id: 'ducts', label: '排管' }, { id: 'backfill', label: '回填' }];
  return <div className="study-drawing" data-drawing-mount={kind === 'cable' ? 'cable-section' : kind === 'scene' ? 'laying-cad' : 'laying-section'}>
    {(kind === 'cable' ? document.cable_types : document.sections).length > 1 && <Select label={kind === 'cable' ? '电缆型号' : '敷设截面'} value={kind === 'cable' ? cable?.id : section?.id}
      options={(kind === 'cable' ? document.cable_types : document.sections).map(item => ({ value: item.id, label: item.label }))}
      onChange={id => setView({ chosen: id, layer: null, selection: null })} />}
    {kind === 'cable' ? <CableSection key={cable?.id} cableType={cable || null} materials={document.materials}
      state={historical ? 'historical' : cable ? 'success' : 'empty'} editable={editable} selectedObject={layer} onCommand={command}
      isLocked={target => !cable || isLocked(context.workspace.locks, cablePath(cable.id, target))}
      onSelectionChange={target => { setView(previous => ({ ...previous, layer: target })); describeLayer(target); }}
      onDimensionChange={edit => {
        if (!editable || !cable) throw new ApiError(409, '当前输入只读');
        const path = cablePath(cable.id, edit.target);
        if (isLocked(context.workspace.locks, path)) throw new ApiError(423, '尺寸已锁定');
        context.editDomainValue(path, edit.valueM, 'cable');
      }} />
      : kind === 'scene' ? <StudyGeometry document={document} sectionId={section?.id || ''} historical={historical} selected={selection} onSelect={selectSection} />
      : <LayingSection key={section?.id} document={document} sectionId={section?.id || ''} state={historical ? 'historical' : section ? 'success' : 'empty'}
        editable={editable} selectedObject={selection} onSelectionChange={selectSection} onCommand={command}
        canUndo={context.canUndo} canRedo={context.canRedo} objectCommands={[]} templates={templates}
        isLocked={field => !section || isLocked(context.workspace.locks, sectionPath(section, field))}
        onChange={(next, edit) => {
          if (!editable || !section) throw new ApiError(409, '当前敷设只读');
          const paths = edit.fields.map(field => sectionPath(section, field));
          if (paths.some(path => isLocked(context.workspace.locks, path))) throw new ApiError(423, '整组画布改动包含锁定字段');
          let updated = document;
          const temporary = { ...document, sections: document.sections.map(item => item.id === next.id ? next : item) };
          for (const path of paths) updated = change(updated, path, at(temporary, path));
          context.editDomainDocument(updated, 'section', paths);
        }}
        onTemplateRequest={async id => {
          if (!editable) throw new ApiError(409, '当前敷设只读');
          const option = templates.find(item => item.id === id);
          if (!option) throw new ApiError(422, '无效模板');
          const result = record(await responseData(api.POST('/api/design/workspaces/{wid}/section-template', {
            params: { path: { wid: context.study.workspace } },
            body: { expected_revision: context.domainDraft?.revision ?? numeric(context.workspace.revision)!, document: context.domainDraft ? commitFields(context.domainDraft) : document, kind: option.id, depth: Math.abs(section?.placements[0]?.z || 0.8) },
          })), '敷设模板');
          if (result.schema_version !== 'cablesim.domain/1') throw new ApiError(502, '模板缺少领域输入');
          context.editDomainDocument(result as DomainDocument, 'section', [pointer('sections')]);
          setView(previous => ({ ...previous, selection: null }));
        }} />}
  </div>;
}
