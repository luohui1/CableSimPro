"""Actual run constants and explicit standard lookup conditions (no substitution).

IEC 60287-2-1:2023 Table 1: PDF 89 / printed 33. Protective plastic
coverings follow the insulating-grade row under the table's final note.
"""

ROLES = {'conductor_screen':'导体屏蔽', 'insulation':'绝缘', 'insulation_screen':'绝缘屏蔽',
         'oversheath':'外护套', 'filler':'填充', 'bedding':'内衬', 'buffer':'缓冲层',
         'metallic_sheath':'金属护套', 'armour':'铠装'}


def material_constants(case, prepared):
    document = case['input']
    if document.get('schema_version') != 'cablesim.domain/1':
        return []  # Scalar legacy inputs do not declare material/form identities.
    materials = {m['id']:m for m in document['materials']}
    parameters = prepared.parameters
    rows = []

    def add(label, value, unit, query=None, note=''):
        if value is None:
            return
        rows.append(dict(label=label, value=value, unit=unit, query=query, note=note))

    def query(part, table, quantity, conditions):
        return dict(schema_version='cablesim.standards-query/1', standard='IEC 60287-'+part,
                    edition='2023', locator='Table '+str(table), quantity=quantity, conditions=conditions)

    used_types = {c['cable_type'] for c in document['circuits']}
    for cable in document['cable_types']:
        if cable['id'] not in used_types:
            continue
        prefix = cable.get('label') or '电缆'
        for index, core in enumerate(cable['cores'],1):
            conductor = core['conductor']; material = materials[conductor['material']]
            kind = (material.get('standard_kind') or '').lower()
            kind = {'cu':'copper','copper_bare':'copper','copper_tinned':'copper','al':'aluminium'}.get(kind,kind)
            conditions = dict(reference_temperature_k=293.15, material=kind, material_role='conductor')
            valid = kind in ('copper','aluminium')
            add(f'{prefix} · 芯 {index} · 导体电阻率', material.get('electrical_resistivity_20'), 'Ω·m',
                query('1-1',1,'resistivity_20_ohm_m',conditions) if valid else None,
                '导体 R20 采用保存输入独立给定；此项为材料电阻率，不能替代 R20 上限。')
            add(f'{prefix} · 芯 {index} · 导体温度系数 α20', material.get('temperature_coefficient_20'), 'K⁻¹',
                query('1-1',1,'temperature_coefficient_20_per_k',conditions) if valid else None)
            form = {'stranded_round':'Round, stranded','stranded_round_compacted':'Round, stranded',
                    'solid_round':'Round, solid'}.get(conductor.get('form'))
            insulation = next(((materials[l['material']].get('standard_kind') or '').lower()
                               for l in core['layers'] if l['role']=='insulation'), '')
            # No Milliken subtype or insulation system is guessed.
            system = 'All' if kind=='aluminium' or form=='Round, solid' else 'Extruded or Mineral' if insulation in ('xlpe','pe','epr','hepr','pvc') else None
            for coefficient in ('ks','kp'):
                add(f'{prefix} · 芯 {index} · '+('集肤系数 ks' if coefficient=='ks' else '邻近系数 kp'),
                    parameters.get(coefficient), '1', query('1-1',2,coefficient,
                        dict(conductor_type=form,insulation_system=system,conductor_material=kind)) if valid and form and system else None)
        layers = [(f'芯 {i} · ',l) for i,c in enumerate(cable['cores'],1) for l in c['layers']]
        layers += [('',l) for l in cable.get('common_layers',[])]
        for sub, layer in layers:
            material=materials[layer['material']]; kind=(material.get('standard_kind') or '').lower()
            role=layer['role']; conditions=None; note=''
            if role=='insulation' and kind in ('xlpe','pe','pvc','epr'):
                conditions=dict(material=kind,material_role='insulation')
                if kind in ('pvc','epr'):conditions['u_v']=cable['rating']['u']
            elif role in ('oversheath','bedding') and kind in ('pvc','pe'):
                # PVC protective row is 5 at <=35 kV. The final Table 1 note
                # explicitly requires the corresponding insulating grade.
                conditions=dict(material=kind,material_role='insulation' if kind=='pvc' else 'protective_covering')
                if kind=='pvc':
                    conditions['u_v']=cable['rating']['u']
                    note='保护护层按表末塑料/弹性体表注采用对应绝缘等级；≤35 kV 保护护层行另列 5 K·m/W，不能脱离表注混用。'
            # Unknown semiconductor formulation/filler grade stays uncovered.
            add(f'{prefix} · {sub}{ROLES.get(role,"结构层")}热阻率',material.get('thermal_resistivity'),'K·m/W',
                query('2-1',1,'thermal_resistivity_k_m_w',conditions) if conditions else None,note)
    for section in document['sections']:
        for region in [section.get('medium'), section.get('backfill'), *section.get('soil_layers',[])]:
            if not region:
                continue
            material=materials[region['material']]
            add('敷设介质 · '+(material.get('label') or '材料')+'热阻率',material.get('thermal_resistivity'),'K·m/W',
                note='保存的现场/工程材料输入；不能按材料名称套用某一国家或参考环境的土壤值。')
        for duct in section.get('enclosures',[]):
            material=materials[duct['material']]; kind=(material.get('standard_kind') or '').lower()
            add('管壁材料热阻率',material.get('thermal_resistivity'),'K·m/W',
                query('2-1',1,'thermal_resistivity_k_m_w',dict(material=kind,material_role='duct_installation'))
                if kind in ('pvc','pe','concrete','fibre','asbestos','earthenware') else None)
    return rows
