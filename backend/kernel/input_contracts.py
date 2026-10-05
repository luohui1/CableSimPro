"""Read-only host form contracts, derived from verified installed input models.

This adapter supplies presentation metadata only. Runs still use the normal
Study/preflight/Run API; no calculation or alternate result storage lives here.
"""
import ast
from hashlib import sha256
import importlib.util
import importlib
import json
from pathlib import Path
import sys
from backend.domain.models import DomainDocument

ROOT = Path(__file__).resolve().parents[2]
MODELS = {
    ('cablesim.simulation', 'getdp-eddy'): ('backend.kernel.simulation_contract', 'StandaloneParameters'),
    ('cablesim.simulation', 'elmer-heat'): ('backend.kernel.simulation_contract', 'StandaloneParameters'),
    ('cablesim.simulation', 'iec-fem-comparison'): ('cablesim_sdk.iec_fem', 'ComparisonParameters'),
    ('cablesim.simulation', 'iec-thermal-field'): ('cablesim_sdk.iec_thermal', 'ThreeCoreThermalParameters'),
    ('cablesim.hybrid-rating', 'physics-comparison'): ('cablesim_hybrid_rating', 'Settings'),
    ('cablesim.iec60287', 'steady-rating'): ('cablesim_iec60287', 'Rating'),
    ('cablesim.iec60287', 'armoured-sl-rating'): ('cablesim_iec60287', 'ArmouredRating'),
    ('cablesim.iec60287', 'model-completion'): ('cablesim_iec60287', 'EngineeringParameters'),
    ('cablesim.type-electrical', 'electrical'): ('cablesim_type_electrical', 'ElectricalParameters'),
    ('cablesim.type-electrical', 'short-circuit'): ('cablesim_type_electrical', 'ShortCircuitParameters'),
    ('cablesim.thermal-network', 'steady-rating'): ('cablesim_thermal_network', 'Scenario'),
    ('cablesim.simulation', 'transient-temperature'): ('cablesim_simulation', 'Options'),
    ('cablesim.simulation', 'sheath-losses'): ('cablesim_simulation', 'Options'),
    ('cablesim.simulation', 'electrothermal-steady'): ('cablesim_simulation', 'Options'),
}


