import { useQuery } from "@tanstack/react-query";
import { displayName, displayText } from '@/lib/display-names';
import { exactContract, inputContractQuery } from "@/api/input-contracts";
import { type StudyDefinition } from "@/api/research";
import { methodCardsQuery } from '@/lib/study-queries';
import { optionalRecord, text, message } from "@/api/client";
import type { components } from "@/api/generated/schema";
import { useStudy } from "./study-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Tooltip } from "./ui/tooltip";
import { Button } from "./ui/button";
import { LoadingState, EmptyState, StaleBanner } from '@/components/states';
import { StudyErrorState as ErrorState } from '@/components/study-error-state';
import { SourceBadge } from "./source-badge";
import { StudyDetailGroup } from './study-detail-group';
import { downloadJson } from "@/lib/download";
import { committedParameter, moduleConfiguration, parameterChange, withConfiguration, rootModule } from "@/lib/study-config";
import { entityLabel } from "@/lib/domain-fields";
import { expand } from '@/lib/contract-schema';
import { savedDomain } from '@/lib/domain-fields';
import { array } from '@/api/client';
import './study-method-form.css';
import { Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { focusParameterField, nullableParameter } from '@/lib/study-parameter-form';
import { contractFields } from '@/lib/heavy-components';
const ContractFields = contractFields.Component;
export { rootModule, moduleConfiguration } from "@/lib/study-config";

/** 型号补录与方法页使用同一份封签参数契约；参考值另从保存研究读取。 */
export function engineeringContractFields(schema: unknown): Record<string, unknown>[] {
  const values = expand(optionalRecord(expand(schema, schema).properties).values, schema);
  const required = Array.isArray(values.required) ? values.required : [];
  return Object.entries(optionalRecord(values.properties)).map(([key, raw]) => {
    const field = expand(raw, schema), properties = optionalRecord(field.properties);
    const value = expand(properties.value, schema), labels = optionalRecord(value['x-enum-labels']);
    return { key, title: text(field.title), hint: text(field.description),
      unit: text(expand(properties.unit, schema).const), display: value['x-unit'],
      min: numericValue(value.exclusiveMinimum ?? value.minimum), max: numericValue(value.maximum),
      minExclusive: value.exclusiveMinimum !== undefined, optional: !required.includes(key),
      choices: Array.isArray(value.enum) ? value.enum.map(item => [item, text(labels[String(item)]) || displayName(String(item))]) : undefined };
  });
}
function numericValue(value: unknown) { return typeof value === 'number' ? value : null; }

type Method = components["schemas"]["Method"];
type Configuration = components["schemas"]["StudyConfiguration"];
export function StudyMethodForm({
  module,
  historical,
  definition: snapshot,
  savedRun,
}: {
  module: string;
  historical: boolean;
  definition?: StudyDefinition;
  savedRun?: Record<string, unknown>;
}) {
  const context = useStudy();
  const form=useRef<HTMLDivElement>(null);
  const methodId=useId();
  useEffect(()=>{
    if(!context.saveError || historical || context.saving)return;
    const invalid=Object.values(context.draft?.parameterFields || {}).find(field=>{
      if(field.module!==module)return false;
      try{committedParameter(field);return false;}catch{return true;}
    });
    if(!invalid)return;
    const frame=requestAnimationFrame(()=>focusParameterField(form.current,invalid.path));
    return ()=>cancelAnimationFrame(frame);
  },[context.saveError,context.saving,historical,module]);
  const [initialMethod,setInitialMethod]=useState('');
  const definition =
    snapshot || context.draft?.definition || context.study.definition;
  const configuration = moduleConfiguration(definition, module);
  const parameters: Record<string,unknown>=historical && savedRun ? {...optionalRecord(configuration?.parameters),...optionalRecord(array(optionalRecord(savedRun.snapshot).cases).map(optionalRecord)[0]?.parameters)} : optionalRecord(configuration?.parameters);
  const independentDomain = optionalRecord(definition.method_input);
  const domain = historical && savedRun ? savedDomain(savedRun) : definition.input_source === 'study' && independentDomain.schema_version === 'cablesim.domain/1' ? independentDomain as unknown as NonNullable<typeof context.domain> : context.domain;
  const references = useMemo(() => {
    if (!domain) return undefined;
    const option = (id: string) => ({ value: id, label: entityLabel(domain, id) });
    return {
      section_id: domain.sections.map((item) => option(item.id)),
      load_id: domain.load_cases.map((item) => option(item.id)),
      load_case_id: domain.load_cases.map((item) => option(item.id)),
      cable_type_id: domain.cable_types.map((item) => option(item.id)),
      // 按对象分项的参数（逐材料、逐电缆、逐回路、逐排管）的行
      material: domain.materials.map((item) => option(item.id)),
      circuit: domain.circuits.map((item) => option(item.id)),
      cable: domain.circuits.flatMap((circuit) => circuit.cables.map((item) => option(item.id))),
      duct: domain.sections.flatMap((section) => (section.enclosures || []).filter((item) => item.type === "duct").map((item) => option(item.id))),
    };
  }, [domain]);
  const methods = useQuery(methodCardsQuery());
  const choices=(methods.data || []).flatMap(entry=>(Array.isArray(entry.capabilities) ? entry.capabilities : []).map(optionalRecord).flatMap(cap=>{
    const method={...optionalRecord(entry.method),capability:text(cap.id)} as Method;
    const task=(['transient-temperature','sheath-losses','electrothermal-steady'].includes(text(cap.id)) ? text(cap.id) : Array.isArray(cap.study_tasks) && cap.study_tasks.includes('operating') ? 'operating' : 'rating') as Configuration['task'];
    if (rootModule({method,driver:{kind:'single'},task} as StudyDefinition)!==module || entry.platform_supported===false) return [];
    return [{value:method.plugin_id+':'+method.capability,label:text(entry.name)+' · '+text(cap.title),method,task}];
  }));
  const chosen=choices.find(row=>row.value===initialMethod) || choices[0];
  const selectedContract = useQuery({
    ...inputContractQuery(configuration?.method || chosen?.method || definition.method),
    enabled: !!configuration || !!chosen,
  });
  const contracts = {...selectedContract, data:selectedContract.data ? [selectedContract.data] : undefined};
  // The form engine keys its field state by schema identity. Keep the filtered
  // schema stable across its change notifications to avoid a reset/render loop.
  const selectLayout = useMemo(() => {
    let root: unknown = {};
    try { if(contracts.data && configuration){const value=exactContract(contracts.data,configuration.method);root={...value.parameter_schema,'x-groups':(value as unknown as Record<string,unknown>)['x-groups'] || value.parameter_schema['x-groups']};} } catch { /* The existing contract error below remains authoritative. */ }
    const properties=optionalRecord(expand(root,root).properties);
    const selects=Object.entries(properties).flatMap(([key,raw])=>{
      const field=expand(raw,root),bind=field['x-bind'],bindType=typeof bind==='string' ? bind : text(optionalRecord(bind).type);
      const refs=references as Record<string,{value:string;label:string}[]> | undefined;
      const options=refs?.[key] || refs?.[bindType.replace('domain.','')] || refs?.[bindType.replace('domain.','')+'_id'];
      const labels=optionalRecord(field['x-enum-labels']);
      const choices=options || (Array.isArray(field.enum) && field.enum.every(v=>typeof v==='string') ? field.enum.map(v=>({value:String(v),label:text(labels[String(v)]) || displayName(String(v))})) : undefined);
      return choices && field.type==='string' ? [{key,field,choices}] : [];
    });
    return {selects,root,remaining:{...expand(root,root),properties:Object.fromEntries(Object.entries(properties).filter(([key])=>key!=='crossing_heat_sources' && !selects.some(item=>item.key===key)))}};
  },[contracts.data,configuration?.method,references]);
  // Only missing-field membership changes the schema identity; typing a valid
  // number must not reset the existing contract form's editor state.
  const missingSignature=JSON.stringify(missingRequiredPaths(selectLayout.remaining,selectLayout.root,parameters));
  const remaining=useMemo(()=>visibleRequiredSchema(selectLayout.remaining,selectLayout.root,new Set<string>(JSON.parse(missingSignature))),[selectLayout,missingSignature]);
  if ((configuration || chosen) && contracts.isPending || methods.isPending)
    return <LoadingState title="正在读取方法输入契约" />;
  if (!configuration) {
    if (historical) return <EmptyState title="该保存运行未配置此模块" description="历史运行保持只读；返回当前研究可建立新配置。" />;
    if (methods.error || contracts.error) return <ErrorState title="方法清单读取失败" description={message(methods.error || contracts.error)} />;
    return <div className="parameter-form"><p>此模块尚未配置。建立配置后核对必填输入，再保存研究；已有模块和运行记录保持不变。</p>
      {chosen ? <><Select label="模块方法" value={chosen.value} options={choices} disabled={context.saving} onChange={setInitialMethod} />
      <p className="muted">参数来源：当前已封签插件输入契约的默认值；没有默认值的必填项需工程师填写。</p>
      <Button disabled={context.saving} onClick={()=>{
        const schema=exactContract(contracts.data!,chosen.method).parameter_schema;
        const parameters=Object.fromEntries(Object.entries(optionalRecord(expand(schema,schema).properties)).flatMap(([key,raw])=>{
          const field=expand(raw,schema);return Object.hasOwn(field,'default') ? [[key,structuredClone(field.default)]] : [];
        }));
        const config={title:definition.title,method:chosen.method,task:chosen.task,input_source:'domain',parameters,driver:{kind:'single'},crosschecks:[],input_sources:{'/parameters':{kind:'derived',reference:`已封签插件输入契约默认值 · 发行摘要 ${chosen.method.release_digest}`,reviewed:false}}} as Configuration;
        context.editDefinition({...definition,modules:{...definition.modules,[module]:config}});
      }}>为该模块建立方法配置</Button></> : <EmptyState title="尚无适用于此模块的已安装方法" description="安装相应插件后可建立配置；现有研究仍可使用。" />}
    </div>;
  }
  let error: unknown = contracts.error || methods.error;
  let contract;
  if (!error)
    try {
      contract = exactContract(contracts.data!, configuration.method);
    } catch (problem) {
      error = problem;
    }
  function update(value: Configuration) {
    context.editDefinition(withConfiguration(definition, module, value));
  }
  const available = (methods.data || []).flatMap((entry) => {
    const pin = optionalRecord(entry.method);
    return (
      Array.isArray(entry.capabilities) ? entry.capabilities : []
    ).flatMap((value) => {
      const cap = optionalRecord(value);
      if (text(cap.id) !== configuration!.method.capability) return [];
      const method = { ...pin, capability: text(cap.id) } as Method;
      return [
        {
          value: [
            method.plugin_id,
            method.capability,
            method.version,
            method.release_digest,
          ].join(":"),
          label:
            text(entry.name) + " · " + text(cap.title) + " · " + method.version,
          method,
        },
      ];
    });
  });
  const savedKey = [
    configuration.method.plugin_id,
    configuration.method.capability,
    configuration.method.version,
    configuration.method.release_digest,
  ].join(":");
  if (!available.some((value) => value.value === savedKey))
    available.unshift({
      value: savedKey,
      label:
        displayName(configuration.method.plugin_id) +
        " · 保存版本 " +
        configuration.method.version,
      method: configuration.method,
    });
  const root = contract?.parameter_schema || {};
  const admission = optionalRecord(root['x-input-admission']);
  const coreSchema = optionalRecord(optionalRecord(optionalRecord(optionalRecord(optionalRecord(admission.schema).properties).cable_types).items).properties).cores;
  const coreAlternatives = optionalRecord(coreSchema).oneOf;
  const allowedCores = (Array.isArray(coreAlternatives) ? coreAlternatives : []).map(optionalRecord)
    .filter(branch => branch.minItems === branch.maxItems).map(branch => branch.minItems);
  if (allowedCores.length && domain?.cable_types.some(cable => !allowedCores.includes(cable.cores.length)))
    return <ErrorState title="方法不覆盖此结构" description={text(admission.message) + ' 在工程浏览器点击“新建研究”，选择校正任务并填写基准来源。'} />;
  const {selects}=selectLayout;
  return (
    <div ref={form} className="parameter-form study-method-config">
      {historical && <StaleBanner description="固定运行方法配置 · 只读" />}
      <div className="select-field">
        <label htmlFor={methodId}>方法版本</label>
        <Select value={savedKey} disabled={historical || context.saving} onValueChange={value=>{
          const chosen=available.find(item=>item.value===value);
          if(chosen && !historical && !context.saving)update({...configuration,method:chosen.method});
        }}>
          <SelectTrigger id={methodId} aria-describedby={`${methodId}-name`}>
            <SelectValue>{configuration.method.version}</SelectValue>
          </SelectTrigger>
          <SelectContent>{available.map(item=><SelectItem key={item.value} value={item.value}>{displayText(item.label)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <p id={`${methodId}-name`} className="study-method-current-name">{displayText(available.find(item=>item.value===savedKey)!.label)}</p>
      {!!error && (
        <ErrorState
          title="方法契约不可用"
          description={message(error)}
          action={
            <Button size="compact" onClick={() => contracts.refetch()}>重新读取契约</Button>
          }
        />
      )}
      {contract && (
        <>
          <StudyDetailGroup id="method-contract" title="契约与单位追溯"><div className="source-line">
            <SourceBadge
              kind="library"
              detail={
                '已安装方法的参数契约'
              }
            />
            <Tooltip
              content={
                '参数单位和范围来自匹配的方法版本'
              }
            >
              <span tabIndex={0} className="muted">
                {displayName(contract.input_schema)}
              </span>
            </Tooltip>
          </div></StudyDetailGroup>
          {historical ? <dl className="report-sources" aria-label="保存运行实际方法参数">{savedParameterRows(root,parameters,references || {}).map(([label,value],index)=><div key={index}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <>
          {selects.map(({key,field,choices}) => <div key={key} data-field-path={'/'+key}><Select label={displayName(key,text(field.title) || key)+(Array.isArray(optionalRecord(root).required)&&(optionalRecord(root).required as string[]).includes(key) ? '（必填）' : '')} value={text(parameters[key] ?? field.default ?? field.const)} placeholder="请选择" disabled={context.saving || optionalRecord(field['x-bind']).read_only === true} options={[{value:'',label:'请选择'},...choices]} onChange={value=>{
            const next: Record<string,unknown>={...optionalRecord(configuration.parameters)};if(value)next[key]=value;else delete next[key];
            update({...configuration,parameters:next,input_sources:{...configuration.input_sources,['/parameters/'+key]:{kind:'user',reference:'工程师按匹配的输入契约填写',reviewed:false}}});
          }} /></div>)}
          {Array.isArray(optionalRecord(root).required) && (optionalRecord(root).required as string[]).map(key=>{
            const field=expand(optionalRecord(optionalRecord(root).properties)[key],root);
            return field.type==='object' && !Object.keys(optionalRecord(parameters[key])).length ? <div key={key} className="method-required-group" data-field-path={'/'+key}>
              <p role="alert">{text(field.title) || displayName(key)}必填；请填写下方参数。</p>
              {Object.keys(requiredDefaults(field,root)).length>0 && <Button size="compact" onClick={()=>update({...configuration,parameters:{...configuration.parameters,[key]:requiredDefaults(field,root)},input_sources:{...configuration.input_sources,['/parameters/'+key]:{kind:'derived',reference:'采用当前插件契约的默认值；由工程师确认',reviewed:false}}})}>采用此组插件默认值</Button>}
            </div> : null;
          })}
          <Suspense fallback={<LoadingState title="正在读取参数表单" />}><ContractFields
            key={`${savedKey}:${historical ? 'history' : 'current'}:${context.study.revision}`}
            module={module}
            schema={remaining}
            root={selectLayout.root}
            values={parameters}
            prefix=""
            draftFields={context.draft?.parameterFields}
            onDraftChange={context.editParameterText}
            sources={configuration.input_sources || {}}
            references={references}
            readOnly={historical || context.saving}
            onChange={(path, value) => context.editDefinition(parameterChange(definition,module,path,value))}
          /></Suspense></>}
        </>
      )}
      {!contract && historical && <dl className="report-sources" aria-label="保存运行实际方法参数">{savedParameterRows({properties:Object.fromEntries(Object.keys(parameters).map(key=>[key,{title:displayName(key)}]))},parameters,references || {}).map(([label,value],index)=><div key={index}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      {!contract && (
        <div className="source-line">
          <span className="muted">参数已保存；契约恢复后可查看单位与范围。</span>
          <Button size="compact" variant="ghost" onClick={() => downloadJson({method:configuration.method, parameters:configuration.parameters || {}, input_sources:configuration.input_sources || {}}, 'saved-method-parameters.json')}>导出已保存参数</Button>
        </div>
      )}
    </div>
  );
}

/** S4 presentation policy: physical inputs stay visible; solver controls fold.
 * The plugin contract remains the sole source of values, validation and units. */
function visibleRequiredSchema(schema:unknown,root:unknown,missing:Set<string>,path='',physical=false,depth=0):Record<string,unknown>{
  const field=expand(schema,root);if(depth>6)return field;
  const required=Array.isArray(field.required)?field.required:[];
  const primaryMesh=['size_m','far_size_m','transition_m','max_nodes'].some(key=>path==='/mesh/'+key);
  const visiblePhysics=physical || /^\/(domain_options|material_thermal_resistivity|thermal_boundaries|boundary|outer_boundary|section_id|load_id|load_case_id|target_current_a)(\/|$)/.test(path);
  const level=missing.has(path)||primaryMesh||visiblePhysics?'basic':field['x-level'];
  return {...field,...(level?{'x-level':level}:{}),...(field.properties?{properties:Object.fromEntries(Object.entries(optionalRecord(field.properties)).map(([key,raw])=>{
    const child=visibleRequiredSchema(raw,root,missing,path+'/'+key,visiblePhysics,depth+1);
    return [key,{...child,...(required.includes(key) && child.type==='object'?{title:(text(child.title)||displayName(key))+'（必填）'}:{})}];
  }))}:{})};
}
function missingRequiredPaths(schema:unknown,root:unknown,values:Record<string,unknown>,prefix='',depth=0):string[]{
  if(depth>6)return [];
  const model=expand(schema,root),required=Array.isArray(model.required)?model.required:[];
  return Object.entries(optionalRecord(model.properties)).flatMap(([key,raw])=>{
    const field=expand(raw,root),value=values[key],path=prefix+'/'+key;
    if(field.type==='object' && field.properties){
      if(value===undefined && !required.includes(key) || value===null && nullableParameter(field))return [];
      return missingRequiredPaths(field,root,optionalRecord(value),path,depth+1);
    }
    return required.includes(key) && (value===undefined || value===null || value==='') ? [path] : [];
  });
}
function requiredDefaults(schema:unknown,root:unknown,depth=0):Record<string,unknown>{
  if(depth>6)return {};
  return Object.fromEntries(Object.entries(optionalRecord(expand(schema,root).properties)).flatMap(([key,raw])=>{
    const field=expand(raw,root);if(field.default!==undefined)return [[key,field.default]];
    if(field.const!==undefined)return [[key,field.const]];
    const child=field.type==='object'?requiredDefaults(field,root,depth+1):{};
    return Object.keys(child).length?[[key,child]]:[];
  }));
}

function savedParameterRows(schema:unknown, values:Record<string,unknown>, references:Record<string,{value:string;label:string}[]>, root=schema, prefix=''): [string,string][] {
  const model=expand(schema,root), properties=optionalRecord(model.properties);
  const rows: [string,string][]=[];
  for(const [key,raw] of Object.entries(properties)) {
    if(/_sha256$/.test(key) || ['run_id','case_id','artifact_type'].includes(key))continue;
    const field=expand(raw,root),value=values[key],label=[prefix,displayName(key,text(field.title) || key)].filter(Boolean).join(' · ');
    if(field.type==='object' && field.properties) {rows.push(...savedParameterRows(field,optionalRecord(value),references,root,label));continue;}
    const unit=optionalRecord(field['x-unit']), options=Object.values(references).flat();
    const render=(item:unknown):string=>{
      if(item === undefined || item === null)return '未单独指定（保存配置）';
      if(typeof item==='number')return `${Number((item*Number(unit.scale ?? 1)+Number(unit.offset ?? 0)).toPrecision(6))}${text(unit.display || unit.si) ? ' '+text(unit.display || unit.si) : ''}`;
      if(typeof item==='boolean')return item ? '是' : '否';
      if(typeof item==='string')return options.find(option=>option.value===item)?.label || text(optionalRecord(field['x-enum-labels'])[item]) || displayName(item);
      if(Array.isArray(item))return item.map(render).join('；');
      return Object.entries(optionalRecord(item)).map(([key,v])=>(options.find(option=>option.value===key)?.label || displayName(key))+'：'+render(v)).join('；');
    };
    rows.push([label,render(value)]);
  }
  return rows.length ? rows : [['方法参数','该保存配置没有单独的方法参数']];
}
