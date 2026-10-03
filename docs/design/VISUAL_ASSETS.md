# 视觉素材需求

图标、品牌标记与动效全部自研。本文是交付给素材制作方（人或 AI）的唯一需求；配色、字号与基调以 [前端需求 §5](./FRONTEND_REQUIREMENTS.md#5-视觉规则) 为准，本文只引用其中的名称，不另定色值。

## 1. 基调

- 白纸、灰阶、柔和圆角；数字精确，颜色只表达含义。界面几乎无色，素材也一样：图标只用当前文字色，品牌标记只有导体铜一处彩色。
- 工程软件：安静、精确、可长时间使用。常规界面朴素，电缆特色只出现在电缆内容里（截面图、编辑器、结果图、计算书）。
- 图标是功能符号，不是插画：不画立体、渐变、阴影、人物、比喻性场景。
- 动效只表达因果（运行、变化、保存、失败），不做装饰性的淡入、弹跳、视差。

## 2. 交付位置与命名

| 内容 | 位置 |
| --- | --- |
| 图标 | `design/icons/<分组>/<名称>.svg` |
| 品牌标记 | `design/brand/`（`mark.svg`、`wordmark.svg`、Windows 应用图标 `app.ico` 含 16 / 24 / 32 / 48 / 256） |
| 动效 | `design/motion/<名称>.md`（规格）与 `design/motion/index.html`（全部动效的可点击演示） |
| 总览 | `design/icons/index.html`：全部图标在 16 / 20 / 24 px、浅色与深色下的对照表 |

- 文件名小写 kebab-case 英文，与下表“名称”一致；不带版本号、日期、`new` / `final` / `v2` 等字样（仓库卫生规则会拒绝）。
- 修改直接覆盖原文件，历史留在 git；不保留旧版文件。
- 全部为原创。参考开源图标（Lucide、Phosphor 等）时不得复制路径；如确需派生，在 `design/icons/LICENSES.md` 写明来源与许可。

## 3. 图标规格

| 项 | 规定 |
| --- | --- |
| 画板 | 24 × 24，内容区 20 × 20（四周留 2） |
| 使用尺寸 | 16（侧栏、工具栏、表格内）、20（对话框、空状态）、24（插件、资源种类） |
| 线条 | 描边 1.5，圆头圆角；不用填充，除非是表示“实心”的小点（直径 ≥ 3） |
| 转角 | 矩形转角半径 1.5–3，与界面的柔和圆角协调；不画尖角方框 |
| 颜色 | 只用 `currentColor`；不写任何色值，由界面决定颜色 |
| 像素 | 在 16 px、Windows 100 % 缩放下横竖线落在整像素上，不发虚 |
| 文件 | 纯 SVG：`viewBox="0 0 24 24"`，无 `width/height`、无 `<style>`、无滤镜、无文字、无内嵌位图；每个文件带 `<title>` 写中文名 |
| 一致性 | 同组图标视觉重量一致：并排在 16 px 时，没有哪个明显更黑或更小 |

### 3.1 图标清单

全量清单共 117 个图标，覆盖 12 个分组。★ 标记高频基础项；完整体系还覆盖模块、来源、计算、建模、线路、资源和结果，不以通用操作图标代替领域含义。

| 分组 | 名称 · 含义 |
| --- | --- |
| `nav` ★ | `home` 首页 · `cable-type` 型号 · `study` 研究 · `library` 库 · `plugin` 插件 · `settings` 设置 · `recent` 最近 |
| `module` | `structure` 结构设计 · `standard-check` 标准核对 · `electrical` 电气参数 · `rating-table` 载流量表 · `short-circuit` 短路容量 · `sweep` 参数扫描 · `method-compare` 方法对比 · `datasheet` 规格书 · `add-module` 添加模块 |
| `object` ★ | `overview` 概况 · `cable` 电缆结构 · `section` 敷设截面 · `route` 线路 · `conditions` 工况与判据 · `study` 计算 · `delivery` 交付 |
| `action` ★ | `add` · `edit` · `delete` · `duplicate` · `undo` · `redo` · `save` · `import` · `export` · `search` · `filter` · `more` · `close` · `chevron-down` · `chevron-right` · `external` · `copy` · `history` · `compare` · `refresh` · `publish` 发布到库 · `detach` 脱离引用 · `replace` 替换引用 · `locate` 定位对象 · `sort-ascending` 升序 · `sort-descending` 降序 · `visible` 显示对象 · `hidden` 隐藏对象 |
| `run` ★ | `run` 运行 · `stop` 停止 · `preflight` 预检 |
| `agent` ★ | `agent` Agent · `proposal` 提案 · `approve` 批准 · `reject` 拒绝 · `retry` 重试 · `branch` 分支 · `send` 发送 · `attach` 附加资料 · `step-read` 已读取 · `step-run` 已运行 |
| `source` | `from-library` 库引用 · `from-standard` 标准值 · `from-document` 资料 · `from-user` 用户录入 · `derived` 推导 · `locked` 锁定 · `unlocked` 解锁 |
| `calc` | `ampacity` 载流量 · `thermal-field` 温度场 · `electric-field` 电场 · `magnetic-field` 磁场 · `short-circuit` 短路热稳定 · `induced-voltage` 感应电压与环流 · `electrical-params` 电气参数 · `voltage-drop` 电压降 · `selection` 选型 · `cross-check` 交叉校核 · `sweep` 参数扫描 |
| `tool` | `select` 选择 · `pan` 平移 · `zoom-in` · `zoom-out` · `fit` 适应窗口 · `place-cable` 放置电缆 · `duct-bank` 排管 · `medium-zone` 介质分区 · `dimension` 标注 · `measure` 测量 · `snap` 捕捉 · `align` 对齐 · `section-cut` 剖切 · `view-3d` 三维查看 |
| `route` | `segment` 分段 · `joint` 接头 / 接头井 · `crossing` 交叉 · `heat-source` 外部热源 · `bonding` 接地方式 · `profile` 纵断面 |
| `resource` | `material` 材料 · `cable-type` 电缆型号 · `section-template` 截面模板 · `route-template` 线路模板 · `condition-set` 工况与判据 · `calc-scheme` 计算方案 · `delivery-template` 交付模板 |
| `result` | `scalar` 数值结论 · `table` 数值表 · `curve` 曲线 · `field` 场分布 · `radial` 径向分布 · `snapshot` 运行快照 · `report` 计算书 · `evidence` 验证依据 |

`design/plugin-system/icons/` 与 `plugins/<id>/assets/icon.svg` 是现有参考，按本规格重画后替换。

### 3.2 不是图标的符号

以下由组件用 CSS / SVG 绘制，不作为图标文件交付，但素材方需在 `design/icons/index.html` 中与图标并排检查视觉协调：

- 同心状态点：实心带环 = 当前，空心 = 历史，虚线 = 草稿，斜线 = 失败，转动虚线 = 执行中，空心带中心点 = 排队。直径 10。
- 判据小方块：满足 / 不满足（实心色块）、无法判断（空心）。边长 8。
- 验证等级环：5 层同心环，实心层数 = 等级（未验证 1 … 交叉验证 5）。直径 18。

### 3.3 使用与选中

- 稳定标识为 `分组/名称`，图标与文字一起使用；只显示图标的按钮必须有功能名称。来源图标不代表可信等级，结果图标不代表运行成功。
- 导航、目录与工具模式的当前位置使用共享灰底；画布对象、表格行与图标预览的选中使用墨线框；键盘焦点仍为独立外框。
- 图标选中只播放一次内部描线：电缆与材料由内向外、线路先路径后节点、计算先外框后字段、精确工具先基准后标记。参与动画的底层笔画暂降透明度，让笔画逐段显现；结束后恢复完整原图。不整枚缩放、旋转或弹跳。
- 单次动作（删除、发布、运行）不在业务中保持“已选中”；图标总览中的选中仅用于检查素材，不执行对应操作。
- 图标总览支持分组、中文与英文名检索、16 / 20 / 24 px 浅深色对照及选中演示。两个总览共用 `design/icons/selection.js` 与 `selection.css`。

## 4. 品牌标记

- 意象：电缆截面——外护套环、绝缘环、铜导体核心。导体铜是唯一彩色，其余用文字色与次要色。
- `mark.svg` 在 16 px 仍可辨认（最多三层）；`wordmark.svg` 为标记 + “CableSimPro”，字体用界面字体 600。
- 浅色、深色背景各给一张检查图；应用图标在 Windows 任务栏 16 / 24 px 下检查。

## 5. 动效规格

### 5.1 统一参数

| 名称 | 值 | 用于 |
| --- | --- | --- |
| 时长 · 快 | 120 ms | 悬停、选中框、草稿虚线出现 |
| 时长 · 标准 | 200 ms | 状态点变化、对话框与抽屉 |
| 时长 · 慢 | 320 ms | 结果变为历史、提案出现、锚点滚动 |
| 时长 · 传导 | 800 ms | 运行开始 |
| 缓动 · 标准 | `cubic-bezier(.2, 0, 0, 1)` | 进入与变化 |
| 缓动 · 退出 | `cubic-bezier(.4, 0, 1, 1)` | 离开 |
| 循环 | 1200 ms 线性 | 执行中 |

- 用 [Motion](https://motion.dev)（MIT）与 CSS 实现：简单的颜色、透明度变化用 CSS 过渡，数值过渡、描边、布局变化用 Motion；不用 Lottie、GIF、视频。素材方交付的是规格与演示，不是视频文件。
- 系统开启“减少动态效果”时：不做位移和缩放，状态直接切换；数值直接显示终值。
- 同一时刻一处只播放一个动效；不阻塞操作，动效进行中可继续点击。

### 5.2 动效清单

| 名称 | 触发 | 表现 | 时长 |
| --- | --- | --- | --- |
| `run-conduct` 运行传导 | 点击“运行” | 铜色沿按钮与截面的连线传入；两个细环从导体向外护套扩散并消隐，环心保持固定 | 800 |
| `running` 执行中 | 运行排队或执行 | 状态点为铜色虚线环匀速转动 | 1200 循环 |
| `result-arrive` 结果到达 | 运行成功 | 结论数值从旧值过渡到新值（三次缓出）；状态点 执行中 → 当前 | 420 |
| `result-stale` 结果变为历史 | 相关输入被修改并保存 | 结论数值颜色从正文色过渡到次要文字、透明度降到 60 %；状态点 当前 → 空心 | 320 |
| `run-failed` 运行失败 | 运行失败或预检不通过 | 状态点画出斜线；原因文字出现。不抖动、不闪红 | 200 |
| `draft-mark` 草稿 | 字段被修改未保存 | 字段边框变为需注意色虚线 | 120 |
| `revision-saved` 保存修订 | 保存成功 | 顶栏状态点 虚线 → 实心带环；修订号数字过渡 | 200 |
| `proposal-arrive` 提案出现 | Agent 或资料导入产生提案 | 光纤青虚线框沿边框描出 | 320 |
| `select-frame` 选中 | 画布或表格选中对象 | 墨线框从对象外 4 px 收紧到贴合 | 120 |
| `icon-select` 图标选中 | 点击、键盘切换导航或工具 | 当前位置灰底平移到目标，目标图标依语义描出内部结构；选中与键盘焦点独立 | 灰底 200，描线 200–320 |
| `snap-guide` 捕捉 | 拖动时命中捕捉 | 对齐参考线立即出现，离开即消失 | 0 |
| `drawer` 抽屉 / 对话框 | 打开 / 关闭 | 透明度 + 4 px 位移 | 200 |
| `anchor-scroll` 目录定位 | 点击工程目录 | 平滑滚动到该节，该节标题短暂显示悬停底 | 320 |
| `agent-stream` Agent 流式输出 | Agent 回复 | 内容按段落逐段淡入，不显示闪烁光标 | 每段 120 |
| `agent-step` 工具调用 | Agent 读取、预检、生成提案 | 保留对应工具图标；当前步骤的图标以光纤青描线，完成后回到静态并更新文字，再联动下一步骤 | 200 切换 |

不要的：页面切换动画、骨架屏闪光、加载转圈遮罩、数字滚轮、粒子、彩带、按钮按下弹跳。

每个动效的 `design/motion/<名称>.md` 写明：触发、参与元素、关键帧、时长与缓动、减少动态效果时的替代、在 `index.html` 中的演示位置。

## 6. 验收

1. 图标在 16 / 20 / 24 px、100 / 125 / 150 % 缩放、浅色 / 深色下逐一检查，无发虚、无粘连、同组重量一致。
2. 对比度：图标与状态符号对背景 ≥ 3 : 1（WCAG 2.1 AA 非文本）。
3. 所有 SVG 通过规格检查：只含 `currentColor`、`viewBox` 正确、无多余属性。
4. 动效在减少动态效果开启时全部退化为直接切换。
5. 以 `design/icons/index.html` 与 `design/motion/index.html` 的截图交使用者复核；新增图标也必须具备相同尺寸、主题、键盘与减少动态效果检查。
