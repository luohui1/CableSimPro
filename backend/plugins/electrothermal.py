"""Same buried FEM mesh, specified electrical losses, stable R(T), bracketed current.

Constant thermal conductivities make a nine-source FEM response basis exact for
this *declared* lumped electrical model. No electromagnetic FE solve is implied.
"""
from math import log, pi, sqrt
from pathlib import Path
import json
from .buried import buried_mesh, assemble_conduction
from .buried_contract import BuriedField
from .electrothermal_contract import ElectrothermalArgs, ElectrothermalSummary, preflight, validate_electrothermal


class ElectrothermalError(ValueError):
    pass


def dielectric_parameters(s):
    # U0 is already conductor-to-screen RMS kV. Do not divide it by sqrt(3).
    c = s.cable
    r = c.radii_mm()
    capacitance = 2*pi*8.8541878128e-12*c.relative_permittivity/log(r[2]/r[1])
    return capacitance, 2*pi*c.frequency_hz*capacitance*(1000*c.u0_kv)**2*c.tan_delta


def mesh_arguments(args):
    return dict(conductor_powers_w_m=[0., 0., 0.], conductor_k_w_m_k=args.conductor_k_w_m_k,
                metal_screen_k_w_m_k=args.metal_screen_k_w_m_k, domain_scale=args.domain_scale, resolution=args.resolution)


