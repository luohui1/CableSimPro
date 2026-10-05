import { message, text } from "@/api/client";
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
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  runs: Record<string, unknown>[];
  selectedId?: string;
  onSelect: (id: string) => void;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  const rows: (Record<string, unknown> & { id: string })[] = runs.map(
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
        loading={loading}
        error={error ? message(error) : undefined}
        groups={[
          {
            id: "current",
            label: "当前",
            rows: rows.filter((run) => run.freshness !== "historical"),
          },
          {
            id: "historical",
            label: "历史",
            defaultCollapsed: false,
            rows: rows.filter((run) => run.freshness === "historical"),
          },
        ]}
        rowClassName={(row) =>
          row.freshness === "historical" ? "historical-row" : ""
        }
        rowLabel={(row) => "查看运行 " + row.id}
        onSelect={(row) => {
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
            render: (row) => (
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
      {!!error && onRetry && <Button onClick={onRetry}>重新读取</Button>}
    </Dialog>
  );
}
