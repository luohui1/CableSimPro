"""Collect notices from the actual redistributed wheels and frontend packages."""
from __future__ import annotations

import argparse
from email.parser import Parser
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def is_notice(name: str) -> bool:
    basename = Path(name).name.lower()
    return basename.startswith(('license', 'licence', 'copying', 'notice', 'ofl')) or bool(
        re.search(r'(?:^|[._ -])(?:licen[cs]e|copyright|copying|notice|ofl)(?:$|[._ -])', basename))


def collect(wheels: Path, output: Path, node_modules: Path | list[Path] | None = None) -> None:
    sections = ['CableSimPro third-party notices. Licenses apply to their respective components, '
                'not an automatic license grant for the whole application.\n']
    for wheel in sorted(wheels.glob('*.whl')):
        with zipfile.ZipFile(wheel) as archive:
            metadata_name = next(name for name in archive.namelist() if name.endswith('.dist-info/METADATA'))
            record = Parser().parsestr(archive.read(metadata_name).decode('utf-8'))
            sections.append('\n' + '=' * 72 + '\n' + record['Name'] + ' ' + record['Version'])
            sections.append('License metadata: ' + (record.get('License-Expression') or record.get('License') or 'see bundled wheel'))
            for entry in sorted(archive.namelist()):
                if is_notice(entry) and not entry.endswith('/'):
                    sections.extend([entry, archive.read(entry).decode('utf-8', errors='replace')])
    for tree in [node_modules] if isinstance(node_modules, Path) else list(node_modules or []):
        if not tree.is_dir():
            continue
        # Include package notices, including locally shipped font licenses.
        # Do not follow symlinked workspaces outside the build dependency tree.
        for package_json in sorted(tree.rglob('package.json')):
            if package_json.is_symlink() or not package_json.resolve().is_relative_to(tree.resolve()):
                continue
            try:
                record = json.loads(package_json.read_text('utf-8'))
            except (OSError, ValueError):
                continue
            notices = [path for path in package_json.parent.iterdir()
                       if path.is_file() and not path.is_symlink() and is_notice(path.name)]
            if notices:
                sections.append('\n' + '=' * 72 + '\n' + str(record.get('name', package_json.parent.name))
                                + ' ' + str(record.get('version', '')))
                for notice in sorted(notices):
                    sections.extend([notice.name, notice.read_text('utf-8', errors='replace')])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text('\n'.join(sections), encoding='utf-8', newline='\n')
    print(f'Collected notices: {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wheelhouse', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--node-modules', type=Path, action='append', help='May be given more than once')
    args = parser.parse_args()
    collect(args.wheelhouse, args.output, args.node_modules)
