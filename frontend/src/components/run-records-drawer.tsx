import { message, optionalRecord, text } from "@/api/client";
import { VersionNotice } from './version-notice';
import { isVersionStale } from '@/lib/version-status';
import { useQuery } from '@tanstack/react-query';
import { studyRuns } from '@/api/research';
import { Dialog } from "./ui/dialog";
import { DataTable } from "./data-table";
import { Button } from "./ui/button";
import { StatusMark } from "./status-mark";
export function RunRecordsDrawer({
  open,
  onOpenChange,
  runs,
  selectedId,
  onSelect,
  loading,
  error,
  onRetry,
  workspace,
  studyId,
  disabledReason,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  runs: Record<string, unknown>[];
  selectedId?: string;
  onSelect: (id: string) => void;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  workspace?: string;
  studyId?: string;
  disabledReason?: string;
}) {
  const history = useQuery({ queryKey: ['run-history', workspace, studyId], queryFn: ({signal}) => studyRuns(workspace!, studyId!, signal), enabled: open && !!workspace && !!studyId });
  const rows: (Record<string, unknown> & { id: string })[] = (history.data || runs).map(
    (run) => ({ ...run, id: text(run.id) }),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      variant="drawer"
      title="运行记录"
      description="固定输入与方法版本"
      initialFocus="form"
    >
      <DataTable
        label="研究运行记录"
        selectedId={selectedId}
        loading={loading || !!workspace && !!studyId && history.isPending}
        error={error || history.error ? message(error || history.error) : undefined}
        groups={[
          {
            id: "current",
            label: "当前",
            rows: rows.filter((run) => run.freshness !== "historical" && !isVersionStale(run)),
          },
          {
            id: "historical",
            label: "历史",
            defaultCollapsed: false,
            rows: rows.filter((run) => run.freshness === "historical" || isVersionStale(run)),
          },
        ]}
        rowClassName={(row) =>
          row.freshness === "historical" ? "historical-row" : ""
        }
        rowLabel={(row) => "查看运行 " + row.id}
        onActivate={(row) => {
          onSelect(row.id);
          onOpenChange(false);
        }}
        columns={[
          {
            id: "time",
            label: "运行时间",
            render: (row) => (
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  onSelect(row.id);
                  onOpenChange(false);
                }}
              >
                {new Date(
                  text(row.finished) || text(row.created),
                ).toLocaleString("zh-CN")}
              </Button>
            ),
          },
          {
            id: "status",
            label: "状态",
            render: (row) => isVersionStale(row) && workspace && studyId ? <VersionNotice value={row} target={{ wid: workspace, sid: studyId, module: text(optionalRecord(row.snapshot).module) || undefined }} disabledReason={disabledReason} onComplete={run => { onSelect(text(run.id)); onOpenChange(false); }} /> : (
              <StatusMark
                kind={
                  row.freshness === "historical"
                    ? "historical"
                    : row.status === "succeeded"
                      ? "current"
                      : row.status === "failed"
                        ? "error"
                        : "running"
                }
                label={
                  row.freshness === "historical"
                    ? "历史"
                    : (
                        {
                          succeeded: "成功",
                          failed: "失败",
                          partial: "部分成功",
                          running: "运行中",
                          accepted: "已受理",
                        } as Record<string, string>
                      )[text(row.status)] || text(row.status)
                }
              />
            ),
          },
          {
            id: "version",
            label: "方法版本",
            render: (row) =>
              text(
                (
                  row.snapshot as {
                    definition?: { method?: { version?: string } };
                  }
                )?.definition?.method?.version,
              ) || "—",
          },
        ]}
      />
      {(!!error || !!history.error) && <Button onClick={() => { onRetry?.(); void history.refetch(); }}>重新读取</Button>}
    </Dialog>
  );
}
