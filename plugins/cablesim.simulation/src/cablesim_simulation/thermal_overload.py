"""Implicit FEM overload from the actual nonuniform preloaded steady state."""
from math import isfinite


def advance(system, initial_currents, loaded_currents, heat_capacities, step_s, duration_s,
            thresholds_k, observed_circuit):
    """Backward Euler with converged electrical and duct constitutive feedback.

    Capacity values are J/(m³ K), one explicit value per semantic mesh region.
    Crossing intervals, not an interpolated point, bound the allowable duration.
    The caller must independently halve the time step and refine the spatial mesh.
    """
    from skfem import BilinearForm, asm
    from scipy.sparse.linalg import splu, cg, LinearOperator
    np = system.np
    expected = {r['uid'] for r in system.regions}
    if set(heat_capacities) != expected:
        raise ValueError('heat_capacities：材料域热容绑定不完整；缺少 '+str(sorted(expected-set(heat_capacities)))+
                         '，多余 '+str(sorted(set(heat_capacities)-expected))+'。')
    if any(
        not isinstance(v,(int,float)) or isinstance(v,bool) or not isfinite(v) or v<=0 for v in heat_capacities.values()):
        raise ValueError('heat_capacities：每个实际材料域均须有正体积热容，单位 J/(m³·K)。')
    if not isfinite(step_s) or step_s<=0 or not isfinite(duration_s) or duration_s<step_s or duration_s/step_s>10000:
        raise ValueError('time：正时间步和总时长须构成1–10000步，单位 s。')
    steps = round(duration_s/step_s)
    if abs(steps*step_s-duration_s)>1e-8:
        raise ValueError('duration_s：总时长须为时间步的整数倍。')
    if system.convection or system.inner_nodes:
        raise ValueError('thermal_boundaries：此暂态分支只覆盖外部给定温度/绝热边界，不覆盖给定芯温或表面对流。')
    if any(not isfinite(t) or t<=0 for t in thresholds_k) or not thresholds_k or len(set(thresholds_k))!=len(thresholds_k):
        raise ValueError('thresholds_k：须给出互不重复的正绝对温度。')
    cables = system.model.cables
    if len(initial_currents)!=len(cables) or len(loaded_currents)!=len(cables) or any(
        not isfinite(i) or i<0 for i in initial_currents+loaded_currents):
        raise ValueError('currents：必须逐缆提供非负电流，单位 A。')
    selected = [c for c in cables if c.circuit==observed_circuit]
    if not selected:
        raise ValueError('observed_circuit：请选择模型中实际存在的回路。')
    ids = system.ids[::4] if system.controls.element_order==2 else system.ids
    capacity = np.asarray([heat_capacities[system.regions[i-1]['uid']] for i in ids])[:,None]
    @BilinearForm
    def storage(u,v,w):
        return w.capacity*u*v
    mass = asm(storage,system.basis,capacity=capacity)
    D = np.asarray(sorted(system.dirichlet),dtype=int)
    free = np.setdiff1d(np.arange(system.basis.N),D)
    prescribed = np.zeros(system.basis.N)
    prescribed[D] = [system.dirichlet[int(n)] for n in D]
    steady = system.state(initial_currents)
    previous = steady.pop('temperature_k')
    initial_digest = __import__('hashlib').sha256(previous.tobytes()).hexdigest()
    def peaks(temperature):
        return {c.uid:float(temperature[system.nodes[c.layers[0].uid]].max()) for c in cables}
    def means(temperature):
        return {c.uid:float(system.weights[c.layers[0].uid]@temperature/system.weights[c.layers[0].uid].sum()) for c in cables}
    curve = [{'time_s':0.,'conductor_max_temperature_k':peaks(previous),'conductor_mean_temperature_k':means(previous)}]
    initial_peak = max(curve[0]['conductor_max_temperature_k'][c.uid] for c in selected)
    crossings = {t:({'status':'already_at_limit','safe_duration_s':0.,'bracket_s':[0.,0.]} if initial_peak>=t else None) for t in thresholds_k}
    factor = None;history = []
    for index in range(1,1 if all(value is not None for value in crossings.values()) else steps+1):
        temperature = previous.copy()
        for iteration in range(1,system.controls.max_iterations+1):
            system.update_duct_conduction(temperature)
            powers = system.electrical_powers(loaded_currents,temperature)
            load = system.heat_load(powers)
            matrix = system.K+mass/step_s
            right = load+mass@(previous-system.reference)/step_s
            reduced = matrix[free][:,free].tocsr()
            if factor is None:
                direct = splu(reduced.tocsc())
                factor = LinearOperator(reduced.shape,matvec=direct.solve)
            solution,status = cg(reduced,right[free]-matrix[free][:,D]@prescribed[D],M=factor,
                                 rtol=1e-11,atol=1e-12,maxiter=200)
            if status or not np.isfinite(solution).all():
                raise ValueError(f'time_s={index*step_s}：当前暂态矩阵未收敛，未返回近似温度。')
            proposed = prescribed.copy()+system.reference;proposed[free] = solution+system.reference
            update = float(np.max(np.abs(proposed-temperature)))
            if update<=system.controls.tolerance_k:
                temperature = proposed
                break
            temperature += system.controls.relaxation*(proposed-temperature)
        else:
            raise ValueError(f'time_s={index*step_s}：电热/管内热阻反馈未收敛。')
        air = system.update_duct_conduction(temperature)
        load = system.heat_load(system.electrical_powers(loaded_currents,temperature))
        storage_rate = mass@(temperature-previous)/step_s
        residual = storage_rate+system.K@(temperature-system.reference)-load
        free_error = float(np.max(np.abs(residual[free]))) if len(free) else 0.
        source = float(load.sum());stored = float(storage_rate.sum());outflow = -float(residual[D].sum())
        balance = abs(source-stored-outflow)/max(abs(source),abs(stored),abs(outflow),1.)
        if free_error>max(1e-5,system.controls.tolerance_k) or balance>1e-6:
            raise ValueError(f'time_s={index*step_s}：接受温度的暂态储能/边界能量校核失败。')
        now = peaks(temperature);time = index*step_s
        curve.append({'time_s':time,'conductor_max_temperature_k':now,'conductor_mean_temperature_k':means(temperature)})
        peak = max(now[c.uid] for c in selected)
        last_peak = max(curve[-2]['conductor_max_temperature_k'][c.uid] for c in selected)
        for threshold in thresholds_k:
            if crossings[threshold] is None and peak>=threshold:
                estimate = time-step_s+step_s*(threshold-last_peak)/(peak-last_peak)
                crossings[threshold] = {'status':'crossed','safe_duration_s':time-step_s,
                    'estimated_time_s':estimate,'bracket_s':[time-step_s,time]}
        history.append({'time_s':time,'iterations':iteration,'temperature_update_inf_k':update,
            'source_heat_w_m':source,'storage_rate_w_m':stored,'boundary_heat_w_m':outflow,
            'energy_relative_residual':balance,'physical_residual_inf_w_m':free_error,'duct_air_states':air})
        previous = temperature
        if all(value is not None for value in crossings.values()):
            break
    for threshold in thresholds_k:
        if crossings[threshold] is None:
            crossings[threshold] = {'status':'not_reached_within_horizon','observed_duration_s':curve[-1]['time_s'],
                'safe_duration_s':None,'bracket_s':None}
    return {'initial_steady_state':steady,'initial_nodal_temperature_sha256':initial_digest,
        'initial_currents_a':list(initial_currents),'loaded_currents_a':list(loaded_currents),
        'observed_circuit':observed_circuit,'step_s':step_s,'requested_duration_s':duration_s,
        'curves':curve,'crossings':[{'threshold_k':t,**crossings[t]} for t in thresholds_k],
        'time_history':history,'temperature_k':previous,
        'discretization':'backward Euler; nonlinear feedback converged at each time step',
        'engineering_approval':False}
