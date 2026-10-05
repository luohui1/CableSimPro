"""Collect installed dependency license texts for the distributable (never fonts)."""
from importlib import metadata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def collect():
    sections = ['CableSimPro third-party notices. Licenses apply to their respective components, not an automatic license grant for the whole application.\n']
    for name in ['scipy','pypdf','Pillow','python-multipart','fastapi','pydantic','numpy','uvicorn','httpx']:
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
