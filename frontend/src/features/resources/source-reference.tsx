import { displayText } from '@/lib/display-names';

/** Preserve an unstructured citation as prose and structured provenance as exact, user-opened text. */
export function ResourceSourceReference({ reference, label }: { reference: string; label: string }) {
  let structured = false;
  try {
    const value: unknown = JSON.parse(reference);
    structured = value !== null && typeof value === 'object';
  } catch { /* Ordinary citations retain the existing readable text projection. */ }
  if (!structured) return <>{displayText(reference || '未提供')}</>;
  return <details className="resource-source-reference">
    <summary>查看结构化出处原文</summary>
    <pre data-source-reference="raw" aria-label={`${label} 原文`} tabIndex={0}>{reference}</pre>
  </details>;
}
