"""Native A-u losses on the thermal mesh, preserving saved phase and bonding.

The continuous round conductor is explicitly R20 matched. This represents
ordinary uninsulated round conductors, not insulated strands or Milliken cores.
Metal temperatures are regional volume means; the exported powers are native
GetDP integrals and are transferred conservatively to the same thermal regions.
"""
from copy import deepcopy
from math import cos, sin, pi
from pathlib import Path
import shutil

from cablesim_sdk.domain import DomainDocument
from cablesim_sdk.validation import FieldValueError
from .problem_mesh import package
from .report import digest


def validate(document, source):
    d = DomainDocument.model_validate(document)
    if not isinstance(source,str) or not source.strip():
        raise FieldValueError('须说明R20匹配连续导体、非磁性介质和区域平均温度模型的采用依据。','parameters','feedback','source')
    types = {t.id:t for t in d.cable_types}
    if any(m.relative_permeability not in (None,1.) for m in d.materials):
        raise FieldValueError('非磁性连续模型不能覆盖已声明的磁性材料。','materials')
    for i,circuit in enumerate(d.circuits):
        cable = types[circuit.cable_type]
        if cable.construction != 'single_core' or len(cable.cores) != 1:
            raise FieldValueError('当前损耗反馈支持单芯同心结构。','circuits',i,'cable_type')
        core = cable.cores[0];conductor = core.conductor
        if (conductor.form not in ('solid_round','stranded_round','stranded_round_compacted') or
            conductor.insulated_wires or conductor.segments or conductor.inner_diameter or core.x or core.z):
            raise FieldValueError('仅覆盖普通非绝缘圆绞线/实心圆导体的R20匹配连续模型；分割、绝缘单丝和空心导体未覆盖。','cable_types',d.cable_types.index(cable),'cores',0,'conductor')
        metal = [l for l in core.layers+cable.common_layers if l.role in ('metallic_screen','metallic_sheath','armour')]
        if len(metal) != 1 or metal[0].form != 'smooth' or metal[0].role == 'armour':
            raise FieldValueError('须为单层非磁性光滑金属护套；丝/带及铠装电磁等效未覆盖。','cable_types',d.cable_types.index(cable),'common_layers')
        if circuit.bonding.kind not in ('single_point','both_ends') or circuit.bonding.transposed or not circuit.bonding.source:
            raise FieldValueError('须保存未换位的单点/两端接地及其来源；本反馈不覆盖交叉互联。','circuits',i,'bonding')
        if circuit.electrical_topology is None or circuit.system.kind != 'ac_three_phase':
            raise FieldValueError('须保存三相相序、参考角和来源。','circuits',i,'electrical_topology')
        if len(circuit.cables) != 3 or {c.phase for c in circuit.cables} not in ({'A','B','C'},{'L1','L2','L3'}):
            raise FieldValueError('必须包含完整三相单芯组。','circuits',i,'cables')
    return d


