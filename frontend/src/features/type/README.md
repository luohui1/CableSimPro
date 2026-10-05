# 型号工作区接线

本目录引用公共 AppShell、Radix 控件、TanStack Query、正式 OpenAPI 客户端和 cad / drawing 组件，不另建生产外壳。本线程未修改公共路由、导航或样式；前端线程已将 createTypeRoutes 接入公共路由，并注册型号入口。

## 接入公共前端

公共路由负责人从本目录 `index.ts` 引入 `createTypeRoutes`，在现有 `rootRoute.addChildren(...)` 中加入 `...createTypeRoutes(rootRoute)`。公共“型号”入口指向 `/types`。父路由保留结构、工况与方法条件、未完成输入文本和首次编辑修订；不可把 TypeProvider 移入会随模块卸载的子页面。

地址为 `/types`、`/types/:wid/:module/:tab`。`theme`、`revision`、`run`、`layer` 进入 URL；历史修订和固定运行保持只读。`preview.tsx` 和 `preview.config.ts` 只供目录内隔离验收，不能作为第二个生产入口注册。

## 本轮范围

- 型号列表 / 新建：读取独立型号与已发布版本；基准克隆、已发布版本分支、筛选和错误恢复。
- 结构设计：分层表、CableSection、CadViewport、来源属性、材料与构造输入、插件外径 / 用料、工程保存与撤销。
- 标准核对：真实精确发行运行、逐项判定、条款与输入来源、结构定位、要求批准记录和明确人工门禁。
- 电气参数 / 短路容量：正式 `cablesim.type-electrical` 0.3.0 参数契约、公共 MethodParameterFields 编辑、首次修订保存、错误保留、跨模块文本与方法草稿撤销。结果保留原始精度、性质、公式、条款和固定快照；短路曲线只读取插件保存点。R₂₀ 分别保留设计输入、实测和厂家上限；第 2 类导体显示 GB/T 3956-2008 表 2 的标准限值参照，不把标准上限当作实测值。
- 载流量表：宿主模板、真实工况编译、方法参数编辑、工况选择、保存冲突和固定快照；当前成功态已用真实 IEC 60287 标准代数运行验收。填写 ks、kp 或涡流分支时，正式契约提供“系数来源”；没有填入猜测的计算默认值。
- 方案对比：正式型号族、最多四个方案、保存指标矩阵、参数差异、只读截面对照、逐项运行来源、独立方案分支。演示场景分别真实运行结构 / 用料和标准核对，并对铜量做独立手算；设计假设保留演示来源。属性不展示空条件或原始 JSON。
- 规格书：正式八章内容、正文预览、修订、采纳与提交、人工批准/发布门禁；HTML 与 PDF 共用中文章节内容。PDF 用 ReportLab 分页，嵌入 PyMuPDF 随包提供的中文 TrueType 字体，短表整体移页、长表逐行分页并重复表头。电压用 kV，厚度 / 外径保留 0.1 mm，用料取整数 kg/km；原始工件与摘要保持不变。没有有效结果时写明未计算原因，空结果也阻止发布。封面编制单位、日期与签字由人工填写，不伪造机构或审批。

## 验收

在 `frontend` 下执行：

```sh
npx tsc -b
npm run check:styles
node node_modules/vite/bin/vite.js build --config src/features/type/preview.config.ts --logLevel error
node src/features/type/tests/verify-list.mjs
node src/features/type/tests/verify-structure.mjs
node src/features/type/tests/verify-standard.mjs
node src/features/type/tests/verify-analysis.mjs
node src/features/type/tests/verify-rating.mjs
node src/features/type/tests/verify-versions.mjs
node node_modules/vite/bin/vite.js build --outDir ../.data/frontend-type/main-build --logLevel error
node src/features/type/tests/verify-integration.mjs
```

所有业务脚本通过 `tests/fixture.mjs` 只读备份真实数据库到随机临时路径、启动独立服务和浏览器，结束核对零标签页、停止服务并删除临时数据库。当前轮次的五态、两尺寸和两主题采用自动断言，检查越界、控件重叠、13 px 字号和文字对比度；每个改动页面只留 1–2 张截图。验收只执行明确授权的 IEC 标准代数、轻量标准核对和 CAD；有限元、批量仿真、收敛研究及性能基准仍走超算。列表源无已发布型号，列表历史态没有伪造批准数据。产物在 `.data/frontend-type/`，不入库。

`verify-versions.mjs` 下载真实 PDF 后调用 `tests/check-pdf.py`，核对中文字体嵌入、没有内部字段名 / 空表、工程单位、页眉页脚和摘要。版式参考受控样本 Nexans XKDT 第 1–2 页、Prysmian N2XS2Y 第 1 页、正泰电缆手册第 21 页；仅参考信息组织，不复制品牌、认证或产品数值。

## 待协调

1. 公共路由与导航已注册；正式构建脚本仍由前端线程管理。目录内 preview 只作隔离验收。
2. 公共参数字段已抽取，本目录直接引用 MethodParameterFields。宿主新导出路由 `/api/types/{wid}/specification/file` 应进入下次公共客户端生成；当前从正式规格书响应读取并核验导出引用，不猜测路径或使用另一套业务 DTO。
3. 宿主尚无已保存方法配置的撤销接口；方法与工况页 Ctrl+Z 只撤销未保存条件，已保存时明确提示，不能误撤销型号结构。
4. 新建空白型号、文件导入、规格书固定修订读取等未提供的能力保持明确缺项。完整阻抗和未覆盖标准分支仍受宿主发布校核约束，前端不能通过省略问题解除门禁。
