# 标准依据库

`cablesim.standards-basis` 0.1.0 是离线、只读的数据插件。它将用户持有的标准正文整理为有版本、条件、单位、页码和核验记录的取值依据；宿主不内置标准算法。当前交付含 **33 张完整数值表、45 条公式或数值判据、1,429 条输出格记录**。表中的截面积、电压和直径区间作为完整的行轴保存，破折号格保存为 `null`，不是零，也不插值。

本版本只发布数据和查询能力。型号要求、标准核对、规格书的接入契约见下文；这些消费者及其页面不在本次改动内。源值核验通过不等于设计合格、试验合格或人工批准，输出始终带 `approval=not_granted`。

## 来源、存放与版本

解析前阅读了本地库的《合法正文目录说明-2026-07-21.md》和《标准题录与数据用途.md》。原 PDF/DOCX 不入库，插件不需要访问本地标准目录、联网、数据库或求解器。仅保留结构化表值、参数、条款标题及必要的一句话条件说明，使用权限仍为 `not_assessed`，不把持有正文当成对外分发许可。

选择新 v2 插件而不是工程数据库：数据可固定发行、封签、离线重放，多个消费者共用同一份证据；数据库读取不会偷偷改写要求。现行宿主没有 `data` capability kind，故以 `kind=method / analysis=standards_lookup / capability=lookup` 承载通用查询，输出数量及 `x-cablesim.standards-basis` JSON 工件。没有新增 SDK 或宿主特例，未声明 UI presentation。

目录 `plugins/cablesim.standards-basis/`：

| 文件 | 用途 |
| --- | --- |
| `plugin.json` | v2 清单、0.1.0 发行、无网络、只读查询权限和逐文件封签 |
| `assets/icon.svg` | 插件图标 |
| `src/cablesim_standards_basis/excerpts.json` | 审阅后的完整矩形输出格、完整行轴、条件与公式参数，作为编制输入 |
| `verification.json` | 每格的 route_a / route_b、方法、源 SHA256、结果和已解决提取问题 |
| `basis.json` | 可直接查询的扁平记录与表索引，由编制输入确定性生成 |
| `integrity.json` | 数据与核验文件的 SHA256 和字节数 |
| `library.py` / `main.py` | 只读查询及现有 `cablesim.run/2` 进程适配 |
| `query.schema.json` | 查询结构与 SI 输入条件约束 |
| `rebuild.py` | 确定性重建与一致性检查；不读取标准全文 |

每条记录含 `standard/edition/clause/table/title/printed_page/pdf_page/source_file/source_sha256/conditions/quantity/value/semantic/criterion/verification`。`quantity` 含中文名、量纲、原表单位；`axes` 保存输入轴，`row/column/row_label` 保存定位。续页逐行保存准确页码，不用表的第一页代替。

原文件摘要（完整 64 位）：

| 标准 | 文件 | SHA256 |
| --- | --- | --- |
| GB/T 12706.1—2020 | PDF | `9c398e261e5b88d24db5f0ca5a698402bc25eab6e4da0de063ebd4cd7790f6f1` |
| 同上 | DOCX | `cb45f149b626e5ab9f50c491f7950965ad604a37cb9dac2c76eee013511f0970` |
| GB/T 12706.2—2020 | PDF | `3b5fa321c213d4aaac7e04a293b9026626f43cc5b15209b26b713172e56f748d` |
| 同上 | DOCX | `b6251feba7318676bc7b28d481f7e978fc66b1efa9f5c16e8bf0f83d0399555a` |
| GB/T 12706.3—2020 | PDF | `4b2cca105c903cf4fed10b7f06cced06b834da1561170f1d9be96eb67ad0e3bb` |
| 同上 | DOCX | `5cf2ff30a362b32f674dc2d2498796625ca13b4f3c27923277560b36f40cf0dc` |
| GB/T 3956—2008 | PDF | `b9a118e1282b4eeee6ec6ae4653e8c80e0a42beee0df5bf84360c4876a856939` |
| IEC 60228:2023 | PDF | `d50b9d8338bdd224b0ffef2714d2e58722b2408e624c161d3503ae2c3374605e` |
| GB/T 11017.2—2024 | PDF | `5a9ecebbedf59c0b99d44c4b3520147d8bd08208ff2b7b6f338cdbbe5628b89b` |

