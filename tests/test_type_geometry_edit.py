"""Thickness edits follow saved tangent construction without weakening validation."""
from copy import deepcopy
from math import hypot, sqrt
from uuid import uuid4
import json

import fitz
import pytest
from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from backend.domain.editing import DraftDomainDocument, resolve_edit
from backend.domain.guards import pointer
from backend.domain.models import DomainDocument
from backend.kernel.scenarios import system_models
from backend.main import create_app


@pytest.fixture
def workspace_client(tmp_path):
    with TestClient(create_app(tmp_path/'type-edit.sqlite')) as client:
        model = next(m for m in system_models() if m['id'] == 'system.specification-yjv22-300')
        response = client.post('/api/design/type-workspaces', json={
            'model_id': model['id'], 'content_sha256': model['content_sha256']})
        assert response.status_code == 201, response.text
        yield response.json(), client


def edit_insulation(document, thickness, indices=(0, 1, 2)):
    changed = deepcopy(document)
    for i in indices:
        core = changed['cable_types'][0]['cores'][i]
        next(layer for layer in core['layers'] if layer['role'] == 'insulation')['thickness'] = thickness
    return changed


@pytest.mark.parametrize('thickness,indices', [(.005, (0, 1, 2)), (.004, (0, 1, 2)), (.005, (0,))])
def test_tangent_edit_repositions_cores_and_preserves_declared_layers(workspace_client, thickness, indices):
    workspace, client = workspace_client
    original = workspace['domain']
    changed = edit_insulation(original, thickness, indices)
    response = client.put(f'/api/workspaces/{workspace["id"]}/domain', json={
        'expected_revision': workspace['revision'], 'document': changed})
    assert response.status_code == 200, response.text
    document = response.json()['document']
    cable = document['cable_types'][0]
    assert cable['common_layers'] == original['cable_types'][0]['common_layers']
    assert document['measurements'] == original['measurements']
    for axis in ('x', 'z'):
        assert sum(c[axis] for c in cable['cores']) == pytest.approx(0, abs=1e-12)
    radii = [.0165 + (thickness-.0045 if i in indices else 0) for i in range(3)]
    for i, j in ((0, 1), (1, 2), (0, 2)):
        a, b = cable['cores'][i], cable['cores'][j]
        assert hypot(a['x']-b['x'], a['z']-b['z']) == pytest.approx(radii[i]+radii[j], abs=1e-12)
    if len(indices) == 3:
        expected_outer_diameter = 2*(radii[0]*(1+2/sqrt(3))+.0075)
        assert DomainDocument.model_validate(document).cable_types[0].radius()*2 == pytest.approx(expected_outer_diameter)
    for core in cable['cores']:
        assert document['provenance'][pointer('cable_types', cable['id'], 'cores', core['id'], 'x')]['kind'] == 'derived'
    # Replaying the fully resolved document cannot move cores again.
    assert resolve_edit({**workspace, 'domain': document}, DraftDomainDocument.model_validate(document)) == document


@pytest.mark.parametrize('mutation', ['explicit_overlap', 'material', 'count', 'sector', 'locked', 'study', 'custom_layout'])
def test_edit_does_not_suppress_geometry_references_or_locks(workspace_client, mutation):
    workspace, client = workspace_client
    state = deepcopy(workspace)
    changed = edit_insulation(state['domain'], .005)
    cable = changed['cable_types'][0]
    if mutation == 'explicit_overlap':
        cable['cores'][0]['x'] = cable['cores'][1]['x']
        cable['cores'][0]['z'] = cable['cores'][1]['z']
    elif mutation == 'material':
        cable['cores'][0]['conductor']['material'] = 'material/missing'
    elif mutation == 'count':
        cable['cores'].pop()
    elif mutation == 'sector':
        cable['cores'][0]['conductor'].update(form='sectoral', diameter=.04, sector_angle_deg=120., sector_rotation_deg=0.)
    elif mutation == 'locked':
        state['locks'] = [pointer('cable_types', cable['id'], 'cores', cable['cores'][0]['id'], 'z')]
    elif mutation == 'study':
        state['study_cable_reference'] = {'id': 'bound-model', 'bound_cable_type_id': cable['id'],
            'payload': {'cable_type': deepcopy(state['domain']['cable_types'][0]), 'materials': state['domain']['materials']}}
    else:
        # A small explicitly declared clearance is not an inferred tangent rule.
        for source in (state['domain'], changed):
            for core in source['cable_types'][0]['cores']:
                core['x'] *= 1.001
                core['z'] *= 1.001
    draft = DraftDomainDocument.model_validate(changed)
    if mutation == 'sector':
        # A sector is not automatically repacked as its bounding circle.
        try:
            result = resolve_edit(state, draft)
        except RequestValidationError:
            pass
        else:
            assert [(c['x'], c['z']) for c in result['cable_types'][0]['cores']] == [(c['x'], c['z']) for c in cable['cores']]
    else:
        with pytest.raises((RequestValidationError, HTTPException)):
            resolve_edit(state, draft)
    assert client.get(f'/api/workspaces/{workspace["id"]}').json()['domain'] == workspace['domain']


