"""Read-only AST comparison; never imports or runs the method being audited.

Run: python plugins/cablesim.standards-basis/validation/constants.py
"""
import ast
import importlib.util
from hashlib import sha256
import json
from pathlib import Path

FIELDS = {'electrical_resistivity_20': 'resistivity_20_ohm_m',
          'temperature_coefficient_20': 'temperature_coefficient_20_per_k',
          'thermal_resistivity': 'thermal_resistivity_k_m_w'}
MATERIAL_ROWS = {'material/cu': 'iec60287-1-1-table1/r1',
                 'material/semi': 'iec60287-2-1-table1/r28',
                 'material/xlpe': 'iec60287-2-1-table1/r7',
                 'material/pvc': 'iec60287-2-1-table1/r18'}


def compare(root):
    root = Path(root)
    basis_path = root/'plugins/cablesim.standards-basis/src/cablesim_standards_basis/basis.json'
    spec=importlib.util.spec_from_file_location('audit_basis_library',basis_path.parent/'library.py')
    library=importlib.util.module_from_spec(spec);spec.loader.exec_module(library)
    basis = library.BasisLibrary(basis_path.parent).data
    records = basis['records']
    source = root/'plugins/cablesim.iec60287/src/cablesim_iec60287/engineering.py'
    raw = source.read_bytes()
    rows = []
    for node in ast.walk(ast.parse(raw)):
        if not isinstance(node, ast.Dict):
            continue
        values = {}
        for key, value in zip(node.keys, node.values):
            if isinstance(key, ast.Constant) and isinstance(key.value, str):
                values[key.value] = value
        material_id = values.get('id')
        if not isinstance(material_id, ast.Constant) or not str(material_id.value).startswith('material/'):
            continue
        for field, quantity in FIELDS.items():
            value = values.get(field)
            if value is None:
                continue
            literal = value.value if isinstance(value, ast.Constant) and type(value.value) in (int, float) else None
            prefix = MATERIAL_ROWS.get(material_id.value)
            reference = next((r for r in records if prefix and r['id'].startswith(prefix+'/') and r['quantity']['key'] == quantity), None)
            status = '依据未覆盖' if literal is None or reference is None else '一致' if literal == reference['value'] else '不一致'
            reason = ''
            if literal is None:
                reason = '工程师输入参数，无固定常数；缺材料构造与实测/声明来源，不能自动选标准格。'
            elif material_id.value == 'material/pvc':
                reason = '15 kV保护护层表格列值为5；插件明确采用绝缘等级口径6。表注允许相应绝缘等级口径，需研究线程确认材料配方和角色，不能据此自动判算法错误。'
            elif material_id.value == 'material/semi':
                reason = '数值一致；仍需核对表注a的相邻介电层等效条件。'
            rows.append({'material_id': material_id.value, 'field': field, 'value': literal,
                         'status': status, 'reason': reason, 'line': value.lineno,
                         'source': str(source.relative_to(root)).replace('\\','/'),
                         'source_sha256': sha256(raw).hexdigest(),
                         'basis_record_id': reference['id'] if reference else None,
                         'basis_value': reference['value'] if reference else None,
                         'citation': f"{reference['standard']}—{reference['edition']} {reference['table']}，第{reference['printed_page']}页（PDF第{reference['pdf_page']}页）" if reference else None})
    for field in ('ks', 'kp'):
        inputs = root/'plugins/cablesim.iec60287/src/cablesim_iec60287/domain.py'
        tree = ast.parse(inputs.read_bytes())
        selected = [node for node in ast.walk(tree) if isinstance(node,ast.Dict)
                    and any(isinstance(k,ast.Constant) and k.value==field for k in node.keys)]
        assert selected, 'ks/kp输入映射消失，请重新审阅常数使用位置。'
        rows.append({'field':field,'status':'依据未覆盖','value':None,
                     'source':str(inputs.relative_to(root)).replace('\\','/'),
                     'source_sha256':sha256(inputs.read_bytes()).hexdigest(),
                     'reason':'插件从工程师参数读取，无内置ks/kp常数；表2已覆盖，但此次对拍没有指定导体形式/绝缘系统及输入值，不能判一致。'})
    return {'basis_version':basis['version'],'basis_sha256':sha256(basis_path.read_bytes()).hexdigest(),
            'rows':rows,'approval':'not_granted'}


if __name__ == '__main__':
    print(json.dumps(compare(Path(__file__).resolve().parents[3]),ensure_ascii=False,indent=2))
