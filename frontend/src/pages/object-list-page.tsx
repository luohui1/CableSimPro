import { useEffect, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  workspaces,
  studyIndex,
  studyRuns,
  typeIndex,
  type StudyRow,
} from "@/api/research";
import { message, text } from "@/api/client";
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
import { Icon } from "@/components/icon";
import { illustration } from "@/lib/illustrations";
import { rootModule, studyEntryTab } from "@/lib/study-config";
import { VersionNotice } from '@/components/version-notice';
import { isVersionStale } from '@/lib/version-status';

const SIMULATION_MODULES = ["simulation", "electrothermal", "transient", "sheath-losses", "thermal-field", "batch"];

/** 首页三个核心领域入口：数字全部来自宿主列表，读不到时显示“—”。 */
function HomeAreas({ theme, studies, types, succeeded }: { theme: "light" | "dark"; studies: StudyRow[]; types?: number; succeeded: number }) {
  const simulation = studies.filter((row) => SIMULATION_MODULES.includes(rootModule(row.definition))).length;
  const areas = [
    { id: "ampacity", icon: "calc/ampacity", title: "载流量计算", copy: "IEC 60287 选型、参数扫描与方法对比", count: studies.length - simulation, unit: "个研究", to: "/studies" as const, search: { theme, kind: "ampacity" } },
    { id: "design", icon: "nav/cable-type", title: "电缆设计", copy: "结构、标准核对、电气参数与规格书", count: types, unit: "个型号", to: "/types" as const, search: { theme } },
    { id: "simulation", icon: "calc/thermal-field", title: "电缆仿真", copy: "有限元温度场、电热耦合与论文复现", count: simulation, unit: "个研究", to: "/studies" as const, search: { theme, kind: "simulation" } },
  ];
  return (
    <section className="home-hero" aria-label="工作台概况">
      <div className="home-banner">
        <div className="home-greeting">
          <h2>电缆设计与计算工作台</h2>
          <p>载流量计算、电缆设计与电缆仿真都由插件完成；每个结果都能追溯到输入、方法和版本。</p>
          <dl className="home-stats">
            <div><dt>研究</dt><dd>{studies.length}</dd></div>
            <div><dt>已有结果</dt><dd>{succeeded}</dd></div>
            <div><dt>型号</dt><dd>{types ?? "—"}</dd></div>
          </dl>
        </div>
        {illustration("cable-section-hero") && <img className="home-banner-art" src={illustration("cable-section-hero")} alt="三芯电缆截面" />}
      </div>
      <div className="home-areas">
        {areas.map((area) => (
          <Link key={area.id} className="home-area" to={area.to} search={area.search}>
            <span className="home-area-icon"><Icon name={area.icon} /></span>
            <strong>{area.title}</strong>
            <span className="muted">{area.copy}</span>
            <span className="home-area-count"><b>{area.count ?? "—"}</b> {area.unit}<Icon name="action/arrow-right" /></span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function ObjectListPage({ home = false }: { home?: boolean }) {
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
  const types = useQuery({
    queryKey: ["type-index"],
    queryFn: ({ signal }) => typeIndex(signal),
    enabled: home,
  });
  const runQueries = useQueries({
    queries: (studies.data || []).map((row) => ({
      queryKey: ["runs", row.workspace, row.id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        studyRuns(row.workspace, row.id, signal),
      enabled: !isVersionStale(row.raw),
    })),
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const projects = useQuery({ queryKey: ["workspace-index"], queryFn: ({ signal }) => workspaces(signal) });
  const projectTitle = search.workspace ? text((projects.data || []).find((space) => text(space.id) === search.workspace)?.name) : "";
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
      render: (row) => row.method.replace("cablesim.", ""),
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
    (!search.workspace || row.workspace === search.workspace) && (search.kind !== "simulation" || ['simulation','electrothermal','transient','sheath-losses','thermal-field','batch'].includes(rootModule(row.definition))) && (search.kind !== 'ampacity' || !['simulation','electrothermal','transient','sheath-losses','thermal-field','batch'].includes(rootModule(row.definition))) && [row.title, row.task, row.model].some((value) =>
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
  const rows = home ? matching.slice(0, 6) : matching;
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
        title={home ? "首页" : projectTitle || (search.kind === "simulation" ? "电缆仿真研究" : "研究")}
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
                if (home) types.refetch();
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
        activeNavigation={home ? "首页" : "研究"}
        onGlobalNavigate={global}
        onUnavailable={setNotice}
        theme={theme}
        onTheme={() =>
          navigate({
            to: home ? "/" : "/studies",
            search: { theme: theme === "light" ? "dark" : "light" },
            replace: true,
          })
        }
      >
        {home && <HomeAreas theme={theme} studies={studies.data || []} types={types.data?.length} succeeded={(studies.data || []).filter((row) => ["succeeded", "partial"].includes(text(statuses.get(row.id)?.data?.at(-1)?.status))).length} />}
        {studies.isError && studies.data && (
          <StaleBanner description="连接中断，保留上次读取的列表。" />
        )}
        <section className="object-section">
          <header>
            <h2>{home ? "最近研究" : "研究列表"}</h2>
            {home && (
              <Link to="/studies" search={{ theme }}>
                查看全部
              </Link>
            )}
          </header>
          {!home && (
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
              label={home ? "最近研究" : "研究列表"}
              columns={columns}
              groups={[{ id: "studies", label: "研究", rows }]}
              rowLabel={(row) => row.title}
              showGroups={false}
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
        {home && (
          <section className="object-section">
            <header>
              <h2>最近型号</h2>
              <Link to="/types" search={{ theme }}>
                打开型号工作区
              </Link>
            </header>
            {types.isPending ? (
              <LoadingState title="正在读取最近型号" />
            ) : types.isError ? (
              <ErrorState
                description={message(types.error)}
                action={
                  <Button onClick={() => types.refetch()}>重新读取</Button>
                }
              />
            ) : types.data.length ? (
              <DataTable<Record<string, unknown> & { id: string }>
                label="最近型号"
                columns={[
                  {
                    id: "name",
                    label: "型号",
                    render: (row) => (
                      <Link
                        className="object-link"
                        to="/types/$wid/$module/$tab" params={{ wid: text(row.id), module: "structure", tab: "section" }} search={{ theme }}
                      >
                        {text(row.name)}
                      </Link>
                    ),
                  },
                  {
                    id: "version",
                    label: "版本",
                    render: (row) =>
                      text(row.origin_version) || String(row.revision),
                  },
                  {
                    id: "updated",
                    label: "更新时间",
                    render: (row) => new Date(text(row.updated_at)).toLocaleString("zh-CN", {
                      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
                    }),
                  },
                ]}
                groups={[
                  {
                    id: "types",
                    label: "型号",
                    rows: types.data
                      .map((row) => ({ ...row, id: text(row.id) }))
                      .slice(0, 6),
                  },
                ]}
                rowLabel={(row) => text(row.name)}
                showGroups={false}
              />
            ) : (
              <EmptyState
                title="尚无型号工作区"
                description="选择型号入口创建或打开型号。"
              />
            )}
          </section>
        )}
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
