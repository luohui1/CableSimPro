"""Read every check of the real release manufacturer's type under the 6 KiB contract.

The release seeder supplies the saved method outputs; this test does not invent
engineering results or replace Types.evidence. Only a read spy checks that the
projection leaves the actual channels and persisted run archives unchanged.
"""
import importlib.util
import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend.harness.context_builder import encoded, fits
from backend.kernel.type_versions import Types, check_results
from backend.kernel.workspace import fingerprint
from test_harness_external import TOKEN, call, open_session


def test_saved_manufacturer_checks_page_all_facts_without_large_provenance_or_mutation(
        tmp_path, monkeypatch, release_seed_copy):
    path = Path(__file__).resolve().parents[1] / 'frontend/scripts/seed-engineering-demo.py'
    spec = importlib.util.spec_from_file_location('type_read_release_seed', path)
    seed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(seed)
    database = tmp_path / 'release/engineering.sqlite'
    release_seed_copy(seed, database)
    monkeypatch.setenv('CABLESIM_DB', str(database))
    monkeypatch.setenv('CABLESIM_DATASETS_DIR', str(database.parent / 'datasets'))
    monkeypatch.setenv('CABLESIM_REPRODUCTION_LIBRARY', str(database.parent / 'library'))
    monkeypatch.setenv('CABLESIM_AGENT_SIDECAR_TOKEN', TOKEN)
    from backend.main import create_app

    with TestClient(create_app(database)) as client:
        receipt = json.loads(database.with_suffix('.seed.json').read_text('utf-8'))
        selected = next(item for item in receipt['types'] if item['name'].startswith('YJV22') and not item.get('teaching'))
        workspace = client.get('/api/workspaces/' + selected['workspace']).json()
        research = client.app.state.research
        _, _, channels, failures = Types(research, None).evidence(workspace['id'])
        expected = list(failures)
        check_results(channels, expected)
        oversized = [check for check in expected if not fits(check, 6 * 1024)]
        assert oversized, 'the real saved specimen must exercise the previously unreadable check, not a small substitute'
        assert any(check.get('result', {}).get('input_source') or check.get('result', {}).get('basis_reference')
                   or any(item.get('density_source') for item in check.get('quantities', [])) for check in oversized)
        with research.store.db() as db:
            saved_runs = [tuple(row) for row in db.execute(
                'SELECT id,snapshot,output,input_digest,output_digest FROM study_runs WHERE workspace=? ORDER BY id',
                (workspace['id'],))]

        def forbidden(*_args, **_kwargs):
            raise AssertionError('reading existing checks must not execute a method')
        monkeypatch.setattr(research.executor, 'run', forbidden)
        observed = []
        original_evidence = Types.evidence

        def inspect(self, identifier):
            result = original_evidence(self, identifier)
            observed.append((result[2], fingerprint(result[2])))
            return result
        monkeypatch.setattr(Types, 'evidence', inspect)
        scope = open_session(client, workspace, '逐页读取保存核对事实及缺项，不运行方法。')
        args = {'type_id': workspace['id'], 'view': 'runs', 'limit': 20}
        entries, cursors, sizes = [], set(), []
        total = None
        while args:
            response = call(client, 'type_read', args, scope['session'], scope['turn'])
            assert response.status_code == 200, response.text
            result = response.json()
            assert result['status'] == 'ok', result
            sizes.append(len(encoded(result)))
            assert sizes[-1] <= 6 * 1024
            data = result['data']
            assert data['view'] == 'runs' and data['type_revision'] == workspace['revision']
            assert '完整来源' in data['check_details'] and '原保存运行' in data['check_details']
            total = data['total'] if total is None else total
            assert data['total'] == total
            sources = data.get('sources', [])
            used_sources = set()
            for item in data['items']:
                source = item.get('source', {})
                if 'index' in source:
                    assert item['section'] == 'checks' and set(source) == {'index'}
                    index = source['index']
                    assert 0 <= index < len(sources)
                    used_sources.add(index)
                    entries.append({**item, 'source': sources[index]})
                else:
                    entries.append(item)
            assert used_sources == set(range(len(sources))), 'the page must not leak a source for a check deferred to the next page'
            for actual, before in observed:
                assert fingerprint(actual) == before, 'projection must not remove provenance or facts from an evidence channel'
            observed.clear()
            args = data['next_page']
            if args:
                assert args['after'] == len(entries) and args['after'] not in cursors
                assert args['expected_revision'] == workspace['revision']
                cursors.add(args['after'])
        assert 1 < len(sizes) < 24 and len(entries) == total
        checks = [item for item in entries if item['section'] == 'checks']
        assert [(item['id'], item.get('channel')) for item in checks] == [(item['id'], item.get('channel')) for item in expected]
        for actual, original in zip(checks, expected):
            for key in ('id', 'channel', 'message', 'blocking', 'excluded', 'exclusion_reason', 'missing'):
                if key in original:
                    assert actual[key] == original[key]
            if original.get('result'):
                for key in ('actual', 'actual_unrounded', 'design_actual', 'value', 'limit', 'unit', 'margin', 'comparison',
                            'verdict', 'status', 'satisfied', 'basis', 'source_status', 'target', 'standard', 'clause', 'missing', 'missing_parameters'):
                    if key in original['result']:
                        assert actual['result'][key] == original['result'][key]
                for key in ('title', 'reason'):
                    if key in original['result']:
                        if key in actual['result']:
                            assert actual['result'][key] == original['result'][key]
                        else:
                            value = original['result'][key]
                            assert isinstance(value, str)
                            if key == 'reason':
                                assert actual['message'].rstrip('。').endswith(value.rstrip('。'))
                            else:
                                assert actual['message'].startswith(value + '：')
                if 'id' in original['result']:
                    if 'id' in actual['result']:
                        assert actual['result']['id'] == original['result']['id']
                    else:
                        assert actual['id'] == actual['channel'] + '/' + original['result']['id']
                assert not {'input_source', 'basis_reference', 'basis_references', 'formula_inputs', 'path', 'layer_path',
                            'printed_page', 'pdf_page', 'source_digest', 'measurement_id'} & actual['result'].keys()
                if original['result'].get('basis_missing_fields'):
                    assert len(actual['result']['basis_missing_fields']) == len(original['result']['basis_missing_fields'])
                    for actual_field, original_field in zip(actual['result']['basis_missing_fields'], original['result']['basis_missing_fields']):
                        for key in ('field', 'label', 'unit', 'type', 'storage'):
                            if key in original_field:
                                assert actual_field[key] == original_field[key]
            if original.get('quantities'):
                assert len(actual['quantities']) == len(original['quantities'])
                for actual_row, original_row in zip(actual['quantities'], original['quantities']):
                    for key in ('entity', 'role', 'mass_kg_per_km', 'density_kg_m3', 'quantity_missing'):
                        if key in original_row:
                            assert actual_row[key] == original_row[key]
                    assert not {'density_source', 'step_text', 'brep_text', 'display_mesh'} & actual_row.keys()
            channel = original.get('channel')
            if channel in channels:
                source = Types._source(channel, channels[channel])
                for key in ('run_id', 'study_id', 'input_digest', 'output_digest', 'method', 'freshness', 'status'):
                    assert actual['source'][key] == source[key]
                assert actual['source']['archive_url'] == (
                    f'/api/workspaces/{workspace["id"]}/studies/{source["study_id"]}/runs/{source["run_id"]}?view=full')
            else:
                assert 'source' not in actual, 'a missing channel has no run identity to invent'

        reference = next(item['source'] for item in checks if item['id'] == oversized[0]['id'])
        archive = client.get(reference['archive_url'])
        assert archive.status_code == 200, archive.text
        archived = archive.json()
        assert archived['id'] == reference['run_id'] and archived['output_digest'] == reference['output_digest']
        assert len(encoded(archived['output'])) > 6 * 1024
        with research.store.db() as db:
            assert [tuple(row) for row in db.execute(
                'SELECT id,snapshot,output,input_digest,output_digest FROM study_runs WHERE workspace=? ORDER BY id',
                (workspace['id'],))] == saved_runs
        print('Saved type checks: ' + json.dumps({'checks': len(checks), 'entries': len(entries),
            'pages': len(sizes), 'largest_page_bytes': max(sizes), 'largest_original_check_bytes': max(map(lambda value: len(encoded(value)), expected))}))
