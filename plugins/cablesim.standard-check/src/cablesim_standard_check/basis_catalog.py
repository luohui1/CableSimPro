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
    by_table={}
    for row in data['records']:
        by_table.setdefault(row['id'].split('/')[0],[]).append(row)
    members={}
    for table in data['tables']:
        for locator in set((table['table'],table['clause']))-{''}:
            key=json.dumps([table['standard'],table['edition'],locator],ensure_ascii=False,separators=(',',':'))
            # Match the data reader's unfiltered list operation, including the
            # union when several indexed tables share this exact locator.
            members.setdefault(key,set()).update(row['id'] for row in by_table.get(table['id'],[])
                if row['standard']==table['standard'] and row['edition']==table['edition']
                and locator in (row['table'],row['clause']))
    complete_lists={key:{'record_count':len(ids),'record_ids_sha256':sha256(
        json.dumps(sorted(ids),ensure_ascii=False,separators=(',',':')).encode()).hexdigest()}
        for key,ids in sorted(members.items()) if ids}
    numbers_spec=importlib.util.spec_from_file_location('basis_catalog_numbers',Path(__file__).with_name('json_numbers.py'))
    numbers=importlib.util.module_from_spec(numbers_spec);numbers_spec.loader.exec_module(numbers)
    def digest(value):
        return sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
    records={row['id']:digest(row) for row in data['records']}
    # A browser writes integral floats back as integers. Pin that same content
    # for the records where it hashes differently; the issuer digest stays primary.
    content={row['id']:digest(numbers.json_numbers(row)) for row in data['records']}
    return {'plugin_version':manifest['version'],'data_sha256':sha256(raw).hexdigest(),'records':records,
        'content_records':{'schema':numbers.SCHEMA,'sha256':{key:value for key,value in sorted(content.items()) if value!=records[key]}},
        'complete_lists':complete_lists}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--write',action='store_true');args=parser.parse_args()
    value=rebuild();path=Path(__file__).with_name('basis-records.json')
    # Sealed source is checked out with LF on every platform (.gitattributes).
    if args.write:path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    elif json.loads(path.read_text('utf-8'))!=value:raise SystemExit('依据发行已变化；请审核新版记录后执行 --write，并重新封签标准核对。')
    print(f"固定依据发行 {value['plugin_version']}；{len(value['records'])} 条记录摘要。")
