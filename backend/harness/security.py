"""Credential exclusion at every persistence and response boundary."""
import os
import re


def redact(value):
    key = os.environ.get('CABLESIM_LLM_API_KEY','')
    if isinstance(value,str):
        text = value.replace(key,'[凭据已隐藏]') if key else value
        text = re.sub(r'(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+','Bearer [凭据已隐藏]',text)
        text = re.sub(r'''(?i)\b(api[-_]?key|access[-_]?token|secret|password)\s*[:=]\s*["']?[^\s,"'&;]+''',r'\1=[凭据已隐藏]',text)
        return text
    if isinstance(value,list):
        return [redact(item) for item in value]
    if isinstance(value,dict):
        return {name: '[凭据已隐藏]' if re.fullmatch(r'(?i)(api[-_]?key|authorization|access[-_]?token|secret|password)',name)
                else redact(item) for name,item in value.items()}
    return value
