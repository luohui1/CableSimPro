import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, message, optionalRecord, record, responseData, text } from "@/api/client";
import { methodCatalog } from "@/api/research";
import { CatalogShell, usePageTheme } from "@/components/catalog-shell";
import { preferences, savePreferences } from "@/lib/preferences";
import { illustration } from "@/lib/illustrations";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { StatusMark } from "@/components/status-mark";

type Backup = { id: string; sha256: string; size_bytes: number; created: string; download_url: string; schema_version: number };

/** 一个设置分区：左侧插画，右侧标题、说明与内容。 */
function Section({ art, title, lead, children }: { art: string; title: string; lead: string; children: ReactNode }) {
  const src = illustration("settings-" + art);
  return <section className="settings-section" aria-label={title}>
    <div className="settings-art">{src && <img src={src} alt="" />}</div>
    <div className="settings-body">
      <h2>{title}</h2>
      <p className="settings-lead">{lead}</p>
      {children}
    </div>
  </section>;
}

/** 设置：外观与单位（本机偏好）、计算位置（来自插件清单）、数据备份与恢复（宿主接口）、Agent 与计算书模板（未接入如实显示）。 */
export function SettingsPage() {
  const { theme, navigate } = usePageTheme();
  const queries = useQueryClient();
  const [reducedMotion, setReducedMotion] = useState(preferences().reducedMotion);
  const [restore, setRestore] = useState<Backup | null>(null);
  const health = useQuery({ queryKey: ["host-health"], queryFn: async ({ signal }) => record(await responseData(api.GET("/api/health", { signal })), "宿主状态") });
  const catalog = useQuery({ queryKey: ["method-catalog"], queryFn: ({ signal }) => methodCatalog(signal) });
  const backups = useQuery({ queryKey: ["database-backups"], queryFn: async ({ signal }) => (await responseData(api.GET("/api/database/backups", { signal }))) as unknown as Backup[] });
  const pending = useQuery({ queryKey: ["database-restore"], queryFn: async ({ signal }) => record(await responseData(api.GET("/api/database/restores/current", { signal })), "恢复状态") });
  const createBackup = useMutation({
    mutationFn: async () => responseData(api.POST("/api/database/backups", { body: { request_id: crypto.randomUUID() } })),
    onSuccess: () => queries.invalidateQueries({ queryKey: ["database-backups"] }),
  });
  const requestRestore = useMutation({
    mutationFn: async (backup: Backup) => responseData(api.POST("/api/database/restores", { body: { request_id: crypto.randomUUID(), backup_id: backup.id, sha256: backup.sha256, confirm_replace: true } })),
    onSuccess: () => { setRestore(null); void queries.invalidateQueries({ queryKey: ["database-restore"] }); },
  });

  const setTheme = (next: "light" | "dark") => {
    savePreferences({ theme: next, reducedMotion });
    void navigate({ to: "/settings", search: { theme: next }, replace: true });
  };
  const setMotion = (next: boolean) => { setReducedMotion(next); savePreferences({ theme, reducedMotion: next }); };
  const plugins = (catalog.data || []).map(optionalRecord);
  const onHpc = plugins.filter((p) => text(optionalRecord(p.execution_policy).backend) === "slurm");
  const local = plugins.filter((p) => text(optionalRecord(p.execution_policy).backend) !== "slurm");
  const restoreState = text(pending.data?.status);

  return (
    <CatalogShell title="设置" active="设置" status={<StatusMark kind="current" label="修改即时生效" />} actions={null}>
      <div className="settings-page" data-page="settings" data-state={health.isPending ? "loading" : health.error ? "error" : "success"}>
        <Section art="appearance" title="外观" lead="只影响这台电脑上的显示。">
          <div className="settings-row">
            <span>主题</span>
            <div className="segmented" role="radiogroup" aria-label="主题">
              {(["light", "dark"] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={theme === value} onClick={() => setTheme(value)}>{value === "light" ? "浅色" : "深色"}</button>)}
            </div>
          </div>
          <label className="settings-row"><span>减少动态</span><input type="checkbox" checked={reducedMotion} onChange={(event) => setMotion(event.target.checked)} /></label>
        </Section>

        <Section art="units" title="单位与数值" lead="保存与计算一律使用 SI；界面按物理量换算成工程单位显示，悬停可看完整精度。">
          <table className="data-table settings-units">
            <thead><tr><th>物理量</th><th>界面显示</th><th>保存（SI）</th></tr></thead>
            <tbody>
              {[["长度 · 尺寸", "mm / m", "m"], ["温度", "°C", "K"], ["电流", "A", "A"], ["热阻率", "K·m/W", "K·m/W"], ["损耗", "W/m", "W/m"], ["电阻", "Ω/km", "Ω/m"]].map(([q, ui, si]) => <tr key={q}><td>{q}</td><td>{ui}</td><td className="muted">{si}</td></tr>)}
            </tbody>
          </table>
        </Section>

        <Section art="compute" title="计算位置" lead="每个插件在清单里声明运行位置；本机插件在独立进程中运行，超算插件以 Slurm 作业提交。">
          <dl className="settings-facts">
            <div><dt>本机</dt><dd>{catalog.isPending ? "…" : `${local.length} 个插件`}</dd><dd className="muted">{local.map((p) => text(p.name)).join("、")}</dd></div>
            <div><dt>超算</dt><dd>{catalog.isPending ? "…" : `${onHpc.length} 个插件`}</dd><dd className="muted">{onHpc.map((p) => text(p.name)).join("、") || "—"}</dd></div>
          </dl>
        </Section>

        <Section art="data" title="数据备份" lead="备份包含整个工程数据库：原件、输入版本、运行结果与计算书。恢复会在下次启动时替换当前数据库，并先保留一份替换前的副本。">
          {restoreState === "pending_restart" && <p className="settings-banner" role="status">已安排恢复，重启宿主后生效。</p>}
          <div className="settings-actions">
            <Button size="compact" variant="primary" loading={createBackup.isPending} onClick={() => createBackup.mutate()}>立即备份</Button>
            {createBackup.error && <span className="field-error">{message(createBackup.error)}</span>}
          </div>
          {backups.isError ? <p className="field-error">{message(backups.error)}</p> : (backups.data || []).length ? (
            <table className="data-table">
              <thead><tr><th>时间</th><th className="numeric">大小</th><th>校验摘要</th><th /></tr></thead>
              <tbody>{[...(backups.data || [])].reverse().map((b) => <tr key={b.id}>
                <td>{new Date(b.created).toLocaleString("zh-CN")}</td>
                <td className="numeric">{(b.size_bytes / 1048576).toFixed(1)} MB</td>
                <td className="muted"><code>{b.sha256.slice(0, 12)}…</code></td>
                <td className="settings-row-actions"><a className="button button-ghost button-compact" href={b.download_url} download>下载</a><Button size="compact" variant="ghost" onClick={() => setRestore(b)}>恢复</Button></td>
              </tr>)}</tbody>
            </table>
          ) : <p className="muted">还没有备份。</p>}
        </Section>

        <Section art="model" title="Agent 模型" lead="Agent 通过与工作台相同的插件能力工作，只提出方案，批准由人完成。">
          <div className="settings-row"><span>连接状态</span><StatusMark kind="draft" label="未连接模型" /></div>
          <p className="muted">私有部署模型或云端模型的连接方式待定，确定后在这里配置地址与密钥。</p>
        </Section>

        <Section art="report" title="计算书模板" lead="计算书只从指定运行生成，包含输入、方法版本与插件封签。">
          <div className="settings-row"><span>当前模板</span><span>默认模板</span></div>
          <p className="muted">企业抬头与自定义模板尚未接入。</p>
        </Section>

        <section className="settings-about" aria-label="关于">
          <dl>
            <div><dt>宿主</dt><dd>{health.data?.status === "ok" ? "运行正常" : "状态待确认"} · {text(health.data?.version) || "版本未提供"}</dd></div>
            <div><dt>数据契约</dt><dd>{text(health.data?.model_version) || "—"}</dd></div>
            <div><dt>快捷键</dt><dd>Ctrl+B 侧栏 · Ctrl+S 保存 · Ctrl+Z / Ctrl+Shift+Z 撤销与重做</dd></div>
          </dl>
        </section>
      </div>
      <Dialog open={!!restore} onOpenChange={(open) => { if (!open) setRestore(null); }} title="恢复到这个备份？"
        description={restore ? `将在下次重启宿主时，用 ${new Date(restore.created).toLocaleString("zh-CN")} 的备份替换当前整个工程数据库。替换前会自动保留一份当前数据。` : undefined}
        actions={<><Button onClick={() => setRestore(null)}>取消</Button><Button variant="primary" loading={requestRestore.isPending} onClick={() => restore && requestRestore.mutate(restore)}>安排恢复</Button></>}>
        {requestRestore.error && <p className="field-error">{message(requestRestore.error)}</p>}
      </Dialog>
    </CatalogShell>
  );
}
