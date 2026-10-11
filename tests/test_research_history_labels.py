from copy import deepcopy

from backend.kernel.workspace import model_edit_label


def test_saved_load_change_names_its_actual_before_and_after_values():
    before = {'domain': {'circuits': [{'id': 'circuit/one', 'label': '回路 1'}],
                         'load_cases': [{'id': 'load/steady', 'currents': {'circuit/one': 600.0}}]}}
    after = deepcopy(before)
    after['domain']['load_cases'][0]['currents']['circuit/one'] = 650.0
    assert model_edit_label(before, after, '保存领域文档') == '修改负荷：回路 1电流 600 → 650 A'
    assert before['domain']['load_cases'][0]['currents']['circuit/one'] == 600


def test_structure_change_is_readable_and_existing_specific_labels_survive():
    assert model_edit_label({'domain': {'cable_types': []}},
                            {'domain': {'cable_types': [{'name': '型号'}]}}, '保存领域文档') == '修改电缆结构参数'
    assert model_edit_label({'domain': {}}, {'domain': {}}, '修改工程名称') == '修改工程名称'
