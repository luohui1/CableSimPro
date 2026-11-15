import { compact, ROLE_NAMES } from '@shared/format';
import { cableShape } from '@shared/geometry';
import type { SpecView } from '@shared/types';
import { CableGlyph } from '@/canvas/cable-glyph';
import { Badge, NavLink } from '@mantine/core';

// The same part names connect the drawing, table fields and standard targets.
export const STRUCTURE_GROUPS = [
  { id: 'conductor', label: '导体', color: '#b77a42', keys: ['area', 'conductor_diameter', 'conductor_wire_count', 'conductor_wire_diameter', 'r20'] },
  { id: 'insulation', label: '绝缘与半导电层', color: '#6c9d91', keys: ['conductor_screen_thickness', 'insulation_thickness', 'insulation_screen_thickness'] },
  { id: 'metallic_screen', label: '金属屏蔽', color: '#c99068', keys: ['screen_tape_thickness', 'screen_tape_width', 'screen_tape_overlap'] },
  { id: 'protection', label: '包带、铠装与护套', color: '#778492', keys: ['binder_thickness', 'bedding_thickness', 'armour_tape_thickness', 'armour_tape_width', 'armour_wire_diameter', 'armour_wire_count', 'oversheath_thickness'] },
  { id: 'overall', label: '成品尺寸与重量', color: '#808783', keys: ['outer_diameter', 'weight'] },
];
export const ROLE_FIELDS: Record<string, string[]> = {
  conductor: STRUCTURE_GROUPS[0].keys, conductor_screen: ['conductor_screen_thickness'], insulation: ['insulation_thickness'],
  insulation_screen: ['insulation_screen_thickness'], metallic_screen: STRUCTURE_GROUPS[2].keys,
  binder: ['binder_thickness'], bedding: ['bedding_thickness'], armour: ['armour_tape_thickness', 'armour_tape_width', 'armour_wire_diameter', 'armour_wire_count'],
  oversheath: ['oversheath_thickness'],
};

export function StructureExplorer({ view, selected, onSelect }: { view: SpecView; selected: string; onSelect: (role: string) => void }) {
  const shape = cableShape(view.entry.payload.cable_type, view.entry.payload.materials);
  const scale = 84 / shape.radius;
  const roles = [...new Set(shape.rings.map(ring => ring.role))];
  // Click targets follow the same outside-to-inside paint order as CableGlyph.
  const targets = [...shape.rings.filter(ring => !ring.core).sort((a, b) => b.outer - a.outer),
    ...shape.rings.filter(ring => ring.core).sort((a, b) => b.outer - a.outer)];
  return <section className="structure-explorer" aria-label="交互电缆结构">
    <div className="structure-drawing">
      <svg viewBox="0 0 240 230" aria-label={`${view.spec.key} 真实尺寸断面`}>
        <path d="M16 104H224 M120 10V198" stroke="var(--line)" strokeDasharray="3 4" />
        <CableGlyph shape={shape} x={120} y={104} scale={scale} />
        {targets.map(ring => <circle key={ring.id} cx={120 + ring.cx * scale} cy={104 - ring.cz * scale} r={ring.outer * scale}
          fill="transparent" className="structure-hit" onClick={() => onSelect(ring.role)}><title>{ring.name} · 点击查看参数</title></circle>)}
        {shape.rings.filter(ring => ring.role === selected).map(ring => <circle key={ring.id} cx={120 + ring.cx * scale} cy={104 - ring.cz * scale}
          r={(ring.inner + ring.outer) / 2 * scale} fill="none" stroke="var(--copper)" strokeWidth="3" strokeDasharray="4 2" pointerEvents="none" />)}
        <path d="M36 198V211 M204 198V211 M36 205H204" stroke="var(--text-secondary)" strokeWidth=".75" />
        <text x="120" y="224" textAnchor="middle" fontSize="12" fill="var(--text-secondary)">⌀ {compact(shape.radius * 2000)} mm</text>
      </svg>
      <span>二维参数截面 · 点击部位查看来源</span>
    </div>
    <div className="structure-parts" aria-label="按电缆部位查看参数">
      <NavLink component="button" label="全部结构" active={!selected} aria-pressed={!selected} onClick={() => onSelect('')} rightSection={<Badge size="xs" variant="light">{view.structure.length}</Badge>} />
      {roles.map((role, index) => <NavLink key={role} component="button" label={ROLE_NAMES[role] ?? role} active={selected === role} aria-label={`选择${ROLE_NAMES[role] ?? role}`} aria-pressed={selected === role} onClick={() => onSelect(selected === role ? '' : role)} leftSection={<Badge size="xs" color="gray" variant="light" circle>{index + 1}</Badge>} />)}
    </div>
  </section>;
}