## 覆盖与核验

下表的记录数是输出格数，包含原表不适用的空格；截面积、电压、直径边界等输入轴单独保存，未丢弃原格。A.1/A.2 左右并排表规范化为一个连续行序列，原数值全部保留。核验方法：

- **D/P**：DOCX 表或段落独立提取，对比 PDF 对应页逐格抄录；12706.1/.2 的扫描页使用离线 OCR 辅助，不以错误 OCR 代替原图。整列 DOCX 数字及摘要另保存在核验记录；12706.3 同时检查 PDF 文字层。
- **T/P**：PDF 表格或文字层独立提取，再对照渲染页独立抄录；GB/T 3956 使用 fitz 与 pdfplumber 两路提取，图像确认破碎小数及破折号。
- **P/P**：IEC 60228 表页无文字层，当前原页两次独立数值抄录并逐格比对，保存两路矩阵摘要；主线程另抽查关键页。文字层为空不算数值核验来源。

| 标准与版本 | 条款 / 完整表 | 规范化行 × 输出列 | 记录数 | 印刷页 / PDF 页 | 核验 |
| --- | --- | --- | ---: | --- | --- |
| GB/T 12706.1—2020 | 6.2 / 表6 PVC/A | 13×2 | 26 | 6 / 12 | D/P |
| 同上 | 6.2 / 表7 XLPE | 16×2 | 32 | 6 / 12 | D/P |
| 同上 | 6.2 / 表8 EPR/HEPR | 17×4 | 68 | 7 / 13 | D/P |
| 同上 | 7.2.3 / 表9 内衬层 | 6×1 | 6 | 8 / 14 | D/P |
| 同上 | 12.5 / 表10 圆铠丝 | 6×1 | 6 | 12 / 18 | D/P |
| 同上 | 12.5 / 表11 铠带 | 3×2 | 6 | 12 / 18 | D/P |
| 同上 | 15.3.4 / 表12 例行电压 | 2×1 | 2 | 15 / 21 | D/P |
| GB/T 12706.2—2020 | 6.2 / 表6 PVC/B | 1×1 | 1 | 6 / 14 | D/P |
| 同上 | 6.2 / 表7 XLPE | 9×5 | 45 | 7 / 15 | D/P |
| 同上 | 6.2 / 表8 EPR/HEPR | 9×6 | 54 | 7 / 15 | D/P |
| 同上 | 8.2.3 / 表9 内衬层 | 6×1 | 6 | 9 / 17 | D/P |
| 同上 | 13.5 / 表10 圆铠丝 | 6×1 | 6 | 12 / 20 | D/P |
| 同上 | 13.5 / 表11 铠带 | 3×2 | 6 | 13 / 21 | D/P |
| 同上 | 16.4.4 / 表12 例行电压 | 5×1 | 5 | 16 / 24 | D/P |
| GB/T 12706.3—2020 | 6.2 / 表6 绝缘 | 1×2 | 2 | 6 / 11 | D/P |
| 同上 | 8.2.3 / 表7 内衬层 | 5×1 | 5 | 7 / 12 | D/P |
| 同上 | 13.5 / 表8 圆铠丝 | 3×1 | 3 | 10 / 15 | D/P |
| 同上 | 13.5 / 表9 钢带 | 2×1 | 2 | 10 / 15 | D/P |
| 同上 | A.2.1 / 表A.1 导体假设直径 | 16×1 | 16 | 32 / 37 | D/P |
| 同上 | A.2.5 / 表A.2 屏蔽直径增量 | 16×1 | 16 | 33 / 38 | D/P |
| 同上 | 16.4.4 / 表10 例行电压 | 2×2 | 4 | 13 / 18 | D/P |
| 同上 | 17.9.3 / 表12 抽样电压 | 2×1 | 2 | 16 / 21 | D/P |
| GB/T 3956—2008 | 5.1.2 / 表1 第1类 | 25×3 | 75 | 3–4 / 6–7 | T/P |
| 同上 | 5.2.2 / 表2 第2类 | 30×9 | 270 | 4–5 / 7–8 | T/P |
| 同上 | 6.1/6.2 / 表3 第5类 | 22×3 | 66 | 5 / 8 | T/P |
| 同上 | 6.1/6.2 / 表4 第6类 | 19×3 | 57 | 6 / 9 | T/P |
| IEC 60228:2023 | 6.1 / Table3 第1类 | 27×3 | 81 | 12 / 14 | P/P |
| 同上 | 6.2 / Table4 第2类 | 33×9 | 297 | 13 / 15 | P/P |
| 同上 | 6.3 / Table5 第5类 | 22×3 | 66 | 14 / 16 | P/P |
| 同上 | 6.4 / Table6 第6类 | 19×3 | 57 | 15 / 17 | P/P |
| GB/T 11017.2—2024 | 6.4 / 表2 绝缘 | 12×3 | 36 | 4 / 10 | T/P |
| 同上 | 6.6 / 表3 金属套 | 12×3 | 36 | 7 / 13 | T/P |
| 同上 | 6.7.2 / 表4 外护套 | 12×2 | 24 | 8 / 14 | T/P |

