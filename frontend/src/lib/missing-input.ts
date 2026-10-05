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