class ResponseModel:
    """Nine normalized source columns: conductors, metal screens, dielectrics.

    Resistance uses each conductor's area-average temperature, while the limit is
    applied to the hottest conductor node. Screen loss ratio is fixed by the user,
    not derived from a bonding or induced-current model. Dielectric source density
    is proportional to 1/r² in each insulation, normalized to omega*C*U0²*tanδ.
    """
    def __init__(self, mesh, scenario, arguments):
        import numpy as np
        from scipy.sparse.linalg import splu
        from skfem import LinearForm, asm
        self.np = np
        self.s, self.args = preflight(scenario, arguments)
        self.mesh = mesh
        BuriedField.model_validate(dict(mesh, values=[273.15]*len(mesh['points'])))
        c = self.s.cable
        ks = [self.args.conductor_k_w_m_k, 1/c.semicon_rho_k_m_w, 1/c.insulation_rho_k_m_w,
              1/c.semicon_rho_k_m_w, self.args.metal_screen_k_w_m_k, 1/c.jacket_rho_k_m_w]
        self.basis, self.matrix = assemble_conduction(mesh, {i: ks[(i-1)%6] for i in range(1,19)} | {19:1/self.s.installation.soil_rho_k_m_w})
        self.boundary = np.asarray(mesh['boundary_nodes'], dtype=int)
        self.free = np.setdiff1d(np.arange(self.basis.N), self.boundary)
        ids, cells = np.asarray(mesh['domain_ids']), np.asarray(mesh['triangles'])
        self.phase_nodes = [np.unique(cells[ids == tag]) for tag in (1, 7, 13)]
        columns = []
        for kind, offsets in [('conductor', (1,7,13)), ('screen', (5,11,17)), ('dielectric', (3,9,15))]:
            for phase, domain in enumerate(offsets):
                x, y = mesh['cable_centers_m'][phase]
                @LinearForm
                def source(v, w):
                    return v/((w.x[0]-x)**2+(w.x[1]-y)**2) if kind == 'dielectric' else v
                load = asm(source, self.basis.with_elements(np.flatnonzero(ids == domain)))
                integral = float(load.sum())
                if not integral > 0:
                    raise ElectrothermalError('EMPTY_LOSS_DOMAIN')
                columns.append(load/integral)
        self.sources = np.column_stack(columns)
        self.response = np.zeros_like(self.sources)
        factor = splu(self.matrix[self.free][:,self.free].tocsc())
        self.response[self.free] = factor.solve(self.sources[self.free])
        if not np.isfinite(self.response).all() or np.min(self.response) < -1e-6:
            raise ElectrothermalError('NONPHYSICAL_UNIT_RESPONSE')
        self.capacitance, self.wd = dielectric_parameters(self.s)
        self.effective = self.response[:,:3] + c.screen_loss_factor*self.response[:,3:6]
        self.base_rise = self.wd*self.response[:,6:].sum(axis=1)
        self.mean_response = self.sources[:,:3].T@self.effective
        self.base_mean = self.sources[:,:3].T@self.base_rise
        self.r20ac_m = c.r20_ohm_km*(1+c.ac_extra_factor)/1000
        self.rho = float(max(abs(np.linalg.eigvals(self.mean_response))))
        self.reference_temperature = self.s.installation.ambient_temperature_c

    def state(self, current_a, verify_iterations=False):
        np = self.np
        if not np.isfinite(current_a) or current_a < 0:
            raise ElectrothermalError('INVALID_CURRENT')
        alpha = self.args.alpha20_per_k
        gain = current_a**2*self.r20ac_m
        spectral = gain*alpha*self.rho
        if spectral >= 1-1e-8:
            raise ElectrothermalError('UNSTABLE_ELECTROTHERMAL_FEEDBACK')
        base = 1+alpha*(self.reference_temperature+self.base_mean-20)
        p = np.linalg.solve(np.eye(3)-gain*alpha*self.mean_response, gain*base)
        rise = self.base_rise+self.effective@p
        mean = self.reference_temperature+self.sources[:,:3].T@rise
        peaks = np.asarray([self.reference_temperature+rise[nodes].max() for nodes in self.phase_nodes])
        expected = gain*(1+alpha*(mean-20))
        residual = float(np.max(abs(p-expected)))
        if not np.isfinite(rise).all() or p.min() < 0 or rise.min() < -1e-6 or residual > 1e-7*max(float(p.sum()),1):
            raise ElectrothermalError('INVALID_FEEDBACK_SOLUTION')
        trace = []
        if verify_iterations:
            trial = gain*base
            for step in range(1, 201):
                next_p = gain*(base+alpha*self.mean_response@trial)
                update = float(np.max(abs(next_p-trial)))
                trace.append({'step':step,'conductor_losses_w_m':next_p.tolist(),'update_inf_w_m':update})
                trial = next_p
                if update <= 1e-10*max(float(p.max()),1):
                    break
            else:
                raise ElectrothermalError('FEEDBACK_ITERATION_NOT_CONVERGED')
            if float(np.max(abs(trial-p))) > 1e-7*max(float(p.max()),1):
                raise ElectrothermalError('INDEPENDENT_FIXED_POINT_MISMATCH')
        return dict(current_a=float(current_a),powers=p,rise=rise,means=mean,peaks=peaks,
                    spectral_radius=spectral,feedback_residual_w_m=residual,trace=trace)

    def invert(self):
        """Return the feasible lower endpoint, plus a finite over-limit witness."""
        limit = self.s.cable.max_temperature_c
        low = self.state(0.)
        if float(max(low['peaks'])) >= limit:
            raise ElectrothermalError('ZERO_CURRENT_OVER_TEMPERATURE_LIMIT')
        alpha = self.args.alpha20_per_k
        cap = self.args.maximum_search_current_a
        # Stable probe, not accepting an unstable trial as an over-temperature root.
        if alpha:
            cap = min(cap, sqrt(.99/(self.r20ac_m*alpha*self.rho)))
        high = self.state(cap)
        history = []
        def record(state):
            history.append({'current_a':state['current_a'],'maximum_conductor_temperature_c':float(max(state['peaks'])),
                            'feedback_spectral_radius':state['spectral_radius']})
        record(low); record(high)
        if float(max(high['peaks'])) <= limit:
            raise ElectrothermalError('AMPACITY_NOT_BRACKETED_WITHIN_SEARCH_LIMIT')
        for _ in range(80):
            mid = self.state((low['current_a']+high['current_a'])/2)
            record(mid)
            if float(max(mid['peaks'])) > limit:
                high = mid
            else:
                low = mid
            if high['current_a']-low['current_a'] <= .01 and limit-float(max(low['peaks'])) <= .005:
                return low, dict(lower_a=low['current_a'],upper_a=high['current_a'],
                    lower_max_temperature_c=float(max(low['peaks'])),upper_max_temperature_c=float(max(high['peaks'])),
                    evaluations=len(history)), history
        raise ElectrothermalError('AMPACITY_BRACKET_DID_NOT_CONVERGE')

    def export_state(self, state, bracket=None):
        np = self.np
        # Verify the final point iteratively, including the coupled three phases.
        state = self.state(state['current_a'], verify_iterations=True)
        if float(max(state['peaks'])) > 150:
            raise ElectrothermalError('ACCEPTED_POINT_EXCEEDS_150_C_REFERENCE_RANGE')
        p, rise = state['powers'], state['rise']
        screen = p*self.s.cable.screen_loss_factor
        dielectric = np.full(3,self.wd)
        powers = np.concatenate((p,screen,dielectric))
        load = self.sources@powers
        residual = self.matrix@rise-load
        total = float(powers.sum())
        outflow = -float(residual[self.boundary].sum())
        s, a = self.s, self.args
        current = state['current_a']
        resistances = s.cable.r20_ohm_km*(1+s.cable.ac_extra_factor)*(1+a.alpha20_per_k*(state['means']-20))
        summary = ElectrothermalSummary(mode=a.mode,ampacity_a=current if a.mode=='ampacity' else None,
            evaluated_current_a=current,temperature_limit_c=s.cable.max_temperature_c,
            maximum_temperature_c=float(rise.max())+self.reference_temperature,
            conductor_max_temperatures_c=state['peaks'].tolist(),conductor_mean_temperatures_c=state['means'].tolist(),
            conductor_ac_resistances_ohm_km=resistances.tolist(),conductor_losses_w_m=p.tolist(),
            screen_losses_w_m=screen.tolist(),dielectric_losses_w_m=dielectric.tolist(),
            ambient_temperature_c=self.reference_temperature,source_heat_w_m=total,boundary_heat_w_m=outflow,
            energy_relative_residual=abs(total-outflow)/total if total else None,
            free_equation_residual_inf_w_m=float(abs(residual[self.free]).max()),
            feedback_residual_w_m=state['feedback_residual_w_m'],feedback_spectral_radius=state['spectral_radius'],
            feedback_iterations=len(state['trace']),alpha20_per_k=a.alpha20_per_k,r20_ohm_km=s.cable.r20_ohm_km,
            ac_extra_factor=s.cable.ac_extra_factor,screen_loss_factor=s.cable.screen_loss_factor,
            capacitance_f_m=self.capacitance,coefficient_basis=a.coefficient_basis,
            within_temperature_limit=bool(max(state['peaks'])<=s.cable.max_temperature_c),bracket=bracket,
            domain_scale=a.domain_scale,resolution=a.resolution,half_width_m=self.mesh['half_width_m'],
            bottom_depth_m=self.mesh['bottom_depth_m'],soil_k_w_m_k=1/s.installation.soil_rho_k_m_w,
            nodes=int(self.basis.N),elements=len(self.mesh['triangles']))
        field = BuriedField.model_validate(dict(self.mesh,values=(rise+self.reference_temperature+273.15).tolist()))
        evidence = {'feedback_iterations':state['trace'],'mean_response_k_m_w':self.mean_response.tolist(),
                    'source_integrals':self.sources.sum(axis=0).tolist(),'thermal_basis_solves':9,
                    'electrical_temperature':'area-average conductor','temperature_limit':'maximum conductor node',
                    'dielectric_source':'normalized coaxial 1/r^2','feedback_solution':'exact 3x3 elimination plus Picard cross-check'}
        return field.model_dump(mode='json'),summary.model_dump(mode='json'),evidence