以上共 1,384 个输出格。另有 45 条条款记录，每条也保存两路取值与页码：

| 标准 | 条款 × 记录数 | 内容 | 核验 |
| --- | --- | --- | --- |
| GB/T 12706.1—2020 | 11×1；12.3.3×2；13.3×2；16.5.2×2；16.5.3×1；16.6.1×1；9.2.3×5（共14） | 铅套/隔离套/外护套公式与下限，绝缘均值和最小值，非金属护套/铅套最小厚度，铜带厚度与搭盖 | D/P |
| GB/T 12706.2—2020 | 12×1；13.3.3×2；14.3×2；17.5.2×2；17.5.3×1；17.6.1×1；10.2.3×5（共14） | 厚度公式、最小测量厚度、绝缘偏心率、铜带屏蔽 | D/P |
| GB/T 12706.3—2020 | 12×1；13.3.3×2；14.3×2；17.5.2×2；17.5.3×1；17.6.1×1（共9） | 厚度公式、最小测量厚度、15%偏心率 | D/P |
| GB/T 11017.2—2024 | 6.3.2×2；6.3.3×2；6.5.2×3；6.7.3×1（共8） | 屏蔽参考/最小厚度、铜丝直径/间隙/公式、外护套半导电层20%上限 | T/P |

逐格核验的未确认差异为 **0**。已解决的提取问题保存在 `verification.json.resolved_extraction_issues`：3956 续页页码；扫描页无文字层和 DOCX 合并格；12706.1 表10 OCR 将边界35误读；12706.3 表9的原题“直径”与列名“厚度”不一致（保留原题，量按列名，附限制）。编制过程中发现的 HEPR 整列错位已由完整 DOCX 数列对照拦截并修正，不放行错误格。

两个注意点：表10末行的 3.15 / 4.0 mm 是两个选项，返回数组而不任择其一；12706.3 表10含两种试验程序的电压列，分别命名，不能任选较低列。11017.2 屏蔽“约”厚度为 `standard_reference/approximate`，最小测量厚度才是 `standard_limit/minimum`。

## 下一轮及未覆盖

未覆盖项同时保存在 `basis.json.not_covered`；查询返回 `not_covered`，不写“查无原文”，也不借其他版本补值。

| 标准 | 留到下一轮 |
| --- | --- |
| GB/T 12706.1/.2—2020 | 表1–5及表13以后；材料、电气/非电气试验完整矩阵；附录A/B的完整假设直径与修约算法；直接包带等例外；完整局放/冲击程序 |
| GB/T 12706.3—2020 | 表1–5、表11、表13以后；局放程序；附录A/B剩余公式与修约实现 |
| GB/T 3956—2008 | 结构条文及表注特殊用途例外、温度修正、附录A/B/C |
| IEC 60228:2023 | Table1/2、特殊用途和非优选截面说明、合金派生/协商分支、温度修正和附录 |
| GB/T 11017.2—2024 | 表1、导体焊接/结构、协商厚度；所引用的GB/T11017.1—2024试验及尺寸验收条件 |
| GB 50217—2018 | 载流量校正与敷设设计规定全部；作为下一轮独立标准条件包 |
| IEC 60287 各分册 | 本轮未新增计算方法依据；仍由已有方法插件提供，不混入本数据查询 |

