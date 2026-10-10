# 插件规范入口

唯一现行规范：[CableSimPro 插件规范 · 宿主 API 2.1](https://github.com/luohui1/CableSimPro-Plugins/blob/main/SPEC.md)。

本目录的 JSON Schema 由 `scripts/seal_plugin_catalog.py` 从宿主契约生成，用于清单与物理工件校验；插件开发仍以现行规范为入口。

能力的可选字段 `solver` 声明求解位置：`local` 仅本机、`slurm` 仅超算、`either` 两者均可。省略按 `local` 处理；它与插件进程的 `execution_policy.backend` 无关。`GET /api/hpc/profile` 返回当前配置的 `remote_plugins` 与 `remote_capabilities`；前者选择插件全部能力，后者按插件 ID 选择能力 ID。`configured` 表示连接参数已配置，`connection_checked=false` 表示未测试连接；接口不连接超算，不返回连接参数或凭据。`status` 为 `not_configured`、`invalid` 或 `configured`，`configuration_file` 为仓库内相对路径（外部文件为 `null`），`configuration_note` 说明配置位置。

显示求解位置时先读能力声明：`slurm` 始终显示超算，并根据配置是否完整且该能力是否被路由选中显示已配置或未配置；`either` 按路由选择本机或超算；`local` 显示本机。如果配置将 `local` 能力选入超算，应提示配置与能力声明冲突。旧运行仍按其保存的执行来源显示。

旧规范内容保留在 Git 历史，不再独立维护。
