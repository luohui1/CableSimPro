# 随附验证证据

三芯共享土壤域暂态方法 API 位于 `src/cablesim_simulation/three_core_history.py`。复用稳态区域与损耗反馈，逐域组装质量矩阵；`bind_saved_preload` 只接受宿主核验通过的稳态运行及全场数组摘要，不接受显示降采样初场或自动投影。管内空气、分层/回填及接触单芯组不在本次覆盖内。此阶段不接工程入口、不生成演示种子。

`python plugins/cablesim.simulation/validation/refresh_engineering_evidence.py --database <隔离库> --receipt-folder <真实复核回执目录> --stage <新审阅目录>` 将成功的同输入、同最终网格 Slurm 复核分阶段打包。先逐项校验原输入、参数与原始输出摘要，再保留全部历史成员、追加当前额定运行；新收敛记录明确标记继承原版本验证级别，原计算书只保留为历史。该命令不提交作业、不生成数值、不改已发布文件；审阅后才更新随附索引与档案并封签。

`python plugins/cablesim.simulation/validation/run_history_hpc.py` 在 dg83 真实运行方法验证：六根独立芯的双回路共享域、保存全网格预载、保持预载、零电流冷却（保留介电热）、能量守恒、时间步/网格收敛及外部均匀土壤 E1 分段历史解析核对。该启动器只冻结本方法的已封签包与依赖闭包，运行时摘要逐文件核验，不依赖并行线程尚未封签的其他插件；`--resume` 恢复原提交。所有热容明确标为“方法验证参数”，不是工程物性，也不是 IEC 官方算例；每级先冻结 CPU/墙钟上限，到 0.1 K 门槛即停。原生验证回执含实际作业号、自由度、逐级时间与核时；不能用计划上限冒充实耗。

`assets/reproduction-evidence.json` 是经人工验收、固定输入与方法版本的保存证据，供发布版离线展示。它不是启动时生成的仿真结果，不属于演示工程的运行记录，也不构成工程批准。仅随附当前快照，不携带历史版本、标准或论文全文、网格及求解器二进制。`assets/reproduction-evidence-index.json` 的摘要同时是不可变快照 ID；Schema 见 `assets/reproduction-evidence-schema.json`。`validation/evidence.sha256` 是验收时固定的同一摘要，测试核对它与发布索引一致。

各目标保留输入出处、页码、方法版本、收敛与偏差、覆盖限制；敏感性诊断保留原工程结果，集中热阻替换只用于口径调查。缺项、未评估和部分覆盖不转为“通过”。

发布种子从这些仓库文件导入自己的复现库，不读取开发或测试目录，不重新求解。`backend.foundation.reproduction_library.bundled_evidence` 在导入前校验摘要、Schema、唯一身份与大小；随附证据测试在 CI 执行同一检查。证据更新须经过验收、替换当前文件与摘要并重新封签；发布身份中的快照 ID 随之变化。

本次证据约 300 KB，保留全部目标与追溯字段，未因大小删除结果。开发复现库的限制文案可用 `python plugins/cablesim.simulation/validation/build_reproduction_library.py --duct-notes-only` 单独发布，不调用求解器。

中文情形名用 `python plugins/cablesim.simulation/validation/build_reproduction_library.py --variant-names-only` 发布并更新随附证据。数值行 `id` 保持原样，内部情形键保存在 `variant_id`，中文名为 `variant_name`；`variant` 是兼容现有验证页面和索引名片的显示别名。其他值、状态、来源与敏感性表不变。

阶跃响应的来源子模型见 `validation/step_response_case.py`；`python plugins/cablesim.simulation/validation/run_step_response.py` 经宿主接口保存稳态参考并派生阶跃响应，独立数据库与证据放在 `.data/simulation/step-response/`。本机不执行有限元；网格预检、暂态收敛和均质土壤 E1 解析场交叉核对均由 dg83 完成。契约元数据可用 `python -m cablesim_simulation.step_contract` 重生成，之后须重新封签。

`node frontend/src/features/field/verify-step-response.mjs` 使用一个无头 Edge 页面，排队适配层为测试替身，展示及导出使用该真实 dg83 保存响应；检查预算确认、重复点击、取消、键盘导出与双尺寸、深浅主题五态。`FRONTEND_URL` 指向已有开发服务；不写正式服务数据库。

浏览器回归使用 `node frontend/src/features/field/verify-reproduction-release.mjs`，环境变量 `FRONTEND_URL` 指向临时前端，`REPRODUCTION_API_URL` 指向已导入随附证据的临时 API。脚本只使用一个无头 Edge 页面，检查实际目录、覆盖页与导出，再断言两种尺寸、深浅主题下的五种状态；不写发布服务数据，也不运行求解器。

## 随附工程运行

`assets/engineering-evidence-index.json` 保存 2026-10-11 的 dg83 当前复核作业 811855 与历史作业 809850，索引摘要见 `validation/engineering-evidence.sha256`，结构见 `assets/engineering-evidence-schema.json`。仓库只保存封签索引、Schema 与摘要见证；完整数值压缩包属于部署数据，不进入 Git，也不享有卫生豁免。索引中的档案路径是逻辑身份，导入器只将固定文件名映射到外部数据目录。`backend.kernel.hpc_evidence` 使用同一个核验与事务导入入口，不重新求解。

从已验收运行的证据保管人取得 `study-evidence.tar.xz`、`mesh-evidence.tar.xz`、`domain-evidence.tar.xz` 三个原件，放到仓库已忽略的 `.data/simulation/engineering-evidence/`；也可用环境变量 `CABLESIM_ENGINEERING_EVIDENCE` 指定目录。不要放回插件目录，不从开发数据库替代或临时生成结果。当前没有公开下载地址；保管方须提供与封签索引一致的原件。运行 `python -c "from backend.kernel.hpc_evidence import verify_archives; print(verify_archives()[1])"` 可逐包核对长度和 SHA256；索引摘要须等于 `validation/engineering-evidence.sha256`。成员原文摘要在事务导入时再次核验，任何不一致都拒绝导入。

