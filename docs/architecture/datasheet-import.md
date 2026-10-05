# 厂家资料导入契约

实现 PRD J3、F-DOC-01～04。原件与页级证据由宿主持久化，解析、字段提取、SI 换算、提供方提示词和输出核验由 `cablesim.datasheet-extract` 0.1.0 插件完成。插件使用现行 `cablesim.run/2` 协议和自定义 `cablesim.datasheet/1` 输入，不导入宿主、不读取工程数据库、不持有密钥、不自行联网或批准。正式地址没有 `design/` 前缀；本轮新增接口无旧地址映射。上轮 deprecated 地址继续保留。

## 人工流程

1. 上传 PDF。宿主保存准确原件字节、SHA256、页数、尺寸；同哈希重复上传返回原 ID。支持最多 64 MiB、500 页；损坏、加密、超限文件被拒绝，已存资料不受影响。PDF 脚本、嵌入文件不执行。
2. 页级查看保留原文字层、单词/行和表格；坐标统一为原件可见页左上角、y 向下的 PDF 点（1/72 inch），包含 CropBox 与旋转变换。PNG 为查看工件，原件下载仍返回原字节和 `X-Original-SHA256`。
3. 显式选择一个型号、规格行/列和 1～4 个页／矩形片段。模型上下文填写厂家、电压、导体、护套分支。规则优先读取文字层、表格与实际字形位置；横向/转置表都保留原单元格。无可用文字层或仅有页码的图像页，规则模式自动采用离线 CPU OCR；`offline_ocr` 可明确重识别所选图像。缺运行库或模型明确失败，原件保留。
4. 每个候选包含 canonical field、原数值/单位、SI 值/单位、页码、原文数值片段、bbox、厂家值/厂家最大值语义和歧义。重复字段不同值保留为歧义；多型号或单位不能唯一定位时留缺项，不凭标准或截面积补猜。
5. 人工逐项接受／修改／拒绝；采用 CAS 修订和 request_id 去重。修改须同时给值、单位与理由，再由插件换算 SI。全部候选都已核对且同字段采用值不冲突，才允许提案。
6. 提案冻结基准型号摘要、候选、核对修订/摘要、提取发行锁、原件/结果摘要与来源坐标。公开规格可补字段；完整结构型号必须显式给 field_bindings，目标只能是角色/单位相符的导体或层数量路径。外径不能反推各层厚度。原版本、工程引用和已保存运行均不改写。
7. 人工按准确提案 SHA256 批准，创建型号的新版本草稿；批准去重，核对或基准变化会拒绝旧提案。该动作不发布型号、不自动补物性，也不把资料候选提升为完整工程认证。工程师修改值记 `engineer_given`，保留原始候选及理由；原文最大值保留为厂家最大值，不能冒充标准限值或出厂实测。

本机部署的 reviewer/approver 是操作者记录，不是多人身份认证；自动提取进程不具备批准动作。历史开发记录没有输入封签时仍可查看，但须重新提取后才能生成新提案。

## 正式接口

所有请求/响应见 OpenAPI 的 `DocumentResponse`、`PageResponse`、`ExtractionScope`、`SelectedModel`、`Candidate`、`Decision`、`ExtractionResponse`、`ProposalResponse` 等模型。原件、图像接口声明二进制 MIME；错误包含稳定 code/message，字段形状错误保留 loc/msg/type。

| 方法／路径（前缀 `/api/documents`） | 行为 |
| --- | --- |
| POST、GET `/` | 上传原件、资料目录 |
| GET `/{did}`、`/{did}/file` | 元数据、准确原件 |
| GET `/{did}/pages/{page}`、`.../image` | 原文字层/坐标/表格、PNG |
| POST `/{did}/disclosures` | 冻结外发提示，不调用提供方 |
| POST `/{did}/extractions` | HTTP 202；保存 request_id 后后台提取，返回 Location/Retry-After |
| GET `/{did}/extractions`、`.../{eid}` | 历史及 accepted/running/succeeded/failed/interrupted 状态 |
| POST `.../{eid}/reviews` | 单项核对，CAS；相同请求重放 |
| POST `/{did}/comparisons` | 同原件、同型号、同页/片段的两次成功提取逐字段对比 |
| POST `/{did}/proposals`、GET `.../{pid}` | 生成／读取新版本草稿提案 |
| POST `.../{pid}/approval` | 明确人工批准，保存新版本草稿 |
| POST `/{did}/batches` | 冻结同一原件多个规格的已逐项核对提案；不写型号库 |
| GET `/{did}/batches/{bid}` | 读取整批及逐项提案、摘要与批准状态 |
| POST `/{did}/batches/{bid}/approval` | 人工批准准确整批摘要，原子生成多份草稿 |

