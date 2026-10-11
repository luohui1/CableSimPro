import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  workspaces,
  studyIndex,
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
import { indexAll } from '@/api/object-index';
import { statusMark } from '@/components/object-link';
import { isVersionStale } from '@/lib/version-status';
import { formatDateTime } from '@/lib/format';
import { statusLabel, taskName } from '@/lib/status-vocabulary';

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
  // 研究状态一律取统一索引（与首页、工程页同一说法，过期带原因），不再逐个研究读取运行再自行推算
  const cards = useQuery({ queryKey: ["index-objects", "study", "all"], queryFn: ({ signal }) => indexAll("study", signal) });
  const stateOf = new Map((cards.data?.items || []).map((card) => [card.id, card.status]));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const catalog = useQuery({ queryKey: ["method-catalog"], queryFn: ({ signal }) => methodCatalog(signal) });
  const pluginNames = new Map((catalog.data || []).map((row) => [text(optionalRecord(row.method).plugin_id), text(row.name)]));
  const projects = useQuery({ queryKey: ["workspace-index"], queryFn: ({ signal }) => workspaces(signal) });
  const projectName = (wid: string) => text((projects.data || []).find((space) => text(space.id) === wid)?.name) || "未命名工程";
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
    { id: "task", label: "任务", render: (row) => taskName(row.definition, row.task) },
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
      label: "状态",
      render: (row) => {
        const state = stateOf.get(row.id);
        // 版本已变化的研究保留“重算”入口
        if (isVersionStale(row.raw)) return <VersionNotice value={row.raw} target={{ wid: row.workspace, sid: row.id, revision: row.workspaceRevision, studyRevision: row.revision, title: row.title }} />;
        if (!state) return cards.isError ? <StatusMark kind="unknown" label="状态读取失败" detail={message(cards.error)} /> : <StatusMark kind="queued" label="读取中" />;
        return <StatusMark kind={statusMark(state.code)} label={statusLabel(state.code, state.label)} detail={state.reason || undefined} />;
      },
    },
    {
      id: "updated",
      label: "更新时间",
      render: (row) =>
        formatDateTime(row.updated),
    },
  ];
  const matching = (studies.data || []).filter((row) =>
    (!search.workspace || row.workspace === search.workspace) && (search.kind !== "simulation" || SIMULATION_MODULES.includes(rootModule(row.definition))) && (search.kind !== "ampacity" || !SIMULATION_MODULES.includes(rootModule(row.definition))) && [row.title, row.task, row.model].some((value) =>
      value.toLowerCase().includes(filter.toLowerCase()),
    ),
  );
  const rank = (row: StudyRow) => ({ current: 0, running: 1, not_run: 2, failed: 3, outdated: 4 } as Record<string, number>)[stateOf.get(row.id)?.code || ""] ?? 2;
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
        title={search.kind === "simulation" ? "电缆仿真研究" : search.kind === "ampacity" ? "载流量研究" : "工程与研究"}
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
          {(
            <Toolbar label="研究检索">
              <label className="search-field">
                检索
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="名称、任务或型号"
                />
              </label>
              <span className="muted">{tableGroups.length} 个工程 · {rows.length} 项研究</span>
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
              rowClassName={(row) => stateOf.get(row.id)?.code === "outdated" ? "is-historical" : undefined}
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
