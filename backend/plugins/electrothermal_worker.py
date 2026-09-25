"""Fixed first-party entry: same host lifecycle, isolated failure/timeout process.

No custom imports/paths from clients or manifests. This is not an OS sandbox.
"""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import json
from importlib import metadata
from backend.foundation.contracts import CircularRecipe
from backend.plugins.electrothermal_contract import preflight
from backend.plugins.electrothermal import electrothermal_reference


def main():
    raw = sys.stdin.buffer.read(2*1024*1024+1)
    if len(raw) > 2*1024*1024:
        raise ValueError('INPUT_SIZE_LIMIT')
    request = json.loads(raw)
    if request['command'] != 'skfem.electrothermal-reference':
        raise ValueError('COMMAND_NOT_ALLOWLISTED')
    scenario, args = preflight(request['scenario'], request['arguments'])
    recipe = CircularRecipe.model_validate(request['recipe'])
    result = electrothermal_reference(recipe.model_dump(mode='json'), scenario, args)
    result['runtime_versions'] = {d.metadata['Name']:d.version for d in metadata.distributions() if d.metadata['Name']}
    result['python_version'] = sys.version.split()[0]
    Path('response.json').write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding='utf-8')


if __name__ == '__main__':
    main()
