"""Product geometry must survive a STEP round trip through the actual CAD kernel."""
from copy import deepcopy

import pytest

from studio_core import CoreError, geometry, library

cq = pytest.importorskip('cadquery', reason='Install the cable-geometry plugin requirements to verify native CAD.')


def test_saved_structure_exports_valid_solids_with_matching_dimensions(tmp_path):
    entry = library.get('huayuan.yjv22-15kv-240')
    before = deepcopy(entry)
    result = geometry.build(entry)
    assert entry == before
    assert result['method']['plugin_id'] == 'cablesim.cable-geometry'
    assert len(result['artifact_sha256']) == 64
    model = result['model']
    assert model['schema'] == 'cablesim.cad-model/1'
    assert model['step_unit'] == 'mm'
    target = tmp_path / 'cable.step'
    target.write_text(model['step_text'], encoding='utf-8')
    imported = cq.importers.importStep(str(target))
    solids = imported.solids().vals()
    assert solids and all(solid.isValid() and solid.Volume() > 0 for solid in solids)
    bounds = cq.Compound.makeCompound(solids).BoundingBox()
    assert bounds.zlen == pytest.approx(model['length_m'] * 1000, abs=.01)
    assert bounds.xlen == pytest.approx(model['outer_diameter_m'] * 1000, abs=.01)
    assert bounds.ylen == pytest.approx(model['outer_diameter_m'] * 1000, abs=.01)
    assert all(layer['display_mesh']['unit'] == 'mm' for layer in model['layers'])


def test_unsupported_corrugation_is_refused_without_substitute_shape():
    with pytest.raises(CoreError, match='波纹'):
        geometry.build(library.get('public.qifan.yjlw03-110kv-800'))


def test_stranded_conductor_requires_manufacturing_parameters():
    entry = deepcopy(library.get('huayuan.yjv22-15kv-240'))
    conductor = entry['payload']['cable_type']['cores'][0]['conductor']
    conductor['form'] = 'stranded_round'
    conductor.pop('wire_count', None)
    with pytest.raises(CoreError, match='单丝'):
        geometry.build(entry)