`evidence_availability()` 返回本机是否具备完整包、缺少的文件名、目标路径与索引摘要；`verify=True` 同时核对包摘要。缺包时发布种子保存完整有限元输入，显示“输入齐全，等待超算提交”，没有场图或伪造结果；包齐全且核验通过时离线导入作业 811855。发布身份记录是否导入实算证据，补齐包后下一次启动会按既有备份重建流程更新演示库。CI 缺包时跳过依赖这些部署数据的断言，仍执行索引与无包流程检查；验收环境有包时完整执行导入检查。

档案保留通过验收的完整运行链：起始网格、两级加密、两级扩域、最终允许电流、同输入 IEC 对照、收敛编排与已保存计算书。全部历史成员原文及摘要保持不变，另追加当前方法的同输入、同最终网格复核。运行序号沿用封存原值，首次种子计算前导入以预留其序号；原运行 UUID、作业号、时间、方法和输入摘要仍可追溯。原方法为 simulation 1.4.1，当前复核为 1.5.0；`current_grid_recheck` 和 `validation_history` 明确保留原版本收敛级别，不将其改称新版本逐级重算。当前正式计算书待研究线程生成，原 PDF 只作为 `historical_delivery`。

当前复核作业实际分配核时 3.8083333333、墙钟 2285 s，另有原生预检 0.0883333333 核时；原最终作业为 4.4233333333 核时、2654 s，原收敛编排为 6.7683333333 核时（起始运行另计 0.25）。当前与原工况的三回路温度、热点及允许电流完全相同：1,836,625 自由度，允许电流 359.645167 A，IEC 为 362.238246 A。地表恒温、均匀土壤、Kennelly 镜像远场，三芯等效热层；不代表三维电磁求解或工程批准。

起始网格远场 0.5 m、局部 0.0022 m、二阶场、512 圆周分段。远场尺寸按四百万节点容量选择起点，后续仍按原规则逐级加密；最终远场 0.125 m、局部 0.00055 m、32 m 域深。网格与扩域各连续两级变化小于 0.1 K，门槛没有放宽。

全网格数据仅在上述忽略目录或指定的部署目录保存；计算书章节会逐级回查封存运行，全网格取样与导出也需要原场。XZ 流式读取、80 MiB 字典、SQLite 增量写入，不将整个档案展开为内存数据库；每个成员上限 100 MiB。打包工具只生成待审阅的部署数据，更新索引前须人工验收并重新封签；不得将压缩包加入仓库。

真实只读浏览器复验：`node frontend/src/features/field/verify-real-study.mjs imported`，`FRONTEND_URL` / `BACKEND_URL` 指向隔离服务，`HPC_REAL_EVIDENCE` 指向本次证据目录。从导入的真实运行打开场图、收敛、对照和已保存历史 PDF，不提交新作业、不将历史 PDF 冒充当前计算书。

## 单芯接触品字形稳态

`single_core_thermal.py` 保留保存输入中的电缆中心、波纹尺寸、负荷和 IEC 电损耗选择。护套相切是零面积理想点接触，采用同一土壤域共形网格，不凭空赋予接触宽度或接触热阻；局部网格须按 0.1 K 门槛验证。它不代表已验证的有限接触面模型，也不开放接触单芯组的暂态。

波纹内侧采用 IEC 60287-2-1:2023 §4.1.2.1 的平均内径（PDF 14 / 印刷 12 页），外护层采用 §4.1.5.1 的平均金属套外径至波峰外包络（PDF 19–20 / 印刷 17–18 页）。各材料圆环热阻按 §4.1.3（PDF 18 / 印刷 16 页）逐层组装。空气、缓冲带参数沿用保存来源；缺失的铜和铝导热率使用刘黎等 2021《110 kV电缆缓冲层的电热特性分析》表 2（PDF 3 / 印刷 56 页）400、238 W/(m·K)，不覆盖已有物性。该文的 1×1000 模型不能冒充本研究 1×800 的厂家验证。二维均匀空气环不能表达波谷的轴向接触；正弦波纹轮廓、轴向等温金属套下的并联热路仅是方法假设敏感性，不是实测参数，也不调整参数去贴合 IEC。

`python plugins/cablesim.simulation/validation/pack_chengnan_evidence.py --database <隔离库> --receipt-folder <验收目录> --stage <外部证据目录>/chengnan` 只打包已完成两类收敛、同输入 IEC 对照与计算书的保存字节。逐成员流式核对摘要，三个包各不超过 100 MiB；先产出待审阅索引，不提交作业。仓库仍仅保留一个封签的 `engineering-evidence-index.json`、Schema 与摘要见证，`supplementary_receipts` 记录城南链，原城北档案与成员摘要不变。

城南原件放在 `.data/simulation/engineering-evidence/chengnan/`，或 `CABLESIM_ENGINEERING_EVIDENCE` 指定根目录下的 `chengnan/`。通过证据保管人取得与索引一致的三份原件；用 `verify_archives(scope='chengnan')` 核验，`evidence_availability(scope='chengnan')` 查询。城北、城南分别核验和导入；一条链缺包不影响另一条链。种子有包时保留原工程与研究绑定并离线导入，缺包时只保存有来源的输入，显示“输入齐全，等待超算提交”。发布身份分别记录两条链的导入状态，补包会触发既有备份重建流程。原生结果均标为“超算实算结果”，保留建模假设；不能称作本机计算或已批准设计。
