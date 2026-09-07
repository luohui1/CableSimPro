"""Bounded provider adapters. Keys are process-memory-only or server environment values.
Only administrator-allowlisted HTTPS hosts; never follow redirects carrying secrets.
"""
import base64
import json
import os
from pathlib import Path
from threading import RLock
from typing import Literal
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import Field, SecretStr
from .schemas import StrictModel


class ProviderConfig(StrictModel):
    protocol: Literal['openai_responses', 'openai_chat', 'mistral_ocr', 'custom_ocr']
    base_url: str = Field(min_length=8, max_length=250)
    model: str = Field(default='', max_length=120, pattern=r'^[\w./:@-]*$')
    api_key: SecretStr | None = Field(default=None, max_length=4096)
    clear_key: bool = False


class Consent(StrictModel):
    consent: bool = False


DEFAULTS = {
    'agent': {'protocol': 'openai_responses', 'base_url': 'https://api.openai.com/v1', 'model': ''},
    'ocr': {'protocol': 'mistral_ocr', 'base_url': 'https://api.mistral.ai/v1', 'model': 'mistral-ocr-latest'},
}


class Providers:
    def __init__(self, directory: Path):
        self.directory = directory
        self.config_path = directory / 'providers.json'
        self.lock = RLock()
        self.keys: dict[str, str] = {}
        self.settings = {k: dict(v) for k, v in DEFAULTS.items()}
        if self.config_path.exists():
            try:
                stored = json.loads(self.config_path.read_text('utf-8'))
                for name in DEFAULTS:
                    if name in stored:
                        c = ProviderConfig.model_validate(stored[name])
                        self.settings[name] = c.model_dump(exclude={'api_key', 'clear_key'})
            except (ValueError, TypeError):
                pass

    @staticmethod
    def validate_url(url: str):
        parsed = urlsplit(url)
        allowed = {'api.openai.com', 'api.mistral.ai'} | {
            h.strip().lower() for h in os.getenv('CABLESIM_PROVIDER_HOSTS', '').split(',') if h.strip()
        }
        try:
            port = parsed.port
        except ValueError:
            raise HTTPException(422, '服务地址端口无效。') from None
        if (parsed.scheme != 'https' or parsed.hostname not in allowed or port not in (None, 443)
                or parsed.username or parsed.password or parsed.query or parsed.fragment
                or '..' in parsed.path or '\\' in url):
            raise HTTPException(422, '仅允许管理员许可的 HTTPS 服务域名（默认 OpenAI/Mistral）。自定义域名须在服务端 CABLESIM_PROVIDER_HOSTS 中声明；禁止凭据、查询参数和跳转。')
        return url.rstrip('/')

    def key(self, name: str):
        env = ('OPENAI_API_KEY' if name == 'agent' else 'CABLESIM_OCR_API_KEY')
        return self.keys.get(name) or os.getenv(env) or (os.getenv('MISTRAL_API_KEY') if name == 'ocr' else None)

    def get(self, name: str):
        if name not in DEFAULTS:
            raise HTTPException(404, '没有此接入配置。')
        with self.lock:
            cfg = dict(self.settings[name])
            if name == 'agent' and not cfg['model']:
                cfg['model'] = os.getenv('CABLESIM_AGENT_MODEL', '')
            cfg['api_key'] = self.key(name)
            return cfg

    def public(self):
        result = {}
        for name in DEFAULTS:
            cfg = self.get(name)
            key = cfg.pop('api_key')
            result[name] = {**cfg, 'configured': bool(key and cfg['model']), 'key_present': bool(key),
                            'key_storage': 'memory' if name in self.keys else ('environment' if key else 'none')}
        return {'providers': result, 'key_policy': '界面输入的密钥仅保留在服务端内存，重启失效；磁盘只保存地址、协议和模型。',
                'runtime': 'local-preview', 'live_cloud_verified': False}

    def save(self, name: str, cfg: ProviderConfig):
        self.get(name)
        if (name == 'agent') != (cfg.protocol in ('openai_responses', 'openai_chat')):
            raise HTTPException(422, '该协议不适用于此接入类型。')
        base = self.validate_url(cfg.base_url)
        key = cfg.api_key.get_secret_value() if cfg.api_key else None
        if key and ('\n' in key or '\r' in key):
            raise HTTPException(422, '密钥不能包含换行。')
        with self.lock:
            self.settings[name] = {**cfg.model_dump(exclude={'api_key', 'clear_key'}), 'base_url': base}
            if cfg.clear_key:
                self.keys.pop(name, None)
            if key:
                self.keys[name] = key
            self.directory.mkdir(parents=True, exist_ok=True)
            temp = self.config_path.with_suffix('.tmp')
            with temp.open('w', encoding='utf-8') as out:
                os.chmod(temp, 0o600)
                json.dump(self.settings, out, ensure_ascii=False, indent=2)
            temp.replace(self.config_path)
        return self.public()

    async def request(self, name: str, endpoint: str, payload: dict | None, method='POST'):
        cfg = self.get(name)
        if not cfg['api_key'] or not cfg['model']:
            raise HTTPException(503, f'{name} 未配置密钥或模型，请在“接入设置”配置。')
        base = self.validate_url(cfg['base_url'])
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=10), follow_redirects=False, trust_env=False) as client:
                async with client.stream(method, base + endpoint,
                        headers={'Authorization': 'Bearer ' + cfg['api_key']}, json=payload) as response:
                    if response.status_code != 200:
                        raise HTTPException(502, f'{name} 服务返回 HTTP {response.status_code}；未应用识别或模型输出。')
                    data = bytearray()
                    async for part in response.aiter_bytes():
                        data.extend(part)
                        if len(data) > 6 * 1024 * 1024:
                            raise HTTPException(502, '服务返回内容超出 6 MiB 限制。')
            return json.loads(data)
        except httpx.TimeoutException:
            raise HTTPException(504, '服务请求超时，当前工程未修改。') from None
        except httpx.HTTPError:
            raise HTTPException(502, '无法连接服务，请检查服务地址与网络。') from None
        except (ValueError, TypeError):
            raise HTTPException(502, '服务未返回有效 JSON。') from None

    async def ocr(self, data: bytes, mime: str, filename: str, pages: list[int]):
        cfg = self.get('ocr')
        encoded = base64.b64encode(data).decode('ascii')
        if cfg['protocol'] == 'mistral_ocr':
            kind = 'document_url' if mime == 'application/pdf' else 'image_url'
            payload = {'model': cfg['model'], 'document': {'type': kind, kind: f'data:{mime};base64,{encoded}'},
                       'include_image_base64': False, 'pages': [p - 1 for p in pages]}
            raw = await self.request('ocr', '/ocr', payload)
            try:
                result = [{'page': p['index'] + 1, 'text': p['markdown']} for p in raw['pages']]
            except (KeyError, TypeError):
                raise HTTPException(502, 'Mistral OCR 响应不符合 pages/index/markdown 契约。') from None
        elif cfg['protocol'] == 'custom_ocr':
            raw = await self.request('ocr', '/ocr', {'model': cfg['model'], 'file_base64': encoded,
                'mime_type': mime, 'filename': filename, 'pages': pages})
            result = raw.get('pages') if isinstance(raw, dict) else None
        else:
            raise HTTPException(422, 'OCR 协议未实现。')
        if not isinstance(result, list) or not result:
            raise HTTPException(502, 'OCR 未返回有效页面。')
        seen = set()
        for p in result:
            if (not isinstance(p, dict) or type(p.get('page')) is not int or p['page'] not in pages
                    or p['page'] in seen or not isinstance(p.get('text'), str) or len(p['text']) > 30000):
                raise HTTPException(502, 'OCR 页码、页数或文字超出已选页范围；未保存结果。')
            seen.add(p['page'])
        if seen != set(pages):
            raise HTTPException(502, 'OCR 未返回全部所选页，未覆盖已有识别结果。')
        return result


def router(providers: Providers):
    api = APIRouter(prefix='/api/integrations')

    @api.get('')
    def status():
        return providers.public()

    @api.put('/{name}')
    def save(name: Literal['agent', 'ocr'], cfg: ProviderConfig):
        return providers.save(name, cfg)

    @api.post('/{name}/check')
    async def check(name: Literal['agent', 'ocr'], body: Consent):
        if not body.consent:
            raise HTTPException(403, '请确认向服务商发送连接检查请求（不含工程或资料正文）。')
        if providers.get(name)['protocol'] == 'custom_ocr':
            raise HTTPException(422, '自定义 OCR 无统一探活接口；请按契约配置后用经授权文件进行识别。')
        await providers.request(name, '/models', None, method='GET')
        return {'ok': True, 'scope': '仅验证 /models 可访问，不证明指定模型可调用或 OCR 识别准确。'}
    return api
