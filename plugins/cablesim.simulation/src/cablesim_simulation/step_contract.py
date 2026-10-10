"""Declarative labels for the saved step-response contract (no solver)."""
from copy import deepcopy
from .step_response import StepInput, Controls


LABELS = {
    'schema_version':'输入契约', 'circuit_id':'所属回路', 'reference_current_a':'参考电流',
    'ambient_temperature_k':'环境温度', 'problem':'保存的有限元热模型', 'conductor_regions':'导体区域',
    'joule_heat_w_m':'各区域固定焦耳损耗', 'capacities':'各材料域体积热容', 'source':'来源说明',
    'saved_source':'已保存稳态来源', 'value_j_m3_k':'体积热容', 'material':'材料',
    'reference':'文献来源', 'source_sha256':'正文摘要', 'page':'正文页码', 'table':'表号',
    'density_kg_m3':'密度', 'specific_heat_j_kg_k':'比热', 'limitations':'适用范围',
    'run_id':'来源运行', 'output_sha256':'结果摘要', 'input_sha256':'输入摘要',
    'method':'来源方法', 'study_name':'来源研究', 'operation':'计算任务', 'mesh':'网格控制',
    'first_time_s':'首时间步', 'final_time_s':'末时刻', 'intervals_per_decade':'每十倍时间的区间数',
    'max_levels':'最多加密级数', 'tolerance_k':'收敛门槛',
}
UNITS={'reference_current_a':'A','ambient_temperature_k':'K','value_j_m3_k':'J/(m3*K)',
       'density_kg_m3':'kg/m3','specific_heat_j_kg_k':'J/(kg*K)','first_time_s':'s','final_time_s':'s','tolerance_k':'K'}


def schemas(manifest):
    # Reuse reviewed labels for the shared Problem and MeshControls fields.
    existing={}
    def collect(node):
        if not isinstance(node,dict):return
        for key,value in node.get('properties',{}).items():
            if value.get('x-unit') is not None:existing.setdefault(key,value)
        for value in node.values():
            if isinstance(value,dict):collect(value)
            elif isinstance(value,list):
                for item in value:collect(item)
    for capability in manifest['capabilities']:
        if capability['id']!='fem-step-response':collect(capability)
    def decorate(node):
        if not isinstance(node,dict):return
        for order,(key,field) in enumerate(node.get('properties',{}).items()):
            old=existing.get(key,{})
            title=LABELS.get(key,old.get('title','模型字段 '+key))
            unit=UNITS.get(key)
            field.update(title=title,description=old.get('description',title+'；须与保存输入和正文来源一致。'))
            field.update({'x-unit':{'si':unit,'display':unit,'scale':1,'offset':0} if unit else old.get('x-unit',{'si':None,'display':None,'scale':1,'offset':0}),
                          'x-group':'response','x-order':order,'x-level':'expert',
                          'x-editor-reason':'保存模型、材料来源与区域映射需要完整结构；预检逐字段核验，不填默认材料数据。',
                          'x-range-basis':{'kind':'method','reference':'有限元阶跃响应 1.0.0 适用范围及输入完整性约束。'}})
            if 'default' in field:field['x-default-basis']={'kind':'numerical','reference':'有限元阶跃响应的数值控制初值；仍须通过实际时间步、网格与末值收敛。'}
            if key=='operation':field['x-enum-labels']={'steady_reference':'封存固定焦耳稳态参考','step_response':'阶跃热响应'}
        for key,value in node.items():
            if isinstance(value,dict):decorate(value)
            elif isinstance(value,list):
                for item in value:decorate(item)
    result=[]
    for model in (StepInput,Controls):
        schema=deepcopy(model.model_json_schema());decorate(schema);result.append(schema)
    return result


if __name__=='__main__':
    import json
    from pathlib import Path
    path=Path(__file__).resolve().parents[2]/'plugin.json'
    manifest=json.loads(path.read_text('utf-8'));a,b=schemas(manifest)
    capability=next(c for c in manifest['capabilities'] if c['id']=='fem-step-response')
    capability['input_contract']['standalone_schema']=a;capability['parameter_schema']=b
    path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
