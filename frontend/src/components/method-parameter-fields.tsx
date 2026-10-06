import { useQuery } from "@tanstack/react-query";
import type { components } from "@/api/generated/schema";
import { exactContract, inputContracts } from "@/api/input-contracts";
import { message } from "@/api/client";
import type { ParameterDraft } from "@/lib/study-config";
import { Suspense } from 'react';
import { contractFields } from '@/lib/heavy-components';
const ContractFields = contractFields.Component;
import { EmptyState, ErrorState, LoadingState } from "./states";
import { Button } from "./ui/button";
import { SourceBadge } from "./source-badge";

/** Controlled contract form: its owner keeps values, pending text and revision. */
export function MethodParameterFields({
  method,
  values,
  onChange,
  draftFields,
  onDraftChange,
  readOnly,
  namespace,
  sources,
}: {
  method: components["schemas"]["Method"];
  values: Record<string, unknown>;
  onChange: (path: string, value: unknown) => void;
  draftFields?: Record<string, ParameterDraft>;
  onDraftChange: (field: ParameterDraft | undefined, key: string) => void;
  readOnly: boolean;
  namespace: string;
  sources?: Record<string, { kind?: string }>;
}) {
  const query = useQuery({
    queryKey: ["input-contracts"],
    queryFn: ({ signal }) => inputContracts(signal),
  });
  if (query.isPending) return <LoadingState title="正在读取方法参数" />;
  let error: unknown = query.error,
    contract;
  if (!error)
    try {
      contract = exactContract(query.data!, method);
    } catch (problem) {
      error = problem;
    }
  if (error)
    return (
      <ErrorState
        title="方法参数契约不可用"
        description={message(error)}
        action={<Button onClick={() => void query.refetch()}>重新读取</Button>}
      />
    );
  if (!contract) return <EmptyState title="没有方法参数契约" description="" />;
  return (
    <div className="parameter-form">
      <div className="source-line">
        <SourceBadge
          kind="library"
          detail={
            '已安装方法的参数契约'
          }
        />
        <span className="muted">{method.version}</span>
      </div>
      <Suspense fallback={<LoadingState title="正在读取参数表单" />}><ContractFields
        module={namespace}
        schema={contract.parameter_schema}
        root={{ ...contract.parameter_schema, "x-groups": (contract as unknown as Record<string, unknown>)["x-groups"] }}
        values={values}
        prefix=""
        readOnly={readOnly}
        onChange={onChange}
        draftFields={draftFields}
        onDraftChange={onDraftChange}
        sources={sources}
      /></Suspense>
    </div>
  );
}
