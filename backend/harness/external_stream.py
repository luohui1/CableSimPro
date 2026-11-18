"""Filter provider responses, including credentials split across SSE deltas."""
import json

from .security import redact

MAX_RESPONSE = 32 * 1024 * 1024


class DeltaFilter:
    def __init__(self, secrets):
        self.secrets = tuple(value for value in secrets if value)
        self.pending = {}

    def feed(self, slot, value):
        text = self.pending.pop(slot, '') + value
        for secret in self.secrets: text = text.replace(secret, '[凭据已隐藏]')
        # Keep only a suffix which could become a credential in a later delta.
        # Ordinary model text is forwarded immediately, without buffering the
        # entire completion or depending on transport chunk boundaries.
        hold = max((size for secret in self.secrets for size in range(1, min(len(secret), len(text) + 1))
                    if text.endswith(secret[:size])), default=0)
        if hold:
            self.pending[slot] = text[-hold:]
            text = text[:-hold]
        return redact(text)

    def flush(self, choice=None):
        events = []
        for slot in list(self.pending):
            if choice is not None and slot[0] != choice: continue
            value = self.pending.pop(slot)
            # A final incomplete credential prefix is not useful model output.
            # Dropping it also keeps provider diagnostics from disclosing parts.
            if any(secret.startswith(value) for secret in self.secrets): continue
            delta = ({slot[1]: redact(value)} if slot[1] != 'tool' else
                     {'tool_calls': [{'index': slot[2], 'function': {'arguments': redact(value)}}]})
            events.append({'choices': [{'index': slot[0], 'delta': delta}]})
        return events


def event(value):
    return 'data: ' + json.dumps(redact(value), ensure_ascii=False, separators=(',', ':')) + '\n\n'


async def safe_sse(upstream, secrets):
    guard = DeltaFilter(secrets)
    size = 0
    async for line in upstream.aiter_lines():
        size += len(line.encode('utf-8'))
        if size > MAX_RESPONSE:
            yield event({'error': {'message': '模型响应超过大小限制，已停止接收。', 'type': 'response_too_large'}})
            yield 'data: [DONE]\n\n'
            return
        if not line.startswith('data:'): continue
        data = line[5:].strip()
        if not data: continue
        if data == '[DONE]':
            for pending in guard.flush(): yield event(pending)
            yield 'data: [DONE]\n\n'
            return
        try:
            value = json.loads(data)
            if not isinstance(value, dict): continue
        except ValueError:
            yield event({'error': {'message': '模型返回了无效的数据流。', 'type': 'invalid_response'}})
            return
        for number, choice in enumerate(value.get('choices', [])):
            if not isinstance(choice, dict): continue
            index = choice.get('index', number)
            delta = choice.get('delta')
            if isinstance(delta, dict):
                for key in ('content', 'reasoning_content', 'refusal'):
                    if isinstance(delta.get(key), str): delta[key] = guard.feed((index, key), delta[key])
                for tool_number, call in enumerate(delta.get('tool_calls', []) or []):
                    if not isinstance(call, dict): continue
                    function = call.get('function', {})
                    if isinstance(function, dict) and isinstance(function.get('arguments'), str):
                        function['arguments'] = guard.feed((index, 'tool', call.get('index', tool_number)), function['arguments'])
            if choice.get('finish_reason'):
                for pending in guard.flush(index): yield event(pending)
        yield event(value)
    for pending in guard.flush(): yield event(pending)
