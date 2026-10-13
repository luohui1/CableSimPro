"""Content-bound model catalogue receipts; no timestamp or trusted-bit cache."""
from hashlib import sha256
import json


def content_identity(repository):
    folder = repository / '.data/method-models'
    index = folder / 'index.json'
    if not index.is_file():
        return ('missing',)
    if index.is_symlink() or index.stat().st_size > 8 * 1024 * 1024:
        raise ValueError('训练模型目录不可用，请联系管理员核验目录。')
    raw = index.read_bytes()
    records = json.loads(raw).get('models', {})
    if not isinstance(records, dict) or len(records) > 1000:
        raise ValueError('训练模型目录格式不符合契约，请联系管理员核验目录。')
    identity = [sha256(raw).hexdigest()]
    import re
    for digest in sorted(records):
        if not re.fullmatch('[0-9a-f]{64}', digest):
            raise ValueError('训练模型目录缺少有效的文件摘要。')
        model = folder / (digest + '.json')
        if not model.is_file():
            identity.append((digest, 'missing'))
        elif model.is_symlink() or model.stat().st_size > 16 * 1024 * 1024:
            identity.append((digest, 'unsafe'))
        else:
            identity.append((digest, sha256(model.read_bytes()).hexdigest()))
    return tuple(identity)


def verified_catalogue(research, identity):
    from ..plugin_host.model_assets import catalogue
    root = research.executor.registry.root.parent
    value = catalogue(root, research.executor.registry)
    if content_identity(root) != identity:
        raise ValueError('训练模型目录在读取期间变化，请重新读取；保存运行不变。')
    return json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
