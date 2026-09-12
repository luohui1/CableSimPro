"""JSON-in / file-artifacts-out worker for explicitly allowlisted adapters.

Separate process, bounded input, finite run timeout in host. Not an OS sandbox.
No eval, shell command, user-specified entry point or dynamic package discovery.
"""
from pathlib import Path
import sys
# -I removes CWD/PYTHONPATH. Only the trusted source package is added here.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import importlib.metadata
import json
from backend.plugins.arguments import ARGUMENTS
from backend.plugins.adapters import HANDLERS as REFERENCE_HANDLERS
from backend.plugins.buried import buried_reference
HANDLERS = dict(REFERENCE_HANDLERS, **{'skfem.buried-reference': buried_reference})
from backend.foundation.contracts import CircularRecipe
from backend.schemas import Scenario


def main():
    raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError('INPUT_SIZE_LIMIT')
    request = json.loads(raw)
    command = request['command']
    if command not in HANDLERS:
        raise ValueError('COMMAND_NOT_ALLOWLISTED')
    args = ARGUMENTS[command].model_validate(request['arguments']).model_dump(mode='json')
    recipe = CircularRecipe.model_validate(request['recipe']).model_dump(mode='json')
    scenario = Scenario.model_validate(request['scenario']).model_dump(mode='json')
    versions = {name: importlib.metadata.version(name) for name in request['distributions']}
    result = HANDLERS[command](recipe, scenario, args)
    # Reproduction evidence includes transitive native/scientific distributions,
    # not environment variables or credentials.
    versions.update({d.metadata['Name']: d.version for d in importlib.metadata.distributions() if d.metadata['Name']})
    result['runtime_versions'] = versions
    result['python_version'] = sys.version.split()[0]
    Path('response.json').write_text(json.dumps(result, allow_nan=False), encoding='utf-8')


if __name__ == '__main__':
    main()
