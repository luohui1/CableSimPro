"""Lossless layout for large inline v2 contracts; no schema extension.

The host only resolves contract-local $defs. Keep every schema keyword and
annotation inline until the normative host supports sealed external contracts.
Human-readable capability metadata stays indented; schema objects use compact
JSON. Parsing this layout yields exactly the same manifest document.
"""
import json
from pathlib import Path


def manifest_text(manifest):
    # Work on an independent tree: formatting must not mutate caller contracts.
    document=json.loads(json.dumps(manifest,ensure_ascii=False,allow_nan=False))
    contracts={}
    for capability in document['capabilities']:
        for owner,key in ((capability,'parameter_schema'),
                          (capability.get('input_contract',{}),'standalone_schema'),
                          (capability.get('input_contract',{}),'standalone_parameter_schema')):
            if isinstance(owner.get(key),dict):
                marker='__sealed_inline_contract_'+str(len(contracts))+'__'
                contracts[marker]=json.dumps(owner[key],ensure_ascii=False,separators=(',',':'),allow_nan=False)
                owner[key]=marker
    text=json.dumps(document,ensure_ascii=False,indent=2,allow_nan=False)+'\n'
    for marker,contract in contracts.items():
        text=text.replace(json.dumps(marker),contract,1)
    if json.loads(text)!=manifest:raise ValueError('契约排版改变了清单内容，未写入。')
    return text


def write_manifest(path,manifest):
    Path(path).write_text(manifest_text(manifest),encoding='utf-8',newline='\n')


if __name__=='__main__':
    path=Path(__file__).resolve().parents[1]/'plugin.json'
    write_manifest(path,json.loads(path.read_bytes()))
