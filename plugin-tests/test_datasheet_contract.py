"""Published extraction metadata must remain readable through the real host API."""
import re

from fastapi.testclient import TestClient

from backend.main import create_app
from backend.plugin_host.registry import Registry


def test_first_party_capability_titles_reach_the_catalogue_without_raw_ids(tmp_path):
    plugin=Registry().get('cablesim.datasheet-extract')
    plugin.verify()
    with TestClient(create_app(tmp_path/'catalogue.sqlite')) as client:
        response=client.get('/api/methods')
        assert response.status_code==200,response.text
        entries=response.json()
    extraction=next(row for row in entries if row['method']['plugin_id']==plugin.manifest.id)
    assert extraction['method']['version']==plugin.manifest.version
    assert {row['id']:row['title'] for row in extraction['capabilities']}=={
        row.id:row.title for row in plugin.manifest.capabilities}
    for entry in entries:
        for capability in entry['capabilities']:
            assert capability['title'].strip()!=capability['id']
            assert re.search('[\u3400-\u9fff]',capability['title']),capability
