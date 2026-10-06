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
import { DataTable } from "./data-table";
import { moduleConfiguration, withConfiguration } from "@/lib/study-config";
import { entityLabel } from "@/lib/domain-fields";
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
}: {
  module: string;
  historical: boolean;
  definition?: StudyDefinition;
}) {
  const context = useStudy();
  const definition =
    snapshot || context.draft?.definition || context.study.definition;
  const configuration = moduleConfiguration(definition, module);
  const domain = context.domain;
  const references = useMemo(() => {
    if (!domain) return undefined;
    const option = (id: string) => ({ value: id, label: entityLabel(domain, id) });
    return {
      section_id: domain.sections.map((item) => option(item.id)),
      load_id: domain.load_cases.map((item) => option(item.id)),
      load_case_id: domain.load_cases.map((item) => option(item.id)),
      cable_type_id: domain.cable_types.map((item) => option(item.id)),
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
        configuration.method.plugin_id +
        " · 保存版本 " +
        configuration.method.version,
      method: configuration.method,
    });
  return (
    <div className="parameter-form">
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
          <Suspense fallback={<LoadingState title="正在读取参数表单" />}><ContractFields
            module={module}
            schema={contract.parameter_schema}
            root={contract.parameter_schema}
            values={configuration.parameters || {}}
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
          /></Suspense>
        </>
      )}
      {!contract && (
        <DataTable
          label="保存的方法参数"
          columns={[
            { id: "name", label: "参数", render: (row) => displayName(row.id) },
            {
              id: "value",
              label: "保存值",
              wrap: true,
              render: (row) => row.value,
            },
          ]}
          groups={[
            {
              id: "parameters",
              label: "参数",
              rows: Object.entries(configuration.parameters || {}).map(
                ([id, value]) => ({ id, value: JSON.stringify(value) }),
              ),
            },
          ]}
          rowLabel={(row) => displayName(row.id)}
          showGroups={false}
        />
      )}
    </div>
  );
}
