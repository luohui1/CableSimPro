"""Complete proposal values from the sealed parameter labels and units."""
from copy import deepcopy

from backend.plugin_host.parameter_contracts import normalize, schemas

from .fields import displayed, schema_at, unit_for


def review_points(parameters, capability, document):
    """Unlike numeric read evidence, a review must include confirmations and sources."""
    schema, _ = schemas(capability, document)
    parameters, _ = normalize(capability, parameters, document)
    points = []

    def visit(value, path):
        if isinstance(value, dict) and value:
            for key, child in value.items():
                visit(child, path + '/' + str(key).replace('~', '~0').replace('/', '~1'))
        elif isinstance(value, list) and value:
            for index, child in enumerate(value): visit(child, path + '/' + str(index))
        elif path:
            metadata = schema_at(schema, path)
            unit = unit_for(metadata, parameters, path)
            shown = displayed(value, unit) if unit.get('si') else deepcopy(value)
            if isinstance(value, str) and value in metadata.get('enum', []):
                shown = metadata.get('x-enum-labels', {}).get(value, shown)
            points.append({'path': '/parameters' + path, 'label': metadata.get('title', path),
                           'value': shown,
                           'unit': unit.get('display')})

    visit(parameters, '')
    return points