错误覆盖 PDF_INVALID/PDF_ENCRYPTED/PDF_PAGE_LIMIT、REGION_INVALID、UNIT_UNKNOWN、MODEL_IDENTITY_MISMATCH、OUTBOUND_CONFIRMATION_REQUIRED/CHANGED、PROVIDER_NOT_CONFIGURED/TIMEOUT/DISCONNECTED/HTTP_ERROR、REVIEW_INCOMPLETE/REVISION_CONFLICT、FIELD_CONFLICT、PROPOSAL_REVIEW_CHANGED、REQUEST_CONFLICT、PACKAGE_DIGEST_MISMATCH 等。网络失败不切服务、不伪造候选；重复点击复用原提取或版本。宿主重启把尚未完成提取标 interrupted，保留原件和已保存结果；明确新请求才重新调用。

`ProposalRequest` 兼容原有 target_model_id/expected_model_sha256 分支，并增加互斥的 `new_model`：工程师明确给 name、manufacturer、designation、电压V、芯数、每芯截面m²、导体材料及 identity_reference；这些身份与所选原文型号/规格核对。新型号无需预建空壳记录，只有批准后才写入。`BatchProposalRequest{request_id,items:[ProposalRequest]}` 支持1–100规格，每项必须已独立提取并逐候选接受/修改/拒绝。整批SHA256绑定各单项提案SHA256；批准仍用 `ApprovalRequest` 的 literal true、approver、request_id、proposal_sha256。重复提交不会多建型号，任一核对版本改变、目标摘要冲突或型号版本重名即整批回滚。提案和批准复用单项实现，页码、坐标、原文、原件/结果/方法摘要进入每个型号来源。结果保持 incomplete 草稿，不自动发布或确认为完整工程型号。

真实示例 `validation/batch-example.json` 标注 Bahra 原件PDF20–21页的185/240/300/400/500 mm²五规格、35字段。浏览器验收 `E2E_ISOLATED=1 HOST_API_URL=<独立宿主> node tests/browser/datasheet-batch.mjs` 走原件上传、五次规则提取、逐项核对、整批提案、明确批准、重试去重及来源回读；在隔离验收库模拟人工动作，不批准生产库资料。原件继续沿用已登记的三份存档，Mistral暂停。

## 外发与密钥

