import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  api,
  record,
  responseData,
  text,
  numeric,
  ApiError,
  optionalRecord,
} from "@/api/client";
import { moduleConfiguration } from "./study-method-form";
import { useStudy } from "./study-provider";
import { Button } from "./ui/button";
import { PreflightDialog, needsScopeConfirmation } from "./preflight-dialog";
import { modelVersions } from "@/api/research";
import { displayName } from "@/lib/display-names";
import { missingInputDestination } from "@/lib/missing-input";
import type { components } from "@/api/generated/schema";

export function StudyRunControl({
  module,
  onResult,
  autoPreflight = false,
  onPreflightConsumed,
  onMissing,
  secondary = false,
  currentInput,
}: {
  module: string;
  onResult: (id: string, module: string) => void;
  autoPreflight?: boolean;
  onPreflightConsumed?: () => void;
  onMissing?: (field: string) => void;
  secondary?: boolean;
  currentInput?: string;
}) {
  const context = useStudy();
  const [open, setOpen] = useState(false),
    [ack, setAck] = useState(false);
  const request = useRef("");
  const accepted = useRef<{
    wid: string;
    sid: string;
    revision: number;
    studyRevision: number;
    module?: string;
    lock: string;
  } | null>(null);
  const configuration = moduleConfiguration(context.study.definition, module);
  const models = useQuery({ queryKey: ["model-versions"], queryFn: ({ signal }) => modelVersions(signal), enabled: open && configuration?.driver?.kind === "selection" });
  const configuredModule = context.study.definition.modules?.[module]
    ? module
    : undefined;
  const preflight = useMutation({
    retry: false,
    mutationFn: async () => {
      if (context.dirty)
        throw new ApiError(409, "请先保存输入和研究配置，再预检");
      if (!configuration) throw new ApiError(422, "该模块没有保存的方法配置");
      const source = {
        wid: context.study.workspace,
        sid: context.study.id,
        revision: numeric(context.workspace.revision)!,
        studyRevision: context.study.revision,
        module: configuredModule,
      };
      const value = record(
        await responseData(
          api.GET("/api/workspaces/{wid}/studies/{sid}/preflight", {
            params: {
              path: { wid: source.wid, sid: source.sid },
              query: {
                expected_revision: source.revision,
                expected_study_revision: source.studyRevision,
                ...(source.module ? { module: source.module } : {}),
              },
            },
          }),
        ),
        "研究预检",
      );
      accepted.current = { ...source, lock: text(value.lock_digest) };
      return value;
    },
    onSuccess: () => {
      request.current = crypto.randomUUID();
      setAck(false);
    },
  });
  const execution = useMutation({
    retry: false,
    mutationFn: async () => {
      if (context.dirty || !preflight.data?.ready || (needsScopeConfirmation(preflight.data) && !ack))
        throw new ApiError(409, "需保存输入并确认预检范围");
      const source = accepted.current;
      if (
        !source ||
        source.wid !== context.study.workspace ||
        source.sid !== context.study.id
      )
        throw new ApiError(409, "预检不属于当前研究");
      const body: components["schemas"]["RunStudy"] = {
        request_id: request.current,
        expected_revision: source.revision,
        expected_study_revision: source.studyRevision,
        lock_digest: source.lock,
        scope_acknowledged: true,
        ...(source.module ? { module: source.module } : {}),
      };
      return record(
        await responseData(
          api.POST("/api/workspaces/{wid}/studies/{sid}/runs", {
            params: { path: { wid: source.wid, sid: source.sid } },
            body,
          }),
        ),
        "研究运行",
      );
    },
    onSuccess: (value) => {
      setOpen(false);
      context.refresh();
      if (location.pathname.startsWith("/studies/" + context.study.id + "/"))
        onResult(text(value.id), module);
    },
  });
  useEffect(() => {
    if (!execution.isPending) return;
    const timer = setInterval(context.refresh, 2000);
    return () => clearInterval(timer);
  }, [execution.isPending]);
  const started = useRef(false);
  useEffect(() => {
    if (autoPreflight && !started.current) {
      started.current = true;
      setOpen(true);
      preflight.mutate();
      onPreflightConsumed?.();
    }
  }, [autoPreflight]);
  return (
    <>
      <Button
        variant={secondary ? "default" : "run"}
        size="compact"
        disabled={context.dirty || context.saving || !configuration}
        onClick={() => {
          setOpen(true);
          setAck(false);
          execution.reset();
          preflight.mutate();
        }}
      >
        预检并运行
      </Button>
      <PreflightDialog
        caseLabel={(id, index) => {
          const match = /case-(\d+)$/.exec(id);
          const n = match ? Number(match[1]) : index;
          const driver = optionalRecord(configuration?.driver);
          const candidate = Array.isArray(driver.candidate_ids) ? driver.candidate_ids[n] : undefined;
          const model = models.data?.find(item => text(item.id) === `candidate:${candidate}`);
          const label = text(model?.name) || (driver.kind === "selection" ? `候选型号 ${n + 1}` : `工况 ${n + 1}`);
          return id.startsWith("crosscheck-") ? `${label} · 交叉核对` : label;
        }}
        missingLabel={(field) =>
          missingInputDestination(field, module, currentInput).label
        }
        open={open}
        onOpenChange={(value) => {
          if (!execution.isPending) setOpen(value);
        }}
        method={
          configuration
            ? displayName(configuration.method.plugin_id) +
              " · " +
              configuration.method.version
            : ""
        }
        loading={preflight.isPending}
        error={preflight.error}
        data={preflight.data}
        ack={ack}
        onAck={setAck}
        running={execution.isPending}
        runError={execution.error}
        disabled={context.dirty}
        onRun={() => execution.mutate()}
        onMissing={(field) => {
          setOpen(false);
          onMissing?.(field);
        }}
      />
    </>
  );
}
