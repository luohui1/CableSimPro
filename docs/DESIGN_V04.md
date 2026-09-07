# 0.4 设计中心：可复核模型与数据接入

## 当前支持矩阵

| 能力 | 实现 | 不代表什么 |
|---|---|---|
| 直埋热分析 | 原三相均匀土壤互热网络 + 半空间解析温度图 | 不是任意二维土壤 FEM |
| 竖向电热 | 单根隔离电缆，轴向有限体积 + 四节点径向热网络；焦耳/介质/屏蔽损耗，对流和辐射 | 不求解气流、烟囱效应、成束互热、支架热桥 |
| 绝缘电场 | 均匀同轴绝缘的电势、RMS/峰值场强、电容 | 不计算局放、缺陷、空间电荷、端部场或击穿资格 |
| 反向选型 | 根据目标电流、裕量、U₀、外径、材料、锁定条件逐项调用计算内核 | 不包含压降、短路耐受、阻燃、机械自重/夹具或成本最优化 |
| 企业资料库 | 本机原件、页级文本、哈希、核对状态、关键词检索、引用式参数入库 | 不是多租户 DMS、全文语义/向量搜索、SSO 或防篡改审计 |
| OCR | PDF 原生文字优先；扫描件接 Mistral OCR 或规范化 Gateway | 不是“任意厂商 key 都通用”，没有 key 就不伪造 OCR |
| Agent | 已有工程变更审批 + 新的受限只读资料研究工具循环 | 不是无限循环自主设计；未验证真实模型任务成功率 |

本轮把“垂向”按竖向敷设解释，同时保留电缆垂直领域的直埋设计能力。竖向边界配置与直埋 Scenario 分离，研究记录同时保存两者，避免土壤条件被误用为空气条件。

## 竖向热模型

在每个轴向有限体积中心设置导体 c、绝缘中间节点 d、金属屏蔽 m、护套表面 s。径向热阻由已有同心层几何和热阻率计算：

`T_layer = rho_th * ln(r_out/r_in) / (2π)`，单位 K·m/W。

导体屏蔽及一半绝缘组成 `Tcd`，剩余绝缘和外半导电/金属层组成 `Tdm`，护套组成 `Tms`。介质热源集中于绝缘中间节点，是降阶近似。

每米稳态平衡：

```
c: kA/dz² * Σ(Tc[i]−Tc[neighbor]) + (Tc−Td)/Tcd − I² Rac(Tc) = 0
d: (Td−Tc)/Tcd + (Td−Tm)/Tdm − Wd = 0
m: (Tm−Td)/Tdm + (Tm−Ts)/Tms − λ I² Rac(Tc) = 0
s: (Ts−Tm)/Tms + πD {h(Ts−Ta) + εσ[(Ts+273.15)^4−(Ta+273.15)^4]} = 0
```

`Rac(T)=R20*(1+ac_extra_factor)*(1+alpha*(T−20))`。两端轴向绝热；只考虑导体轴向热导，k 为演示铜 400 / 铝 235 W/(m·K)。空气温度在指定顶部/底部值之间线性变化，辐射环境温度取当地空气温度。h 是用户给定的有效对流系数，不能当作自动自然对流或通风计算。

使用稀疏解析 Jacobian 的阻尼 Newton 求解。每节点残差单位 W/m；全长输入热量与对流/辐射散热差单位 W。非均匀空气温度下，轴向导热可能使局部节点温度低于当地空气，这是物理上允许的。稳定性用 Z-matrix 的 `Jx=1, x>0` 判据检查，不使用错误的“所有节点必须高于当地空气”规则。超过 200 °C 的外推或无稳定收敛解不返回虚假运行温度。

载流量用电流二分查找最大导体温度等于材料允许温度。热点位置是网格中心，不是无限精度定位。建议将网格数加倍检查收敛；默认 40 个单元不是所有长度的设计保证。

## 同轴绝缘电场

 a 为导体屏蔽外半径、b 为绝缘外半径。内屏蔽电位 U₀，外屏蔽接地：

```
V(r) = U₀ ln(b/r) / ln(b/a)
E_rms(r) = U₀ / [r ln(b/a)]
E_peak = √2 E_rms
C' = 2π ε0 εr / ln(b/a)
```

代码用 kV 与 mm 计算 kV/mm，单独输出 RMS 与峰值。图只给绝缘区域赋值，外部标为空；没有计算的区域不填假数值。非均匀介质、终端和缺陷不适用。

## 选型规则与来源

每个候选固定目标环境和设计条件，温度上限不高于当前工程及候选材料的较小值。库中 U₀ 用于额定电压初筛；计算介质损耗时使用用户明确给定的设计 U₀。锁定的电压不得被改动。输出每个候选的通过/失败理由，在通过者中按最小截面排序，不假装有价格成本函数。

铜/铝 120、185、240、300、400、500、630 mm² 共 14 个条目是演示模板，默认不纳入选型。企业条目目前标为 `reviewed_partial`：原文支持的字段已由用户确认，其余结构和材料仍沿用当前工程假设。不可把部分来源核对说成完整厂家认证。

应用候选先生成服务端提案，经版本与参数锁校验，由用户批准。只替换电缆定义，不直接更改运行电流和敷设，不将只读选型解释为批准施工。

