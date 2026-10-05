"""Read-only catalogue of content-addressed trained method artifacts.

No algorithm, automatic registration, execution or engineering approval occurs
here. Registration is an administrator operation over a sealed producer run.
"""
from hashlib import sha256
import json
from pathlib import Path
import re
from .registry import Registry
from ..kernel.workspace import fingerprint


def catalogue(repository,registry):
    folder=Path(repository)/'.data/method-models';path=folder/'index.json'
    if not path.is_file():return []
    if path.is_symlink() or path.stat().st_size>8*1024*1024:raise ValueError('MODEL_CATALOGUE_INVALID')
    index=json.loads(path.read_text('utf-8'))
    if index.get('schema_version')!='cablesim.method-model-catalogue/1':raise ValueError('MODEL_CATALOGUE_VERSION_UNSUPPORTED')
    records=index.get('models',{})
    if not isinstance(records,dict) or len(records)>1000:raise ValueError('MODEL_CATALOGUE_INVALID')
    rows=[]
    for hashed,record in sorted(records.items()):
        if not re.fullmatch('[0-9a-f]{64}',hashed) or not isinstance(record,dict):raise ValueError('MODEL_CATALOGUE_INVALID')
        entry={**record,'model_sha256':hashed,'authority':'reference_only','engineering_approval':False}
        try:
            plugin=Registry(registry.root,plugin_id=record['method']['plugin_id']).get(record['method']['plugin_id']);plugin.verify()
            if plugin.manifest.version!=record['method']['version']:raise ValueError('METHOD_VERSION_UNAVAILABLE')
            entry['runtime_method']={**record['method'],'release_digest':fingerprint(plugin.manifest.model_dump(mode='json',by_alias=True))}
            model=folder/(hashed+'.json')
            if not model.is_file() or model.is_symlink() or model.stat().st_size>16*1024*1024:
                raise ValueError('MODEL_FILE_MISSING')
            raw=model.read_bytes()
            if sha256(raw).hexdigest()!=hashed:raise ValueError('MODEL_FILE_CORRUPT')
            if index.get('active_feature_version') and json.loads(raw).get('feature_version')!=index['active_feature_version']:
                raise ValueError('MODEL_FEATURE_CONTRACT_CHANGED: 原模型保留为历史来源，请选择当前特征契约的训练版本。')
            entry['availability']='available'
        except Exception as exc:
            entry['availability']='unavailable';entry['reason']=str(exc)
        rows.append(entry)
    return rows
