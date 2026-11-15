"""Local service for the studio host: one JSON request per line on stdin, one reply per line on stdout.

Started as `python -m studio_core`. Requests are {"id", "method", "params"}; replies are
{"id", "result"} or {"id", "error": {"code", "message", "path"?}}. No network, no state:
the host owns the project files and passes the parts it wants computed.
"""
from concurrent.futures import ThreadPoolExecutor
import json
import sys
import threading

from . import CoreError
from . import catalogue, designation, layouts, library, methods, product, scene, specification, structure, study, tables

_library_lock = threading.Lock()
_write_lock = threading.Lock()


def _library():
    with _library_lock:  # the first call derives the manufacturer series once
        return library.entries()


def _defaults(cable):
    return {'installation': scene.default_installation(cable), 'conditions': scene.default_conditions(cable)}


def _layouts(construction):
    return [{**item, 'default_duct': layouts.default_duct(item['kind'])} for item in layouts.options(construction)]


def _vocabulary():
    return {'fields': [{'key': key, 'label': label, 'unit': unit} for key, (label, unit, _, _) in structure.FIELDS.items()],
            'modelling': [{'key': key, 'label': label, 'unit': unit} for key, (label, unit) in structure.MODELLING.items()],
            'reference_modelling': structure.reference_modelling()}


def _designation(text):
    parts = designation.parse(text)
    return {**parts, 'description': designation.describe(parts), 'name': designation.name(parts)}


def _sample(name, path):
    """A public catalogue written as a workbook, with what an engineer declares to import each of its tables."""
    data = catalogue.tables(name)
    written = catalogue.workbook(data, path)
    declarations = []
    for table, sheet in zip(data['tables'], written['sheets']):
        series, _ = catalogue.table_series(data, table['id'])
        declarations.append({'sheet': sheet, 'series': series})
    return {**written, 'title': data['title'], 'manufacturer': data['manufacturer'], 'declarations': declarations}


HANDLERS = {
    'ping': lambda: {'ok': True},
    'library.bundled': _library,
    'cable.defaults': _defaults,
    'designation.parse': _designation,
    'structure.vocabulary': _vocabulary,
    'structure.build': lambda series, rows: structure.build(series, rows),
    'tables.inspect': lambda path, designation=None: tables.inspect(path, designation),
    'tables.rows': lambda path, sheet, first_data_row, mapping: tables.rows(path, sheet, first_data_row, mapping),
    'catalogue.sample': _sample,
    'product.compute': lambda items, kinds: product.compute(items, kinds),
    'specification.render': specification.render,
    'layouts.list': _layouts,
    'methods.list': methods.catalogue,
    'scene.preview': lambda scene: study.preview(scene),
    'study.rate': lambda scene: study.rate(scene),
    'study.sweep': lambda scene, variable, values: study.sweep(scene, variable, values),
    'study.select': lambda scene, candidates, target_current_a: study.select(scene, candidates, target_current_a),
    'sweeps.list': lambda: study.SWEEPS,
}


def handle(request):
    try:
        handler = HANDLERS.get(request.get('method'))
        if handler is None:
            raise CoreError('METHOD_UNKNOWN', f"未知的核心接口：{request.get('method')}")
        return {'id': request.get('id'), 'result': handler(**(request.get('params') or {}))}
    except CoreError as error:
        return {'id': request.get('id'), 'error': error.as_dict()}
    except Exception as error:  # noqa: BLE001 - the host must always get a reply for its request id
        return {'id': request.get('id'), 'error': {'code': 'INTERNAL', 'message': f'{type(error).__name__}: {error}'}}


def main():
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8', newline='\n')

    def reply(request):
        text = json.dumps(handle(request), ensure_ascii=False, allow_nan=False)
        with _write_lock:
            sys.stdout.write(text + '\n')
            sys.stdout.flush()

    # A few workers keep previews responsive while a sweep is running; the plugin
    # process itself stays single-threaded.
    with ThreadPoolExecutor(max_workers=3) as pool:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except ValueError:
                continue
            pool.submit(reply, request)


if __name__ == '__main__':
    main()
