"""Credential exclusion at every persistence and response boundary."""
import os
import re


_secrets = set()


def remember_secret(value):
    """Keys saved through the settings page are hidden exactly like the environment key."""
    if value and len(value) >= 8:
        _secrets.add(value)


def redact(value):
    keys = {key for key in (os.environ.get('CABLESIM_LLM_API_KEY',''),
        os.environ.get('CABLE_STUDIO_MODEL_API_KEY',''),os.environ.get('CABLESIM_AGENT_SIDECAR_TOKEN',''),*_secrets) if key}
    if isinstance(value,str):
        text = value
        for key in keys:
            text = text.replace(key,'[凭据已隐藏]')
        text = re.sub(r'(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+','Bearer [凭据已隐藏]',text)
        text = re.sub(r'''(?i)\b(api[-_]?key|access[-_]?token|secret|password)\s*[:=]\s*["']?[^\s,"'&;]+''',r'\1=[凭据已隐藏]',text)
        return text
    if isinstance(value,list):
        return [redact(item) for item in value]
    if isinstance(value,dict):
        return {name: '[凭据已隐藏]' if re.fullmatch(r'(?i)(api[-_]?key|authorization|access[-_]?token|secret|password)',name)
                else redact(item) for name,item in value.items()}
    return value
