"""Input locations shared by plugins and the host; no engineering algorithms."""
def pointer(parts):
    return '/' + '/'.join(str(p).replace('~', '~0').replace('/', '~1') for p in parts)


class FieldValueError(ValueError):
    def __init__(self, message, *path):
        super().__init__(message)
        self.field_path = path


def validation_error(exc, code='INPUT_INVALID', prefix=()):
    """Keep each Pydantic location, including explicit model-validator suffixes."""
    issues = []
    for error in exc.errors()[:100]:
        suffix = getattr(error.get('ctx', {}).get('error'), 'field_path', ())
        path = (*prefix, *error['loc'], *suffix)
        issues.append({'code': error['type'], 'path': pointer(path or ('parameters',)), 'message': error['msg']})
    return {'code': code, 'message': '；'.join(i['message'] for i in issues),
            'path': issues[0]['path'], 'issues': issues}
