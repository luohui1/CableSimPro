"""Conservative release comparison: ignore only enumerated presentation metadata.

No execution substitutes releases. This proof applies to reading saved results
only. All sealed files, dependencies, defaults, units and unknown fields remain
in the comparison; unsupported/absent historical evidence fails closed.
"""
from copy import deepcopy
from functools import lru_cache
import json
from pathlib import Path
from fastapi import HTTPException

from .workspace import fingerprint

RULE = 'sealed-computation-and-contract/1'


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
    value = deepcopy(manifest)
    for key in ('version', 'name', 'description', 'icon', 'presentation'):
        value.pop(key, None)
    selected = next(item for item in value.pop('capabilities') if item['id'] == capability)
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


def classify(old, new, old_manifest, new_manifest):
    base = {'rule': RULE, 'from_computation_digest': None, 'to_computation_digest': None}
    try:
        if (not isinstance(old_manifest, dict) or fingerprint(old_manifest) != old['release_digest']
                or fingerprint(new_manifest) != new['release_digest']
                or old_manifest['version'] != old['version'] or new_manifest['version'] != new['version']
                or old_manifest['id'] != old['plugin_id'] or new_manifest['id'] != old['plugin_id']):
            return {**base, 'classification': 'unproven'}
        before = computation_identity(old_manifest, old['capability'])
        after = computation_identity(new_manifest, old['capability'])
        return {**base, 'from_computation_digest': before, 'to_computation_digest': after,
                'classification': 'presentation_only' if before == after else 'calculation_changed'}
    except (KeyError, TypeError, StopIteration):
        return {**base, 'classification': 'unproven'}


def current_for_read(research, old, snapshot, cache):
    """Validate current installation, prove equivalent release, preserve old pin."""
    try:
        return research.resolve(old, cache)
    except HTTPException as error:
        # Only a release conflict can be considered; failed seals never qualify.
        if error.status_code != 409:
            raise
        registry = cache.setdefault('registries', {}).get(old['plugin_id'])
        plugin = (registry or research.registry(old['plugin_id'])).get(old['plugin_id'])
        new = {**research.pin(plugin), 'capability': old['capability']}
        resolved = research.resolve(new, cache)
        proof = classify(old, new, saved_manifest(snapshot, old['release_digest']),
                         plugin.manifest.model_dump(mode='json', by_alias=True))
        if proof['classification'] != 'presentation_only':
            raise error
        return resolved
