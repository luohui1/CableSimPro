"""Manifest-driven form contracts from verified installed releases.

The shared domain document belongs to the host. Every capability parameter and
standalone input schema comes from its sealed manifest, with no UI field-name map.
"""
import ast
from copy import deepcopy
from hashlib import sha256
import importlib
import importlib.util
import json
from pathlib import Path
import sys
from collections import OrderedDict
from threading import RLock
from backend.domain.models import DomainDocument

ROOT = Path(__file__).resolve().parents[2]
_validated_catalogues = OrderedDict()
_catalogue_lock = RLock()
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



def contracts(research, *, encoded=False, catalog_preload=True):
    from backend.plugin_host import PluginHostError
    from .verified_executor import verification_scope
    from .host_api import InputContract
    from pydantic import TypeAdapter

    try:
        with research.contract_read_lock, verification_scope():
            registry = research.registry()
            entries = research.methods(registry)
            # methods() already computed each identity from this exact Registry
            # metadata snapshot; fresh package verification below still runs.
            cache = {'registries': {pid: registry for pid in registry.plugins},
                     'pins': {(entry['method']['plugin_id'], id(registry.get(entry['method']['plugin_id']).manifest)):
                              entry['method'] for entry in entries}}
            if catalog_preload:
                # Discovery only publishes metadata, with a SourceWatch lease around
                # the whole read. Verify all package bytes/import closures once;
                # execution receipts and before/after source snapshots remain the
                # executor's responsibility when an engineering operation starts.
                # Package verification is bounded filesystem work, not solver
                # execution. Four readers overlap Windows path/byte I/O while
                # keeping every package's normal digest/import-closure check.
                from concurrent.futures import ThreadPoolExecutor
                from backend.plugin_host.dependencies import DependencySnapshot, dependency_batch
                snapshot = DependencySnapshot(registry.root.parent)
                def verify(plugin):
                    with dependency_batch(snapshot):
                        plugin.verify()
                try:
                    with ThreadPoolExecutor(max_workers=4) as readers:
                        list(readers.map(verify, registry.plugins.values()))
                except OSError as exc:
                    raise PluginHostError('PLUGIN_SEAL_INVALID', '插件封签文件无法核验；请检查安装文件与读取权限。'+str(exc), 409) from None
                cache['verified'] = {pid: None for pid in registry.plugins}
            # Every hit rechecks the exact installed bytes, including presentation.
            for entry in entries:
                for cap in entry['capabilities']:
                    research.resolve({**entry['method'], 'capability': cap['id']}, cache)
            key = sha256(json.dumps([entry['method'] for entry in entries], sort_keys=True).encode()).hexdigest()
            if key not in research.contract_read_cache:
                # Only immutable source-derived JSON is shared between hosts.
                # Every package/closure above was freshly authenticated; database
                # data, executors, mutable manifests and currentness never enter
                # this cache. A model rebuild or builder replacement also misses.
                schema_digest = sha256(json.dumps(DomainDocument.model_json_schema(), sort_keys=True).encode()).digest()
                shared_key = (str(registry.root.resolve()), key, schema_digest, verified_contracts)
                with _catalogue_lock:
                    previous = _validated_catalogues.get(shared_key)
                    if previous is not None:
                        _validated_catalogues.move_to_end(shared_key)
                if previous is None:
                    values = verified_contracts(research, entries, cache)
                    adapter = TypeAdapter(list[InputContract])
                    validated = adapter.validate_python(values)
                    previous = (json.dumps(values, ensure_ascii=False, allow_nan=False).encode(),
                                adapter.dump_json(validated, by_alias=True))
                    with _catalogue_lock:
                        _validated_catalogues[shared_key] = previous
                        while len(_validated_catalogues) > 8:
                            _validated_catalogues.popitem(last=False)
                research.contract_read_cache[key] = (json.loads(previous[0]), previous[1])
                while len(research.contract_read_cache) > 4:
                    research.contract_read_cache.popitem(last=False)
            research.contract_read_cache.move_to_end(key)
            values, payload = research.contract_read_cache[key]
            return payload if encoded else deepcopy(values)
    except (OSError, ValueError, SyntaxError, ImportError, AttributeError) as exc:
        raise PluginHostError('PLUGIN_INPUT_CONTRACT_INVALID', '插件清单参数契约无法读取；请完成安装与封签。'+str(exc), 409) from None


def verified_contracts(research, entries=None, resolve_cache=None):
    domain_schema = DomainDocument.model_json_schema()
    values = []
    for entry in research.methods() if entries is None else entries:
        for cap in entry['capabilities']:
            method = {**entry['method'], 'capability': cap['id']}
            plugin, capability = research.resolve(method, resolve_cache)
            contract = capability.input_contract
            if contract is None:
                continue
            standalone = contract.standalone_schema.model_dump(mode='json', by_alias=True, exclude_none=False) if contract.standalone_schema else None
            schema = domain_schema if 'domain' in contract.input_sources else standalone or {'type':'object', 'description':'此输入由声明的来源对象绑定，不能自由编辑JSON。'}
            path = plugin.directory/'plugin.json'
            source = path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else str(path)
            source_hash = sha256(path.read_bytes()).hexdigest()
            values.append({
                'method':method, 'input_schema':capability.input_schema, 'schema':schema,
                'parameter_schema':capability.parameter_schema.model_dump(mode='json', by_alias=True, exclude_none=False),
                'standalone_schema':standalone, 'input_sources':contract.input_sources,
                'standalone_parameter_schema':contract.standalone_parameter_schema.model_dump(mode='json',by_alias=True,exclude_none=False) if contract.standalone_parameter_schema else None,
                'input_binding':contract.binding.model_dump(mode='json') if contract.binding else None,
                'schema_digest':sha256(json.dumps(schema, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
                'source':source, 'source_sha256':source_hash,
                'parameter_source':source, 'parameter_source_sha256':source_hash,
                'tasks':capability.study_tasks, 'reference_only':capability.analysis=='crosscheck',
                'x-groups':[group.model_dump(mode='json') for group in capability.parameter_groups],
                'x-headline':[headline.model_dump(mode='json') for headline in capability.headlines],
                'preview':capability.preview, 'preview_timeout_s':capability.preview_timeout_s})
    values.sort(key=lambda item:item['method']['capability']!='steady-rating')
    return values


def synthetic_iec():
    """Read the public invented input literal; never load licensed reference data."""
    path = ROOT / 'plugins/cablesim.iec60287/tests/test_iec60287_method.py'
    tree = ast.parse(path.read_text(encoding='utf-8'))
    value = next(ast.literal_eval(node.value) for node in tree.body
                 if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'BASE' for t in node.targets))
    model, _ = model_for('cablesim.iec60287', 'steady-rating')
    from cablesim_sdk.parameter_units import translate
    manifest=json.loads((ROOT/'plugins/cablesim.iec60287/plugin.json').read_text('utf-8'))
    schema=next(cap for cap in manifest['capabilities'] if cap['id']=='reference-rating')['input_contract']['standalone_schema']
    return {'input': translate(schema,model.model_validate(value).model_dump(mode='json')),
            'source': path.relative_to(ROOT).as_posix() + ':18',
            'source_sha256': sha256(path.read_bytes()).hexdigest(),
            'label': '公开合成算例 · 非厂家数据、非标准参考算例'}
