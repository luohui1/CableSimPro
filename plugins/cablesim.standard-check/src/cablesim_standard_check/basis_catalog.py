"""Rebuild the evidence hash allowlist from an installed, sealed data release."""
import argparse
import importlib.util
from hashlib import sha256
import json
from pathlib import Path

def rebuild():
    root=Path(__file__).resolve().parents[4]
    package=root/'plugins/cablesim.standards-basis'
    manifest=json.loads((package/'plugin.json').read_text('utf-8'))
    source=package/'src/cablesim_standards_basis/basis.json'
    raw=source.read_bytes()
    sealed=next(item for item in manifest['files'] if item['path']=='src/cablesim_standards_basis/basis.json')
    if sha256(raw).hexdigest()!=sealed['sha256'] or len(raw)!=sealed['size_bytes']:
        raise ValueError('依据数据尚未完成封签，不能更新判据发行。')
    # The data plugin owns its storage layout, including independently sealed
    # volume files. Use its read-only integrity-checking reader to expand them.
    module_spec=importlib.util.spec_from_file_location('basis_catalog_reader',source.with_name('library.py'))
    module=importlib.util.module_from_spec(module_spec);module_spec.loader.exec_module(module)
    data=module.BasisLibrary(source.parent).data
    return {'plugin_version':manifest['version'],'data_sha256':sha256(raw).hexdigest(),
        'records':{row['id']:sha256(json.dumps(row,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest() for row in data['records']}}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--write',action='store_true');args=parser.parse_args()
    value=rebuild();path=Path(__file__).with_name('basis-records.json')
    # Sealed source is checked out with LF on every platform (.gitattributes).
    if args.write:path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    elif json.loads(path.read_text('utf-8'))!=value:raise SystemExit('依据发行已变化；请审核新版记录后执行 --write，并重新封签标准核对。')
    print(f"固定依据发行 {value['plugin_version']}；{len(value['records'])} 条记录摘要。")
