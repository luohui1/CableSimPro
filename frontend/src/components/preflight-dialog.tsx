import { array, message, optionalRecord, text } from "@/api/client";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { ErrorState, LoadingState } from "./states";
import { StatusMark } from "./status-mark";
import type { ReactNode } from "react";
export function needsScopeConfirmation(data?: Record<string, unknown>) {
  return data?.partial === true || [data?.cases, data?.crosschecks].some(rows =>
    Array.isArray(rows) && rows.some(raw => optionalRecord(raw).status !== "succeeded"));
}
function outsideScope(item: Record<string, unknown>, issue?: Record<string, unknown>) {
  const error = optionalRecord(item.error);
  return item.status === 'not_applicable' || text(error.code).includes('APPLICAB') ||
    /不覆盖|未覆盖|不适用|不接受/.test(text(issue?.message) || text(error.message));
}
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
  caseLabel,
  requireConfirmation = false,
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
  caseLabel?: (id: string, index: number) => string;
  requireConfirmation?: boolean;
}) {
  const cases = data && Array.isArray(data.cases) ? array(data.cases, "预检工况").map(optionalRecord) : [];
  const checks = [...cases, ...(Array.isArray(data?.crosschecks) ? data.crosschecks.map(optionalRecord) : [])];
  const failed = checks.filter(item => item.status !== "succeeded");
  const outOfScope = failed.filter(item => outsideScope(item));
  const confirm = requireConfirmation || !!onCheck || needsScopeConfirmation(data);
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
          disabled={disabled || (confirm && !ack) || (!onCheck && data?.ready !== true) || loading || !!error}
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
          {data && data.local_only !== true && <StatusMark kind={failed.length || data.ready !== true ? "error" : "current"} label={
            failed.length ? (outOfScope.length === failed.length ? `有 ${failed.length} 项超出范围` : `有 ${failed.length} 项需要修正`) :
            data.ready === true ? "你的工况在适用范围内 ✓" : "当前没有可运行工况"
          } />}
          {cases.some(
            (item) =>
              optionalRecord(item.error).code === "INPUT_INVALID" &&
              !optionalRecord(item.error).field &&
              !optionalRecord(item.error).path &&
              !(Array.isArray(optionalRecord(item.error).issues) &&
                (optionalRecord(item.error).issues as unknown[]).some(issue => text(optionalRecord(issue).path))),
          ) && <span className="muted">具体缺项位置未提供，请检查输入。</span>}
          {checks.map((item, index) => (
            <div key={text(item.case_id) || index}>
              <StatusMark
                kind={item.status === "succeeded" ? "current" : "error"}
                label={text(item.name) || text(item.label) || caseLabel?.(text(item.case_id), index) || `工况 ${index + 1}`}
              />
              {item.status !== "succeeded" && (
                <>
                  {(Array.isArray(optionalRecord(item.error).issues) && (optionalRecord(item.error).issues as unknown[]).length
                    ? (optionalRecord(item.error).issues as unknown[])
                    : [item.error]).map((raw, issueIndex) => {
                      const issue = optionalRecord(raw), path = text(issue.path) || text(optionalRecord(item.error).path);
                      return <div key={issueIndex}><p>{text(issue.message) || '输入不符合当前方法要求'}</p>{!outsideScope(item, issue) && <Button variant="ghost" size="compact" onClick={() => onMissing(path)}>修正{missingLabel(path)}后重新预检</Button>}</div>;
                    })}
                </>
              )}
            </div>
          ))}
          {Array.isArray(data?.method_scopes) && <details><summary>查看方法适用范围</summary>{
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
            ))}</details>}
          {confirm && <label className="run-ack">
            <input
              type="checkbox"
              checked={ack}
              onChange={(event) => onAck(event.target.checked)}
              disabled={(!onCheck && data?.ready !== true) || running || loading}
            />
            {onCheck || requireConfirmation ? "已核对保存输入与采样范围" : data?.ready === true ? "已知悉上述限制，仅运行通过预检的工况" : outOfScope.length === failed.length && failed.length ? "当前方法不覆盖此工况，不能运行" : "请先修正上述问题，再重新预检"}
          </label>}
          {!!runError && (
            <ErrorState title="运行未完成" description={message(runError)} />
          )}
        </div>
      )}
    </Dialog>
  );
}
