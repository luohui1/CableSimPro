"""Freeze verified saved-run bytes as a bounded native-input attachment.

The input snapshot keeps only a content-addressed reference. Neither the UI
preview nor a regenerated field is used as initial data. No solver runs here.
"""
from hashlib import sha256
import gzip
from io import BytesIO
import json
from pathlib import Path
import shutil
import tarfile
from uuid import uuid4
from fastapi import HTTPException


def freeze(research,run):
    root=Path(research.executor.root)/'preloads';root.mkdir(parents=True,exist_ok=True)
    with research.store.read_snapshot() as db:
        row=db.execute('SELECT CAST(snapshot AS BLOB) AS snapshot,CAST(output AS BLOB) AS output,status,input_digest,output_digest FROM study_runs WHERE workspace=? AND id=?',
                       (run['workspace'],run['id'])).fetchone()
    if row is None or row['status']!='succeeded' or row['input_digest']!=run['input_digest'] or row['output_digest']!=run['output_digest']:
        raise HTTPException(409,'起算场在准备期间变化；未提交暂态，请重新读取原运行。')
    for key in ('snapshot','output'):
        if row[key] is None or sha256(row[key]).hexdigest()!=row['input_digest' if key=='snapshot' else 'output_digest']:
            raise HTTPException(409,'起算场原始字节摘要不一致；原运行保留，不采用显示投影替代。')
    source={key:run[key] for key in ('id','workspace','study','input_digest','output_digest','status','integrity','execution')}
    partial=root/('.pending-'+str(uuid4()))
    try:
        with partial.open('wb') as stream,gzip.GzipFile(fileobj=stream,mode='wb',mtime=0,filename='') as zipped,tarfile.open(fileobj=zipped,mode='w|') as archive:
            for name,data in [('snapshot.json',row['snapshot']),('output.json',row['output']),('source.json',json.dumps(source,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())]:
                if len(data)>160*1024*1024:raise HTTPException(422,'保存起算场超过已验证的有界输入容量；未截断数据。')
                member=tarfile.TarInfo(name);member.size=len(data);member.mtime=0;archive.addfile(member,BytesIO(data))
        checksum=sha256()
        with partial.open('rb') as stream:
            for block in iter(lambda:stream.read(1024*1024),b''):checksum.update(block)
        size=partial.stat().st_size
        if size>100*1024*1024:raise HTTPException(422,'压缩初场附件超过已验证容量，未提交暂态。')
        identity=checksum.hexdigest();target=root/('preload-'+identity+'.tar.gz')
        if target.exists():
            if target.stat().st_size!=size or _checksum(target)!=identity:raise HTTPException(409,'已保存初场附件损坏，请保留文件并重新核验。')
        else:partial.replace(target)
        return {'attachment_sha256':identity,'attachment_size':size}
    finally:
        partial.unlink(missing_ok=True)


def _checksum(path):
    result=sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):result.update(block)
    return result.hexdigest()


def stage(root,candidate,cases):
    records=[]
    for case in cases:
        value=case.get('input',{})
        if value.get('kind')!='preloaded_history':continue
        source=value.get('saved_source',{});identity=source.get('attachment_sha256','')
        if len(identity)!=64 or any(c not in '0123456789abcdef' for c in identity):raise HTTPException(422,'初场附件身份无效。')
        name='preload-'+identity+'.tar.gz';path=Path(root)/'preloads'/name
        if not path.is_file() or path.stat().st_size!=source.get('attachment_size') or _checksum(path)!=identity:
            raise HTTPException(409,'已保存初场附件缺失或摘要变化；未提交超算。')
        if name in {r['name'] for r in records}:continue
        target=candidate/'inputs'/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,target)
        if _checksum(target)!=identity:raise HTTPException(409,'冻结初场副本核验失败；未提交超算。')
        records.append({'name':name,'size':target.stat().st_size,'sha256':identity})
    return records
