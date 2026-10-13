# 场图真实使用检查

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
