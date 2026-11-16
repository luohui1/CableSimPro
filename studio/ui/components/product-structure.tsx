// Structure fields grouped by part, for declaring what a structure table leaves out.
export const STRUCTURE_GROUPS = [
  { id: 'conductor', label: '导体', color: '#b77a42', keys: ['area', 'conductor_diameter', 'conductor_wire_count', 'conductor_wire_diameter', 'r20'] },
  { id: 'insulation', label: '绝缘与半导电层', color: '#6c9d91', keys: ['conductor_screen_thickness', 'insulation_thickness', 'insulation_screen_thickness'] },
  { id: 'metallic_screen', label: '金属屏蔽', color: '#c99068', keys: ['screen_tape_thickness', 'screen_tape_width', 'screen_tape_overlap'] },
  { id: 'protection', label: '包带、铠装与护套', color: '#778492', keys: ['binder_thickness', 'bedding_thickness', 'armour_tape_thickness', 'armour_tape_width', 'armour_wire_diameter', 'armour_wire_count', 'oversheath_thickness'] },
  { id: 'overall', label: '成品尺寸与重量', color: '#808783', keys: ['outer_diameter', 'weight'] },
];
