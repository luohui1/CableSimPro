"""多材料二维P1稳态导热、温变电阻迭代和有界电流反求。"""
from math import log, pi
from .thermal_mesh import build


class UnstableState(ValueError):
    """A load outside the stable steady-state branch, never a label."""


class ThermalSystem:
    def __init__(self, model, controls, prepared_mesh=None):
        import numpy as np
        from skfem import MeshTri, Basis, FacetBasis, ElementTriP1, ElementTriP2, BilinearForm, LinearForm, asm
        from skfem.helpers import dot, grad
        self.np, self.model, self.controls = np,model,controls
        points,cells,ids,self.regions = prepared_mesh if prepared_mesh is not None else build(model,controls)
        self.mesh = MeshTri(points.T,cells.T)
        element=ElementTriP2() if controls.element_order==2 else ElementTriP1()
        self.basis = Basis(self.mesh,element,intorder=4)
        if self.basis.N>controls.max_nodes:
            from cablesim_sdk.validation import FieldValueError
            raise FieldValueError(f'有限元有 {self.basis.N} 自由度，超过上限 {controls.max_nodes}；请调整局部/远场网格分配。','parameters','controls','max_nodes')
        self.points=self.basis.doflocs.T
        self.cells,self.ids=cells,ids
        if controls.element_order==2:
            # P2 values live on vertices and edge midpoints. Export all six
            # values as four visualization triangles; never drop midside DOFs.
            dofs=self.basis.element_dofs.T
            self.cells=dofs[:,[[0,3,5],[3,1,4],[5,4,2],[3,4,5]]].reshape(-1,3)
            self.ids=np.repeat(ids,4)
        if np.min(self.basis.dx.sum(axis=1)) <= 0:
            raise ValueError('退化单元。')
        k = np.asarray([self.regions[i-1]['k'] for i in ids])[:,None]
        @BilinearForm
        def conduction(u,v,w):
            return w.k*dot(grad(u),grad(v))
        self.K = asm(conduction,self.basis,k=k)
        self._duct_feedback = []
        self._fixed_conduction = self.K.copy()
        for cable in model.cables:
            if cable.duct is None or cable.duct.air_law is None:
                continue
            region_ids = [r['id'] for r in self.regions if r['uid'] == cable.duct.uid+'/air']
            mask = np.isin(ids,region_ids)
            unit_matrix = asm(conduction,self.basis,k=mask[:,None].astype(float))
            initial_k = log(cable.duct.inner_radius_m/cable.layers[-1].outer_radius_m)/(2*pi*cable.duct.air_resistance_k_m_w)
            self._fixed_conduction -= initial_k*unit_matrix
            interfaces = []
            endpoints = self.mesh.p[:,self.mesh.facets]
            distance = np.sqrt((endpoints[0]-cable.x_m)**2+(endpoints[1]-cable.z_m)**2)
            for radius in (cable.layers[-1].outer_radius_m,cable.duct.inner_radius_m):
                selected = np.flatnonzero(np.all(np.isclose(distance,radius,atol=1e-8,rtol=0),axis=0))
                if not len(selected):
                    raise ValueError('duct.air_law：未找到管内空气两侧共形界面。')
                interfaces.append(FacetBasis(self.mesh,element,facets=selected,intorder=4))
            self._duct_feedback.append((cable,unit_matrix,interfaces))
        @LinearForm
        def unit(v,w):
            return v
        self.weights, self.nodes = {},{}
        for r in self.regions:
            mask = np.flatnonzero(ids == r['id'])
            weights = asm(unit,self.basis.with_elements(mask))
            if weights.sum() <= 0:
                raise ValueError('材料域面积非正：'+r['uid'])
            # 分区可能把同一语义区域切成多个实体；按UID累计，绝不覆盖热源面积。
            self.weights[r['uid']] = self.weights.get(r['uid'],np.zeros(self.basis.N))+weights
            self.nodes[r['uid']] = np.union1d(self.nodes.get(r['uid'],np.array([],dtype=int)),np.unique(self.basis.element_dofs[:,mask]))
        self.boundaries = {}
        facets = self.mesh.boundary_facets()
        endpoints = self.mesh.p[:,self.mesh.facets[:,facets]]
        assigned = np.zeros(len(facets),dtype=int)
        def boundary(name, mask):
            selected = facets[mask]
            if len(selected):
                self.boundaries[name] = FacetBasis(self.mesh,element,facets=selected,intorder=4)
                assigned[mask] += 1
        if model.environment.kind == 'ground':
            x0,z0,x1,z1 = model.environment.background.bounds_m
            for name,axis,value in [('left',0,x0),('right',0,x1),('bottom',1,z0),('top',1,z1)]:
                boundary(name,np.all(np.isclose(endpoints[axis],value,atol=1e-8,rtol=0),axis=0))
        else:
            for c in model.cables:
                radius = np.sqrt((endpoints[0]-c.x_m)**2+(endpoints[1]-c.z_m)**2)
                boundary('surface:'+c.uid,np.all(np.isclose(radius,c.layers[-1].outer_radius_m,atol=1e-8,rtol=0),axis=0))
        for c in model.cables:
            if c.prescribed_core_temperature_k is not None:
                radius = np.sqrt((endpoints[0]-c.x_m)**2+(endpoints[1]-c.z_m)**2)
                boundary('core:'+c.uid,np.all(np.isclose(radius,c.layers[0].outer_radius_m,atol=1e-8,rtol=0),axis=0))
        if not np.all(assigned == 1):
            raise ValueError('外/内边界未唯一归类；可能存在孔洞或非共形界面。')
        self.reference = min(b.temperature_k for b in model.environment.boundaries.values() if b.temperature_k is not None)
        self.dirichlet = {}
        self.inner_nodes = {}
        self.convection = []
        for name,fb in self.boundaries.items():
            if name.startswith('core:'):
                c = next(c for c in model.cables if name == 'core:'+c.uid)
                ns = self.basis.get_dofs(facets=fb.find).all()
                self.inner_nodes[c.uid] = ns
                self.dirichlet.update({int(n):c.prescribed_core_temperature_k-self.reference for n in ns})
                continue
            bc = model.environment.boundaries['surface' if name.startswith('surface:') else name]
            if bc.kind == 'temperature':
                self.dirichlet.update({int(n):bc.temperature_k-self.reference for n in self.basis.get_dofs(facets=fb.find).all()})
            elif bc.kind == 'convection':
                self.convection.append((fb,bc))
        self.fixed_load = np.zeros(self.basis.N)
        for c in model.cables:
            for layer in c.layers:
                if layer.fixed_heat_w_m:
                    w = self.weights[layer.uid]
                    self.fixed_load += layer.fixed_heat_w_m*w/w.sum()
        self.fixed_heat = float(self.fixed_load.sum())
        self._factor = None
        self._constant_matrix = not self._duct_feedback and all(bc.emissivity == 0 for _,bc in self.convection)
        self._affine = None
        self.loss_evaluator = None
        self._duct_preconditioner = None

    def update_duct_conduction(self, temperature):
        """Use length-weighted interface temperatures, not mesh-density averages."""
        if not self._duct_feedback:
            return []
        matrix = self._fixed_conduction.copy()
        states = []
        for cable,unit_matrix,interfaces in self._duct_feedback:
            surfaces = [float(self.np.sum(fb.interpolate(temperature)*fb.dx)/self.np.sum(fb.dx)) for fb in interfaces]
            mean = sum(surfaces)/2
            resistance = cable.duct.air_law.resistance(mean,2*cable.layers[-1].outer_radius_m)
            conductivity = log(cable.duct.inner_radius_m/cable.layers[-1].outer_radius_m)/(2*pi*resistance)
            matrix += conductivity*unit_matrix
            for region in self.regions:
                if region['uid'] == cable.duct.uid+'/air':
                    region['k'] = conductivity
            states.append({'entity':cable.duct.uid,'surface_temperature_k':surfaces[0],
                'duct_inner_temperature_k':surfaces[1],'mean_temperature_k':mean,
                'resistance_k_m_w':resistance,'equivalent_k_w_m_k':conductivity,
                'source':cable.duct.air_law.source})
        self.K = matrix
        self._factor = self._affine = None
        return states

    def electrical_powers(self, currents, temperature):
        if self.loss_evaluator is not None:
            powers = self.loss_evaluator(currents,temperature)
            if len(powers) != len(self.model.cables) or any(
                set(row) != {'conductor','sheath'} or any(not self.np.isfinite(v) or v < 0 for v in row.values()) for row in powers):
                raise ValueError('电损耗反馈必须逐缆返回非负有限的导体/护套功率，单位 W/m。')
            return powers
        powers = []
        for cable,current in zip(self.model.cables,currents):
            conductor = sheath = 0.
            if cable.electrical:
                e = cable.electrical
                weights = self.weights[cable.layers[0].uid]
                mean = float(weights@temperature/weights.sum())
                resistance = e.r20_ohm_m*(1+e.alpha20_per_k*(mean-293.15))*(1+e.ac_extra_factor)
                if resistance <= 0:
                    raise ValueError('温度对应的导体电阻非正。')
                conductor = current**2*resistance
                sheath = conductor*e.sheath_loss_factor
            powers.append({'conductor':conductor,'sheath':sheath})
        return powers

    def solve_duct_matrix(self, matrix, load, D, prescribed):
        """Reuse an LU preconditioner, never a stale conductivity solution.

        Every solve uses the current full matrix. CG must meet the declared
        algebraic residual and state() still checks nonlinear conservation.
        """
        from scipy.sparse.linalg import splu, cg, LinearOperator
        np = self.np
        free = np.setdiff1d(np.arange(self.basis.N),D)
        reduced = matrix[free][:,free].tocsr()
        right = load[free]-matrix[free][:,D]@prescribed[D]
        if self._duct_preconditioner is None:
            factor = splu(reduced.tocsc())
            self._duct_preconditioner = LinearOperator(reduced.shape,matvec=factor.solve)
        solution,status = cg(reduced,right,M=self._duct_preconditioner,rtol=1e-11,atol=1e-12,maxiter=200)
        if status != 0 or not np.isfinite(solution).all():
            raise ValueError('管内变温热阻的当前矩阵未达到线性残差要求，未返回近似解。')
        rise = prescribed.copy();rise[free] = solution
        return rise

    def heat_load(self, powers):
        load = self.fixed_load.copy()
        for cable,row in zip(self.model.cables,powers):
            if row['conductor']:
                w = self.weights[cable.layers[0].uid]
                load += row['conductor']*w/w.sum()
            if row['sheath']:
                if cable.electrical is None or cable.electrical.sheath_layer_uid not in self.weights:
                    raise ValueError('电损耗反馈的护套功率缺少明确的热层绑定。')
                w = self.weights[cable.electrical.sheath_layer_uid]
                load += row['sheath']*w/w.sum()
        return load

    def affine_temperature(self,currents,D,prescribed):
        """Exact low-rank solve for constant k/h and the declared linear R(T).

        This is the same nodal FEM system, not a surrogate or fitted thermal
        network. The full physical residual is still checked by state().
        """
        from scipy.sparse.linalg import splu
        from skfem import BilinearForm,LinearForm,asm
        np=self.np
        if self._affine is None:
            matrix=self.K.copy();load=self.fixed_load.copy()
            for fb,bc in self.convection:
                @BilinearForm
                def robin(u,v,w):return w.h*u*v
                @LinearForm
                def background(v,w):return w.value*v
                matrix+=asm(robin,fb,h=bc.h_w_m2_k)
                load+=asm(background,fb,value=bc.h_w_m2_k*(bc.temperature_k-self.reference))
            free=np.setdiff1d(np.arange(self.basis.N),D)
            factor=splu(matrix[free][:,free].tocsc())
            boundary=matrix[free][:,D]@prescribed[D]
            base=prescribed.copy();base[free]=factor.solve(load[free]-boundary)
            indices=[i for i,c in enumerate(self.model.cables) if c.electrical]
            normalized=[];sources=[]
            for i in indices:
                cable=self.model.cables[i];weights=self.weights[cable.layers[0].uid]
                weights=weights/weights.sum();normalized.append(weights);source=weights.copy()
                if cable.electrical.sheath_loss_factor:
                    screen=self.weights[cable.electrical.sheath_layer_uid]
                    source+=cable.electrical.sheath_loss_factor*screen/screen.sum()
                sources.append(source)
            response=np.zeros((self.basis.N,len(indices)))
            if indices:response[free]=factor.solve(np.asarray(sources).T[free])
            normalized=np.asarray(normalized).reshape(len(indices),self.basis.N)
            self._affine=(indices,base,response,normalized@response,self.reference+normalized@base)
            self._factor=(free,factor,boundary)
        indices,base,response,coupling,initial_mean=self._affine
        if not indices:return self.reference+base
        scale=np.asarray([currents[i]**2*self.model.cables[i].electrical.r20_ohm_m*
                          (1+self.model.cables[i].electrical.ac_extra_factor) for i in indices])
        alpha=np.asarray([self.model.cables[i].electrical.alpha20_per_k for i in indices])
        feedback=(scale*alpha)[:,None]*coupling
        if max(abs(np.linalg.eigvals(feedback)))>=1-1e-12:
            raise UnstableState('温变电阻反馈不存在稳定稳态解；请降低负荷或检查散热边界。')
        power=np.linalg.solve(np.eye(len(indices))-feedback,scale*(1+alpha*(initial_mean-293.15)))
        return self.reference+base+response@power

    def state(self, currents):
        from skfem import BilinearForm, LinearForm, asm, condense, solve
        np = self.np
        temperature = np.full(self.basis.N,self.reference)
        model,cfg = self.model,self.controls
        trace = []
        D = np.asarray(sorted(self.dirichlet),dtype=int)
        prescribed = np.zeros(self.basis.N)
        if len(D):
            prescribed[D] = [self.dirichlet[int(i)] for i in D]
        if self._constant_matrix and self.loss_evaluator is None:
            temperature=self.affine_temperature(currents,D,prescribed)
        for step in range(1,cfg.max_iterations+1):
            self.update_duct_conduction(temperature)
            load = self.heat_load(self.electrical_powers(currents,temperature))
            matrix = self.K.copy()
            for fb,bc in self.convection:
                t = fb.interpolate(temperature)
                h = bc.h_w_m2_k+bc.emissivity*5.670374419e-8*(t+bc.temperature_k)*(t*t+bc.temperature_k**2)
                @BilinearForm
                def robin(u,v,w):
                    return w.h*u*v
                @LinearForm
                def background(v,w):
                    return w.h*(bc.temperature_k-self.reference)*v
                matrix += asm(robin,fb,h=h)
                load += asm(background,fb,h=h)
            if self._constant_matrix:
                # Geometry and constant-k/constant-h boundaries do not change during
                # Picard or the rating search. Reuse only this exact factorization.
                if self._factor is None:
                    from scipy.sparse.linalg import splu
                    free_nodes = np.setdiff1d(np.arange(self.basis.N),D)
                    self._factor = (free_nodes,splu(matrix[free_nodes][:,free_nodes].tocsc()),
                                    matrix[free_nodes][:,D]@prescribed[D])
                free_nodes,factor,boundary_load = self._factor
                rise = prescribed.copy()
                rise[free_nodes] = factor.solve(load[free_nodes]-boundary_load)
            elif self._duct_feedback:
                rise = self.solve_duct_matrix(matrix,load,D,prescribed)
            else:
                rise = solve(*condense(matrix,load,x=prescribed,D=D)) if len(D) else solve(matrix,load)
            proposed = rise+self.reference
            if not np.isfinite(proposed).all() or float(proposed.min()) <= 0 or float(proposed.max()) > 1500:
                raise UnstableState('无有效稳态温度解或迭代越出1500 K数值边界。')
            delta = float(np.max(np.abs(proposed-temperature)))
            trace.append({'iteration':step,'temperature_update_inf_k':delta,'max_temperature_k':float(proposed.max())})
            if delta <= cfg.tolerance_k:
                temperature = proposed
                break
            temperature += cfg.relaxation*(proposed-temperature)
        else:
            raise ValueError('温变电阻/辐射迭代不收敛。')
        residual = matrix@rise-load
        free = np.setdiff1d(np.arange(self.basis.N),D)
        equation_residual = float(np.max(np.abs(residual[free]))) if len(free) else 0.
        # 重新按接受温度核验真实热源和非线性边界，避免只验上一迭代线性系统。
        powers = self.electrical_powers(currents,temperature)
        physical_load = self.heat_load(powers)
        cable_states = []
        for c,current,power in zip(model.cables,currents,powers):
            if c.prescribed_core_temperature_k is None:
                w = self.weights[c.layers[0].uid]
                mean = float(w@temperature/w.sum())
                peak = float(temperature[self.nodes[c.layers[0].uid]].max())
            else:
                mean = peak = c.prescribed_core_temperature_k
            p,ps = power['conductor'],power['sheath']
            interfaces = {}
            for layer in c.layers:
                r = np.sqrt((self.points[:,0]-c.x_m)**2+(self.points[:,1]-c.z_m)**2)
                selected = np.flatnonzero(np.isclose(r,layer.outer_radius_m,rtol=0,atol=1e-8))
                if len(selected):
                    interfaces[layer.uid] = float(temperature[selected].mean())
            cable_states.append({'entity':c.uid,'circuit':c.circuit,'current_a':current,
                                 'conductor_mean_temperature_k':mean,'conductor_max_temperature_k':peak,
                                 'limit_k':c.temperature_limit_k,'conductor_joule_heat_w_m':p,
                                 'sheath_joule_heat_w_m':ps,'interface_nodal_mean_k':interfaces})
        duct_states = self.update_duct_conduction(temperature)
        physical_residual = self.K@(temperature-self.reference)-physical_load
        conv_heat = 0.
        for fb,bc in self.convection:
            t = fb.interpolate(temperature)
            flux = bc.h_w_m2_k*(t-bc.temperature_k)+bc.emissivity*5.670374419e-8*(t**4-bc.temperature_k**4)
            @LinearForm
            def nonlinear_boundary(v,w):
                return w.flux*v
            vector = asm(nonlinear_boundary,fb,flux=flux)
            physical_residual += vector
            conv_heat += float(vector.sum())
        core_nodes = np.unique(np.concatenate(list(self.inner_nodes.values()))) if self.inner_nodes else np.array([],dtype=int)
        external_nodes = np.setdiff1d(D,core_nodes)
        imposed_heat = float(physical_residual[core_nodes].sum())
        outflow = conv_heat-float(physical_residual[external_nodes].sum())
        heat = float(physical_load.sum())+imposed_heat
        physical_free = float(np.max(np.abs(physical_residual[free]))) if len(free) else 0.
        balance = abs(heat-outflow)/max(abs(heat),1.)
        if balance > max(1e-6,cfg.tolerance_k*.01) or physical_free > max(1e-5,cfg.tolerance_k):
            raise ValueError('接受温度处的物理残差/能量平衡不合格。')
        return {'cables':cable_states,'nodes':int(self.basis.N),'elements':len(self.cells),
                'finite_elements':self.mesh.nelements,'element_order':cfg.element_order,
                'source_heat_w_m':float(physical_load.sum()),'prescribed_temperature_heat_w_m':imposed_heat,
                'boundary_heat_w_m':outflow,'energy_relative_residual':balance,
                'linear_residual_inf_w_m':equation_residual,'physical_residual_inf_w_m':physical_free,
                'iterations':trace,'duct_air_states':duct_states,'temperature_k':temperature}

    def solve(self):
        cfg,model,np = self.controls,self.model,self.np
        currents = [c.current_a for c in model.cables]
        brackets = []
        rating = None
        if cfg.operation == 'temperature':
            result = self.state(currents)
        else:
            indices = [i for i,c in enumerate(model.cables) if c.circuit == cfg.rated_circuit]
            base = max(currents[i] for i in indices)
            ratios = {i:currents[i]/base if base else 1. for i in indices}
            def trial(current):
                values = currents.copy()
                for i in indices:
                    values[i] = current*ratios[i]
                state = self.state(values)
                # 其他回路也必须不超温；额定回路改变不能破坏被保持负荷的约束。
                excess = max(c['conductor_max_temperature_k']-c['limit_k'] for c in state['cables'])
                brackets.append({'trial_current_a':current,'max_excess_k':excess})
                return state,excess
            low,high = 0.,cfg.current_upper_a
            result,excess = trial(low)
            if excess >= 0:
                raise ValueError('被保持负荷/固定热源已超温，不存在可行额定电流。')
            def bounded_trial(current):
                try:
                    return trial(current)
                except UnstableState as error:
                    brackets.append({'trial_current_a':current,'status':'unstable','reason':str(error)})
                    return None,float('inf')
            ceiling = cfg.current_maximum_a or high
            while True:
                state,excess = bounded_trial(high)
                if excess >= 0:
                    break
                low,result = high,state
                if high >= ceiling:
                    raise ValueError('controls.current_maximum_a：达到明确搜索上限仍未夹住温限；请提高上限，未返回载流量。')
                high = min(ceiling,high*1.6)
            for _ in range(70):
                if high-low <= cfg.current_tolerance_a:
                    break
                middle = (low+high)/2
                state,excess = bounded_trial(middle)
                if excess <= 0:
                    low,result = middle,state
                else:
                    high = middle
            else:
                raise ValueError('电流求根不收敛。')
            margin = min(c['limit_k']-c['conductor_max_temperature_k'] for c in result['cables'])
            if margin > max(.02, cfg.tolerance_k*10):
                raise ValueError('controls.current_tolerance_a：电流区间收敛但未到温限，不能把失稳边界作为载流量；请缩小电流容差。')
            rating = {'circuit':cfg.rated_circuit,'ampacity_a':low,'upper_bracket_a':high,
                      'held_currents_a':{c.uid:currents[i] for i,c in enumerate(model.cables) if i not in indices},
                      'trace':brackets}
        temperature = result.pop('temperature_k')
        field = {'schema':'cablesim.simulation-field/1','length_unit':'m','temperature_unit':'K','association':'node',
                 'discretization':'P2 nodal values on four linear display subtriangles per element' if cfg.element_order==2 else 'linear triangular nodal field',
                 'points':self.points.tolist(),'triangles':self.cells.tolist(),'domain_ids':self.ids.tolist(),
                 'regions':self.regions,'temperature':temperature.tolist()}
        result['rating'] = rating
        result['mesh_size_m'] = cfg.mesh_size_m
        return result,field


def solve_thermal(model,controls):
    return ThermalSystem(model,controls).solve()