def electrothermal_reference(recipe, scenario, arguments):
    import numpy as np
    import meshio
    s, args = preflight(scenario, arguments)
    mesh = buried_mesh(recipe, scenario, mesh_arguments(args))
    model = ResponseModel(mesh, scenario, args)
    if args.mode == 'ampacity':
        state, bracket, roots = model.invert()
    else:
        state, bracket, roots = model.state(s.operating_current_a), None, []
    field, summary, evidence = model.export_state(state, bracket)
    evidence['current_bracketing'] = roots
    files = ['buried.msh','temperature.vtu','thermal.json','field.json','iteration.json']
    if args.compare_domain_scale is not None:
        # Old buried mesher writes a fixed filename: preserve the primary mesh first.
        Path('buried.msh').rename('primary.msh')
        other_args = args.model_copy(update={'domain_scale':args.compare_domain_scale,'compare_domain_scale':None})
        other_mesh = buried_mesh(recipe,scenario,mesh_arguments(other_args))
        Path('buried.msh').rename('comparison.msh');Path('primary.msh').rename('buried.msh')
        other = ResponseModel(other_mesh,scenario,other_args)
        second, second_bracket, second_trace = other.invert()
        other_field, other_summary, other_evidence = other.export_state(second,second_bracket)
        validate_electrothermal(other_field,other_summary,scenario,other_args)
        Path('comparison-field.json').write_text(json.dumps(other_field,allow_nan=False),encoding='utf-8')
        delta = 100*(second['current_a']-state['current_a'])/state['current_a']
        comparison = dict(domain_scale=other_args.domain_scale,ampacity_a=second['current_a'],
            primary_current_max_temperature_c=float(max(other.state(state['current_a'])['peaks'])),
            current_change_percent=delta,pairwise_tolerance_percent=args.domain_current_tolerance_percent,
            within_pairwise_tolerance=abs(delta)<=args.domain_current_tolerance_percent,
            nodes=other_summary['nodes'],elements=other_summary['elements'])
        summary['domain_comparison'] = comparison
        Path('comparison.json').write_text(json.dumps({'summary':other_summary,'current_bracketing':second_trace,'feedback_evidence':other_evidence},allow_nan=False),encoding='utf-8')
        files += ['comparison.msh','comparison.json','comparison-field.json']
    summary = ElectrothermalSummary.model_validate(summary).model_dump(mode='json')
    validate_electrothermal(field,summary,scenario,args)
    meshio.Mesh(np.asarray(field['points']),[('triangle',np.asarray(field['triangles']))],
        point_data={'temperature_c':np.asarray(field['values'])-273.15},
        cell_data={'domain_id':[np.asarray(field['domain_ids'])]}).write('temperature.vtu')
    for name,payload in [('field.json',field),('thermal.json',summary),('iteration.json',evidence)]:
        Path(name).write_text(json.dumps(payload,ensure_ascii=False,allow_nan=False),encoding='utf-8')
    return {'files':files,'summary':summary,'warnings':[
        '系数损耗参考模型：交流附加系数和屏蔽损耗系数读取工程输入，不求解集肤、邻近、环流或接地方式。',
        'R(T)使用导体面积平均温度，温度限值检查最热导体节点；不是逐股或电磁场耦合。',
        '介质损耗使用导体对屏蔽RMS电压及同轴电场分布；材料常数、系数和来源须人工核对。',
        '土壤、各层热导率恒定；有限矩形域全边界恒温，无干燥、排管、回填、接触热阻或暂态。',
        '允许电流仅对应本模型、本输入和有限计算域；不是完整IEC60287实现或工程合格结论。',
        '域比较只是两个离散计算之间的差异，不证明剩余截断误差或网格无关。']}