离线安装入口为 `pip install -r plugins/requirements-datasheet.txt`；内网可用预下载的 wheelhouse 加 `--no-index --find-links` 安装。RapidOCR 3.9.2 包内含 PP-OCRv6 检测/识别与方向分类 ONNX 模型；执行前检查三个本地文件并显式传 `model_path`，缺文件报 `OCR_MODEL_MISSING`，不触发模型下载。CPU 推理单线程，图像最多1600万像素，沿用插件超时、队列、重复请求与历史保存机制。原生库缺失报 `OCR_ENVIRONMENT_MISSING`，空白页报 `OCR_NO_TEXT`；进程崩溃仍由通用宿主隔离并保留原件。[RapidOCR 离线模型配置](https://rapidai.github.io/RapidOCRDocs/main/install_usage/rapidocr/how_to_use_offline_model/)、[ONNX Runtime 安装要求](https://onnxruntime.ai/docs/install/)为部署依据。

本地 OCR 识别框按渲染区域转换为 PDF 点坐标；利用图像中的横竖表格线重建单元格、合并表头，并由规格列表头确定目标行，禁止把试验电压等其他列的同值当成截面。OCR 原文、图像/原件摘要、引擎/运行库版本和三个模型的 SHA256 放在独立 `ocr_evidence`，不覆盖原 PDF 文字层。候选创建时即绑定实际来源及证据摘要，同页文字层、重叠 OCR 片段不能按坐标互相覆盖来源。低置信度数值、冲突值、最小厚度与标称厚度的语义差异仍标歧义；所有值仍需人工核对与批准。`rules` 和 `offline_ocr` 不调用提供方、不需要密钥或外发确认；`ocr` 保持已有 Mistral 云端语义，作为显式可选项。

默认 OCR 在本机运行；可选外部服务为 Mistral。通用字段提取固定 `mistral-medium-2604`（Medium 3.5），OCR 固定 `mistral-ocr-4-1`；2026-10-04 用官方 `/v1/models` 回读核对别名。密钥从 `MISTRAL_API_KEY` 读取；Windows 桌面进程须继承用户环境变量，API 不读取注册表或把密钥写入数据库。可用 `CABLESIM_DATASHEET_MODEL`、`CABLESIM_DATASHEET_OCR_MODEL` 显式配置其他已审核模型，每次结果记录请求模型、实际返回模型、usage、响应 SHA256 和耗时。官方依据：[模型选择](https://docs.mistral.ai/models/model-selection-guide)、[OCR](https://docs.mistral.ai/models/ocr-4-1)。

显式设置 `CABLESIM_DATASHEET_BASE_URL` 时保留原 OpenAI-compatible JSON 接口，使用 `CABLESIM_DATASHEET_SERVICE`、`CABLESIM_DATASHEET_MODEL`、`CABLESIM_DATASHEET_API_KEY`；该兼容后端未声明 Mistral OCR，扫描页返回 `OCR_PROVIDER_UNSUPPORTED`。地址仅 HTTPS（本地测试可 loopback HTTP），禁止 URL 内密码、查询参数、重定向。密钥只用于宿主请求头，既不进入插件 minimal_environment，也不进入请求/结果快照、日志、OpenAPI 或提供方错误正文。流式接收上限 4 MiB，120 s 超时；网络失败和限流均保留原件，不自动重复收费调用。

外发前先请求 disclosures，显示服务、准确目的 URL、模型、选定原件/页/片段、内容类型和 payload_sha256；新增 `ocr_endpoint` 与 `ocr_model` 同时展示 OCR 和字段提取两个目的地址。`llm`、`hybrid` 中无文字层的选定页自动进入已披露的 OCR；`ocr` 显式识别所选图像再提字段。云端 extractions 必须回传 disclosure ID/digest 及 literal true 确认；范围、提供方、凭据不可逆指纹或 payload 变化立即拒绝（凭据指纹只存内部记录，不回传或记录日志）。用户上传扫描页未经确认不能外发。LLM 只收到选定文字/表格及单独 OCR 证据；云端 OCR 只收到所选页／片段 PNG，原 PDF 不外发。

OCR 使用 `/v1/ocr`，启用 HTML 表格、结构块、块坐标与置信度。原文字层不覆盖，识别文本放 `result.ocr_evidence`，记录原件/图像/响应 SHA256、模型和页／片段坐标。字段候选必须对应唯一型号行和字段／单位列，数字须与原文字形或 OCR 表格单元格一致；找不到依据的值丢弃，并返回 `PROVIDER_UNGROUNDED_CANDIDATE`。OCR 缺块坐标直接 `OCR_EVIDENCE_MISSING`，最低块置信度小于 0.95 或缺失时标歧义。识别证据仍须人工逐项核对，不能冒充原 PDF 文字层或自动批准。

OCR 已成功但字段模型失败时，提取状态仍为 failed；已收到的 OCR 块、模型、usage 与摘要保存在结果快照。前端可查看这些证据和历史，核对／提案仍被拒绝；明确重试才再调用。错误状态不是零准确率，也不把没有 usage 的失败请求费用记成零。

文字层候选 bbox 对应数值字形／单元格；OCR 4.1 原生提供块级坐标，候选 bbox 对应含数值的表格块。`evidence_source=ocr` 时前端高亮该块，不能声称为单元格定位；型号行、数值和单位列另以保存的 HTML 单元格内容核对。

`hybrid` 保留无歧义规则候选，只为缺失／歧义字段请求补充；同字段规则值不被模型覆盖。`candidate.extraction_origin` 区分 rules/llm，`evidence_source` 区分 original/ocr；页、原文、字段表头、证据摘要与提供方模型进入版本提案来源，规则历史记录保持可读。标题／型号不存在、邻行值、单位错配、区间端点和无原文引用均不会变成确定值。

接口地址不变。当前 OpenAPI 方法为 `rules/offline_ocr/llm/ocr/hybrid`；本轮增加 `offline_ocr` 和页级 `requires_ocr`，后者识别含少量原生页码的扫描表。前端默认规则优先、离线 OCR，只有明确选择云端模式时显示披露与确认。`result.strategy/provider_calls/ocr_evidence`、候选证据字段沿用；人工修改支持 `kg/100m`，SI 仍为 `kg/m`。其余上传、轮询、核对、提案、批准地址和 CAS 语义不变。

## 评测与验证

`validation/labels.json` 保持原 11 份 PDF、17 规格、76 字段真值不变。另增 `validation/scans.json`：大山公开盖章扫描型录和宏泰官方图像页型录，2份PDF、4规格、20字段；宏泰最小平均层厚另列不采纳项。合计13份PDF、21规格、96字段；不将人工栅格化文件冒充厂家扫描原件。原件只放资料目录、Zotero 和 `.data/`，标注保留源 SHA、URL、页／片段、原单位与 SI。

`python scripts/evaluate_datasheets.py --sources <原件目录>` 核对源哈希并调用与插件同一原语，记录源码 SHA 和方法版本；结果默认 `.data/datasheet-import/evaluation.json`。`--strategies rules llm hybrid --public-corpus-outbound-confirmed` 仅用于用户已授权外发的公开评测集，不为用户上传文件绕过宿主确认。`--retry-failed` 是显式重试，成功结果缓存不重复收费；`--prepare-public-batch` 生成固定型号和来源的批请求，私有资料不使用这个入口。计时／准确率评测在 Slurm dg83 运行；节点没有外网时采用仅允许 Mistral 两个 API 地址的 SSH 文件转运，授权头不落盘，总耗时与外部服务耗时分别记录。

精确率/召回率按唯一无歧义字段计，歧义候选单列，不计成功；相邻已标注规格构成串行负例，单位倍率错误单列。没有配置并确认提供方时大模型记 not_evaluated，不用模拟响应填准确率。当前小评测集用于开发回归，不能代表所有厂家版式。

当前规则实测61/61个明确字段正确，召回61/76=80.26%，单位错误0、型号串行0；原基线42/76=55.26%。34个漏提的逐字段归因见 `validation/recall-audit.json`：跨页型号关联10、型号粘连10、属性值行7、多结构列/缩写6、铜重/总重混淆1；恢复19，保留15个缺项。已保存工件中的粘连缺项来自人民110kV表；标题分词恢复后仍不猜测其他列缺失的单位。字段、单位、排除语义和结构分支均用数据表维护；多规格选择使用单元格坐标和规格表头。

图像页的独立实测16/16个明确字段正确、召回16/20=80%，单位错误0、型号串行0；8个歧义候选不计成功。大山合并表头仍使导体/成品外径不明确，宏泰的最小平均层厚保持待人工核对。实际计时、CPU核时和原始输出保存于 `.data/datasheet-import/offline/`；性能评测全部在 dg83 执行。可复跑：`python scripts/evaluate_datasheets.py --labels plugins/cablesim.datasheet-extract/validation/scans.json --strategies offline_ocr --output <结果路径>`；离线策略不要求公开资料外发开关。

已存的上一轮 Mistral 通用提取与 OCR 请求遇 HTTP429；低频最小请求复核仍为 `Rate limit exceeded`。官方批接口在缩小请求包后明确返回 HTTP402：需要在console启用billing。没有成功识别输出或usage，LLM／hybrid／云端OCR统计为not_evaluated，费用未知，不记零准确率或零费用。没有改用其他模型或伪造响应。每个失败、源哈希、Slurm作业及已完成规则工件保留于 `.data/datasheet-import/mistral/`；计费／额度恢复后再显式复跑。[限额说明](https://docs.mistral.ai/admin/billing-usage/usage-limits)、[标准单价](https://docs.mistral.ai/inference/pricing)是估算依据，不是账单。

Mistral 评测按设计负责人决定暂停，账户恢复前不重试。验证入口：`tests/test_datasheet_import.py`、`test_datasheet_evaluation.py`、`test_datasheet_offline.py`；`tests/browser/datasheet-workflow.mjs` 用独立数据库及无头 Edge/CDP 走真实原件、页级读取、提取、逐项核对、提案、批准、历史和下载。设置 `DATASHEET_E2E_SCAN=1` 验证大山扫描原件与零外部调用；默认验证 Bahra 文字层。它验证后端业务网络流程，不代表新前端页面或工程师耗时。

## 研究预检字段位置

研究预检 `error` 现为 OpenAPI `PreflightError`，固定包含 `code/message/path`，并可有逐项 `issues[{code,message,path}]`。`path` 使用 RFC6901 JSON Pointer，领域数组以零基索引定位，`~` 和 `/` 转义；例如 `/load_cases/0/currents/circuit~1c1`。方法参数以 `/parameters` 为根，例如 `/parameters/values/core_lay_length`；方法级组合约束定位相应参数组。Pydantic 字段位置、模型级显式位置、IEC 适用性位置经插件宿主透传，不从中文错误文字反解析。前端沿用 `error.path` 跳转，并逐项展示 `issues`；路径地址和预检请求本身未改名。测试入口 `tests/test_preflight_locations.py`。
