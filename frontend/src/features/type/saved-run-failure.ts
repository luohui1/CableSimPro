/** Explain the actual saved failure rather than leaving the engineer with an empty preflight dialog. */
export function savedRunFailureReason(value: unknown): string {
  const record = (item: unknown): Record<string, unknown> =>
    item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {};
  const message = (item: unknown): string => {
    const content = record(item).message;
    return typeof content === 'string' && content.trim() ? content.trim() : '';
  };
  const run = record(value);
  const direct = message(run.error);
  if (direct) return direct;
  const output = record(run.output);
  const cases = Array.isArray(output.cases) ? output.cases : Array.isArray(run.cases) ? run.cases : [];
  for (const entry of cases) {
    const row = record(entry);
    if (!['failed', 'not_applicable', 'partial'].includes(String(row.status))) continue;
    const diagnostic = message(row.error);
    if (diagnostic) return diagnostic;
  }
  return '本次运行未取得有效结果，请查看运行记录中的失败诊断，不采用预检结论作为计算结果。';
}
