import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { screenToWorld, snapCoordinate } from './coordinates';
import { moveSelection, selectionPosition } from './section-geometry';
import { editDimension } from './section-dimensions';
import type { ObjectPointer } from './section-objects';
import type { DrawingView, LayingSectionProps, PixelSize, Section, SectionEdit, SectionSelection, WorldPoint } from './types';

interface Gesture {
  pointerId: number; section: Section; view: DrawingView; start: WorldPoint; selection: SectionSelection;
  size: PixelSize; bounds: { left: number; top: number };
  operation: 'pan' | 'move' | 'width' | 'height'; id: string; moved: boolean;
  next: Section | null; fields: string[];
}
export function useSectionGesture({ props, section, view, objectView = view, size, snap, followEnclosure, tool, editable, setView, commit, report }: {
  props: LayingSectionProps; section: Section | null; view: DrawingView; size: PixelSize; snap: boolean; followEnclosure: boolean;
  objectView?: DrawingView;
  tool: 'select' | 'pan'; editable: boolean; setView: (view: DrawingView) => void;
  commit: (section: Section, edit: SectionEdit) => Promise<void>; report: (error: unknown) => void;
}) {
  const gesture = useRef<Gesture | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [preview, setPreview] = useState<Section | null>(null);
  const [guides, setGuides] = useState<WorldPoint | null>(null);
  const [dragging, setDragging] = useState(false);
  const suppressClick = useRef(false);
  const latest = useRef(props); latest.current = props;

  function cancel() {
    const current = gesture.current;
    if (!current) return;
    if (svg.current?.hasPointerCapture(current.pointerId)) svg.current.releasePointerCapture(current.pointerId);
    gesture.current = null; setPreview(null); setGuides(null); setDragging(false);
    latest.current.onPreview?.(null, { gestureId: current.id, kind: 'move', selection: current.selection, fields: current.fields });
  }
  useEffect(() => {
    if (gesture.current && gesture.current.section !== section) cancel();
  }, [section]);
  useEffect(() => () => {
    const current = gesture.current;
    if (current) latest.current.onPreview?.(null, { gestureId: current.id, kind: 'move', selection: current.selection, fields: current.fields });
  }, []);

  const pointerPosition = (event: ReactPointerEvent<SVGElement>) => {
    const bounds = svg.current!.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const begin: ObjectPointer = (event, selection, operation = 'move') => {
    if (!section || !svg.current || event.button !== 0) return;
    event.stopPropagation(); event.preventDefault();
    props.onSelectionChange?.(selection);
    if (tool !== 'pan' && !editable) return;
    svg.current.focus(); svg.current.setPointerCapture(event.pointerId);
    const transform = tool === 'pan' ? view : objectView;
    gesture.current = { pointerId: event.pointerId, section, view: transform, size: { ...size }, bounds: svg.current.getBoundingClientRect(), start: screenToWorld(pointerPosition(event), transform, size),
      selection, operation: tool === 'pan' ? 'pan' : operation, id: crypto.randomUUID(), moved: false, next: null, fields: [] };
  };
  function beginBackground(event: ReactPointerEvent<SVGSVGElement>) {
    if (!section || !svg.current || ![0, 1].includes(event.button)) return;
    event.preventDefault(); svg.current.focus();
    if (tool !== 'pan' && event.button !== 1) return;
    svg.current.setPointerCapture(event.pointerId);
    gesture.current = { pointerId: event.pointerId, section, view, size: { ...size }, bounds: svg.current.getBoundingClientRect(), start: screenToWorld(pointerPosition(event), view, size),
      selection: null, operation: 'pan', id: crypto.randomUUID(), moved: false, next: null, fields: [] };
  }
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;
    // Selection can resize the stage mid-gesture. Keep the original SI transform.
    const pointer = screenToWorld({ x: event.clientX - current.bounds.left, y: event.clientY - current.bounds.top }, current.view, current.size);
    const delta = { x: pointer.x - current.start.x, z: pointer.z - current.start.z };
    if (Math.hypot(delta.x, delta.z) * current.size.width / current.view.widthM > 3) current.moved = true;
    if (!current.moved) return;
    setDragging(true);
    if (current.operation === 'pan') {
      setView({ ...current.view, x: current.view.x - delta.x, z: current.view.z - delta.z }); return;
    }
    try {
      const position = selectionPosition(current.section, current.selection);
      if (!position) return;
      const step = props.snapStepM ?? .001;
      let x = snapCoordinate(position.x + delta.x, snap, step), z = snapCoordinate(position.z + delta.z, snap, step);
      let guide: WorldPoint | null = null;
      if (snap && current.selection?.kind === 'cable') {
        const threshold = 8 * current.view.widthM / current.size.width;
        for (const other of current.section.placements) if (other.cable !== current.selection.id) {
          if (Math.abs(x - other.x) < threshold) { x = other.x; guide = { x, z }; }
          if (Math.abs(z - other.z) < threshold) { z = other.z; guide = { x, z }; }
        }
      }
      let result: { section: Section; fields: string[] };
      if (current.operation === 'move') result = moveSelection(current.section, current.selection,
        { x: x - position.x, z: z - position.z }, followEnclosure);
      else {
        const item = current.selection?.kind === 'backfill' ? current.section.backfill
          : current.section.enclosures?.find(value => value.id === current.selection?.id);
        if (!item || !current.selection) return;
        const field = current.operation;
        const old = item[field];
        if (old == null) throw new Error('所选构筑物未提供尺寸。');
        const value = snapCoordinate(old + 2 * (field === 'width' ? delta.x : delta.z), snap, step);
        result = editDimension(current.section, { selection: current.selection, field, valueM: old, label: field === 'width' ? '宽度' : '高度', x: 0, y: 0 }, value);
      }
      current.next = result.section; current.fields = result.fields;
      setPreview(result.section); setGuides(guide);
      props.onPreview?.(result.section, { gestureId: current.id, kind: current.operation === 'move' ? 'move' : 'resize',
        selection: current.selection, fields: result.fields });
    } catch (error) { current.next = null; report(error); }
  }
  function finish(event: ReactPointerEvent<SVGSVGElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    suppressClick.current = current.moved || !!current.selection;
    cancel();
    if (current.moved && current.next) void commit(current.next, { gestureId: current.id,
      kind: current.selection?.kind === 'soil' ? 'soil-boundary' : current.operation === 'move' ? 'move' : 'resize',
      selection: current.selection, fields: current.fields }).catch(report);
  }
  return { svg, preview, guides, dragging, begin, beginBackground, move, finish, cancel,
    backgroundClick: () => { if (!suppressClick.current) props.onSelectionChange?.(null); suppressClick.current = false; } };
}