本轮可确认原数值和页码，但不能将任意型号声明为满足整份标准。尤其：第1类大截面铜导体有特殊用途说明；铝合金不能直接套用表内铝值；非优选截面积和分块组合需要另核条件。查询对铝合金电阻直接返回未覆盖。公式的0.1 mm修约仅记录附录B引用和参数，`execution_status=not_implemented`，消费者必须完成附录B实现及对拍后才能据此自动生成标称厚度。不能把局放灵敏度10 pC当成统一合格阈值。

## 只读查询契约

消费者优先通过现有 `backend.plugin_host.executor.Executor` 调用 `cablesim.standards-basis / lookup`；host会验证清单封签、进程超时及工件摘要。没有新增HTTP路由、数据库写入或SDK字段。进程输入为 `cablesim.run/2`，工况的 `input` 为 `cablesim.standards-query/1`，`parameters` 留空。直接本地使用 `BasisLibrary.query()` 也校验数据、核验文件、integrity及清单中的数据封签；工程运行仍应走Executor以保留运行身份。

```python
from backend.plugin_host.executor import Executor
saved_query = {
    'schema_version': 'cablesim.standards-query/1',
    'standard': 'GB/T 12706.2', 'edition': '2020', 'locator': '表 7',
    'quantity': 'insulation_nominal',
    'conditions': {'area_m2': 0.00024, 'u0_v': 12000,
                   'u_v': 20000, 'insulation': 'XLPE'}
}
result = Executor().run('cablesim.standards-basis', 'lookup', cases=[{
    'case_id': 'insulation',
    'input': saved_query
}])
answer = result.cases[0].artifacts['x-cablesim.standards-basis']
# status=resolved；value=5.5，unit=mm；印刷7 / PDF15；approval=not_granted
```

`locator` 精确使用 `表 7`、`表 A.1`、`Table 4` 或条款号 `17.5.2`，不模糊匹配。`operation=list` 加标准、版本、表号可列完整表；不传条件/record_id。返回每格完整条件，再由消费者填足后 `resolve`；后者必须指定 `quantity`。`record_id` 可消歧，但不免除条件检查。历史重放传 `expected_data_sha256`，不符则 `BASIS_VERSION_CHANGED`。

条件单位：`area_m2` 是导体截面积，`screen_area_m2` 是表A.2的屏蔽/同心导体截面积；`diameter_m` 是该表规定位置的假设直径；电压为V，长度为m，`core_count/conductor_class`为整数。禁止传 `area_mm2` 或把240 mm²写为240 m²。返回数值保持标准原单位（mm、kV、Ω/km等），消费者作显式单位转换，不将它们直接写进SI事实。

材料代号：`PVC/A`、`PVC/B`、`XLPE`、`EPR`、`HEPR`；`copper/aluminium`；`plain/metal_coated`；`circular/compacted/shaped`；`screened=yes/no`。金属套为`lead/corrugated_aluminium/plain_aluminium`，隔离套公式的`non_lead`为明确分支代号，不代表自动识别材料。依据选择只传返回记录声明的条件；多余字段不会被忽略。公式查询返回参数描述，不接收计算输入也不执行表达式。

| 状态或错误 | 消费者处理 |
| --- | --- |
| `resolved` / `verification.status=verified` | 可显示已核验依据与原值；核对实测值还需完整适用条件和算法 |
| `explicit_not_applicable` | 原表是破折号，不产生零值/近似值 |
| `not_covered` | 显示“本轮未覆盖此条款/条件”，保留版本声明，禁止判合格 |
| `CONDITIONS_REQUIRED` / `INPUT_INVALID` | 错误含字段路径与修改说明，补足该字段后再查询 |
| `BASIS_AMBIGUOUS` | 增加明确条件或record_id，不自行选格 |
| `EVIDENCE_BLOCKED` | 保留差异列表，仅供审阅，不给自动判据 |
| `BASIS_VERSION_CHANGED` / `BASIS_INTEGRITY_FAILED` | 禁止静默更新引用；重装准确发行或重新核对版本 |
| 宿主超时/进程失败/环境缺失 | 沿用宿主明确错误；已有要求与运行快照不被本插件修改 |

## 型号、标准核对与规格书接入

