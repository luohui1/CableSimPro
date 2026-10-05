import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, record, responseData, text } from "@/api/client";
import { CatalogShell, usePageTheme } from "@/components/catalog-shell";
import { QueryState } from "@/components/query-state";
import { preferences, savePreferences } from "@/lib/preferences";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { StatusMark } from "@/components/status-mark";
export function SettingsPage() {
  const { theme, navigate } = usePageTheme(),
    [value, setValue] = useState({ ...preferences(), theme }),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const query = useQuery({
    queryKey: ["host-health"],
    queryFn: async ({ signal }) =>
      record(
        await responseData(api.GET("/api/health", { signal })),
        "宿主状态",
      ),
  });
  function save() {
    try {
      savePreferences(value);
      setError("");
      setSaved(true);
      void navigate({
        to: "/settings",
        search: { theme: value.theme },
        replace: true,
      });
    } catch {
      setError("浏览器未能保存偏好；请检查本地存储权限后重试。");
    }
  }
  return (
    <CatalogShell
      title="设置"
      active="设置"
      status={
        <StatusMark
          kind={saved ? "saved" : "current"}
          label={saved ? "偏好已保存" : "本机偏好"}
        />
      }
      actions={
        <Button variant="primary" size="compact" onClick={save}>
          保存偏好
        </Button>
      }
    >
      <div
        className="input-module"
        data-page="settings"
        data-state={
          query.isPending
            ? "loading"
            : query.error
              ? query.data
                ? "historical"
                : "error"
              : "success"
        }
        onKeyDown={(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "s"
          ) {
            event.preventDefault();
            save();
          }
        }}
      >
        <section className="input-section">
          <h2>外观</h2>
          <div className="input-form-grid">
            <Select
              label="主题"
              value={value.theme}
              onChange={(theme) => {
                setValue((previous) => ({
                  ...previous,
                  theme: theme as "light" | "dark",
                }));
                setSaved(false);
              }}
              options={[
                { value: "light", label: "浅色" },
                { value: "dark", label: "深色" },
              ]}
            />
            <label className="run-ack">
              <input
                type="checkbox"
                checked={value.reducedMotion}
                onChange={(event) => {
                  setValue((previous) => ({
                    ...previous,
                    reducedMotion: event.target.checked,
                  }));
                  setSaved(false);
                }}
              />
              减少动态
            </label>
          </div>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
        </section>
        <section className="input-section">
          <h2>数值显示</h2>
          <p className="muted">
            工程单位与精度按物理量统一；悬停查看完整精度，保存值使用 SI。
          </p>
        </section>
        <section className="input-section">
          <h2>快捷键</h2>
          <dl className="settings-shortcuts">
            <dt>Enter / Esc</dt>
            <dd>确认 / 取消</dd>
            <dt>Ctrl+S</dt>
            <dd>保存当前输入</dd>
            <dt>Ctrl+Z / Ctrl+Shift+Z</dt>
            <dd>撤销 / 重做，按对象已接入的历史能力开放</dd>
          </dl>
        </section>
        <section className="input-section">
          <h2>宿主与许可</h2>
          <QueryState query={query} empty={false}>
            <span className="muted">
              {query.data?.status === 'ok' ? '运行正常' : '状态待确认'}
            </span>
            <details>
              <summary>运行信息</summary>
              <dl><dt>宿主版本</dt><dd>{text(query.data?.version) || '未提供'}</dd><dt>数据契约</dt><dd>电缆工程领域输入</dd></dl>
            </details>
          </QueryState>
          <p className="muted">
            Agent 与数据目录配置接口尚未提供；开源依赖许可随分发包保留。
          </p>
        </section>
      </div>
    </CatalogShell>
  );
}
