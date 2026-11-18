"""Admission for reviewed local actions; preview is not an execution location."""
from fastapi import HTTPException


# These formal local methods deliberately have no unsaved-preview entry point.
# This list does not admit native-reference, FEM, training or remote simulation.
FORMAL_LOCAL = frozenset({
    ('cablesim.gb50217-correction', 'steady-rating'),
    ('cablesim.cable-geometry', 'concentric-model'),
    ('cablesim.cable-geometry', 'installation-scene'),
})
SIMULATION_TASKS = frozenset({'transient-temperature', 'sheath-losses',
                            'electrothermal-steady', 'iec-fem-comparison'})


def require_local(research, definition):
    """Check every method before proposal and again immediately before preflight."""
    def refuse(message):
        raise HTTPException(422, {'code': 'NATIVE_EXECUTION_UNAVAILABLE', 'message': message})

    if definition.get('task') in SIMULATION_TASKS or definition.get('verification'):
        refuse('此研究须通过工作台确认超算位置与核时；边车不提交原生仿真或收敛计算。')
    methods = [definition['method']]
    methods.extend(row['method'] for row in definition.get('crosschecks', []))
    methods.extend(row['method'] for row in definition.get('candidate_completions', {}).values())
    primary = None
    for method in methods:
        plugin, capability = research.resolve(method)
        if primary is None: primary = (plugin, capability)
        remote = hasattr(research.executor, 'required') and research.executor.required(plugin.manifest.id, capability.id)
        if capability.solver != 'local' or remote:
            refuse('此方法的清单或宿主执行配置要求超算；请在工作台确认计算位置和核时后提交。')
        if not capability.preview and (plugin.manifest.id, capability.id) not in FORMAL_LOCAL:
            refuse('此方法未开放给边车的本机运行；请在工作台核对执行环境。原生求解不会在本机代算。')
    return primary
