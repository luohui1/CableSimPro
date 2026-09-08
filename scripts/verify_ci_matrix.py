"""Fail closed when a browser shard is missing, duplicated or interrupted."""
from __future__ import annotations

import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

EXPECTED = {'chromium': 74, 'webkit': 74, 'mobile-webkit': 11,
            'windows-chromium-1': 47, 'windows-chromium-1.25': 47,
            'windows-chromium-1.5': 47, 'windows-edge-1.25': 47}


def verify(root: Path) -> dict:
    counts = {name: 0 for name in EXPECTED}
    seen: set[tuple[str, str, str]] = set()
    reports = sorted(root.rglob('*tests.xml'))
    if len(reports) != 12:
        raise ValueError(f'Expected 12 browser shard reports, received {len(reports)}')
    for path in reports:
        document = ET.parse(path).getroot()
        cases = list(document.iter('testcase'))
        if not cases or any(next(document.iter(tag), None) is not None for tag in ('failure', 'error', 'skipped')):
            raise ValueError(f'Empty, failed or skipped browser shard: {path}')
        if int(document.attrib['tests']) != len(cases):
            raise ValueError(f'Incomplete test report: {path}')
        for suite in document.iter('testsuite'):
            project = suite.attrib['hostname']
            if project not in counts:
                raise ValueError(f'Unexpected browser project: {project}')
            for case in suite.findall('testcase'):
                key = (project, case.attrib['classname'], case.attrib['name'])
                if key in seen:
                    raise ValueError(f'Duplicate test execution: {key}')
                seen.add(key)
                counts[project] += 1
    if counts != EXPECTED:
        raise ValueError(f'Missing or unexpected tests: {counts}; expected {EXPECTED}')
    result = {'browser_reports': len(reports), 'projects': counts,
              'linux_tests': 159, 'windows_tests': 188,
              'failures': 0, 'errors': 0, 'skipped': 0}
    return result


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python scripts/verify_ci_matrix.py ARTIFACT_DIRECTORY')
    print(json.dumps(verify(Path(sys.argv[1])), ensure_ascii=False, indent=2))
