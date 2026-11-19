"""Conservative release comparison: ignore only enumerated presentation metadata.

No execution substitutes releases. This proof applies to reading saved results
only. Calculation files, dependencies, defaults, units and unknown fields remain
in the comparison; unsupported/absent historical evidence fails closed. Two
fixed simulation evidence assets are authenticated separately on evidence reads.
"""
from copy import deepcopy
from functools import lru_cache
from collections import OrderedDict
from threading import RLock
import json
from pathlib import Path
from fastapi import HTTPException

from .workspace import fingerprint

RULE = 'sealed-computation-and-contract/3'
_identities = OrderedDict()
_identity_lock = RLock()

# These assets catalogue already completed jobs; neither is a solver input.
# Keep their paths and any unknown file metadata in the identity. This is not
# a plugin-controlled trust switch, an assets/** exclusion, or a seal bypass.
EVIDENCE_ASSETS = frozenset({
    'assets/engineering-evidence-index.json',
    'assets/engineering-evidence-schema.json',
})


def evidence_asset_receipts(manifest):
    if manifest.get('id') != 'cablesim.simulation':
        return {}
    return {row['path']: deepcopy(row) for row in manifest.get('files', [])
            if row.get('path') in EVIDENCE_ASSETS}


@lru_cache(maxsize=1)
def historical_manifests():
    # Frozen normalized seal evidence from the named repository commit; never
    # match by version/name, and never read runtime git or mutate saved inputs.
    return json.loads((Path(__file__).parent / 'method-manifests.json').read_text('utf-8'))['manifests']


def saved_manifest(snapshot, digest):
    return (snapshot.get('method_manifests') or {}).get(digest) or historical_manifests().get(digest)


