import { QueryClient } from '@tanstack/react-query';

/** 全应用唯一的查询缓存。15 秒内重新进入同一页面直接用缓存，不再转圈；写操作后各处显式失效。 */
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } });

// 插件目录与输入契约随插件发布才变化，5 分钟内复用，切页签不再重新读取。
queryClient.setQueryDefaults(['input-contracts'], { staleTime: 300_000 });
queryClient.setQueryDefaults(['method-catalog'], { staleTime: 300_000 });
