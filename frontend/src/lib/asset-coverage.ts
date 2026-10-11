/** 展示已登记的数值物性与明确缺项；不是插件适用性或工程可用性认证。 */
export function assetCoverage(release: Record<string, unknown>) {
  const present = new Set<string>();
  const missing = new Map<string, string>();
  for (const value of Array.isArray(release.parameters) ? release.parameters : []) {
    const row = value as { name?: string; quantity?: { value?: unknown; unit?: string; dimension?: string } };
    if (row.name && typeof row.quantity?.value === 'number' && Number.isFinite(row.quantity.value) && row.quantity.unit && !['length', 'angle', 'area'].includes(row.quantity.dimension || '')) present.add(row.name);
  }
  for (const source of Array.isArray(release.sources) ? release.sources : []) {
    try {
      const row = JSON.parse(String((source as { reference?: string }).reference || ''));
      if (row?.schema !== 'cablesim.reference-data/1') continue;
      if (typeof row.property === 'string' && typeof row.value === 'number' && Number.isFinite(row.value) && typeof row.unit === 'string' && row.unit) present.add(row.property);
      if (Array.isArray(row.missing)) for (const property of row.missing) if (typeof property === 'string' && property) missing.set(property, typeof row.reason === 'string' ? row.reason : '未提供该用途的值');
    } catch { /* 普通出处不是物性记录 */ }
  }
  for (const property of missing.keys()) if (present.delete(property)) missing.set(property, '数值记录与缺项声明冲突，请核对来源。');
  return { covered: present.size, total: present.size + missing.size, missing: [...missing].map(([property, reason]) => ({ property, reason })) };
}
