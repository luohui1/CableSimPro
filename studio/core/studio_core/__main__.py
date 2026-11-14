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
from . import layouts, library, methods, scene, study

_library_lock = threading.Lock()
_write_lock = threading.Lock()


def _library():
    with _library_lock:  # the first call derives the manufacturer series once
        return library.entries()


def _defaults(model_id, content_sha256=None):
    with _library_lock:
        cable = library.get(model_id, content_sha256)
    return {'cable': cable, 'installation': scene.default_installation(cable), 'conditions': scene.default_conditions(cable)}


def _layouts(construction):
    return [{**item, 'default_duct': layouts.default_duct(item['kind'])} for item in layouts.options(construction)]


HANDLERS = {
    'ping': lambda: {'ok': True},
    'library.list': _library,
    'library.defaults': _defaults,
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
