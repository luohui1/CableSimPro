"""Read-only prototype form contracts, derived from installed input models.

This adapter supplies presentation metadata only. Runs still use the normal
Study/preflight/Run API; no calculation or alternate result storage lives here.
"""
import ast
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import sys
from backend.domain.models import DomainDocument

ROOT = Path(__file__).resolve().parents[2]
MODELS = {
    ('cablesim.iec60287', 'steady-rating'): ('cablesim_iec60287', 'Rating'),
    ('cablesim.thermal-network', 'steady-rating'): ('cablesim_thermal_network', 'Scenario'),
}


def model_for(plugin_id, capability):
    package, name = MODELS[(plugin_id, capability)]
    path = ROOT / 'plugins' / plugin_id / 'src' / package / 'inputs.py'
    module_name = '_design_' + package + '_inputs'
    if module_name not in sys.modules:
        spec = importlib.util.spec_from_file_location(module_name, path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
    return getattr(sys.modules[module_name], name), path


def contracts(research):
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
                fields['duct'] = {'type': 'object', 'properties': {k: schema['$defs']['Duct']['properties'][k]
                                  for k in ('u', 'v', 'y_per_k', 'initial_mean_air_temperature_c')},
                                  'required': ['u', 'v', 'y_per_k', 'initial_mean_air_temperature_c']}
                fields['per_cable_losses'] = {'type':'object', 'additionalProperties': {'type':'object','properties': {
                    'ac_extra_factor': {'type':'number','minimum':0}, 'lambda1': {'type':'number','minimum':0}},
                    'required':['ac_extra_factor','lambda1'], 'additionalProperties':False}}
                fields['loss_input_source'] = {'type':'string'}
                fields['target_circuit_id'] = {'type':'string'}
                fields['reference_basis'] = {'type':'string','enum':['iec2023','tb880_reference'],'default':'iec2023'}
                parameters.update(properties=fields, required=[k for k in fields if k not in ('duct','per_cable_losses','loss_input_source','target_circuit_id','reference_basis')], **{'$defs': schema['$defs']})
            primary = DomainDocument.model_json_schema() if key[0] == 'cablesim.iec60287' else schema
            encoded = json.dumps(primary, sort_keys=True, ensure_ascii=False).encode()
            result.append({'method': pin, 'input_schema': cap['input_schema'], 'schema': primary,
                           'standalone_schema': schema,
                           'parameter_schema': parameters,
                           'schema_digest': sha256(encoded).hexdigest(),
                           'source': path.relative_to(ROOT).as_posix(),
                           'source_sha256': sha256(path.read_bytes()).hexdigest(),
                           'input_sources': ['domain'] if key[0] == 'cablesim.thermal-network' else ['domain', 'study'],
                           'tasks': ['rating', 'operating', 'target']})
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
