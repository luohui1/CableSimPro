export function missingInputDestination(
  field: string,
  calculation: string,
  currentInput?: string,
) {
  if (/(?:\/sections\/|sections\.|\/placements\/|placements\.)/.test(field))
    return { module: "section", tab: "coordinates", label: "敷设坐标与尺寸" };
  if (
    /(?:\/load_cases\/|load_cases\.|materials[/.][^\s]*soil|soil[^\n]*(?:rho|resistiv)|土壤[^\n]*热阻)/i.test(
      field,
    )
  )
    return { module: "conditions", tab: "inputs", label: "工况输入" };
  if (/(?:\/cable_types\/|cable_types\.|\/materials\/|materials\.)/.test(field))
    return { module: "cable", tab: "layers", label: "电缆分层参数" };
  if (field.includes("INPUT_INVALID") && currentInput) {
    if (currentInput === "conditions")
      return { module: "conditions", tab: "inputs", label: "工况输入" };
    if (currentInput === "section")
      return { module: "section", tab: "coordinates", label: "敷设坐标与尺寸" };
    if (currentInput === "cable")
      return { module: "cable", tab: "layers", label: "电缆分层参数" };
  }
  return {
    module: calculation,
    tab: calculation === "selection" ? "settings" : "parameters",
    label: calculation === "selection" ? "问询条件" : "方法参数",
  };
}

export function pointerParts(path: string): string[] {
  if (!path.startsWith('/') || /~(?:[^01]|$)/.test(path)) return [];
  return path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function matchingFieldPath(errorPath: string, available: string[], domain?: unknown): string | undefined {
  const wanted = pointerParts(errorPath);
  if (wanted[0] === 'parameters') wanted.shift();
  else if (domain) {
    let target: unknown = domain;
    for (let index = 0; index < wanted.length; index++) {
      const part = wanted[index];
      if (Array.isArray(target)) {
        if (!/^(0|[1-9]\d*)$/.test(part)) return undefined;
        const item = target[Number(part)] as Record<string, unknown> | undefined;
        if (!item) return undefined;
        const identity = item.id ?? item.role ?? item.cable;
        if (typeof identity === 'string') wanted[index] = identity;
        target = item;
      } else target = target && typeof target === 'object' ? (target as Record<string, unknown>)[part] : undefined;
    }
  }
  if (!wanted.length) return undefined;
  const matches = available.map(path => ({ path, parts: pointerParts(path) })).filter(item => item.parts.length && item.parts.every((part, index) => part === wanted[index]));
  const exact = matches.find(item => item.parts.length === wanted.length);
  if (exact) return exact.path;
  // A parameter-group error may focus its first actual child, without parsing prose.
  return available.find(path => { const parts = pointerParts(path); return parts.length > wanted.length && wanted.every((part, index) => part === parts[index]); });
}

export function focusPreflightField(path: string, domain?: unknown) {
  const focus = () => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-field-path]'));
    const matched = matchingFieldPath(path, nodes.map(node => node.dataset.fieldPath || ''), domain);
    const node = nodes.find(item => matched !== undefined && item.dataset.fieldPath === matched);
    const input = node?.querySelector<HTMLElement>('input,select,textarea,button');
    if (!input) return false;
    node?.closest('details')?.setAttribute('open', ''); input.focus(); input.scrollIntoView({ block: 'center' }); return true;
  };
  if (focus()) return;
  const observer = new MutationObserver(() => { if (focus()) observer.disconnect(); });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 3000);
}
