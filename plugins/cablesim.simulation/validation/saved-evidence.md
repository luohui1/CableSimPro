# 随附验证证据

`assets/reproduction-evidence.json` 是经人工验收、固定输入与方法版本的保存证据，供发布版离线展示。它不是启动时生成的仿真结果，不属于演示工程的运行记录，也不构成工程批准。仅随附当前快照，不携带历史版本、标准或论文全文、网格及求解器二进制。`assets/reproduction-evidence-index.json` 的摘要同时是不可变快照 ID；Schema 见 `assets/reproduction-evidence-schema.json`。`validation/evidence.sha256` 是验收时固定的同一摘要，测试核对它与发布索引一致。

各目标保留输入出处、页码、方法版本、收敛与偏差、覆盖限制；敏感性诊断保留原工程结果，集中热阻替换只用于口径调查。缺项、未评估和部分覆盖不转为“通过”。

发布种子从这些仓库文件导入自己的复现库，不读取开发或测试目录，不重新求解。`backend.foundation.reproduction_library.bundled_evidence` 在导入前校验摘要、Schema、唯一身份与大小；随附证据测试在 CI 执行同一检查。证据更新须经过验收、替换当前文件与摘要并重新封签；发布身份中的快照 ID 随之变化。

本次证据约 300 KB，保留全部目标与追溯字段，未因大小删除结果。开发复现库的限制文案可用 `python plugins/cablesim.simulation/validation/build_reproduction_library.py --duct-notes-only` 单独发布，不调用求解器。

浏览器回归使用 `node frontend/src/features/field/verify-reproduction-release.mjs`，环境变量 `FRONTEND_URL` 指向临时前端，`REPRODUCTION_API_URL` 指向已导入随附证据的临时 API。脚本只使用一个无头 Edge 页面，检查实际目录、覆盖页与导出，再断言两种尺寸、深浅主题下的五种状态；不写发布服务数据，也不运行求解器。
