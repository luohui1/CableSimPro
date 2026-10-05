import type { ReactNode } from "react";
import { message } from "@/api/client";
import { EmptyState, ErrorState, LoadingState, StaleBanner } from "./states";
import { Button } from "./ui/button";
export function QueryState({
  query,
  empty,
  children,
  loading = "正在读取保存记录",
}: {
  query: {
    isPending: boolean;
    error: unknown;
    data: unknown;
    refetch: () => unknown;
  };
  empty: string | false;
  children: ReactNode;
  loading?: string;
}) {
  if (query.isPending) return <LoadingState title={loading} />;
  if (query.error && !query.data)
    return (
      <ErrorState
        title="读取失败"
        description={message(query.error)}
        action={<Button onClick={() => void query.refetch()}>重新读取</Button>}
      />
    );
  return (
    <>
      {query.error && (
        <StaleBanner description="连接中断，保留上次读取的记录。" />
      )}
      {empty ? <EmptyState title={empty} description="" /> : children}
    </>
  );
}