def schema_identity(value):
    if isinstance(value, list):
        return [schema_identity(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {}
    for key, item in value.items():
        if key in ('title', 'description', 'x-group', 'x-enum-labels'):
            continue
        # x-unit only tells a form how to show and enter an SI value; any runtime
        # conversion is declared separately in x-runtime and stays in the identity.
        # A corrected display unit (0.1 K shown as °C) must not retire saved runs.
        if key == 'x-unit' and isinstance(item, dict):
            result[key] = {'si': item.get('si')}
            continue
        if key == 'x-unit-by' and isinstance(item, dict):
            cases = item.get('cases')
            result[key] = {**{name: deepcopy(child) for name, child in item.items() if name != 'cases'},
                           'cases': {case: {'si': unit.get('si')} if isinstance(unit, dict) else deepcopy(unit)
                                     for case, unit in cases.items()} if isinstance(cases, dict) else deepcopy(cases)}
            continue
        # Traverse schema nodes only. Annotation-looking keys inside default,
        # const, enum and unknown extension DATA remain calculation inputs.
        if key in ('properties', '$defs', 'definitions', 'patternProperties', 'dependentSchemas') and isinstance(item, dict):
            result[key] = {name: schema_identity(child) for name, child in item.items()}
        elif key in ('items', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'contains', 'propertyNames', 'if', 'then', 'else', 'not', 'allOf', 'anyOf', 'oneOf', 'prefixItems'):
            result[key] = schema_identity(item)
        else:
            result[key] = deepcopy(item)
    return result


def computation_identity(manifest, capability):
    # Authenticate the actual manifest, rather than trusting its claimed seal.
    # Cached normalization never replaces resolve() or input/currentness checks.
    return _computation_identity(manifest, capability, fingerprint(manifest))


def _computation_identity(manifest, capability, release_digest):
    cache_key = (RULE, release_digest, capability)
    with _identity_lock:
        cached = _identities.get(cache_key)
        if cached is not None:
            _identities.move_to_end(cache_key)
            return cached
        # The summary and display requests arrive together. Normalize each
        # authenticated release once, including their concurrent first miss.
        # This is a metadata lock; it never holds a database/write transaction.
        result = _normalized_identity(manifest, capability)
        _identities[cache_key] = result
        while len(_identities) > 128:
            _identities.popitem(last=False)
        return result


def _normalized_identity(manifest, capability):
    # Only the selected capability belongs to this identity. Do not recursively
    # copy contracts of every other capability merely to discard them below;
    # retain every non-presentation root/file/dependency field exactly as before.
    value = {key: deepcopy(item) for key, item in manifest.items() if key != 'capabilities'}
    selected = deepcopy(next(item for item in manifest['capabilities'] if item['id'] == capability))
    if value.get('id') == 'cablesim.simulation':
        for row in value.get('files', []):
            if row.get('path') in EVIDENCE_ASSETS:
                row.pop('sha256', None)
                row.pop('size_bytes', None)
    for key in ('version', 'name', 'description', 'icon', 'presentation'):
        value.pop(key, None)
    for key in ('title', 'description', 'limitations', 'validation', 'x-groups'):
        selected.pop(key, None)
    if 'parameter_schema' in selected:
        selected['parameter_schema'] = schema_identity(selected['parameter_schema'])
    contract = selected.get('input_contract') or {}
    for key in ('standalone_schema', 'standalone_parameter_schema'):
        if key in contract:
            contract[key] = schema_identity(contract[key])
    # Headline labels may change, but key/unit/condition/aggregation stay fixed.
    for headline in selected.get('x-headline', []):
        headline.pop('title', None)
    value['capabilities'] = [selected]
    return fingerprint(value)


def classify(old, new, old_manifest, new_manifest, cache=None):
    # Read callers supply their private request scope: both manifests are
    # immutable, already byte-bound copies. Retain the object alongside its
    # digest, so an id cannot be reused for a different manifest in this scope.
    # Independent callers (including mutable diagnostic inputs) hash each call.
    def manifest_digest(manifest):
        if cache is None:return fingerprint(manifest)
        receipts = cache.setdefault('manifest_digests', {})
        key = id(manifest)
        if key not in receipts:receipts[key] = (manifest, fingerprint(manifest))
        return receipts[key][1]
    base = {'rule': RULE, 'from_computation_digest': None, 'to_computation_digest': None}
    try:
        if (not isinstance(old_manifest, dict) or manifest_digest(old_manifest) != old['release_digest']
                or manifest_digest(new_manifest) != new['release_digest']
                or old_manifest['version'] != old['version'] or new_manifest['version'] != new['version']
                or old_manifest['id'] != old['plugin_id'] or new_manifest['id'] != old['plugin_id']):
            return {**base, 'classification': 'unproven'}
        # Both seals were authenticated against actual bytes above. Avoid a
        # second hash and recursive schema copy for this same immutable release.
        before = _computation_identity(old_manifest, old['capability'], old['release_digest'])
        after = _computation_identity(new_manifest, old['capability'], new['release_digest'])
        asset_changes = [{'path': path, 'from': receipt, 'to': evidence_asset_receipts(new_manifest).get(path)}
                         for path, receipt in evidence_asset_receipts(old_manifest).items()
                         if receipt != evidence_asset_receipts(new_manifest).get(path)]
        return {**base, 'from_computation_digest': before, 'to_computation_digest': after,
                'non_computation_asset_changes': asset_changes,
                'classification': 'presentation_only' if before == after else 'calculation_changed'}
    except (KeyError, TypeError, StopIteration):
        return {**base, 'classification': 'unproven'}


def manifest_for_read(plugin, cache):
    """Serialize a resolved, sealed manifest once within this read request."""
    manifests = cache.setdefault('serialized_manifests', {})
    key = (plugin.manifest.id, id(plugin.manifest))
    if key not in manifests:
        manifests[key] = plugin.manifest.model_dump(mode='json', by_alias=True)
    return manifests[key]


def current_for_read(research, old, snapshot, cache):
    """Validate current installation, prove equivalent release, preserve old pin."""
    from .report_reads import read_cache
    shared = read_cache()
    if shared is not None:cache = shared.setdefault('methods', {})
    try:
        return research.resolve(old, cache)
    except HTTPException as error:
        # Only a release conflict can be considered; failed seals never qualify.
        if error.status_code != 409:
            raise
        registry = cache.setdefault('registries', {}).get(old['plugin_id'])
        plugin = (registry or research.registry(old['plugin_id'])).get(old['plugin_id'])
        pins = cache.setdefault('pins', {})
        pin_key = (old['plugin_id'], id(plugin.manifest))
        if pin_key not in pins:
            pins[pin_key] = research.pin(plugin)
        new = {**pins[pin_key], 'capability': old['capability']}
        resolved = research.resolve(new, cache)
        proof = classify(old, new, saved_manifest(snapshot, old['release_digest']),
                         manifest_for_read(plugin, cache), cache)
        if proof['classification'] != 'presentation_only':
            raise error
        return resolved
