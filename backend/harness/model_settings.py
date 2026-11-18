"""Agent model settings chosen in the UI.

Non-secret values (API base, model, instructions, timeout, token limits) live in the workspace
database. The API key lives in the operating system credential store when one is
available, otherwise only in this process; it never enters the database, files,
responses or logs. Saved settings take precedence over CABLESIM_LLM_* variables.
"""
from hashlib import sha256
import json
from pathlib import Path
import os
import threading
from urllib.parse import urlsplit

from fastapi import HTTPException

from backend.kernel.workspace import stamp
from .security import remember_secret

SERVICE = 'CableSimPro'
TIMEOUT_RANGE = (10, 180)
INSTRUCTIONS_LIMIT = 2000
DEFAULT_CONTEXT_WINDOW = 64000
DEFAULT_MAX_OUTPUT_TOKENS = 16384


def token_limits(context_window=None, max_output_tokens=None):
    context = context_window if context_window is not None else DEFAULT_CONTEXT_WINDOW
    output = max_output_tokens if max_output_tokens is not None else min(DEFAULT_MAX_OUTPUT_TOKENS, context - 8192)
    if output > context - 8192:
        raise HTTPException(422, {'code': 'MODEL_TOKEN_LIMITS_INVALID',
            'message': '最大输出须比上下文窗口至少少 8192 token，给指令、工具和对话保留输入空间。'})
    return {'context_window': context, 'max_output_tokens': output}


def valid_base(base):
    parsed = urlsplit(base)
    return (parsed.scheme in ('http', 'https') and bool(parsed.hostname) and not parsed.username
            and not parsed.password and not parsed.query and not parsed.fragment)


class KeyStore:
    """OS credential store per database, or process memory when none is usable."""

    def __init__(self, database_path):
        # 按库文件的真实路径区分账户：相对路径、目录联接指向同一个库时取到同一把密钥
        self.account = 'agent-model-api-key:' + sha256(str(Path(database_path).resolve()).encode()).hexdigest()[:16]
        self.memory = ''
        self.cached = None
        self.backend = None
        if os.environ.get('CABLESIM_AGENT_KEY_STORE', 'system') != 'memory':
            try:
                import keyring
                from keyring.backends import fail
                if not isinstance(keyring.get_keyring(), fail.Keyring):
                    self.backend = keyring
            except Exception:
                self.backend = None

    @property
    def storage(self):
        return 'system' if self.backend else 'memory'

    def get(self):
        if self.cached is None:
            if self.backend:
                try:
                    self.cached = self.backend.get_password(SERVICE, self.account) or ''
                except Exception:
                    self.cached = ''
            else:
                self.cached = self.memory
            remember_secret(self.cached)
        return self.cached

    def set(self, value):
        remember_secret(value)
        if self.backend:
            if value:
                self.backend.set_password(SERVICE, self.account, value)
            else:
                try:
                    self.backend.delete_password(SERVICE, self.account)
                except Exception:
                    pass
        else:
            self.memory = value
        self.cached = value


