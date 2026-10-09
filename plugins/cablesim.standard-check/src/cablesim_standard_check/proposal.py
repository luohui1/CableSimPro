"""Bounded XLPE design suggestions; table values never become measured facts."""
def propose(values, insulation_limit, sources, data):
    u0, u = map(int, values['voltage'].split('/'))
    family = next((family for a, b, family in data['voltage_families'] if (a, b) == (u0, u)), None)
    area = values['area_m2'] * 1e6
    if family is None:
        raise ValueError('/voltage：表外电压，未覆盖。')
    if family == 'hv' and values['construction'] != 'single_core':
        raise ValueError('/construction：GB/T 11017 高压三芯结构未覆盖。请选择单芯或其他电压。')
    thickness = insulation_limit(family, u0, round(area, 8), 'XLPE')
    if thickness is None:
        raise ValueError('/area_m2：所选电压的 XLPE 厚度表不含此截面，未生成近似结构。')
    source = sources[family]
    rule = data['rules']['insulation-nominal'][family]
    reference = {**source, **rule, 'pdf_page': rule['printed_page'] + source['page_offset']}
    n = 1 if values['construction'] == 'single_core' else 3
    conductor = {'material': 'material/conductor', 'form': 'unspecified', 'nominal_area': values['area_m2'],
                 'diameter': None, 'r20': None, 'conductor_class': None, 'lay_factor': None}
    document = {'schema_version': 'cablesim.type-draft/1', 'name': '标准结构草稿',
        'materials': [{'id': 'material/conductor', 'label': '铜' if values['conductor'] == 'copper_bare' else '铝',
                       'category': 'conductor', 'standard_kind': values['conductor']},
                      {'id': 'material/insulation', 'label': 'XLPE', 'category': 'insulation', 'standard_kind': 'XLPE'}],
        'cable_types': [{'id': 'cable_type/design', 'label': '标准结构草稿', 'construction': values['construction'],
            'rating': {'u0': u0, 'u': u, 'um': None, 'max_conductor_temperature': {}},
            'cores': [{'id': f'core/{i+1}', 'conductor': dict(conductor), 'x': None, 'z': None,
                       'layers': [{'role': 'insulation', 'material': 'material/insulation', 'thickness': thickness/1000, 'form': 'smooth'}]} for i in range(n)],
            'common_layers': []}], 'circuits': [], 'sections': [], 'load_cases': [], 'criteria': {}, 'measurements': [], 'provenance': {}}
    import json
    rows = []
    for i in range(n):
        path = f'/cable_types/cable_type~1design/cores/core~1{i+1}/layers/insulation/thickness'
        document['provenance'][path] = {'kind': 'standard', 'reference': json.dumps(reference, ensure_ascii=False), 'reviewed': False}
        rows.append({'label': f'芯 {i+1} · 绝缘标称厚度', 'path': path, 'value': thickness/1000, 'unit': 'm',
                     'basis': 'standard_value', 'source': reference})
    return {'schema': 'cablesim.cable-design-proposal/1', 'document': document, 'rows': rows,
            'next_input': {'schema_version': 'cablesim.core-layout-request/1', 'area_m2': values['area_m2'],
                'thickness_m': thickness/1000, 'construction': values['construction'], 'form': values['form'],
                **{k: values[k] for k in ('diameter_m', 'gap_m') if k in values}},
            'limitations': ['仅提出 XLPE 绝缘及导体几何；屏蔽、护套、铠装、制造数据和物性需另行设计。',
                            '标准厚度不是实测最薄点；提案不构成合格判定或型号发布。']}
