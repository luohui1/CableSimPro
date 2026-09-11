"""Plugin SDK v0.1: check manifests, release bytes and exact dependency closures.

Usage: python scripts/plugin_sdk.py verify
       python scripts/plugin_sdk.py manifest path/to/plugin.json
This tool does not install packages, import plugin modules, or execute hooks.
"""
from pathlib import Path
import argparse
import json
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.plugins.catalog import Catalog
from backend.plugins.contracts import PluginManifest

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['verify','manifest'])
    parser.add_argument('file',nargs='?',type=Path)
    args=parser.parse_args()
    if args.action=='manifest':
        if args.file is None: parser.error('manifest requires a file')
        if args.file.stat().st_size>1024*1024: raise ValueError('MANIFEST_SIZE_LIMIT')
        m=PluginManifest.model_validate_json(args.file.read_text('utf-8'))
        print(json.dumps({'plugin_id':m.plugin_id,'version':m.version,'sha256':m.digest(),'executed':False}))
    else:
        catalog=Catalog()
        for m in catalog.manifests:
            if m.distribution!='roadmap': catalog.verify(m)
        print(json.dumps({'plugins':len(catalog.manifests),'catalog_sha256':catalog.digest,'executed':False}))
if __name__=='__main__':main()