class NativeLossFeedback:
    def __init__(self, system, document, prepared_iec, source, work):
        self.document = validate(document,source)
        self.system,self.work,self.source = system,Path(work),source
        self.history = [];self._last_key = None;self._last = None
        np = system.np
        # The thermal P2 mesh uses the same straight-sided geometric triangles.
        points,cells = system.mesh.p.T,system.mesh.t.T
        original_ids = system.ids[::4] if system.controls.element_order == 2 else system.ids
        regions = deepcopy(system.regions)
        self.laws = {};by_uid = {c['id']:c for c in prepared_iec.cables}
        for cable in system.model.cables:
            item = by_uid[cable.uid];rating = item['rating']
            if rating.conductor.ks != 1 or rating.conductor.kp != 1:
                raise FieldValueError('连续圆导体反馈要求已声明 ks=kp=1 的普通非绝缘圆导体。','parameters','feedback')
            uid = cable.layers[0].uid
            area = float(system.weights[uid].sum())
            self.laws[uid] = (1/(cable.electrical.r20_ohm_m*area),cable.electrical.alpha20_per_k)
            sheath = cable.electrical.sheath_layer_uid
            self.laws[sheath] = (1/rating.sheath.resistivity20_ohm_m,rating.sheath.alpha20_per_k)
        for region in regions:
            sigma = self.laws.get(region['uid'],(0.,0.))[0]
            region['material'] = {'conductivity_s_m':sigma,'relative_permeability':1.,
                                  'k_w_m_k':region['k'],'source':source}
        boundaries = [{'uid':'outer','selector':'outer','values':[],'kind':'magnetic_potential','value':0.}]
        self.mesh = package(points,cells,original_ids,regions,boundaries)
        frequency = {c.system.frequency for c in self.document.circuits}
        if len(frequency) != 1:
            raise FieldValueError('相邻回路须使用同一正频率。','circuits')
        self.problem = {'physics':'magnetic_harmonic','frequency_hz':next(iter(frequency)),
            'boundaries':boundaries,'excitations':[],'probes_m':[],'current_probes':[],
            'electrical_networks':[],'axial_lengths_m':{},
            'provenance':{'domain_sha256':digest(document),'source':source},
            'assumptions':['R20-matched continuous round conductors; nonmagnetic media; regional mean metal temperatures.']}
        self.phase = {};self.sheath_groups = []
        model_by_uid = {c.uid:c for c in system.model.cables}
        for circuit in self.document.circuits:
            group = []
            for cable in circuit.cables:
                position = {'A':0,'L1':0,'B':1,'L2':1,'C':-1,'L3':-1}[cable.phase]
                topology = circuit.electrical_topology
                self.phase[cable.id] = topology.reference_angle_rad+position*(-1 if topology.phase_sequence=='ABC' else 1)*2*pi/3
                group.append(model_by_uid[cable.id].electrical.sheath_layer_uid)
            self.sheath_groups.extend([[uid] for uid in group] if circuit.bonding.kind=='single_point' else [group])

    def __call__(self, currents, temperature):
        means = {uid:float(self.system.weights[uid]@temperature/self.system.weights[uid].sum()) for uid in self.laws}
        # The physical constitutive interval is deliberately bounded; no extrapolation.
        if any(not 273.15 <= value <= 423.15 for value in means.values()):
            from .thermal import UnstableState
            raise UnstableState('feedback.temperature：试探状态越出声明的0–150 °C数值研究区间；未外推，该试探不发布结果。')
        key = (tuple(currents),tuple(means.values()))
        if key == self._last_key:
            return deepcopy(self._last)
        p,m = deepcopy(self.problem),deepcopy(self.mesh)
        for region in m['regions']:
            uid = region['uid']
            if uid in self.laws:
                sigma,alpha = self.laws[uid]
                region['material']['conductivity_s_m'] = sigma/(1+alpha*(means[uid]-293.15))
        for cable,current in zip(self.system.model.cables,currents):
            angle = self.phase[cable.uid]
            p['excitations'].append({'regions':[cable.layers[0].uid],'kind':'current_rms_a',
                'value':[current*cos(angle),current*sin(angle)],'source':self.source})
        for group in self.sheath_groups:
            p['excitations'].append({'regions':group,'kind':'current_rms_a','value':[0.,0.],'source':self.source})
        # No hidden earth-return conductor is added for unbalanced input.
        total = sum(complex(*e['value']) for e in p['excitations'])
        if abs(total)>1e-8*max(1.,sum(currents)):
            raise ValueError('feedback.currents：无大地回流模型，三相电流相量和必须为零。')
        from .getdp_adapter import solve
        folder = self.work/f'loss-{len(self.history)}'
        try:
            result = solve(p,m,folder)
            values = {r['entity']:r for r in result['regions']}
            powers = [{'conductor':values[c.layers[0].uid]['joule_loss_w_m'],
                       'sheath':values[c.electrical.sheath_layer_uid]['joule_loss_w_m']} for c in self.system.model.cables]
            self.history.append({'currents_a':list(currents),'region_mean_temperature_k':means,
                'powers_w_m':powers,'execution':result['execution'],'solver':result['solver'],
                'electrical_rows':result['regions'],
                'mesh_sha256':m['sha256'],'problem_sha256':result['problem_sha256'],
                'current_constraint_errors':result['current_constraint_errors'],
                'solver_log':(folder/'solver.log').read_text('utf-8',errors='replace')})
            self._last_key,self._last = key,powers
            return deepcopy(powers)
        finally:
            shutil.rmtree(folder,ignore_errors=True)
