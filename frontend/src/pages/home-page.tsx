import { useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { studyIndex, studyRuns, typeIndex, workspaces, type StudyRow } from "@/api/research";
import { cableModels } from "@/api/documents";
import { message, optionalRecord, text } from "@/api/client";
import { AppShell } from "@/components/app-shell";
import { usePageTheme } from "@/components/catalog-shell";
import { CreateStudyDialog } from "@/components/create-study-dialog";
import { DataTable } from "@/components/data-table";
import { Icon } from "@/components/icon";
import { StatusMark, type StatusKind } from "@/components/status-mark";
import { ErrorState, InlineEmpty, LoadingState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { VersionNotice } from "@/components/version-notice";
import { rootModule, studyEntryTab } from "@/lib/study-config";
import { studyState } from "@/lib/study-state";
import { isVersionStale, versionReasons } from "@/lib/version-status";

const SIMULATION_MODULES = ["simulation", "electrothermal", "transient", "sheath-losses", "thermal-field", "batch"];
const short = (value: string) => value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

type Recent = { id: string; name: ReactNode; label: string; owner: string; mark: StatusKind; state: string; updated: string };

/**
 * 首页（FRONTEND_REQUIREMENTS §2.2，已定方案“工作入口”）：搜索、继续工作、需要处理、三个领域的新建入口。
 * 不放产品大图和统计大数字；“需要处理”是待办中心的摘要。
 */
export function HomePage() {
  const { theme, navigate } = usePageTheme();
  const [create, setCreate] = useState(false);
  const [q, setQ] = useState("");
  const studies = useQuery({ queryKey: ["study-index"], queryFn: ({ signal }) => studyIndex(signal) });
  const types = useQuery({ queryKey: ["type-index"], queryFn: ({ signal }) => typeIndex(signal) });
  const projects = useQuery({ queryKey: ["workspace-index"], queryFn: ({ signal }) => workspaces(signal) });
  const cables = useQuery({ queryKey: ["domain-cable-models"], queryFn: ({ signal }) => cableModels(signal) });
  const rows = studies.data || [];
  const runs = useQueries({ queries: rows.map((row) => ({
    queryKey: ["runs", row.workspace, row.id, "summary"],
    queryFn: ({ signal }: { signal: AbortSignal }) => studyRuns(row.workspace, row.id, signal, "summary"),
    enabled: !isVersionStale(row.raw),
  })) });
  const typeIds = new Set((types.data || []).map((row) => text(row.id)));
  const projectList = (projects.data || []).filter((row) => !typeIds.has(text(row.id)));
  const projectName = (wid: string) => text(projectList.find((row) => text(row.id) === wid)?.name) || "未命名工程";
  const states = rows.map((row, index) => ({ row, state: studyState(row, runs[index]?.data?.at(-1)), pending: !isVersionStale(row.raw) && runs[index]?.isPending }));
  const studyLink = (row: StudyRow, children: ReactNode) => {
    const module = rootModule(row.definition);
    return <Link className="object-link" to="/studies/$sid/$module/$tab" params={{ sid: row.id, module, tab: studyEntryTab(module) }} search={{ workspace: row.workspace, theme, run: "", delivery: "" }}>{children}</Link>;
  };

  const recent: Recent[] = [
    ...states.map(({ row, state, pending }) => ({ id: row.id, name: studyLink(row, row.title), label: row.title, owner: projectName(row.workspace), mark: pending ? "queued" as const : state.mark, state: pending ? "读取中" : state.label, updated: row.updated })),
    ...(types.data || []).map((row) => ({ id: text(row.id), label: text(row.name),
      name: <Link className="object-link" to="/types/$wid/$module/$tab" params={{ wid: text(row.id), module: "structure", tab: "section" }} search={{ theme }}>{text(row.name)}</Link>,
      owner: "型号设计", mark: "draft" as const, state: "设计草稿", updated: text(row.updated_at) })),
  ].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 6);

  const outdated = states.filter(({ state }) => state.code === "outdated");
  const notRun = states.filter(({ state, pending }) => !pending && state.code === "not_run");
  const missing = (cables.data || []).filter((row) => text(row.state) === "incomplete").length;

  const needle = q.trim().toLowerCase();
  const hit = (value: string) => value.toLowerCase().includes(needle);
  const found = needle ? [
    ...projectList.filter((row) => hit(text(row.name))).map((row) => ({ id: "p" + text(row.id), group: "工程", node: <Link className="object-link" to="/studies" search={{ theme, workspace: text(row.id) }}>{text(row.name)}</Link> })),
    ...rows.filter((row) => [row.title, row.task, row.model].some(hit)).map((row) => ({ id: "s" + row.id, group: "研究", node: studyLink(row, row.title) })),
    ...(types.data || []).filter((row) => hit(text(row.name))).map((row) => ({ id: "t" + text(row.id), group: "型号设计", node: <Link className="object-link" to="/types/$wid/$module/$tab" params={{ wid: text(row.id), module: "structure", tab: "section" }} search={{ theme }}>{text(row.name)}</Link> })),
    ...(cables.data || []).filter((row) => hit(text(optionalRecord(row.payload).name))).map((row) => ({ id: "c" + text(row.id), group: "电缆型号版本", node: <Link className="object-link" to="/resources/cables" search={{ theme }}>{text(optionalRecord(row.payload).name)}</Link> })),
  ] : [];
  const simulation = rows.filter((row) => SIMULATION_MODULES.includes(rootModule(row.definition))).length;

  return <>
    <AppShell title="首页" status={null} theme={theme} onUnavailable={() => {}}
      onTheme={() => void navigate({ to: "/", search: { theme: theme === "light" ? "dark" : "light" }, replace: true })}
      actions={<Button variant="primary" size="compact" onClick={() => setCreate(true)}>新建研究</Button>}>
      <div className="home-page" data-page="home">
        <label className="home-search">
          <Icon name="action/search" />
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="搜索工程、研究、型号设计或电缆型号版本" aria-label="搜索" />
        </label>
        {needle ? <section className="home-section" aria-label="搜索结果">
          {!found.length ? <InlineEmpty title="没有匹配的对象" /> : ["工程", "研究", "型号设计", "电缆型号版本"].map((group) => {
            const items = found.filter((item) => item.group === group).slice(0, 6);
            return items.length ? <div key={group} className="home-results"><h2>{group}</h2><ul>{items.map((item) => <li key={item.id}>{item.node}</li>)}</ul></div> : null;
          })}
        </section> : <>
          <div className="home-columns">
            <section className="home-section" aria-label="继续工作">
              <header><h2>继续工作</h2><Link to="/studies" search={{ theme }}>全部研究</Link></header>
              {studies.isPending ? <LoadingState title="正在读取最近的研究与型号" />
                : studies.isError ? <ErrorState description={message(studies.error)} action={<Button onClick={() => void studies.refetch()}>重新读取</Button>} />
                : !recent.length ? <InlineEmpty title="还没有研究或型号设计。" action={<Button size="compact" onClick={() => setCreate(true)}>新建研究</Button>} />
                : <DataTable<Recent> label="继续工作" showGroups={false} groups={[{ id: "recent", label: "最近", rows: recent }]} rowLabel={(row) => row.label}
                  columns={[
                    { id: "name", label: "名称", wrap: true, render: (row) => row.name },
                    { id: "owner", label: "所属", render: (row) => row.owner },
                    { id: "state", label: "状态", render: (row) => <StatusMark kind={row.mark} label={row.state} /> },
                    { id: "updated", label: "更新时间", render: (row) => short(row.updated) },
                  ]} />}
            </section>
            <section className="home-section" aria-label="需要处理">
              <header><h2>需要处理</h2></header>
              {studies.isPending ? <LoadingState title="正在汇总" />
                : !outdated.length && !notRun.length && !missing ? <InlineEmpty title="没有需要处理的事项。" />
                : <ul className="home-todo">
                  {outdated.map(({ row }) => <li key={row.id}>
                    <span className="home-todo-text">{studyLink(row, row.title)}<small>{versionReasons(row.raw)[0] || "输入已变化，现有结果是历史结果。"}</small></span>
                    {isVersionStale(row.raw)
                      ? <VersionNotice value={row.raw} target={{ wid: row.workspace, sid: row.id, revision: row.workspaceRevision, studyRevision: row.revision, title: row.title }} />
                      : <StatusMark kind="historical" label="已过期" />}
                  </li>)}
                  {notRun.map(({ row }) => <li key={row.id}>
                    <span className="home-todo-text">{studyLink(row, row.title)}<small>还没有运行</small></span>
                    <StatusMark kind="draft" label="未运行" />
                  </li>)}
                  {missing > 0 && <li>
                    <span className="home-todo-text"><Link className="object-link" to="/resources/cables" search={{ theme }}>{missing} 条厂家型号资料缺项</Link><small>缺项补齐并核对后，研究才能引用为完整型号</small></span>
                    <StatusMark kind="draft" label="资料缺项" />
                  </li>}
                </ul>}
            </section>
          </div>
          <nav className="home-domains" aria-label="新建">
            <div><Icon name="calc/ampacity" /><Link to="/studies" search={{ theme, kind: "ampacity" }}><b>载流量计算</b><span className="muted">{rows.length - simulation} 项研究</span></Link><Button size="compact" variant="ghost" onClick={() => setCreate(true)}>新建研究</Button></div>
            <div><Icon name="nav/cable-type" /><Link to="/types" search={{ theme }}><b>电缆设计</b><span className="muted">{types.data?.length ?? "—"} 个型号设计</span></Link><Button size="compact" variant="ghost" onClick={() => void navigate({ to: "/types", search: { theme } })}>新建型号</Button></div>
            <div><Icon name="calc/thermal-field" /><Link to="/studies" search={{ theme, kind: "simulation" }}><b>电缆仿真</b><span className="muted">{simulation} 项研究</span></Link><Button size="compact" variant="ghost" onClick={() => setCreate(true)}>新建研究</Button></div>
          </nav>
        </>}
      </div>
    </AppShell>
    <CreateStudyDialog open={create} onOpenChange={setCreate} theme={theme} />
  </>;
}
