/** 插件清单字段的中文名：验证等级、分析类型、工件类型。清单原值找不到对应时原样显示。 */
export const VALIDATION_LEVELS: Record<string, string> = {
  unverified: "未验证",
  "interface-tested": "接口测试",
  interface_tested: "接口测试",
  "analytic-benchmark": "解析基准",
  analytic_benchmark: "解析基准",
  "reference-benchmark": "参考基准",
  reference_benchmark: "参考基准",
  "cross-validated": "交叉验证",
  cross_validated: "交叉验证",
};

export const ANALYSIS_KINDS: Record<string, string> = { steady_state: "稳态", transient: "暂态", frequency_domain: "频域", geometry: "几何建模", mesh: "网格", model_preparation: "模型准备", postprocess: "后处理", properties: "参数计算", short_circuit: "短路", standard_check: "标准核对", crosscheck: "交叉校核", extraction: "资料提取" };

export const ARTIFACT_KINDS: Record<string, string> = {
  "x-cablesim.simulation-bundle": "仿真包：网格、求解器输入与日志",
  "x-cablesim.temperature-field": "温度场",
  "x-cablesim.temperature-history": "温度历程",
  "x-cablesim.native-bundle": "原生求解包",
  "x-cablesim.sheath-losses": "护套损耗",
  "x-cablesim.loss-coefficients": "损耗系数",
  "x-cablesim.iec60287-trace": "IEC 60287 中间量",
  "x-cablesim.iec-fem-comparison": "IEC 与有限元对照",
  "x-cablesim.physics-comparison": "物理量对比",
  "x-cablesim.reproduction-report": "复现报告",
  "x-cablesim.cad-model": "电缆 CAD 模型",
  "x-cablesim.cad-scene": "敷设三维场景",
  "x-cablesim.standard-check": "标准核对记录",
  "x-cablesim.type-electrical": "型号电气参数",
  "x-cablesim.type-short-circuit": "短路热稳定",
};

export const validationLevel = (level: string) => VALIDATION_LEVELS[level] || level || "未声明";
export const isBenchmarked = (level: string) => level.includes("benchmark") || level.includes("validated");
