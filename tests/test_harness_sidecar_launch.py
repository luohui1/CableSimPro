"""Exercise the child boundary: model keys stay out and failed launches leave no process."""
import json
import os
from pathlib import Path
import secrets
import shutil
import time

import pytest

from studio.fusion.launch import running


@pytest.mark.skipif(not shutil.which('node'), reason='Node is required for the Agent sidecar')
def test_sidecar_has_only_the_private_link_and_is_closed_after_a_parent_failure(tmp_path):
    entry = tmp_path / 'studio/fusion/server.ts'
    entry.parent.mkdir(parents=True)
    receipt = tmp_path / 'started.json'
    entry.write_text('''
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.CHECK_RECEIPT, JSON.stringify({
  hasBackendKey: Boolean(process.env.CABLESIM_LLM_API_KEY),
  hasFallbackKey: Boolean(process.env.CABLE_STUDIO_MODEL_API_KEY),
  hasPrivateLink: Boolean(process.env.CABLESIM_AGENT_SIDECAR_TOKEN),
}));
setInterval(() => {}, 1000);
''', encoding='utf-8')
    environment = {**os.environ, 'CHECK_RECEIPT': str(receipt),
                   'CABLESIM_LLM_API_KEY': secrets.token_urlsafe(32),
                   'CABLE_STUDIO_MODEL_API_KEY': secrets.token_urlsafe(32),
                   'CABLESIM_AGENT_SIDECAR_TOKEN': secrets.token_urlsafe(32)}
    with pytest.raises(RuntimeError, match='parent startup failed'):
        with running(tmp_path, environment) as child:
            deadline = time.monotonic() + 5
            while not receipt.exists() and child.poll() is None and time.monotonic() < deadline:
                time.sleep(.02)
            assert json.loads(receipt.read_text()) == {
                'hasBackendKey': False, 'hasFallbackKey': False, 'hasPrivateLink': True}
            raise RuntimeError('parent startup failed')
    assert child.poll() is not None
    assert Path(receipt).is_file()