class ModelSettings:
    def __init__(self, store):
        self.store = store
        self.keys = KeyStore(store.path)
        self.lock = threading.Lock()
        self.values = None

    def initialize(self):
        with self.store.db(True) as db:
            db.execute('CREATE TABLE IF NOT EXISTS agent_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated TEXT NOT NULL)')
        self.values = None

    def saved(self):
        with self.lock:
            if self.values is None:
                with self.store.db() as db:
                    self.values = {row['name']: json.loads(row['value']) for row in db.execute('SELECT name,value FROM agent_settings')}
            return dict(self.values)

    @staticmethod
    def environment():
        original = {name: os.environ.get('CABLESIM_LLM_' + name.upper(), '').strip() for name in ('base_url', 'model', 'api_key')}
        fallback = {name: os.environ.get('CABLE_STUDIO_MODEL_' + suffix, '').strip()
                    for name, suffix in (('base_url', 'BASE_URL'), ('model', 'ID'), ('api_key', 'API_KEY'))}
        # Keep endpoint, model and credential together. Never combine the key of
        # one provider with the address of another partially configured provider.
        result = original if all(original.values()) else fallback if all(fallback.values()) else original if any(original.values()) else fallback
        remember_secret(result['api_key'])
        return result

    def resolve(self):
        """The connection the provider uses: saved settings first, then the host environment."""
        saved, env = self.saved(), self.environment()
        if saved.get('base_url') and saved.get('model'):
            key = self.keys.get()
            key_source = self.keys.storage if key else None
            # 地址未变时沿用环境变量里的密钥，改模型名不必重新输入
            if not key and env['api_key'] and env['base_url'].rstrip('/') == saved['base_url'].rstrip('/'):
                key, key_source = env['api_key'], 'environment'
            return {'source': 'settings', 'base_url': saved['base_url'], 'model': saved['model'], 'api_key': key, 'key_source': key_source}
        if env['base_url'] and env['model'] and env['api_key']:
            return {'source': 'environment', 'base_url': env['base_url'], 'model': env['model'], 'api_key': env['api_key'], 'key_source': 'environment'}
        return {'source': 'none', 'base_url': env['base_url'], 'model': env['model'] or 'deepseek-flash', 'api_key': env['api_key'], 'key_source': 'environment' if env['api_key'] else None}

    def instructions(self):
        return self.saved().get('instructions', '')

    def model_timeout(self):
        return self.saved().get('model_timeout_s')

    def token_limits(self):
        saved = self.saved()
        return token_limits(saved.get('context_window'), saved.get('max_output_tokens'))

    def public(self):
        current, saved = self.resolve(), self.saved()
        key = current['api_key']
        return {'source': current['source'], 'base_url': current['base_url'], 'model': current['model'],
                'has_key': bool(key), 'key_hint': ('…' + key[-4:]) if len(key) >= 8 else None, 'key_source': current['key_source'],
                'key_storage': self.keys.storage, 'configured': bool(current['base_url'] and current['model'] and key),
                'instructions': saved.get('instructions', ''), 'model_timeout_s': saved.get('model_timeout_s'),
                'context_window': saved.get('context_window'), 'max_output_tokens': saved.get('max_output_tokens'),
                'environment': {'base_url': bool(self.environment()['base_url']), 'model': bool(self.environment()['model']), 'api_key': bool(self.environment()['api_key'])}}

    def update(self, body):
        base = body.base_url.strip()
        model = body.model.strip()
        if not valid_base(base):
            raise HTTPException(422, {'code': 'LLM_BASE_INVALID', 'message': '服务地址须为 http(s) 开头、不含账号密码、查询串或片段的 API 基址，例如 https://api.deepseek.com/v1。'})
        if not model or len(model) > 100:
            raise HTTPException(422, {'code': 'LLM_MODEL_INVALID', 'message': '请填写模型名（不超过 100 个字符）。'})
        instructions = body.instructions.strip()
        if len(instructions) > INSTRUCTIONS_LIMIT:
            raise HTTPException(422, {'code': 'INSTRUCTIONS_TOO_LONG', 'message': f'自定义指令不超过 {INSTRUCTIONS_LIMIT} 个字符。'})
        timeout = body.model_timeout_s
        if timeout is not None and not TIMEOUT_RANGE[0] <= timeout <= TIMEOUT_RANGE[1]:
            raise HTTPException(422, {'code': 'TIMEOUT_INVALID', 'message': f'单次请求超时取 {TIMEOUT_RANGE[0]}–{TIMEOUT_RANGE[1]} 秒。'})
        token_limits(body.context_window, body.max_output_tokens)
        if body.api_key is not None:
            self.keys.set(body.api_key.strip())
        values = {'base_url': base, 'model': model, 'instructions': instructions, 'model_timeout_s': timeout,
                  'context_window': body.context_window, 'max_output_tokens': body.max_output_tokens}
        with self.lock, self.store.db(True) as db:
            for name, value in values.items():
                db.execute('INSERT INTO agent_settings(name,value,updated) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated=excluded.updated',
                    (name, json.dumps(value, ensure_ascii=False), stamp()))
            self.values = None
        return self.public()

    def reset(self):
        self.keys.set('')
        with self.lock, self.store.db(True) as db:
            db.execute('DELETE FROM agent_settings')
            self.values = None
        return self.public()
