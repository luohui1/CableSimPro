"""Read-only lookup using the existing cablesim.run/2 process protocol."""
from pathlib import Path
import json
import platform
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cablesim_standards_basis.library import BasisError, BasisLibrary, VERSION


def main():
    request = json.loads(Path('input/request.json').read_text('utf-8'))
    cases = []
    try:
        library = BasisLibrary()
        initialization_error = None
    except BasisError as error:
        library, initialization_error = None, error
    for case in request['cases']:
        try:
            if initialization_error:
                raise initialization_error
            if request['capability'] != 'lookup':
                raise BasisError('CAPABILITY_UNKNOWN', '/capability', '未声明的依据查询能力。')
            if case.get('parameters'):
                raise BasisError('INPUT_INVALID', '/parameters', '查询条件只能写入 input，不接受另一路参数。')
            answer = library.query(case['input'])
            result = {'case_id': case['case_id'], 'status': 'succeeded'}
            if request['phase'] == 'run':
                name = case['case_id'] + '.json'
                Path('output', name).write_text(json.dumps(answer, ensure_ascii=False, allow_nan=False), 'utf-8')
                result.update(results=[{'key': 'x-cablesim.standards-basis.count', 'type': 'quantity',
                                       'entity': 'query', 'status': 'available',
                                       'value': len(answer['records']), 'unit': '1'}],
                              artifacts=[{'type': 'x-cablesim.standards-basis', 'path': 'output/' + name}])
            cases.append(result)
        except BasisError as error:
            cases.append({'case_id': case['case_id'], 'status': 'failed',
                          'error': {'code': error.code, 'path': error.path, 'message': str(error)}})
        except Exception:
            cases.append({'case_id': case['case_id'], 'status': 'failed',
                          'error': {'code': 'BASIS_QUERY_FAILED', 'path': '/',
                                    'message': '依据查询失败；请核对查询契约和插件完整性后重试。'}})
    Path('output/result.json').write_text(json.dumps({'protocol': 'cablesim.run/2', 'cases': cases,
                                                    'environment': {'python': platform.python_version(), 'method': VERSION}},
                                                   ensure_ascii=False, allow_nan=False), 'utf-8')


if __name__ == '__main__':
    main()
