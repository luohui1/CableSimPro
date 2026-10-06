"""Small, explicit answer artifacts from validated producer quantities.

This is a protocol adapter, not an algorithm. Each answer retains the exact raw
engineering artifact it accompanies, and the host checks it against the accepted
quantity, input identity and original artifact digest before projecting a list.
"""
from hashlib import sha256
import json
from math import isfinite
from pathlib import Path
from typing import Literal
from pydantic import Field, model_validator

from .simulation import Strict

ARTIFACT='x-cablesim.headline-witness'


class AnswerProducer(Strict):
    run_id: str = Field(min_length=1)
    case_id: str = Field(min_length=1)
    plugin_id: str = Field(min_length=1)
    plugin_version: str = Field(min_length=1)
    capability: str = Field(min_length=1)
    input_sha256: str = Field(pattern='^[0-9a-f]{64}$')
    manifest_sha256: str = Field(pattern='^[0-9a-f]{64}$')


class AnswerQuantity(Strict):
    key: str = Field(min_length=1)
    entity: str = Field(min_length=1)
    condition: str | None = None
    value: float
    unit: str = Field(min_length=1)
    artifact_type: str = Field(min_length=1)
    artifact_sha256: str = Field(pattern='^[0-9a-f]{64}$')


class HeadlineWitness(Strict):
    schema_version: Literal['cablesim.headline-witness/1']
    producer: AnswerProducer
    quantities: list[AnswerQuantity] = Field(max_length=1000)
    engineering_approval: Literal[False] = False

    @model_validator(mode='after')
    def finite(self):
        if any(not isfinite(row.value) for row in self.quantities):
            raise ValueError('关键结论只能采用有限的真实数量。')
        ids=[(row.key,row.entity,row.condition) for row in self.quantities]
        if len(ids)!=len(set(ids)):raise ValueError('关键结论对象或工况重复。')
        return self


def attach_witnesses(request,response,manifest_path):
    if request['phase']!='run':return
    manifest=json.loads(manifest_path.read_text('utf-8'))
    cap=next(item for item in manifest['capabilities'] if item['id']==request['capability'])
    specs=cap.get('x-headline',[])
    if not specs or not any(item['type']==ARTIFACT for item in cap['artifacts']):return
    inputs={item['case_id']:item for item in request['cases']}
    job=Path.cwd().resolve()
    for case in response['cases']:
        if case['status']!='succeeded':continue
        quantities=[]
        files={item['type']:item['path'] for item in case.get('artifacts',[])}
        for spec in specs:
            source=spec.get('source_artifact')
            if source not in files:continue
            file=(job/files[source]).resolve()
            if not file.is_relative_to(job/'output'):raise ValueError('关键结论来源工件越出输出目录。')
            original_sha=sha256(file.read_bytes()).hexdigest()
            for row in case.get('results',[]):
                if row.get('key')!=spec['key'] or row.get('status')!='available':continue
                if isinstance(row.get('value'),bool) or not isinstance(row.get('value'),(int,float)) or not isfinite(row['value']):continue
                quantities.append(dict(key=row['key'],entity=row['entity'],condition=row.get('case',spec.get('condition')),
                                       value=row['value'],unit=row['unit'],artifact_type=source,artifact_sha256=original_sha))
        source=inputs[case['case_id']]
        from .reproduction import digest
        input_sha=source.get('_source_input_sha256') or digest(source['input'])
        witness=HeadlineWitness.model_validate(dict(schema_version='cablesim.headline-witness/1',
            producer=dict(run_id=request['run_id'],case_id=case['case_id'],plugin_id=manifest['id'],plugin_version=manifest['version'],
                          capability=request['capability'],input_sha256=input_sha,manifest_sha256=sha256(manifest_path.read_bytes()).hexdigest()),quantities=quantities))
        data=witness.model_dump_json().encode()
        if len(data)>256*1024:raise ValueError('关键结论证据超过256 KiB上限。')
        name=case['case_id']+'.answers.json'
        (job/'output'/name).write_bytes(data)
        case.setdefault('artifacts',[]).append(dict(type=ARTIFACT,path='output/'+name))
