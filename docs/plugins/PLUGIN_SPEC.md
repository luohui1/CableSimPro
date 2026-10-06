# 插件自描述扩展修改稿

这是提交用户审阅的本地修改稿，未推送远端。唯一现行规范仍为 [CableSimPro-Plugins/SPEC.md](https://github.com/luohui1/CableSimPro-Plugins/blob/main/SPEC.md)。本稿基于读取的文件标识 `b928f225bfda859aab9356943caff5b39e28b5b5` 内容准备；宿主可执行的字段以 `plugin-spec/manifest.schema.json` 和 `backend/plugin_host/manifest.py` 为准。本轮用户决定将第一方发行及能力方法版本统一为 `1.0.0`，不重写历史运行。

## 参数契约

每个 method 能力声明 `parameter_schema`、`input_contract`、`x-groups`、`x-headline`。共享领域事实绑定 `input_contract.binding`，独立输入使用 `standalone_schema`；独立输入与领域输入参数不同的能力另声明 `standalone_parameter_schema`。宿主参数面板入口是 `GET /api/input-contracts`，不再从宿主按插件编号拼接表单。

所有层级的 JSON Schema properties，包括数组元素和 `$defs` 中的字段，必须有中文 `title`、`description`、`x-unit`、`x-group`、`x-order`、`x-level`。单位声明使用 `{si,display,scale,offset}`，显示值为 SI 值乘 scale 加 offset；非物理对象的两个单位为 null。显示层转换不能改变存储口径。`x-runtime` 是封签内的已审查内部算法适配，不接受调用者提供转换；旧单位键通过此显式映射升级到 SI，双单位同时出现会拒绝。

同一值随物理类型切换单位时，声明 `x-unit-by={selector,cases}`：selector引用同一对象的枚举字段，cases必须覆盖全部枚举并逐项给出UnitDisplay；固定x-unit的si/display为null。例如线热源W/m、电流A、电压梯度V/m；恒温/对流边界的K显示为°C，磁矢势为Wb/m。前端按所选枚举查声明，不猜单位；所有数值仍以对应SI单位保存。激励时间表的二元组在items.prefixItems中分别声明“时间(s)”与“热源倍率(1)”的中文元数据。

`x-groups` 声明中文分组和顺序，`x-order` 在同一对象内唯一。每能力普通面板最多八个 basic 字段，其余为 advanced 或 expert。`x-bind` 声明对象类型、范围、多选/键控和只读属性，绑定型号、截面、负荷、回路、材料、区域或已保存工件。对象标识不可用自由 JSON 输入代替。

默认值须声明 `x-default-basis`，范围、枚举等须声明 `x-range-basis`，依据包括 kind 与 reference。软件数值初值和输入保护范围须标为 numerical/engineering，不能描述为规范物理限值。宿主不填工程默认材料或缺失物性。无法通用结构化的原始证据只允许 expert，并声明 `x-editor-reason` 与绑定方式；不是普通编辑器。

## 关键结论与来源

`x-headline` 每能力一至三个，字段为 key、中文 title、unit、aggregate、condition、artifact 和 source_artifact。aggregate 为 minimum/maximum/first，聚合不能混合不同物理工况。声明引用能力输出键和同工况工程工件。

第一方插件将真实输出数量和原始工程工件摘要写入 `cablesim.headline-witness/1`。宿主校验生产插件、发行、能力、执行、工况、原始 SI 输入、封存清单及原工件摘要，并与验收后的结果数量比对。运行摘要 `GET /api/workspaces/{wid}/studies/{sid}/runs?view=summary` 返回最多三个 headlines；缺失、损坏或未成功均为空数组，历史无声明的运行也不补值。摘要包含 SI 值、显示值、实体、工况、case_id 及源工件与见证摘要，不传完整网格。

## 展示包

插件 name、description 为中文名称和一句话定位；`presentation.category` 为 calculation/modeling/simulation/data-standard/report/agent-skill，中文类别见 category_title。类别来自清单。assets 声明 role、path、title、description、media_type，cover 与 method 必须存在，validation 可选。所有资源纳入 files 的 SHA-256 与字节数封签。

`GET /api/methods` 返回 presentation 和 resources；`GET /api/plugins/{plugin_id}/assets/{role}?sha256={digest}` 核验当前整个插件及资源字节。摘要过期返回409，未声明资源404。响应含 ETag、禁止 MIME 嗅探；SVG 禁止脚本、事件、外部链接与实体。验证图必须来自已声明算例的真实计算或已保存结果，无可发布数据时说明“无参考算例”或“无可发布验证数据”。示意图不能冒充验证数据。

## 温度场的两类来源

`cablesim.temperature-field/1` 的 source.binding 默认为 simulation-bundle，必须带 bundle_sha256 并匹配同工况 x-cablesim.simulation-bundle。新增 iec-trace 绑定：trace_sha256 必须匹配同工况 x-cablesim.iec60287-trace，不能同时带 bundle_sha256；能力另声明 `x-temperature-field-binding`。

IEC 快速场复用本次保存负荷损耗、均匀土半空间、恒温地表与镜像线源。61×41规则显示网格三角化，排除电缆/排管内部与跨越内部的三角形。`analytical_soil_view` 明确模型、operating 工况、土壤热阻率、排除圆、局限及自检。每根外表面64点周向平均与原IEC外部温升差须≤0.1 K，同时披露周向温差；不能将平均一致宣称为逐点等温。回填、分层、接触等效组或自检失败不发布场，原结果保持。热点为输出节点最大值，不代表连续极值；此视图不套用有限元三网格/加倍域门禁，也不能替代有限元。

## 快速预览与显式升级

`POST /api/workspaces/{wid}/studies/{sid}/preview` 请求 expected_revision、expected_study_revision，可选 module、未保存 domain、parameters 或独立 method_input。领域研究只能给 domain，独立研究只能给 method_input。仅允许能力 preview=true、本机快速执行，timeout 为 preview_timeout_s（1–15秒）。复用执行器和封签检查；来源正文由宿主绑定，调用方不能注入。返回 preview=true、persisted=false、engineering_approval=false、elapsed_ms、execution_id、cases、artifact_status、headlines。不会保存领域草稿、研究、运行或交付。超时与参数错误沿用执行器的结构化拒绝；执行临时目录由执行器负责清理。

`POST /api/workspaces/{wid}/studies/{sid}/upgrade-methods` 请求两项 revision，可选 module。未给 module 时升级主配置、所有模块、交叉校核及候选准备引用，通过普通 study.save 保存新版本、审计和可撤销历史；不执行算法。显式单位别名转换为SI，保留历史版本与运行原件。recalculate 复用相同采用路径，只有用户实际调用重算才创建运行。

## 报告模板与 Agent 技能（声明阶段）

能力 kind 新增 report-template 与 agent-skill，不能混入 method 输出或 preview。本轮没有新运行时，Executor 明确拒绝运行这两类声明。

report_template：context_schema=cablesim.report-context/1、format=html、封签内 assets/*.html 入口、sections（id、中文title、source、required）、engineering_approval=false。source 仅 inputs/results/artifacts/provenance/limitations。未来上下文只能提供已核验输入、结果、工件及来源，模板不能补算或批准。

agent_skill：context_schema=cablesim.workflow-context/1、steps（唯一id、中文title、capability引用 plugin_id/capability/version、静态 parameters_template、JSON Pointer bindings）、effects（read/calculate/propose）。参数模板不允许表达式或脚本，未来执行前按引用封签契约校验。engineering_approval=false，human_approval_required_for 必须保留 workspace.change/engineering.accept/external.send。声明不授权修改、批准或外发。

最小示例在 `docs/plugins/examples/report-template/plugin.json` 和 `docs/plugins/examples/agent-skill/plugin.json`，不在发布 registry 中；资源与模板是示例源文件，没有启用执行环境。
