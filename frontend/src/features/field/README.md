# 场图真实使用检查

`verify-heat-capacity.mjs` 在发布库隔离服务中打开城南暂态热容准备表单，先核对真实保存来源的摘要与暂态适用范围，再真实读取依据库，采用文献材料值，用明确标记的教学现场参数请求土壤公式，检查超范围拒绝与导出。只要求保存研究实际引用的材料；材料来源格式检查调用真实仿真插件契约。半导电层、波纹气隙或暂态构型缺依据仍拒绝完整暂态提交。设置 `FRONTEND_URL`、`BACKEND_URL` 后执行 `node frontend/src/features/field/verify-heat-capacity.mjs`；`HPC_REAL_EVIDENCE` 可指定输出目录。不提交作业，不将无文献来源的公式教学参数保存为工程或种子。

该脚本还读取真实保存的有限元显示投影，核对热缓存字节；仅在隔离副本通过正常保存接口修改敷设段标签，再撤销，验证数据库提交使缓存失效、保存运行输入/输出摘要保持不变。禁止连接 8100 / 8200。

`verify-real-study.mjs` 检查隔离发布库中的有限元保存结果、收敛、IEC 对照和计算书。

`verify-transient-real-study.mjs` 检查同一保存工况的阶跃响应适用范围，以及超算作业所属研究和跳转。它使用真实宿主、插件、保存数据和浏览器，不替换接口或生成曲线。默认保存运行标识对应随附的城北变电站演示证据。

先启动指向发布库隔离副本的宿主与前端，设置 `BACKEND_URL`、`FRONTEND_URL`，再执行：

```sh
node frontend/src/features/field/verify-transient-real-study.mjs inspect
```

`inspect` 只读取保存结果与作业；核对两种桌面尺寸和深浅主题。输出目录可用 `HPC_REAL_EVIDENCE` 指定。脚本拒绝连接 8100 / 8200，结束时关闭自己创建的浏览器。

显式执行 `preflight` 会从界面请求真实超算原生预检，须先为隔离宿主配置超算与核时预算；脚本不会点击提交求解。三回路三芯排管暂态超出现行阶跃响应范围，检查如实停在“尚未覆盖”，不表示已通过暂态计算验收。

`verify-supported-transient.mjs` 核对城南发布库隔离副本的保存来源、暂态入口和方法配置入口。设置上述两个 URL；`HPC_REAL_EVIDENCE` 目录需有该副本查询得到的 `release-inventory.json`。只读核对真实保存运行的摘要，记录两个桌面尺寸及深浅主题；不替换接口、不提交作业。缺有限元参考或材料来源时记录受阻，不宣称已有暂态曲线或已通过暂态验收。

`verify-uncovered-preflight.mjs` 将 `PREFLIGHT_SAVED_RECEIPT` 内真实宿主保存的 `fourPreflight` 响应在正式预检对话框中读取。`FRONTEND_URL` 使用私有 Vite 开发服务。检查两个尺寸及深浅主题下四芯不覆盖文案、提交禁用、没有误导性分层修正按钮和 Esc 关闭。这是保存拒绝结果的组件回放，不是重新执行预检或求解，不伪造 SSH、工况或返回值。
城南保存工况稳态真实验收使用 `verify-chengnan-steady.mjs`：私有发布库副本、真实宿主与 dg83 预检和提交；已有运行时拒绝重复提交。以 `FRONTEND_URL`、`BACKEND_URL` 和 `HPC_REAL_EVIDENCE` 指定隔离服务与记录目录。

`verify-chengnan-transient.mjs` 在上述真实保存库的隔离副本中读取作业 817014，进入“阶跃热响应”，核对逐相预载绑定、两种尺寸及深浅主题布局；点击输入预检，确认缺热容时拒绝打开超算提交确认。不会提交作业、构造响应曲线或调用整包输入契约。记录在 `.data/fix-round/simulation-chengnan-transient/`；缺项拒绝通过不代表城南暂态求解验收通过。

`verify-preloaded-response.mjs` 用有正文热容来源的简化三导体截面，在隔离宿主中从保存全场起算。`reference` 从界面预检并提交真实稳态参考，完成后 `submit` 提交逐区域损耗阶跃，完成后 `inspect` 核对曲线、两类收敛和外部土壤 E1 解析交叉核对。三阶段都拒绝 8100 / 8200；活动或成功作业存在时不会重复提交。`HPC_REAL_EVIDENCE` 目录须有该隔离研究的 `reference.json`，材料参数来源与简化几何假设随输入保存。这是材料有来源的简化模型核验，不是完整文献或 IEC 官方暂态算例复现。
