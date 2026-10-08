import { CatalogShell } from "@/components/catalog-shell";
import { HpcJobList } from "@/features/field/hpc-job-list";

/**
 * 记录 › 运行与作业（FRONTEND_REQUIREMENTS §2.2）：跨对象的筛选视图，运行本身的家在所属研究或型号里。
 * 作业列表从设置移到这里；设置只保留超算连接。
 */
export function RunsPage() {
  return (
    <CatalogShell title="运行与作业" status={<span className="muted">全部工程的超算作业 · 单次运行在所属研究里查看</span>}>
      <HpcJobList />
    </CatalogShell>
  );
}
