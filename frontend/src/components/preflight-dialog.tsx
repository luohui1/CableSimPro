import { array, message, optionalRecord, text } from "@/api/client";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { ErrorState, LoadingState } from "./states";
import { StatusMark } from "./status-mark";
import type { ReactNode } from "react";
export function PreflightDialog({
  open,
  onOpenChange,
  method,
  loading,
  error,
  data,
  ack,
  onAck,
  running,
  runError,
  disabled,
  onRun,
  onMissing,
  missingLabel = () => "工程输入",
  summary,
  onCheck,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  method: string;
  loading: boolean;
  error?: unknown;
  data?: Record<string, unknown>;
  ack: boolean;
  onAck: (value: boolean) => void;
  running: boolean;
  runError?: unknown;
  disabled: boolean;
  onRun: () => void;
  onMissing: (field: string) => void;
  missingLabel?: (field: string) => string;
  summary?: ReactNode;
  onCheck?: () => void;
}) {
  const cases = data && Array.isArray(data.cases) ? array(data.cases, "预检工况").map(optionalRecord) : [];
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="运行前预检"
      description={method}
      actions={
        <Button
          variant="run"
          loading={running}
          disabled={disabled || !ack || (!onCheck && data?.ready !== true) || loading}
          onClick={onCheck || onRun}
        >
          {onCheck ? "核对后预检" : "确认并运行"}
        </Button>
      }
    >
      {summary}
      {loading ? (
        <LoadingState title="正在核对已保存输入" />
      ) : error ? (
        <ErrorState
          title="预检失败"
          description={message(error)}
          action={
            <Button onClick={() => onMissing("")}>
              前往{missingLabel("")}
            </Button>
          }
        />
      ) : (
        <div className="run-checks">
          {cases.some(
            (item) =>
              optionalRecord(item.error).code === "INPUT_INVALID" &&
              !optionalRecord(item.error).field &&
              !optionalRecord(item.error).path,
          ) && <span className="muted">具体缺项位置未提供，请检查输入。</span>}
          {cases.map((item, index) => (
            <div key={text(item.case_id) || index}>
              <StatusMark
                kind={item.status === "succeeded" ? "current" : "error"}
                label={text(item.case_id)}
              />
              {item.status !== "succeeded" && (
                <>
                  <p>
                    {text(optionalRecord(item.error).message) ||
                      text(item.status)}
                  </p>
                  <Button
                    variant="ghost"
                    size="compact"
                    onClick={() =>
                      onMissing(
                        text(optionalRecord(item.error).field) ||
                          text(optionalRecord(item.error).path) ||
                          JSON.stringify(item.error),
                      )
                    }
                  >
                    前往
                    {missingLabel(
                      text(optionalRecord(item.error).field) ||
                        text(optionalRecord(item.error).path) ||
                        JSON.stringify(item.error),
                    )}
                  </Button>
                </>
              )}
            </div>
          ))}
          {Array.isArray(data?.method_scopes) &&
            data.method_scopes.map((scope, index) => (
              <ul key={index}>
                {(Array.isArray(optionalRecord(scope).limitations)
                  ? (optionalRecord(scope).limitations as unknown[])
                  : []
                ).map((value, i) => (
                  <li key={i}>
                    {typeof value === "string" ? value : JSON.stringify(value)}
                  </li>
                ))}
              </ul>
            ))}
          <label className="run-ack">
            <input
              type="checkbox"
              checked={ack}
              onChange={(event) => onAck(event.target.checked)}
              disabled={(!onCheck && data?.ready !== true) || running || loading}
            />
            {onCheck ? "已核对保存输入与采样范围，执行预检" : "已核对适用范围，按已保存版本运行"}
          </label>
          {!!runError && (
            <ErrorState title="运行未完成" description={message(runError)} />
          )}
        </div>
      )}
    </Dialog>
  );
}
