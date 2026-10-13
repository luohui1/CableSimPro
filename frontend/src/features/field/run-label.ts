import { numeric, optionalRecord, text } from '@/api/client';

export function localTime(value: unknown) {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? '时间未记录' : new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

export function savedRunLabel(run: Record<string, unknown>, title?: string) {
  const name = title || text(run.study_name) || text(optionalRecord(optionalRecord(run.snapshot).definition).title) || '保存研究';
  const sequence = numeric(run.sequence);
  return `${name} · ${sequence === null ? (run.kind === 'preflight' ? '预检记录' : '保存运行') : `运行 ${sequence}`} · ${localTime(run.created)}`;
}

export async function hpcJson(path: string, options?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/hpc${path}`, { credentials: 'same-origin', ...options });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(typeof value.detail === 'string' ? value.detail : `超算服务读取失败（${response.status}）；已保存数据保留，可重试。`);
  return value;
}

export const hpcStatus = (value: unknown) => ({ queued: '排队', submitted: '已提交', preparing: '准备中', running: '运行',
  validating: '后处理', collecting: '回收结果', succeeded: '已封存', partial: '部分完成', failed: '失败', disconnected: '连接中断',
  interrupted: '待恢复', cancelled: '已取消', cancel_requested: '取消待确认', completed: '已完成', blocked: '资源不足',
  budget_exhausted: '达到预算上限' }[text(value)] || '状态待确认');