def model_for(plugin_id, capability):
    if plugin_id == 'cablesim.simulation' and capability == 'iec-thermal-field':
        from cablesim_sdk.iec_thermal import ThreeCoreThermalParameters
        return ThreeCoreThermalParameters,ROOT/'cablesim_sdk/iec_thermal.py'
    if plugin_id=='cablesim.simulation' and capability in ('getdp-eddy','elmer-heat'):
        from .simulation_contract import StandaloneParameters
        return StandaloneParameters,ROOT/'backend/kernel/simulation_contract.py'
    if plugin_id == 'cablesim.simulation' and capability == 'iec-fem-comparison':
        from cablesim_sdk.iec_fem import ComparisonParameters
        return ComparisonParameters, ROOT/'cablesim_sdk/iec_fem.py'
    if plugin_id == 'cablesim.hybrid-rating':
        source=ROOT/'plugins'/plugin_id/'src'
        dependencies=[source,ROOT/'plugins/cablesim.iec60287/src',ROOT/'plugins/cablesim.simulation/src']
        for directory in dependencies:sys.path.insert(0,str(directory))
        module='measurements' if capability=='measurement-import' else 'labels'
        try:model=getattr(importlib.import_module('cablesim_hybrid_rating.'+module),'Measurements' if module=='measurements' else 'Settings')
        finally:
            for directory in dependencies:sys.path.remove(str(directory))
        return model,source/'cablesim_hybrid_rating'/(module+'.py')
    if plugin_id == 'cablesim.simulation':
        module = {'transient-temperature': 'transient', 'sheath-losses': 'sheath', 'electrothermal-steady': 'domain_coupled'}[capability]
        source = ROOT/'plugins'/plugin_id/'src'
        sys.path.insert(0, str(source))
        try:
            model = importlib.import_module('cablesim_simulation.'+module).Options
        finally:
            sys.path.remove(str(source))
        return model, source/'cablesim_simulation'/(module+'.py')
    if plugin_id == 'cablesim.thermal-network':
        from backend.schemas import Scenario
        return Scenario, ROOT/'backend/schemas.py'
    package, name = MODELS[(plugin_id, capability)]
    filename = 'engineering_contract.py' if name=='EngineeringParameters' else 'armour.py' if name=='ArmouredRating' else 'inputs.py'
    path = ROOT / 'plugins' / plugin_id / 'src' / package / filename
    module_name = '_design_' + package + '_' + name + '_' + sha256(path.read_bytes()).hexdigest()[:12]
    if module_name not in sys.modules:
        spec = importlib.util.spec_from_file_location(module_name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
    return getattr(sys.modules[module_name], name), path


def contracts(research):
    from backend.plugin_host import PluginHostError
    try:
        return verified_contracts(research)
    except (OSError,ValueError,SyntaxError,ImportError,AttributeError) as exc:
        raise PluginHostError('PLUGIN_INPUT_CONTRACT_INVALID','插件输入契约无法读取；源码可能正在更新，请完成安装和封签后重试。'+str(exc),409) from None


def verified_contracts(research):
    result = []
    for entry in research.methods():
        for cap in entry['capabilities']:
            key = (entry['method']['plugin_id'], cap['id'])
            if key not in MODELS:
                continue
            pin = {**entry['method'], 'capability': cap['id']}
            research.resolve(pin)  # The form must refer to the verified release.
            model, path = model_for(*key)
            schema = model.model_json_schema()
            if key[0] == 'cablesim.hybrid-rating':
                result.append({'method':pin,'input_schema':cap['input_schema'],'schema':DomainDocument.model_json_schema(),
                    'parameter_schema':schema,'input_sources':['domain','study'],'tasks':['rating'],
                    'source':path.relative_to(ROOT).as_posix(),'source_sha256':sha256(path.read_bytes()).hexdigest(),
                    'parameter_source':path.relative_to(ROOT).as_posix(),'parameter_source_sha256':sha256(path.read_bytes()).hexdigest(),
                    'schema_digest':sha256(json.dumps(schema,sort_keys=True).encode()).hexdigest()})
                continue
            if key[0] == 'cablesim.type-electrical':
                result.append({'method':pin, 'input_schema':cap['input_schema'], 'schema':DomainDocument.model_json_schema(),
                    'parameter_schema':schema, 'input_sources':['domain', 'study'], 'tasks':[cap['id']],
                    'source':path.relative_to(ROOT).as_posix(), 'source_sha256':sha256(path.read_bytes()).hexdigest(),
                    'parameter_source':path.relative_to(ROOT).as_posix(), 'parameter_source_sha256':sha256(path.read_bytes()).hexdigest(),
                    'schema_digest':sha256(json.dumps(schema,sort_keys=True,ensure_ascii=False).encode()).hexdigest()})
                continue
            if key[0] == 'cablesim.simulation':
                from .simulation_parameters import SIMULATION_PARAMETER_MODELS
                schema = SIMULATION_PARAMETER_MODELS.get(cap['id'],model).model_json_schema()
                units = {'domain_options': 'Saved section/load and thermal boundary/source options; lengths m, temperatures K, heat W/m.',
                         'electromagnetic_options': 'Saved section/load, finite bounds m, material temperature K and conductivity S/m; sources required.',
                         'time': 'Initial temperature K, fixed time step s, step count and BDF order.',
                         'mesh': 'Mesh lengths m; finite node limit; P1 required for transient/electrothermal.',
                         'resistance_temperature_k': 'Resistance freeze temperature by cable, K.',
                         'duct_air_capacity': 'Duct equivalent air volumetric heat capacity J/(m³*K) and source.',
                         'temperature_table': 'Native solved conductor/sheath temperature grid in °C; current RMS A; no extrapolation.',
                         'thermal_boundaries': 'Thermal boundary conditions; fixed temperature K must equal saved ambient.',
                         'material_validity': 'Sourced valid temperature interval by conducting material, K.',
                         'initial_temperature_k': 'Initial absolute temperature, K.',
                         'temperature_tolerance_k': 'Iteration temperature update threshold, K.',
                         'power_relative_tolerance': 'Dimensionless relative power update threshold.',
                         'maximum_iterations': 'Maximum coupled iterations; failure publishes no substitute field.',
                         'relaxation': 'Dimensionless under-relaxation in (0,1].'}
                for field, info in schema['properties'].items():
                    info['description'] = units.get(field, info.get('description', field))
                result.append({'method':pin, 'input_schema':cap['input_schema'], 'schema':DomainDocument.model_json_schema(),
                               'parameter_schema':schema, 'input_sources':['domain', 'study'], 'tasks':[cap['id']],
                               'parameter_source':'backend/kernel/simulation_parameters.py',
                               'parameter_source_sha256':sha256((ROOT/'backend/kernel/simulation_parameters.py').read_bytes()).hexdigest(),
                               'source':path.relative_to(ROOT).as_posix(), 'source_sha256':sha256(path.read_bytes()).hexdigest(),
                               'schema_digest':sha256(json.dumps(schema,sort_keys=True).encode()).hexdigest()})
                if cap['input_schema']=='cablesim.simulation-problem/1':
                    from .simulation_contract import contract
                    exact=contract()
                    result[-1].update(schema=exact['schema'],standalone_schema=exact['schema'],
                                      source=exact['source'],source_sha256=exact['source_sha256'],schema_digest=exact['schema_sha256'],
                                      parameter_source=path.relative_to(ROOT).as_posix(),parameter_source_sha256=sha256(path.read_bytes()).hexdigest(),
                                      input_sources=['study'])
                continue
            if cap['id']=='model-completion':
                result.append({'method':pin,'input_schema':cap['input_schema'],'schema':schema,
                    'parameter_schema':schema,'input_sources':['study'],'tasks':[],
                    'engineering_fields':sys.modules[model.__module__].FORM_FIELDS})
                continue
            if cap['id']=='armoured-sl-rating':
                result.append({'method':pin,'input_schema':cap['input_schema'],'schema':schema,'standalone_schema':schema,
                  'parameter_schema':{'type':'object','properties':{},'additionalProperties':False},'schema_digest':sha256(json.dumps(schema,sort_keys=True).encode()).hexdigest(),
                  'source':path.relative_to(ROOT).as_posix(),'source_sha256':sha256(path.read_bytes()).hexdigest(),'input_sources':['study'],'tasks':['rating']})
                continue
            parameters = {'type': 'object', 'properties': {}, 'additionalProperties': False}
            if key[0] == 'cablesim.thermal-network':
                cable = schema['$defs']['Cable']['properties']
                fields = {'conductor_kind': cable['conductor'], 'ac_extra_factor': cable['ac_extra_factor'],
                          'screen_loss_factor': cable['screen_loss_factor']}
                parameters.update(properties=fields, required=list(fields))
            else:
                fields = {'ks': schema['$defs']['Conductor']['properties']['ks'],
                          'kp': schema['$defs']['Conductor']['properties']['kp'],
                          't4_form': schema['$defs']['Installation']['properties']['t4_form'],
                          'eddy': schema['$defs']['Bonding']['properties']['eddy'],
                          'solver': schema['properties']['solver']}
                for name, title in {'ks':'集肤系数 kₛ', 'kp':'邻近系数 kₚ', 't4_form':'外部热阻形式', 'eddy':'涡流分支'}.items():
                    fields[name]['title'] = title
                fields['source'] = {'type':'string', 'minLength':1, 'title':'系数来源',
                    'description':'载流量表填写 ks、kp 或涡流分支时需记录标准条款、厂家资料或明确设计条件；不作为实测证明。'}
                fields['duct'] = {'type': 'object', 'properties': {k: schema['$defs']['Duct']['properties'][k]
                                  for k in ('u', 'v', 'y_per_k', 'initial_mean_air_temperature_c')},
                                  'required': ['u', 'v', 'y_per_k', 'initial_mean_air_temperature_c']}
                fields['per_cable_losses'] = {'type':'object', 'additionalProperties': {'type':'object','properties': {
                    'ac_extra_factor': {'type':'number','minimum':0}, 'lambda1': {'type':'number','minimum':0},
                    'lambda2': {'type':'number','minimum':0,'default':0}},
                    'required':['ac_extra_factor','lambda1'], 'additionalProperties':False}}
                fields['loss_input_source'] = {'type':'string'}
                fields['target_circuit_id'] = {'type':'string'}
                fields['reference_basis'] = {'type':'string','enum':['iec2023','tb880_reference'],'default':'iec2023'}
                fields['operation'] = {'type':'string','enum':['both','temperature'],'default':'both'}
                fields['rating_mode'] = {'type':'string','enum':['individual','simultaneous','both'],'default':'individual',
                    'description':'individual: one circuit varies, other saved loads held; simultaneous: all circuits share one balanced RMS current (A); both: publish both bases.'}
                fields['double_flat_tables'] = {'type':'object','additionalProperties':True}
                fields['corrugated_gap'] = {'type':'object','description':'By cable type ID; explicit effective corrugation-gap material and geometry sources.',
                    'additionalProperties':{'type':'object','properties':{
                        'rho_k_m_w':{'type':'number','exclusiveMinimum':0,'description':'Effective thermal resistivity of the gap to mean inner sheath diameter, K·m/W.'},
                        'source':{'type':'string','minLength':1,'description':'Reference or measured source for gap thermal property.'},
                        'geometry_source':{'type':'string','minLength':1,'description':'Depth/pitch source; label engineering assumptions separately.'}},
                        'required':['rho_k_m_w','source','geometry_source'],'additionalProperties':False}}
                fields['external_loss_reference'] = {'type':'object','properties':{
                    'run_id':{'type':'string'},'case_id':{'type':'string'},
                    'artifact_type':{'const':'x-cablesim.loss-coefficients','type':'string'},
                    'artifact_sha256':{'type':'string','pattern':'^[0-9a-f]{64}$'}},
                    'required':['run_id','case_id','artifact_type','artifact_sha256'],'additionalProperties':False}
                optional = ('source','duct','per_cable_losses','loss_input_source','target_circuit_id','reference_basis','operation','rating_mode','double_flat_tables','external_loss_reference','corrugated_gap')
                parameters.update(properties=fields, required=[k for k in fields if k not in optional], **{'$defs': schema['$defs']})
            primary = DomainDocument.model_json_schema()
            encoded = json.dumps(primary, sort_keys=True, ensure_ascii=False).encode()
            result.append({'method': pin, 'input_schema': cap['input_schema'], 'schema': primary,
                           'standalone_schema': schema,
                           'parameter_schema': parameters,
                           'schema_digest': sha256(encoded).hexdigest(),
                           'source': path.relative_to(ROOT).as_posix(),
                           'source_sha256': sha256(path.read_bytes()).hexdigest(),
                           'input_sources': ['domain'] if key[0] == 'cablesim.thermal-network' else ['domain', 'study'],
                           'reference_only': key[0] == 'cablesim.thermal-network',
                           'tasks': ['compare'] if key[0] == 'cablesim.thermal-network' else ['rating', 'operating', 'target']})
    result.sort(key=lambda item:item['method']['capability']!='steady-rating')
    return result


def synthetic_iec():
    """Read the public invented input literal; never load licensed reference data."""
    path = ROOT / 'plugins/cablesim.iec60287/tests/test_iec60287_method.py'
    tree = ast.parse(path.read_text(encoding='utf-8'))
    value = next(ast.literal_eval(node.value) for node in tree.body
                 if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'BASE' for t in node.targets))
    model, _ = model_for('cablesim.iec60287', 'steady-rating')
    return {'input': model.model_validate(value).model_dump(mode='json'),
            'source': path.relative_to(ROOT).as_posix() + ':18',
            'source_sha256': sha256(path.read_bytes()).hexdigest(),
            'label': '公开合成算例 · 非厂家数据、非标准参考算例'}
