"""Export the host's OpenAPI description for the static API reference.

Usage (from the repository root): python site/scripts/export-openapi.py <output.json>
Builds the FastAPI application without starting it; the temporary database is never initialised.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main() -> int:
    output = Path(sys.argv[1]).resolve()
    sys.path.insert(0, str(ROOT))
    with tempfile.TemporaryDirectory() as scratch:
        os.environ['CABLESIM_DATASETS_DIR'] = scratch
        from backend.main import create_app

        spec = create_app(Path(scratch) / 'openapi.sqlite').openapi()
    # Same rule as frontend/scripts/generate-api.mjs: the catch-all 404 handler is not a business endpoint.
    spec['paths'].pop('/api/{path}', None)
    spec['info']['title'] = 'CableSimPro 宿主接口'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding='utf-8')
    operations = sum(1 for item in spec['paths'].values() for method in item if method in {'get', 'post', 'put', 'patch', 'delete'})
    print(f'OpenAPI: {len(spec["paths"])} paths, {operations} operations -> {output.name}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
