"""Fixed stdlib/Pydantic worker for the line-source cross-check."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import json
from backend.foundation.contracts import CircularRecipe
from backend.schemas import Scenario
from backend.plugins.line_source import run_line_source


def main():
    raw = sys.stdin.buffer.read(2*1024*1024+1)
    if len(raw) > 2*1024*1024:
        raise ValueError('INPUT_SIZE_LIMIT')
    request = json.loads(raw)
    if request['command'] != 'validation.line-source-buried':
        raise ValueError('COMMAND_NOT_ALLOWLISTED')
    recipe = CircularRecipe.model_validate(request['recipe']).model_dump(mode='json')
    scenario = Scenario.model_validate(request['scenario']).model_dump(mode='json')
    context = request['arguments'].get('_source_context')
    if not isinstance(context, dict):
        raise ValueError('SOURCE_CONTEXT_MISSING')
    result = run_line_source(recipe, scenario, context)
    result['python_version'] = sys.version.split()[0]
    Path('response.json').write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding='utf-8')


if __name__ == '__main__':
    main()
