import { useQuery } from "@tanstack/react-query";
import type { components } from "@/api/generated/schema";
import { exactContract, inputContracts } from "@/api/input-contracts";
import { message, text } from "@/api/client";
import type { ParameterDraft } from "@/lib/study-config";
import { ContractFields } from "./contract-fields";
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
            text(contract.parameter_source || contract.source) +
            " · " +
            text(contract.parameter_source_sha256 || contract.source_sha256)
          }
        />
        <span className="muted">{method.version}</span>
      </div>
      <ContractFields
        module={namespace}
        schema={contract.parameter_schema}
        root={contract.parameter_schema}
        values={values}
        prefix=""
        readOnly={readOnly}
        onChange={onChange}
        draftFields={draftFields}
        onDraftChange={onDraftChange}
        sources={sources}
      />
    </div>
  );
}
