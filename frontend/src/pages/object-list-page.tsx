import { useEffect, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  workspaces,
  studyIndex,
  studyRuns,
  methodCatalog,
  type StudyRow,
} from "@/api/research";
import { message, optionalRecord, text } from "@/api/client";
import { AppShell } from "@/components/app-shell";
import { CreateStudyDialog } from "@/components/create-study-dialog";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { StatusMark } from "@/components/status-mark";
import {
  EmptyState,
  LoadingState,
  ErrorState,
  StaleBanner,
} from "@/components/states";
import { Toolbar } from "@/components/toolbar";
import { rootModule, studyEntryTab } from "@/lib/study-config";
import { VersionNotice } from '@/components/version-notice';
import { isVersionStale } from '@/lib/version-status';

const SIMULATION_MODULES = ["simulation", "electrothermal", "transient", "sheath-losses", "thermal-field", "batch"];

/** 研究列表（目录页）：全部研究按所属工程分组。首页在 home-page.tsx。 */
export function ObjectListPage() {
  const search = useSearch({ strict: false });
  const theme = search.theme === "dark" ? "dark" : "light";
  const navigate = useNavigate();
  const [create, setCreate] = useState(false);
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("");
  const studies = useQuery({
    queryKey: ["study-index"],
    queryFn: ({ signal }) => studyIndex(signal),
  });
  const runQueries = useQueries({
    queries: (studies.data || []).map((row) => ({
      queryKey: ["runs", row.workspace, row.id, "summary"],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        studyRuns(row.workspace, row.id, signal, "summary"),
      enabled: !isVersionStale(row.raw),
    })),
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const catalog = useQuery({ queryKey: ["method-catalog"], queryFn: ({ signal }) => methodCatalog(signal) });
  const pluginNames = new Map((catalog.data || []).map((row) => [text(optionalRecord(row.method).plugin_id), text(row.name)]));
  const projects = useQuery({ queryKey: ["workspace-index"], queryFn: ({ signal }) => workspaces(signal) });
  const projectName = (wid: string) => text((projects.data || []).find((space) => text(space.id) === wid)?.name) || "未命名工程";
  const statuses = new Map(
    (studies.data || []).map((row, index) => [row.id, runQueries[index]]),
  );
  const columns: Column<StudyRow>[] = [
    {
      id: "name",
      label: "研究名称",
      wrap: true,
      render: (row) => (
        <Link
          className="object-link"
          to="/studies/$sid/$module/$tab"
          params={{
            sid: row.id,
            module: rootModule(row.definition),
            tab: studyEntryTab(rootModule(row.definition)),
          }}
          search={{ workspace: row.workspace, theme, run: "", delivery: "" }}
        >
          {row.title}
        </Link>
      ),
    },
    { id: "task", label: "任务", render: (row) => row.task },
    { id: "model", label: "引用型号", wrap: true, render: (row) => row.model },
    {
      id: "method",
      label: "方法",
      // 插件名以已安装插件清单为准；插件未安装时用研究里保存的身份
      render: (row) => {
        const name = pluginNames.get(text(row.definition.method?.plugin_id));
        return name ? `${name} ${text(row.definition.method?.version)}` : row.method.replace("cablesim.", "");
      },
    },
    {
      id: "state",
      label: "最近运行",
      render: (row) => {
        const query = statuses.get(row.id);
        if (isVersionStale(row.raw)) return <VersionNotice value={row.raw} target={{ wid: row.workspace, sid: row.id, revision: row.workspaceRevision, studyRevision: row.revision, title: row.title }} />;
        if (query?.isPending)
          return <StatusMark kind="queued" label={query.fetchStatus === 'paused' ? '等待网络连接' : '读取中'} />;
        if (query?.isError)
          return (
            <span className="status-actions"><span className="field-error">{message(query.error)}</span><Button size="compact" variant="ghost" onClick={() => void query.refetch()}>重试</Button></span>
          );
        const latest = query?.data?.at(-1);
        if (isVersionStale(row.raw) || isVersionStale(latest)) return <VersionNotice value={isVersionStale(row.raw) ? row.raw : latest} target={{ wid: row.workspace, sid: row.id, revision: row.workspaceRevision, studyRevision: row.revision, title: row.title }} />;
        return latest ? (
          <StatusMark
            kind={
              latest.freshness === "historical"
                ? "historical"
                : ["accepted", "running", "validating"].includes(
                      text(latest.status),
                    )
                  ? "running"
                  : ["succeeded", "partial"].includes(text(latest.status))
                    ? "current"
                    : "error"
            }
            label={
              latest.freshness === "historical"
                ? "历史"
                : text(latest.status) === "partial"
                  ? "部分成功"
                  : text(latest.status) === "succeeded"
                    ? "成功"
                    : ["accepted", "running", "validating"].includes(
                          text(latest.status),
                        )
                      ? "执行中"
                      : "失败"
            }
          />
        ) : (
          <StatusMark kind="draft" label="未运行" />
        );
      },
    },
    {
      id: "updated",
      label: "更新时间",
      render: (row) =>
        new Date(row.updated).toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }),
    },
  ];
  const matching = (studies.data || []).filter((row) =>
    (!search.workspace || row.workspace === search.workspace) && (search.kind !== "simulation" || SIMULATION_MODULES.includes(rootModule(row.definition))) && (search.kind !== "ampacity" || !SIMULATION_MODULES.includes(rootModule(row.definition))) && [row.title, row.task, row.model].some((value) =>
      value.toLowerCase().includes(filter.toLowerCase()),
    ),
  );
  const rank = (row: StudyRow) => {
    const latest = statuses.get(row.id)?.data?.at(-1);
    return latest?.freshness === "current" &&
      latest.integrity === "verified" &&
      ["succeeded", "partial"].includes(text(latest.status))
      ? 0
      : latest?.freshness === "historical"
        ? 2
        : 1;
  };
  matching.sort(
    (a, b) => rank(a) - rank(b) || b.updated.localeCompare(a.updated),
  );
  const rows = matching;
  // 全部研究按所属工程分组（工程 → 研究）
  const tableGroups = [...new Set(rows.map((row) => row.workspace))].map((wid) => ({ id: wid, label: projectName(wid), rows: rows.filter((row) => row.workspace === wid) }));
  function global(label: string) {
    if (label === "首页") navigate({ to: "/", search: { theme } });
    else if (label === "研究") navigate({ to: "/studies", search: { theme } });
    else if (label === "型号")
      navigate({ to: "/types", search: { theme } });
    else setNotice(`${label}即将迁移`);
  }
  return (
    <>
      <AppShell
        title={search.kind === "simulation" ? "电缆仿真研究" : "研究"}
        status={
          (studies.isError || studies.isFetching) && <StatusMark
            kind={
              studies.isError && studies.data
                ? "historical"
                : studies.isError
                  ? "error"
                  : studies.isFetching
                    ? "running"
                    : "current"
            }
            label={
              studies.isError && studies.data
                ? "上次列表"
                : studies.isError
                  ? "读取失败"
                  : studies.isFetching
                    ? "读取中"
                    : ""
            }
            detail={
              studies.isError
                ? message(studies.error)
                : "对象来自正式宿主，按更新时间排列。"
            }
          />
        }
        actions={
          <>
            <Button
              size="compact"
              onClick={() => {
                studies.refetch();
              }}
            >
              刷新
            </Button>
            <Button
              variant="primary"
              size="compact"
              onClick={() => setCreate(true)}
            >
              新建研究
            </Button>
          </>
        }
        activeNavigation="研究"
        onGlobalNavigate={global}
        onUnavailable={setNotice}
        theme={theme}
        onTheme={() =>
          navigate({
            to: "/studies",
            search: { theme: theme === "light" ? "dark" : "light" },
            replace: true,
          })
        }
      >
        {studies.isError && studies.data && (
          <StaleBanner description="连接中断，保留上次读取的列表。" />
        )}
        <section className="object-section">
          <header>
            <h2>研究列表</h2>
          </header>
          {(
            <Toolbar label="研究检索">
              <label className="search-field">
                筛选研究
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="名称、任务或型号"
                />
              </label>
              <span className="muted">{rows.length} 项</span>
            </Toolbar>
          )}
          {studies.isPending ? (
            <LoadingState title="正在读取研究" />
          ) : studies.isError && !studies.data ? (
            <ErrorState
              description={message(studies.error)}
              action={
                <Button onClick={() => studies.refetch()}>重新读取</Button>
              }
            />
          ) : rows.length ? (
            <DataTable
              label="研究列表"
              columns={columns}
              groups={tableGroups}
              rowLabel={(row) => row.title}
              showGroups={tableGroups.length > 1}
              rowClassName={(row) =>
                statuses.get(row.id)?.data?.at(-1)?.freshness === "historical"
                  ? "is-historical"
                  : undefined
              }
            />
          ) : (
            <EmptyState
              title={filter ? "没有匹配研究" : "尚无研究"}
              description={
                filter ? "调整筛选条件。" : "选择任务和型号版本后建立研究。"
              }
            />
          )}
        </section>
      </AppShell>
      <CreateStudyDialog open={create} onOpenChange={setCreate} theme={theme} />
      <Dialog
        open={!!notice}
        onOpenChange={(open) => {
          if (!open) setNotice("");
        }}
        title={notice}
        description="该入口将在后续迁移中接入。"
      />
    </>
  );
}
