import { useEffect, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { AppShell } from "./app-shell";
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
/**
 * 目录页与详情页的内容面板（FRONTEND_REQUIREMENTS §2.4）。导航全部在常驻侧栏里按类别给出，
 * 这里不再另放一套子导航。
 */
export function CatalogShell({
  title,
  path,
  children,
  status,
  actions,
  tabs,
  property,
}: {
  title: string;
  path?: string;
  children: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  property?: ReactNode;
}) {
  const { theme, search, navigate } = usePageTheme();
  return (
    <AppShell
      title={title}
      path={path}
      status={status}
      actions={actions}
      theme={theme}
      onUnavailable={() => {}}
      onTheme={() =>
        void navigate({
          to: window.location.pathname,
          search: { ...search, theme: theme === "light" ? "dark" : "light" },
          replace: true,
        })
      }
      tabs={tabs}
      property={property}
      propertyCollapsed={false}
    >
      {children}
    </AppShell>
  );
}
