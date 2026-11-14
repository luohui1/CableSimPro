// What the section canvas draws: the geometry of the domain document, joined with the cable states of a run.
import { sectionShape, type CableShape, type Placed } from '@shared/geometry';
import type { CableState, DomainDocument, Enclosure, Region } from '@shared/types';
import type { Box } from './camera';

export interface SceneCable extends Placed {
  /** Name as the engineer says it: "A 相", "回路 2", "回路 1 A 相". */
  name: string;
  state: CableState | null;
  limiting: boolean;
}

export interface Scene {
  cables: SceneCable[];
  shape: CableShape;
  /** Bounds of the cables alone, in metres. */
  group: Box;
  ducts: Enclosure[];
  backfill: Region | null;
  /** Template dimensions, when the section came from a laying template. */
  depth: number | null;
  spacing: number | null;
  ambient: number;
  limit: number;
  /** A key that changes when the geometry changes. */
  key: string;
}

export function buildScene(document: DomainDocument, states: CableState[] | undefined, limiting: string | undefined): Scene {
  const drawn = sectionShape(document);
  const section = document.sections[0];
  const cable = document.cable_types[0];
  const several = document.circuits.length > 1;
  const byId = new Map((states ?? []).map(state => [state.id, state]));
  const cables = drawn.cables.map(item => {
    const name = cable.construction === 'single_core'
      ? (several ? `${item.circuitLabel} ${item.phase} 相` : `${item.phase} 相`)
      : (several ? item.circuitLabel : '电缆');
    return { ...item, name, state: byId.get(item.id) ?? null, limiting: item.id === limiting };
  });
  const group: Box = {
    left: Math.min(...cables.map(item => item.x - item.radius)),
    right: Math.max(...cables.map(item => item.x + item.radius)),
    top: Math.max(...cables.map(item => item.z + item.radius)),
    bottom: Math.min(...cables.map(item => item.z - item.radius)),
  };
  return {
    cables,
    shape: drawn.shape,
    group,
    ducts: section.enclosures ?? [],
    backfill: section.backfill ?? null,
    depth: section.layout_template?.depth ?? null,
    spacing: section.layout_template?.spacing ?? null,
    ambient: section.medium.surface_temperature - 273.15,
    limit: (cable.rating.max_conductor_temperature.normal ?? 363.15) - 273.15,
    key: cables.map(item => `${item.id}@${item.x.toFixed(5)},${item.z.toFixed(5)}`).join('|') + `/${drawn.shape.radius.toFixed(5)}`,
  };
}

/** The region each lens shows. The cluster lens is for reading cables; the overview shows the ground. */
export function lensBox(scene: Scene, lens: 'cluster' | 'overview'): Box {
  const { group } = scene;
  const diameter = scene.shape.radius * 2;
  if (lens === 'cluster') {
    const side = Math.max(diameter * 1.5, 0.11);
    const above = Math.max(diameter * 1.9, 0.15);
    const below = Math.max(diameter * 1.7, 0.14);
    return { left: group.left - side, right: group.right + side, top: Math.min(0.02, group.top + above), bottom: group.bottom - below };
  }
  const depth = -group.bottom;
  const side = Math.max(0.9, depth * 0.85);
  return { left: group.left - side, right: group.right + side, top: 0.2, bottom: group.bottom - Math.max(0.5, depth * 0.42) };
}
