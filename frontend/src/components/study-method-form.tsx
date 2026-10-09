import { useQuery } from "@tanstack/react-query";
import { displayName } from '@/lib/display-names';
import { inputContracts, exactContract } from "@/api/input-contracts";
import { methodCatalog, type StudyDefinition } from "@/api/research";
import { optionalRecord, text, message } from "@/api/client";
import type { components } from "@/api/generated/schema";
import { useStudy } from "./study-provider";
import { Select } from "./ui/select";
import { Tooltip } from "./ui/tooltip";
import { Button } from "./ui/button";
import { ErrorState, LoadingState, EmptyState, StaleBanner } from "./states";
import { SourceBadge } from "./source-badge";
import { downloadJson } from "@/lib/download";
import { moduleConfiguration, withConfiguration } from "@/lib/study-config";
import { entityLabel } from "@/lib/domain-fields";
import { expand } from '@/lib/contract-schema';
import { savedDomain } from '@/lib/domain-fields';
import { array } from '@/api/client';
import './study-method-form.css';
import { Suspense, useMemo } from 'react';
import { contractFields } from '@/lib/heavy-components';
const ContractFields = contractFields.Component;
export { rootModule, moduleConfiguration } from "@/lib/study-config";

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
  const definition =
    snapshot || context.draft?.definition || context.study.definition;
  const configuration = moduleConfiguration(definition, module);
  const domain = historical && savedRun ? savedDomain(savedRun) : context.domain;
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
  const contracts = useQuery({
    queryKey: ["input-contracts"],
    queryFn: ({ signal }) => inputContracts(signal),
  });
  const methods = useQuery({
    queryKey: ["method-catalog"],
    queryFn: ({ signal }) => methodCatalog(signal),
  });
  // The form engine keys its field state by schema identity. Keep the filtered
  // schema stable across its change notifications to avoid a reset/render loop.
  const selectLayout = useMemo(() => {
    let root: unknown = {};
    try { if(contracts.data && configuration)root=exactContract(contracts.data,configuration.method).parameter_schema; } catch { /* The existing contract error below remains authoritative. */ }
    const properties=optionalRecord(expand(root,root).properties);
    const selects=Object.entries(properties).flatMap(([key,raw])=>{
      const field=expand(raw,root),bind=field['x-bind'],bindType=typeof bind==='string' ? bind : text(optionalRecord(bind).type);
      const refs=references as Record<string,{value:string;label:string}[]> | undefined;
      const options=refs?.[key] || refs?.[bindType.replace('domain.','')] || refs?.[bindType.replace('domain.','')+'_id'];
      const labels=optionalRecord(field['x-enum-labels']);
      const choices=options || (Array.isArray(field.enum) && field.enum.every(v=>typeof v==='string') ? field.enum.map(v=>({value:String(v),label:text(labels[String(v)]) || displayName(String(v))})) : undefined);
      return choices && field.type==='string' ? [{key,field,choices}] : [];
    });
    return {selects,remaining:{...expand(root,root),properties:Object.fromEntries(Object.entries(properties).filter(([key])=>key!=='crossing_heat_sources' && !selects.some(item=>item.key===key)))}};
  },[contracts.data,configuration?.method,references]);
  if (!configuration)
    return <EmptyState description="" title="当前研究没有该模块的方法配置" />;
  if (contracts.isPending || methods.isPending)
    return <LoadingState title="正在读取方法输入契约" />;
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
  const {selects,remaining}=selectLayout;
  const parameters: Record<string,unknown>=historical && savedRun ? {...optionalRecord(configuration.parameters),...optionalRecord(array(optionalRecord(savedRun.snapshot).cases).map(optionalRecord)[0]?.parameters)} : optionalRecord(configuration.parameters);
  return (
    <div className="parameter-form study-method-config">
      {historical && <StaleBanner description="固定运行方法配置 · 只读" />}
      <Select
        label="方法版本"
        value={savedKey}
        disabled={historical || context.saving}
        options={available}
        onChange={(value) => {
          const chosen = available.find((item) => item.value === value);
          if (chosen) update({ ...configuration, method: chosen.method });
        }}
      />
      {!!error && (
        <ErrorState
          title="方法契约不可用"
          description={message(error)}
          action={
            <Button onClick={() => contracts.refetch()}>重新读取契约</Button>
          }
        />
      )}
      {contract && (
        <>
          <div className="source-line">
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
          </div>
          {historical ? <dl className="report-sources" aria-label="保存运行实际方法参数">{savedParameterRows(root,parameters,references || {}).map(([label,value],index)=><div key={index}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <>
          {selects.map(({key,field,choices}) => <Select key={key} label={displayName(key,text(field.title) || key)} value={text(parameters[key])} placeholder="未单独指定" disabled={context.saving || optionalRecord(field['x-bind']).read_only === true} options={[{value:'',label:'未单独指定'},...choices]} onChange={value=>{
            const next: Record<string,unknown>={...optionalRecord(configuration.parameters)};if(value)next[key]=value;else delete next[key];
            update({...configuration,parameters:next,input_sources:{...configuration.input_sources,['/parameters/'+key]:{kind:'user',reference:'工程师按匹配的输入契约填写',reviewed:false}}});
          }} />)}
          <Suspense fallback={<LoadingState title="正在读取参数表单" />}><ContractFields
            key={`${savedKey}:${historical ? 'history' : 'current'}:${context.study.revision}`}
            module={module}
            schema={remaining}
            root={{ ...contract.parameter_schema, "x-groups": (contract as unknown as Record<string, unknown>)["x-groups"] }}
            values={parameters}
            prefix=""
            draftFields={context.draft?.parameterFields}
            onDraftChange={context.editParameterText}
            sources={configuration.input_sources || {}}
            references={references}
            readOnly={historical || context.saving}
            onChange={(path, value) => {
              const parameters = structuredClone(
                configuration.parameters || {},
              );
              const parts = path.split("/").filter(Boolean);
              let target: Record<string, unknown> = parameters;
              for (const key of parts.slice(0, -1)) {
                target[key] = optionalRecord(target[key]);
                target = target[key] as Record<string, unknown>;
              }
              target[parts.at(-1)!] = value;
              update({
                ...configuration,
                parameters,
                input_sources: {
                  ...configuration.input_sources,
                  ["/parameters" + path]: {
                    kind: "user",
                    reference: "工程师按匹配的输入契约填写",
                    reviewed: false,
                  },
                },
              });
            }}
          /></Suspense></>}
        </>
      )}
      {!contract && historical && <dl className="report-sources" aria-label="保存运行实际方法参数">{savedParameterRows({properties:Object.fromEntries(Object.keys(parameters).map(key=>[key,{title:displayName(key)}]))},parameters,references || {}).map(([label,value],index)=><div key={index}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      {!contract && (
        <div className="source-line">
          <span className="muted">参数已保存；契约恢复后可查看单位与范围。</span>
          <Button variant="ghost" onClick={() => downloadJson({method:configuration.method, parameters:configuration.parameters || {}, input_sources:configuration.input_sources || {}}, 'saved-method-parameters.json')}>导出已保存参数</Button>
        </div>
      )}
    </div>
  );
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
