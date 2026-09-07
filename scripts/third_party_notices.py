"""Collect installed dependency license texts for the distributable (never fonts)."""
from importlib import metadata
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def collect():
    sections = ['CableSimPro third-party notices. Licenses apply to their respective components, not an automatic license grant for the whole application.\n']
    modules = ROOT / 'frontend/node_modules'
    candidates = list(modules.glob('*/package.json')) + list(modules.glob('@*/*/package.json'))
    for manifest in sorted(candidates):
        data = json.loads(manifest.read_text())
        heading = f"{data.get('name')} {data.get('version')} | declared license: {data.get('license', 'see package')}"
        sections.append('\n' + '=' * 72 + '\n' + heading)
        files = [p for p in manifest.parent.iterdir() if p.is_file() and p.name.lower().startswith(('license', 'licence', 'copying', 'notice'))]
        for file in files:
            sections.append(file.read_text(errors='replace'))
    for name in ['fastapi','pydantic','numpy','uvicorn','httpx','langgraph','langchain-core','langgraph-checkpoint','langgraph-prebuilt','langgraph-sdk','langsmith']:
        try:
            dist = metadata.distribution(name)
        except metadata.PackageNotFoundError:
            continue
        sections.append('\n' + '=' * 72 + '\n' + name + ' ' + dist.version)
        for entry in dist.files or []:
            p = Path(str(entry))
            if p.name.lower().startswith(('license','licence','copying','notice')) and '.dist-info' in str(p):
                file = Path(dist.locate_file(entry))
                if file.is_file() and file.stat().st_size < 300000:
                    sections.append(file.read_text(errors='replace'))
    output = ROOT / 'docs/THIRD_PARTY_NOTICES.txt'
    output.write_text('\n'.join(sections), encoding='utf-8')
    print(f'Collected notices: {output}')


if __name__ == '__main__':
    collect()