def test_same_edit_previews_saves_invalidates_recalculates_and_exports(workspace_client):
    workspace, client = workspace_client
    wid = workspace['id']
    # The engineer explicitly chooses editions before obtaining their criteria.
    from test_standard_check import plugin
    document=deepcopy(workspace['domain'])
    document['provenance']['/execution_standards']={'kind':'standard','reviewed':True,'reference':json.dumps({
        'schema':'cablesim.execution-standards/1','items':[{'standard':source['standard'],'source_digest':source['sha256']}
            for source in [plugin.SOURCES['mv2'],plugin.SOURCES['conductor']]]})}
    declared=client.put(f'/api/workspaces/{wid}/domain',json={'expected_revision':workspace['revision'],'document':document})
    assert declared.status_code==200,declared.text
    workspace=client.get(f'/api/workspaces/{wid}').json()
    root = f'/api/types/{wid}/specification'

    def generate(revision):
        response = client.post(root+'/generate', json={'expected_revision': revision,
            'request_id': str(uuid4()), 'scope_acknowledged': True})
        assert response.status_code == 200, response.text
        assert response.json()['status'] == 'generated', response.json()
        return client.get(root).json()

    before = generate(workspace['revision'])
    document = edit_insulation(workspace['domain'], .005)
    method = next(m['method'] for m in client.get('/api/methods').json() if m['method']['plugin_id'] == 'cablesim.cable-geometry')
    preview = client.post(f'/api/workspaces/{wid}/geometry-preview', json={
        'expected_revision': workspace['revision'], 'document': document,
        'method': {**method, 'capability': 'concentric-model'},
        'parameters': {'cable_type_id': document['cable_types'][0]['id'], 'include_exact': False}})
    assert preview.status_code == 200, preview.text
    assert client.get(f'/api/workspaces/{wid}').json()['domain'] == workspace['domain']
    saved = client.put(f'/api/workspaces/{wid}/domain', json={
        'expected_revision': workspace['revision'], 'document': document})
    assert saved.status_code == 200, saved.text
    revision = saved.json()['revision']
    for source in before['payload']['sources']:
        run = client.get(f'/api/workspaces/{wid}/studies/{source["study_id"]}/runs/{source["run_id"]}').json()
        assert run['freshness'] == 'historical'
    # An old specification cannot be exported against the modified input.
    assert client.get(root+'/file', params={'expected_revision': revision,
        'specification_digest': before['digest'], 'audience': 'customer'}).status_code == 409
    after = generate(revision)
    old_geometry = before['payload']['results']['geometry']['artifact']
    new_geometry = after['payload']['results']['geometry']['artifact']
    assert new_geometry['outer_diameter_m']-old_geometry['outer_diameter_m'] == pytest.approx(.001*(1+2/sqrt(3)))
    assert new_geometry['mass_kg_per_km'] > old_geometry['mass_kg_per_km']
    assert preview.json()['artifacts']['x-cablesim.cad-model']['outer_diameter_m'] == pytest.approx(new_geometry['outer_diameter_m'])
    assert all(s['freshness'] == 'current' for s in after['payload']['sources'])
    pdf = client.get(root+'/file', params={'expected_revision': revision,
        'specification_digest': after['digest'], 'audience': 'customer'})
    assert pdf.status_code == 200, pdf.text
    assert pdf.headers['x-specification-audience'] == 'customer'
    with fitz.open(stream=pdf.content, filetype='pdf') as output:
        content = ''.join(p.get_text() for p in output)
        assert 'YJV22' in content and '300' in content
    print(f'\nYJV22 edit: OD {old_geometry["outer_diameter_m"]*1000:.6f} -> {new_geometry["outer_diameter_m"]*1000:.6f} mm; '
          f'mass {old_geometry["mass_kg_per_km"]:.6f} -> {new_geometry["mass_kg_per_km"]:.6f} kg/km; customer PDF {len(pdf.content)} bytes')
