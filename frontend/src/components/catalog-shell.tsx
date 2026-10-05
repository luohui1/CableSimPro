import { useEffect, type ReactNode } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { AppShell } from "./app-shell";
import { Icon } from "./icon";
export function usePageTheme() {
  const search = useSearch({ strict: false }),
    navigate = useNavigate();
  const theme =
    search.theme === "dark" ? ("dark" as const) : ("light" as const);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return { theme, search, navigate };
}
export function CatalogShell({
  title,
  active,
  children,
  status,
  actions,
  tabs,
  property,
  sidebar,
}: {
  title: string;
  active: "库" | "插件" | "设置";
  children: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  property?: ReactNode;
  sidebar?: ReactNode;
}) {
  const { theme, search, navigate } = usePageTheme();
  return (
    <AppShell
      title={title}
      status={status}
      actions={actions}
      activeNavigation={active}
      theme={theme}
      onUnavailable={() => {}}
      onTheme={() =>
        void navigate({
          to: window.location.pathname,
          search: { ...search, theme: theme === "light" ? "dark" : "light" },
          replace: true,
        })
      }
      sidebar={
        sidebar ||
        (active === "库" ? (
          <>
            <Link className="module-item" to="/library" search={{ theme }}>
              <Icon name="nav/library" />
              资源库
            </Link>
            <Link
              className="module-item"
              to="/library/reproductions"
              search={{ theme, snapshot: "" }}
            >
              <Icon name="nav/study" />
              复现库
            </Link>
          </>
        ) : (
          <span className="module-item">
            {active === "插件" ? "已安装插件" : "应用偏好"}
          </span>
        ))
      }
      tabs={tabs}
      property={property}
      propertyCollapsed={false}
    >
      {children}
    </AppShell>
  );
}
