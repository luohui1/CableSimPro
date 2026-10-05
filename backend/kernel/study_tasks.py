"""Study objectives and their declared plugin capabilities, without physics."""

SIMULATION_TASKS = {
    'iec-fem-comparison': ('steady_state', 'IEC 与有限元对比', ['x-cablesim.iec-fem-comparison', 'x-cablesim.simulation-bundle']),
    'transient-temperature': ('transient', '暂态温升', ['x-cablesim.temperature-history', 'x-cablesim.temperature-field']),
    'sheath-losses': ('frequency_domain', '护套损耗', ['x-cablesim.sheath-losses', 'x-cablesim.loss-coefficients']),
    'electrothermal-steady': ('steady_state', '电热耦合', ['x-cablesim.temperature-field', 'x-cablesim.simulation-bundle']),
}


def validate_task(configuration, capability):
    task = configuration.task
    if task in SIMULATION_TASKS:
        if capability.id != task or capability.analysis != SIMULATION_TASKS[task][0] or capability.input_schema != 'cablesim.domain/1':
            from fastapi import HTTPException
            raise HTTPException(422, {'code': 'TASK_CAPABILITY_MISMATCH', 'message': '任务与方法能力不匹配，请从任务清单选择对应的完整发行锁。'})
        if configuration.driver.kind not in ('single', 'sweep', 'batch'):
            from fastapi import HTTPException
            raise HTTPException(422, {'code': 'TASK_DRIVER_NOT_SUPPORTED', 'message': '此仿真任务只接受单工况或明确工况扫描，不接受型号选型驱动。'})


def task_catalog(research):
    result = []
    for entry in research.methods():
        for cap in entry['capabilities']:
            if cap['id'] not in SIMULATION_TASKS:
                continue
            analysis, label, artifacts = SIMULATION_TASKS[cap['id']]
            if cap['analysis'] != analysis or cap['input_schema'] != 'cablesim.domain/1':
                continue
            result.append({'task': cap['id'], 'module': cap['id'], 'label': label,
                           'method': {**entry['method'], 'capability': cap['id']},
                           'analysis': analysis, 'required_artifacts': artifacts,
                           'execution_backend': entry['execution_policy']['backend'],
                           'input_contract_url': '/api/input-contracts', 'parameters_unit_system': 'SI',
                           'limitations': cap['limitations']})
    return result
