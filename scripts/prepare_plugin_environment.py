"""Prepare the project .venv from a plugin's sealed Python dependency declaration."""
import argparse
from pathlib import Path
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    from backend.plugin_host.registry import Registry
    from backend.plugin_host.runtime import declared_requirements, environment_python, resolve_python
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plugin_id')
    parser.add_argument('--check', action='store_true', help='Validate without installing anything')
    parser.add_argument('--with-tests', action='store_true', help='Include the existing backend test dependencies')
    args = parser.parse_args()
    plugin = Registry(plugin_id=args.plugin_id).get(args.plugin_id)
    plugin.verify()
    declaration = declared_requirements(plugin)
    if declaration is None:
        parser.error('This plugin does not declare src/requirements.txt')
    if not args.check:
        target = ROOT/'.venv'
        python = environment_python(target)
        if not python.is_file():
            venv.EnvBuilder(with_pip=True).create(target)
        backend_requirements = ROOT/'backend'/('requirements-dev.txt' if args.with_tests else 'requirements.txt')
        subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(backend_requirements),
                        '-r', str(declaration[0])], check=True, cwd=ROOT)
    python, receipt = resolve_python(plugin)
    print(f'{plugin.manifest.name}: {python}')
    print(receipt)


if __name__ == '__main__':
    main()