## 文档与 OCR 数据路径

上传 PDF/PNG/JPEG/TXT/MD/CSV → 检查文件类型和尺寸 → 原件按随机 ID 保存在数据库同目录 `library-blobs/` → 数字 PDF 用 pypdf 提取文字 → 扫描页标为 needs_ocr → 用户同意后调用配置的 OCR → 页级文本核对 → 提取明确标签与单位 → 用户核对完整参数 → 保存部分有来源的电缆条目。

限制：单文件 10 MB，PDF 60 页，图片 3000 万像素；加密 PDF 拒绝。复杂表格的多产品行/跨页关联尚未自动解析；同页冲突不会拼成一个产品。默认不会重复 OCR 已有文本，重跑必须显式确认。识别失败保留原件和旧文本。资料修改使用版本条件写入，旧核对请求不能确认用户尚未看过的新文本。

目前搜索是大小写不敏感的页级关键词匹配，不是向量语义 RAG。Agent 检索工具只取得实际匹配片段，不把文件内的指令当系统指令。

PDF 解析仍在本机服务进程；不能用文件大小限制冒充完整恶意 PDF 沙箱。正式企业部署需隔离解析进程、资源限额、恶意文件检测、权限与保留策略。

### Mistral OCR

`CABLESIM_OCR_PROVIDER=mistral`，`CABLESIM_OCR_API_KEY`，可选 `CABLESIM_OCR_MODEL`（默认 `mistral-ocr-latest`）。PDF 传 Base64 data URI，页码发给服务时减 1，返回 index 加 1；图片使用 image_url data URI。即使只识别部分页，服务仍收到完整原件，界面明确提示。

### 自定义 Gateway 契约 v1

`CABLESIM_OCR_PROVIDER=gateway`，`CABLESIM_OCR_URL` 和 `CABLESIM_OCR_API_KEY`。只接受服务端配置 URL，不从资料或前端读取地址；默认 HTTPS，不跟随重定向。

请求：

```json
{"schema_version":1,"mime_type":"application/pdf","file_base64":"...","pages":[1,3]}
```

请求头：`Authorization: Bearer <server-side-key>`。返回：

```json
{"pages":[{"page":1,"text":"第1页原文"},{"page":3,"text":"第3页原文"}]}
```

页码从 1 开始，必须恰好覆盖请求页，非空文本且无重复页。供应商协议不同则需网关转换；不能只填别家 key 就宣称兼容。55 秒超时，最多 4 MB 响应，无自动计费重试。供应商识别质量/真实 key 联通性尚未验收。

## Agent 接入

在根目录复制 `config.example.env` 为 `.env`，填入 `CABLESIM_AGENT_PROTOCOL`（responses / chat_completions）、`CABLESIM_AGENT_BASE_URL`、`CABLESIM_AGENT_API_KEY` 和 `CABLESIM_AGENT_MODEL`。启动加载 `.env`，不覆盖已有系统环境变量。浏览器只看到配置状态、模型和目标主机，不取得 key。旧 `OPENAI_API_KEY` 可回退使用。

设计中心 Agent 最多四轮模型响应、三次只读工具执行：`inspect_project`、`search_documents`、`select_cables`。必须明确允许发送任务、完整工程与检索片段，云端可能计费。工具名与参数均服务端验证，任何 shell/URL-fetch/写数据库/绕过锁的请求均无相应能力。模型解释仍可能错误，工具计算表和原文引用单列显示。旧主工作台的修改 Agent 继续人工审批。

OCR 同意和 Agent 同意是两个独立开关。未配置大模型时，UI 明确标为本地关键词检索/命令解析，不伪称使用了 AI。提供商契约测试使用模拟 HTTP JSON，不能替代真实密钥与模型任务成功率验证。

## 持久化与导出

企业文档与选型库、研究输入与结果存储在同一 SQLite 文件；原件在同目录 `library-blobs/`。研究快照绑定工程版本，旧版本不会冒充当前版本。工程 Scenario JSON 导出不含整个资料库/历史；完整备份应停止程序后复制数据库及 blob 目录。新研究支持 JSON 快照导出和只读 HTML 原始研究报告接口。

## 主要依据（一般物理/接口依据，不是正式工程认证）

- MIT, Combined Conduction and Convection / cylindrical resistance: https://web.mit.edu/16.unified/www/FALL/thermodynamics/notes/node123.html
- MIT 8.02, Capacitance and Dielectrics, cylindrical capacitor §5.2: https://web.mit.edu/8.02t/www/802TEAL3D/visualizations/coursenotes/modules/guide05.pdf
- Mistral OCR API: https://docs.mistral.ai/api/endpoint/ocr
- Mistral PDF/image document input: https://docs.mistral.ai/studio/document-processing/basic_ocr
- OpenAI function calling: https://developers.openai.com/api/docs/guides/function-calling
- pypdf extraction limitations: https://pypdf.readthedocs.io/en/latest/user/extract-text.html

工程应用前仍需要已授权标准文本、厂家参数、独立算例、实测或可信参考工具校核。版本 0.4 是面向电缆设计的研究 Preview，不是通用 COMSOL 或可直接批准工程的选型系统。