已有型号标准资源仍采用`type_resource_bindings.standard[SHA256({standard,source_digest})]`，固定`resource_id/asset_id/version/content_sha256`。执行标准声明`cablesim.execution-standards/1`只说明使用版本；不自动批准条款。新依据引用补充到已支持的`sources[].reference` JSON字符串，不更换原资源摘要，也不改变SDK物理事实。拟消费的JSON schema名为`cablesim.standard-basis-ref/1`：

```python
record = answer['records'][0]
basis_ref = {
    'schema': 'cablesim.standard-basis-ref/1',
    'plugin_id': answer['plugin_id'], 'plugin_version': answer['plugin_version'],
    'data_sha256': answer['data_sha256'], 'query_sha256': answer['query_sha256'],
    'query': saved_query,  # 上述查询正文；保存原条件
    'record_id': record['id'], 'record_sha256': record['record_sha256'],
    'standard': record['standard'], 'edition': record['edition'],
    'locator': record['table'] or record['clause'],
    'printed_page': record['printed_page'], 'pdf_page': record['pdf_page'],
    'source_sha256': record['source_sha256'],
    'record': record       # 固定原值、单位、条件、语义和核验快照
}
# reference=json.dumps(basis_ref, ensure_ascii=False)
# 同时保存宿主运行的request_sha256、插件发行摘要及当前型号输入修订/摘要。
```

这是下一轮接入示例，不宣称已增加消费者接口。型号输入变化使既有依据引用过期；仅数据内容相同不代表新型号仍适用。历史要求、运行和规格书读已保存的record快照及摘要，不重新取“最新”值。数据插件不创建要求、不改其审批状态，人工确认仍走已有流程。

标准核对按固定标准版本、量和明确条件取唯一格；核对记录保存查询、插件版本/发行摘要、原文件摘要、record摘要及型号输入摘要。先检查`status/semantic/criterion/limitations`，再作单位转换和比较。`nominal`、`minimum`、`maximum`、`approximate`不能混用；数组必须由有依据的结构分支选定；公式参数不允许当字符串`eval`。第1类特殊用途、合金和试验程序未覆盖时不能把逐格数字核对升格为整标准合格。

运行编排的对接顺序为：宿主通过统一Executor执行`lookup`，保存`run_id`、`artifact_digests['x-cablesim.standards-basis']`及完整答复；把固定的`basis_ref`写入标准核对输入已有的来源reference载荷，由标准核对插件读取并验证摘要、型号输入身份及条件后取判据。消费者可据此使用数据，无需导入宿主算法或修改SDK。资料接口与标准核对负责人下一轮实现这段输入适配；本版本没有注册自动编排，也不宣称现有standard-check已经消费新依据。

规格书优先展示查询返回的`citation`：**GB/T 12706.2—2020 表 7，第 7 页**；详情补“PDF第15页”，版本、源摘要及记录身份。公式展示“GB/T 12706.2—2020 17.5.2，第17页”及参数/单位；表值注明行条件，如“240 mm²、12/20 kV、XLPE：5.5 mm”。本轮已核验条目可由消费者替换“原文未核验”为“依据已核验”，缺项显示“本轮未覆盖”，批准状态单独保留。

## 重建与检查

```sh
python plugins/cablesim.standards-basis/src/cablesim_standards_basis/rebuild.py
python -m pytest tests/test_standards_basis.py -q
python scripts/plugin_sdk.py seal --write
python scripts/plugin_sdk.py verify
python scripts/seal_plugin_catalog.py
```

数值修改先更新完整编制输入与独立核验矩阵，再`rebuild.py --write`；默认命令只检查，不改文件。新发行或版本更新按根AGENTS.md封签规则处理，不修改已发布版本。多线程环境下封签脚本会重写所有插件，故本次在`.tmp/`隔离工作副本执行原始封签命令，只回收本插件清单和自己的registry条目，然后在实际仓库只读核对目录及封签，避免改写其他线程的发行。临时工作副本不入库。

测试包含原页人工锚点（低压/中压/35kV/110kV及铜电阻、根数等16格）、全部完整表的矩阵尺寸、逐记录出处与双路结果、确定性重建及封签、防篡改、输入单位/缺条件、空格/多个选项/边界、不跨版本/合金派生、手算公式参数对拍，以及真实宿主进程的check/run/混合错误/重试/页码。前端页面接入及其浏览器验收由消费者下一轮完成，本轮不能据此声称现有页面已消除全部待核验。
