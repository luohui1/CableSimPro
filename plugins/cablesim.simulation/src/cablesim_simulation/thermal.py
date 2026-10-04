"""多材料二维P1稳态导热、温变电阻迭代和有界电流反求。"""
from math import pi
from .thermal_mesh import build


class ThermalSystem:
    def __init__(self, model, controls, prepared_mesh=None):
        import numpy as np
        from skfem import MeshTri, Basis, FacetBasis, ElementTriP1, BilinearForm, LinearForm, asm
        from skfem.helpers import dot, grad
        self.np, self.model, self.controls = np,model,controls
        self.points,self.cells,self.ids,self.regions = prepared_mesh if prepared_mesh is not None else build(model,controls)
        self.mesh = MeshTri(self.points.T,self.cells.T)
        self.basis = Basis(self.mesh,ElementTriP1(),intorder=4)
        if np.min(self.basis.dx.sum(axis=1)) <= 0:
            raise ValueError('退化单元。')
        k = np.asarray([self.regions[i-1]['k'] for i in self.ids])[:,None]
        @BilinearForm
        def conduction(u,v,w):
            return w.k*dot(grad(u),grad(v))
        self.K = asm(conduction,self.basis,k=k)
        @LinearForm
        def unit(v,w):
            return v
        self.weights, self.nodes = {},{}
        for r in self.regions:
            mask = np.flatnonzero(self.ids == r['id'])
            weights = asm(unit,self.basis.with_elements(mask))
            if weights.sum() <= 0:
                raise ValueError('材料域面积非正：'+r['uid'])
            # 分区可能把同一语义区域切成多个实体；按UID累计，绝不覆盖热源面积。
            self.weights[r['uid']] = self.weights.get(r['uid'],np.zeros(self.basis.N))+weights
            self.nodes[r['uid']] = np.union1d(self.nodes.get(r['uid'],np.array([],dtype=int)),np.unique(self.cells[mask]))
        self.boundaries = {}
        facets = self.mesh.boundary_facets()
        endpoints = self.mesh.p[:,self.mesh.facets[:,facets]]
        assigned = np.zeros(len(facets),dtype=int)
        def boundary(name, mask):
            selected = facets[mask]
            if len(selected):
                self.boundaries[name] = FacetBasis(self.mesh,ElementTriP1(),facets=selected,intorder=4)
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
                ns = np.unique(self.mesh.facets[:,fb.find])
                self.inner_nodes[c.uid] = ns
                self.dirichlet.update({int(n):c.prescribed_core_temperature_k-self.reference for n in ns})
                continue
            bc = model.environment.boundaries['surface' if name.startswith('surface:') else name]
            if bc.kind == 'temperature':
                self.dirichlet.update({int(n):bc.temperature_k-self.reference for n in np.unique(self.mesh.facets[:,fb.find])})
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
        self._constant_matrix = all(bc.emissivity == 0 for _,bc in self.convection)
        self._affine = None

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
            raise ValueError('温变电阻反馈不存在稳定稳态解；请降低负荷或检查散热边界。')
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
        if self._constant_matrix:
            temperature=self.affine_temperature(currents,D,prescribed)
        for step in range(1,cfg.max_iterations+1):
            load = self.fixed_load.copy()
            powers = []
            for c,current in zip(model.cables,currents):
                p = 0.
                if c.electrical:
                    e = c.electrical
                    w = self.weights[c.layers[0].uid]
                    mean = float(w@temperature/w.sum())
                    resistance = e.r20_ohm_m*(1+e.alpha20_per_k*(mean-293.15))*(1+e.ac_extra_factor)
                    if resistance <= 0:
                        raise ValueError('温度对应的导体电阻非正。')
                    p = current**2*resistance
                    load += p*w/w.sum()
                    if e.sheath_loss_factor:
                        sw = self.weights[e.sheath_layer_uid]
                        load += p*e.sheath_loss_factor*sw/sw.sum()
                powers.append(p)
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
            else:
                rise = solve(*condense(matrix,load,x=prescribed,D=D)) if len(D) else solve(matrix,load)
            proposed = rise+self.reference
            if not np.isfinite(proposed).all() or float(proposed.min()) <= 0 or float(proposed.max()) > 1500:
                raise ValueError('无有效稳态温度解或迭代越出1500 K数值边界。')
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
        physical_load = self.fixed_load.copy()
        cable_states = []
        for c,current in zip(model.cables,currents):
            if c.prescribed_core_temperature_k is None:
                w = self.weights[c.layers[0].uid]
                mean = float(w@temperature/w.sum())
                peak = float(temperature[self.nodes[c.layers[0].uid]].max())
            else:
                mean = peak = c.prescribed_core_temperature_k
            p,ps = 0.,0.
            if c.electrical:
                e = c.electrical
                p = current**2*e.r20_ohm_m*(1+e.alpha20_per_k*(mean-293.15))*(1+e.ac_extra_factor)
                ps = p*e.sheath_loss_factor
                w = self.weights[c.layers[0].uid]; physical_load += p*w/w.sum()
                if ps:
                    w = self.weights[e.sheath_layer_uid]; physical_load += ps*w/w.sum()
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
                'source_heat_w_m':float(physical_load.sum()),'prescribed_temperature_heat_w_m':imposed_heat,
                'boundary_heat_w_m':outflow,'energy_relative_residual':balance,
                'linear_residual_inf_w_m':equation_residual,'physical_residual_inf_w_m':physical_free,
                'iterations':trace,'temperature_k':temperature}

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
            _,excess = trial(high)
            if excess < 0:
                raise ValueError('给定上界未夹住温限；明确扩大搜索范围，不能返回假载流量。')
            for _ in range(70):
                if high-low <= cfg.current_tolerance_a:
                    break
                middle = (low+high)/2
                state,excess = trial(middle)
                if excess <= 0:
                    low,result = middle,state
                else:
                    high = middle
            else:
                raise ValueError('电流求根不收敛。')
            rating = {'circuit':cfg.rated_circuit,'ampacity_a':low,'upper_bracket_a':high,
                      'held_currents_a':{c.uid:currents[i] for i,c in enumerate(model.cables) if i not in indices},
                      'trace':brackets}
        temperature = result.pop('temperature_k')
        field = {'schema':'cablesim.simulation-field/1','length_unit':'m','temperature_unit':'K','association':'node',
                 'points':self.points.tolist(),'triangles':self.cells.tolist(),'domain_ids':self.ids.tolist(),
                 'regions':self.regions,'temperature':temperature.tolist()}
        result['rating'] = rating
        result['mesh_size_m'] = cfg.mesh_size_m
        return result,field


def solve_thermal(model,controls):
    return ThermalSystem(model,controls).solve()
