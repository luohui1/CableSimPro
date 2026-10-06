"""Sealed JSON-Schema admission and explicit SI aliases; no method knowledge."""
from copy import deepcopy
from jsonschema import Draft202012Validator
from cablesim_sdk.parameter_units import translate
from .registry import PluginHostError

HOST_PARAMETERS={'external_loss_artifact','_artifact_reuse_sha256'}


def schemas(capability,document):
    contract=capability.input_contract
    parameters=capability.parameter_schema
    if contract and document.get('schema_version')!='cablesim.domain/1' and contract.standalone_parameter_schema:
        parameters=contract.standalone_parameter_schema
    return parameters.model_dump(mode='json',by_alias=True,exclude_none=True), (
        contract.standalone_schema.model_dump(mode='json',by_alias=True,exclude_none=True)
        if contract and contract.standalone_schema and document.get('schema_version')!='cablesim.domain/1' else None)


def normalize(capability,parameters,document):
    schema,input_schema=schemas(capability,document)
    return translate(schema,parameters), translate(input_schema,document) if input_schema else deepcopy(document)


def validate_case(capability,case):
    schema,input_schema=schemas(capability,case['input'])
    try:
        parameters,document=normalize(capability,case.get('parameters',{}),case['input'])
    except (ValueError,KeyError,TypeError) as error:
        exc=PluginHostError('INPUT_CONTRACT_VIOLATION',str(error),422)
        exc.path='/parameters'
        raise exc from None
    parameters={key:value for key,value in parameters.items() if key not in HOST_PARAMETERS}
    for spec,value,prefix in [(schema,parameters,'parameters'),(input_schema,document,'input')]:
        if spec is None:continue
        errors=sorted(Draft202012Validator(spec).iter_errors(value),key=lambda error:str(list(error.path)))
        if errors:
            error=errors[0]
            path='/'+prefix+''.join('/'+str(part).replace('~','~0').replace('/','~1') for part in error.absolute_path)
            if error.validator=='required':
                missing=[name for name in error.validator_value if name not in error.instance]
                if missing:path+='/'+missing[0].replace('~','~0').replace('/','~1')
            exc=PluginHostError('INPUT_CONTRACT_VIOLATION',f'{path}：参数不符合所选封签契约（{error.validator}）。',422)
            exc.path=path
            raise exc
