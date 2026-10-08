export const moduleDefinitions: Record<
  string,
  { label: string; icon: string; tabs: { id: string; label: string }[] }
> = {
  cable: {
    label: "电缆",
    icon: "object/cable",
    tabs: [
      { id: "section", label: "截面" },
      { id: "layers", label: "分层" },
      { id: "references", label: "引用" },
    ],
  },
  section: {
    label: "敷设截面",
    icon: "object/section",
    tabs: [
      { id: "section", label: "截面" },
      { id: "three-dimensional", label: "三维" },
      { id: "coordinates", label: "坐标" },
      { id: "media", label: "介质" },
    ],
  },
  conditions: {
    label: "工况",
    icon: "object/conditions",
    tabs: [{ id: "inputs", label: "工况" }],
  },
  ampacity: {
    label: "载流量",
    icon: "calc/ampacity",
    tabs: [
      { id: "results", label: "结果" },
      { id: "detail", label: "结果详情" },
      { id: "validation", label: "验证与范围" },
      { id: "parameters", label: "方法参数" },
    ],
  },
  hybrid: {
    label: "混合载流量",
    icon: "calc/ampacity",
    tabs: [
      { id: "results", label: "预测结果" },
      { id: "validation", label: "模型验证" },
      { id: "sources", label: "来源" },
    ],
  },
  "thermal-field": {
    label: "温度场",
    icon: "calc/thermal-field",
    tabs: [
      { id: "field", label: "场图" },
      { id: "samples", label: "取样" },
      { id: "parameters", label: "方法参数" },
      { id: "diagnostics", label: "诊断" },
      { id: "convergence", label: "收敛" },
    ],
  },
  selection: {
    label: "问询选型",
    icon: "calc/selection",
    tabs: [
      { id: "results", label: "候选结果" },
      { id: "detail", label: "结果详情" },
      { id: "validation", label: "验证与范围" },
      { id: "settings", label: "问询条件" },
    ],
  },
  sweep: {
    label: "参数扫描",
    icon: "calc/sweep",
    tabs: [
      { id: "curve", label: "曲线" },
      { id: "points", label: "扫描点" },
      { id: "settings", label: "设置" },
      { id: "validation", label: "验证与范围" },
    ],
  },
  batch: {
    label: "批量仿真",
    icon: "module/rating-table",
    tabs: [
      { id: "space", label: "工况空间" },
      { id: "results", label: "结果" },
      { id: "execution", label: "执行" },
    ],
  },
  "method-compare": {
    label: "方法对比",
    icon: "module/method-compare",
    tabs: [
      { id: "results", label: "结果" },
      { id: "inputs", label: "输入差异" },
      { id: "evidence", label: "证据" },
    ],
  },
  simulation: {
    label: "仿真复现",
    icon: "calc/thermal-field",
    tabs: [{ id: "results", label: "结果" }, { id: "inputs", label: "输入与网格" }, { id: "evidence", label: "证据" }],
  },
  report: {
    label: "计算书",
    icon: "module/datasheet",
    tabs: [
      { id: "content", label: "内容" },
      { id: "sources", label: "来源" },
      { id: "preview", label: "预览" },
    ],
  },
  transient: {
    label: "暂态温度",
    icon: "calc/thermal-field",
    tabs: [
      { id: "results", label: "结果" },
      { id: "history", label: "时间序列" },
      { id: "field", label: "场图" },
      { id: "samples", label: "取样" },
      { id: "diagnostics", label: "诊断" },
      { id: "convergence", label: "收敛" },
      { id: "parameters", label: "方法参数" },
    ],
  },
  "sheath-losses": {
    label: "护套损耗",
    icon: "calc/ampacity",
    tabs: [
      { id: "results", label: "结果" },
      { id: "losses", label: "损耗系数" },
      { id: "parameters", label: "方法参数" },
    ],
  },
  electrothermal: {
    label: "电热耦合",
    icon: "calc/thermal-field",
    tabs: [
      { id: "results", label: "结果" },
      { id: "field", label: "场图" },
      { id: "samples", label: "取样" },
      { id: "parameters", label: "方法参数" },
      { id: "diagnostics", label: "诊断" },
      { id: "convergence", label: "收敛" },
    ],
  },
};

/** Host navigation is intentionally stable (FRONTEND_REQUIREMENTS §3.2).
 * Single-method names are replaced by the installed capability title in the
 * workbench; these flags only select the host renderer and its layout.
 */
export const moduleBehavior = {
  input: new Set(["cable", "section", "conditions"]),
  plotFirst: new Set(["sweep", "batch", "method-compare", "simulation", "hybrid"]),
  resultConclusion: new Set(["ampacity", "electrothermal", "transient", "sheath-losses"]),
  runnable: new Set(["ampacity", "thermal-field", "transient", "sheath-losses", "electrothermal", "sweep", "simulation", "selection"]),
  supporting: ["sweep", "batch", "method-compare", "simulation"],
};
