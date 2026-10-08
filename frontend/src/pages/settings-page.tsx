import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, message, optionalRecord, record, responseData, text } from "@/api/client";
import { methodCatalog } from "@/api/research";
import { CatalogShell, usePageTheme } from "@/components/catalog-shell";
import { preferences, savePreferences } from "@/lib/preferences";
import { illustration } from "@/lib/illustrations";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { StatusMark } from "@/components/status-mark";
import { HpcJobList } from "@/features/field/hpc-job-list";
import { agentSettings, agentStatus, resetAgentSettings, saveAgentSettings, testAgentSettings, type AgentProbe, type AgentSettings } from "@/features/agent/agent-api";

type Backup = { id: string; sha256: string; size_bytes: number; created: string; download_url: string; schema_version: number };

const SECTIONS = [
  { id: "general", title: "常规", icon: "nav/theme", lead: "显示偏好只影响这台电脑；保存与计算一律使用 SI。" },
  { id: "ai", title: "AI 模型", icon: "agent/agent", lead: "Agent 用哪家模型、怎么说话。它只能提出方案，批准仍由人完成。" },
  { id: "compute", title: "计算位置", icon: "nav/simulation", lead: "每个插件在清单里声明运行位置：本机插件在独立进程中运行，超算插件以 Slurm 作业提交。" },
  { id: "data", title: "数据与备份", icon: "object/file", lead: "备份包含整个工程数据库：原件、输入版本、运行结果与计算书。" },
  { id: "report", title: "计算书", icon: "result/report", lead: "计算书只从指定运行生成，包含输入、方法版本与插件封签。" },
  { id: "about", title: "关于", icon: "status/info", lead: "宿主版本、数据契约与快捷键。" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

/** OpenAI 兼容服务的常用地址；只是代填，模型名可改。Agent 需要模型支持函数调用。 */
const PRESETS = [
  { key: "deepseek", name: "DeepSeek", base: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { key: "qwen", name: "通义千问", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { key: "glm", name: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-plus" },
  { key: "kimi", name: "Kimi", base: "https://api.moonshot.cn/v1", model: "moonshot-v1-32k" },
  { key: "ollama", name: "本机 Ollama", base: "http://127.0.0.1:11434/v1", model: "" },
];
const INSTRUCTIONS_LIMIT = 2000;
const SOURCE: Record<AgentSettings["source"], string> = { settings: "本页设置", environment: "宿主环境变量", none: "未配置" };
const KEY_PLACE: Record<string, string> = { system: "系统凭据库（Windows 凭据管理器 / 钥匙串）", memory: "本次运行的内存里（这台机器没有可用的系统凭据库，重启宿主后要重新填写）", environment: "宿主环境变量" };

function SectionHead({ id }: { id: SectionId }) {
  const section = SECTIONS.find((item) => item.id === id)!;
  const art = illustration("settings-" + ({ general: "appearance", ai: "model", compute: "compute", data: "data", report: "report", about: "units" } as const)[id]);
  return <header className="settings-head">
    <div><h2>{section.title}</h2><p>{section.lead}</p></div>
    {art && <img src={art} alt="" />}
  </header>;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="settings-row"><div className="settings-row-label"><span>{label}</span>{hint && <small>{hint}</small>}</div><div className="settings-row-control">{children}</div></div>;
}

/** AI 模型：连接（预设 · 地址 · 模型 · 密钥 · 测试）、自定义指令、超时。密钥只写不读。 */
function AiSettings() {
  const queries = useQueryClient();
  const settings = useQuery({ queryKey: ["agent-settings"], queryFn: ({ signal }) => agentSettings(signal), retry: false });
  const status = useQuery({ queryKey: ["agent-status"], queryFn: ({ signal }) => agentStatus(signal), retry: false, staleTime: 60_000 });
  const [form, setForm] = useState({ base_url: "", model: "", key: "", instructions: "", timeout: "" });
  const [clearKey, setClearKey] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [probe, setProbe] = useState<AgentProbe | null>(null);
  useEffect(() => {
    if (!settings.data || loaded) return;
    setForm({ base_url: settings.data.base_url, model: settings.data.model, key: "", instructions: settings.data.instructions, timeout: settings.data.model_timeout_s ? String(settings.data.model_timeout_s) : "" });
    setLoaded(true);
  }, [settings.data, loaded]);
  const set = (name: keyof typeof form) => (value: string) => { setForm((current) => ({ ...current, [name]: value })); setProbe(null); };
  const refresh = (data: AgentSettings) => {
    queries.setQueryData(["agent-settings"], data);
    void queries.invalidateQueries({ queryKey: ["agent-status"] });
    setForm((current) => ({ ...current, key: "" })); setClearKey(false);
  };
  const timeout = form.timeout.trim() ? Number(form.timeout) : null;
  const save = useMutation({
    mutationFn: () => saveAgentSettings({ base_url: form.base_url.trim(), model: form.model.trim(), instructions: form.instructions, model_timeout_s: timeout,
      ...(form.key.trim() ? { api_key: form.key.trim() } : clearKey ? { api_key: "" } : {}) }),
    onSuccess: refresh,
  });
  const reset = useMutation({ mutationFn: resetAgentSettings, onSuccess: (data) => { refresh(data); setForm({ base_url: data.base_url, model: data.model, key: "", instructions: "", timeout: "" }); } });
  const test = useMutation({ mutationFn: () => testAgentSettings({ base_url: form.base_url.trim(), model: form.model.trim(), ...(form.key.trim() ? { api_key: form.key.trim() } : {}) }), onSuccess: setProbe });
  const data = settings.data;
  const preset = PRESETS.find((item) => item.base === form.base_url.trim());
  const dirty = !!data && (form.base_url !== data.base_url || form.model !== data.model || !!form.key.trim() || clearKey || form.instructions !== data.instructions || form.timeout !== (data.model_timeout_s ? String(data.model_timeout_s) : ""));
  // 环境变量的密钥只在地址不变时沿用
  const keyNeeded = !!data && data.key_source === "environment" && form.base_url.trim().replace(/\/$/, "") !== data.base_url.replace(/\/$/, "") && !form.key.trim();
  const timeoutInvalid = timeout !== null && (!Number.isInteger(timeout) || timeout < 10 || timeout > 180);

  if (settings.isPending) return <p className="muted">正在读取模型设置</p>;
  if (settings.isError || !data) return <p className="field-error">模型设置读取失败：{message(settings.error)}</p>;
  return <div className="settings-ai">
    <div className={`settings-connection ${data.configured ? "is-ok" : ""}`}>
      <span className={`status-dot ${data.configured ? "is-ok" : "is-off"}`} />
      <div>
        <b>{data.configured ? `已配置 · ${data.model}` : "模型未配置"}</b>
        <span>{data.configured ? `来自${SOURCE[data.source]}${data.key_hint ? ` · 密钥 ${data.key_hint}` : ""}` : "填写服务地址、模型名与密钥后保存；也可以由宿主的 CABLESIM_LLM_* 环境变量提供。"}</span>
      </div>
      {status.data?.tools ? <span className="settings-connection-tools">可调用 {status.data.tools} 个工具</span> : null}
    </div>

    <FieldGroup className="settings-form">
      <Field>
        <FieldLabel>服务商</FieldLabel>
        <ToggleGroup type="single" value={preset?.key || "custom"} className="settings-presets" aria-label="服务商"
          onValueChange={(value) => {
            if (!value) return;
            const item = PRESETS.find((entry) => entry.key === value);
            setForm((current) => item ? { ...current, base_url: item.base, model: item.model || current.model } : { ...current, base_url: preset ? "" : current.base_url });
            setProbe(null);
          }}>
          {PRESETS.map((item) => <ToggleGroupItem key={item.key} value={item.key}>{item.name}</ToggleGroupItem>)}
          <ToggleGroupItem value="custom">其他兼容服务</ToggleGroupItem>
        </ToggleGroup>
        <FieldDescription>任何 OpenAI 兼容（/chat/completions）且支持函数调用的服务都可以；预设只代填地址。</FieldDescription>
      </Field>
      <div className="settings-form-pair">
        <Field>
          <FieldLabel htmlFor="ai-base">服务地址</FieldLabel>
          <Input id="ai-base" value={form.base_url} onChange={(event) => set("base_url")(event.target.value)} placeholder="https://api.example.com/v1" spellCheck={false} autoComplete="off" />
        </Field>
        <Field>
          <FieldLabel htmlFor="ai-model">模型名</FieldLabel>
          <Input id="ai-model" value={form.model} onChange={(event) => set("model")(event.target.value)} placeholder="例如 deepseek-chat" spellCheck={false} autoComplete="off" />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="ai-key">API 密钥</FieldLabel>
        <Input id="ai-key" type="password" value={form.key} onChange={(event) => { set("key")(event.target.value); setClearKey(false); }} autoComplete="new-password" spellCheck={false}
          placeholder={clearKey ? "保存后清除已保存的密钥" : !data.has_key || keyNeeded ? "sk-…" : data.key_source === "environment" ? `沿用环境变量里的密钥 ${data.key_hint || ""}，留空表示不修改` : `已保存 ${data.key_hint || ""}，留空表示不修改`} />
        {keyNeeded && <FieldError>换了服务地址，环境变量里的密钥不会带过去，请填写这家服务的密钥。</FieldError>}
        <FieldDescription>
          密钥只送到宿主，存放在{KEY_PLACE[data.key_storage]}；不写入数据库、文件与日志，页面也读不回来。{data.key_source === "environment" && " 当前密钥来自宿主环境变量。"}
          {data.has_key && data.key_source !== "environment" && !clearKey && <> <button type="button" className="settings-link" onClick={() => { setClearKey(true); setForm((current) => ({ ...current, key: "" })); }}>清除已保存的密钥</button></>}
        </FieldDescription>
      </Field>
      <div className="settings-test">
        <Button size="compact" loading={test.isPending} disabled={!form.base_url.trim() || !form.model.trim()} onClick={() => test.mutate()}><Icon name="run/preflight" />测试连接</Button>
        {probe && <span className={probe.ok ? "settings-test-ok" : "settings-test-fail"} role="status">
          <Icon name={probe.ok ? "agent/approve" : "status/warning"} />
          {probe.ok ? `连接正常 · ${probe.model} · ${probe.latency_ms} ms` : probe.message}
        </span>}
        {test.error && <span className="settings-test-fail">{message(test.error)}</span>}
      </div>

      <Field>
        <FieldLabel htmlFor="ai-instructions">自定义指令</FieldLabel>
        <Textarea id="ai-instructions" value={form.instructions} maxLength={INSTRUCTIONS_LIMIT} rows={4} onChange={(event) => set("instructions")(event.target.value)}
          placeholder="例如：先用一句话给结论；温度用 °C；回路按“回路 1、回路 2”称呼；结论后列出需要人工核对的输入。" />
        <FieldDescription>每次对话都会带上。只影响表达方式和关注点，不能放宽权限、数值核验或批准规则。{form.instructions.length > 0 && `（${form.instructions.length} / ${INSTRUCTIONS_LIMIT}）`}</FieldDescription>
      </Field>
      <Field className="settings-timeout">
        <FieldLabel htmlFor="ai-timeout">单次模型请求超时</FieldLabel>
        <div className="settings-inline"><Input id="ai-timeout" type="number" min={10} max={180} step={1} value={form.timeout} placeholder="30" aria-invalid={timeoutInvalid}
          onChange={(event) => set("timeout")(event.target.value)} /><span>秒</span></div>
        {timeoutInvalid ? <FieldError>取 10–180 之间的整数秒。</FieldError> : <FieldDescription>网络慢或模型较大时调高；新建任务起生效。留空用默认 30 秒。</FieldDescription>}
      </Field>
    </FieldGroup>

    <div className="settings-actions">
      <Button variant="primary" loading={save.isPending} disabled={!dirty || timeoutInvalid || !form.base_url.trim() || !form.model.trim()} onClick={() => save.mutate()}>保存</Button>
      {dirty && <Button variant="ghost" onClick={() => { setLoaded(false); setProbe(null); setClearKey(false); }}>放弃修改</Button>}
      {data.source === "settings" && <Button variant="ghost" loading={reset.isPending} onClick={() => reset.mutate()}>{data.environment.api_key ? "改回环境变量配置" : "清除本页设置"}</Button>}
      {(save.error || reset.error) && <span className="field-error">{message(save.error || reset.error)}</span>}
      {save.isSuccess && !dirty && <span className="muted" role="status">已保存，下一条消息起生效。</span>}
    </div>
  </div>;
}

/** 设置：左侧分类，右侧当前分类的内容；分类写在地址里，可以直接链接到“AI 模型”。 */
export function SettingsPage() {
  const { theme, search, navigate } = usePageTheme();
  const queries = useQueryClient();
  const current: SectionId = SECTIONS.some((item) => item.id === search.section) ? (search.section as SectionId) : "general";
  const [reducedMotion, setReducedMotion] = useState(preferences().reducedMotion);
  const [restore, setRestore] = useState<Backup | null>(null);
  const health = useQuery({ queryKey: ["host-health"], queryFn: async ({ signal }) => record(await responseData(api.GET("/api/health", { signal })), "宿主状态") });
  const catalog = useQuery({ queryKey: ["method-catalog"], queryFn: ({ signal }) => methodCatalog(signal) });
  const backups = useQuery({ queryKey: ["database-backups"], queryFn: async ({ signal }) => (await responseData(api.GET("/api/database/backups", { signal }))) as unknown as Backup[], enabled: current === "data" });
  const pending = useQuery({ queryKey: ["database-restore"], queryFn: async ({ signal }) => record(await responseData(api.GET("/api/database/restores/current", { signal })), "恢复状态"), enabled: current === "data" });
  const createBackup = useMutation({
    mutationFn: async () => responseData(api.POST("/api/database/backups", { body: { request_id: crypto.randomUUID() } })),
    onSuccess: () => queries.invalidateQueries({ queryKey: ["database-backups"] }),
  });
  const requestRestore = useMutation({
    mutationFn: async (backup: Backup) => responseData(api.POST("/api/database/restores", { body: { request_id: crypto.randomUUID(), backup_id: backup.id, sha256: backup.sha256, confirm_replace: true } })),
    onSuccess: () => { setRestore(null); void queries.invalidateQueries({ queryKey: ["database-restore"] }); },
  });

  const go = (section: SectionId) => void navigate({ to: "/settings", search: { theme, section }, replace: true });
  const setTheme = (next: "light" | "dark") => {
    savePreferences({ theme: next, reducedMotion });
    void navigate({ to: "/settings", search: { theme: next, section: current }, replace: true });
  };
  const setMotion = (next: boolean) => { setReducedMotion(next); savePreferences({ theme, reducedMotion: next }); };
  const plugins = (catalog.data || []).map(optionalRecord);
  const groups = [
    { key: "local", title: "本机", note: "独立进程，随宿主运行", rows: plugins.filter((p) => text(optionalRecord(p.execution_policy).backend) !== "slurm") },
    { key: "hpc", title: "超算", note: "以 Slurm 作业提交，需人工确认", rows: plugins.filter((p) => text(optionalRecord(p.execution_policy).backend) === "slurm") },
  ];
  const restoreState = text(pending.data?.status);

  return (
    <CatalogShell title="设置" active="设置" status={<StatusMark kind="current" label="修改即时生效" />} actions={null}>
      <div className="settings-page" data-page="settings" data-state={health.isPending ? "loading" : health.error ? "error" : "success"}>
        <nav className="settings-nav" aria-label="设置分类">
          {SECTIONS.map((item) => <button key={item.id} type="button" aria-current={item.id === current ? "page" : undefined} onClick={() => go(item.id)}>
            <Icon name={item.icon} />{item.title}
          </button>)}
        </nav>
        <section className="settings-content" aria-label={SECTIONS.find((item) => item.id === current)!.title}>
          <SectionHead id={current} />
          {current === "general" && <>
            <div className="settings-card">
              <Row label="主题" hint="浅色或深色，图表与温度场配色随之切换">
                <ToggleGroup type="single" value={theme} onValueChange={(value) => value && setTheme(value as "light" | "dark")} aria-label="主题" className="settings-segmented">
                  <ToggleGroupItem value="light">浅色</ToggleGroupItem><ToggleGroupItem value="dark">深色</ToggleGroupItem>
                </ToggleGroup>
              </Row>
              <Row label="减少动态" hint="关闭过渡与数值滚动动画"><Switch checked={reducedMotion} onCheckedChange={setMotion} aria-label="减少动态" /></Row>
            </div>
            <h3 className="settings-subhead">单位与数值</h3>
            <p className="muted">保存与计算一律使用 SI；界面按物理量换算成工程单位显示，悬停可看完整精度。</p>
            <table className="data-table settings-units">
              <thead><tr><th>物理量</th><th>界面显示</th><th>保存（SI）</th></tr></thead>
              <tbody>
                {[["长度 · 尺寸", "mm / m", "m"], ["温度", "°C", "K"], ["电流", "A", "A"], ["热阻率", "K·m/W", "K·m/W"], ["损耗", "W/m", "W/m"], ["电阻", "Ω/km", "Ω/m"]].map(([q, ui, si]) => <tr key={q}><td>{q}</td><td>{ui}</td><td className="muted">{si}</td></tr>)}
              </tbody>
            </table>
          </>}
          {current === "ai" && <AiSettings />}
          {current === "compute" && <div className="settings-compute">
            {groups.map((group) => <div key={group.key} className="settings-card">
              <div className="settings-card-head"><b>{group.title}</b><span>{catalog.isPending ? "…" : `${group.rows.length} 个插件`}</span><small>{group.note}</small></div>
              <ul className="settings-plugins">{group.rows.map((p) => <li key={text(optionalRecord(p.method).plugin_id) || text(p.name)}>
                <span>{text(p.name)}</span><small>{text(optionalRecord(p.method).version) || text(p.version)}</small>
              </li>)}{!catalog.isPending && !group.rows.length && <li className="muted">没有插件</li>}</ul>
            </div>)}
          </div>}
          {current === "compute" && <HpcJobList />}
          {current === "data" && <>
            {restoreState === "pending_restart" && <p className="settings-banner" role="status">已安排恢复，重启宿主后生效。</p>}
            <div className="settings-actions">
              <Button variant="primary" loading={createBackup.isPending} onClick={() => createBackup.mutate()}><Icon name="action/save" />立即备份</Button>
              <span className="muted">恢复会在下次启动时替换当前数据库，并先保留一份替换前的副本。</span>
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
            ) : <p className="muted">{backups.isPending ? "正在读取备份" : "还没有备份。"}</p>}
          </>}
          {current === "report" && <div className="settings-card">
            <Row label="当前模板" hint="封面、输入、方法与插件封签、结论">默认模板</Row>
            <Row label="企业抬头" hint="自定义抬头与模板需宿主支持后开放">未接入</Row>
          </div>}
          {current === "about" && <div className="settings-card">
            <Row label="宿主">{health.data?.status === "ok" ? "运行正常" : "状态待确认"} · {text(health.data?.version) || "版本未提供"}</Row>
            <Row label="数据契约">{text(health.data?.model_version) || "—"}</Row>
            <Row label="快捷键">Ctrl+B 侧栏 · Ctrl+S 保存 · Ctrl+Z / Ctrl+Shift+Z 撤销与重做</Row>
          </div>}
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
