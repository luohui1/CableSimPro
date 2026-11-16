# Cable Studio 界面规范

界面长什么样，以本文件和陈列页 `/gallery` 为准；方向和界面规矩见 [ROADMAP.md](ROADMAP.md)。页面只拼 `ui/kit` 与 `ui/components/ui` 的部件，不写自己的样式。陈列页里没有的部件，先加进 kit 和陈列页，再用。

## 主题（`ui/styles/theme.css`，由 `design/tokens.css` 补全）

| 项 | 取值 |
| --- | --- |
| 字体 | Inter 写拉丁字母和数字，Noto Sans SC 写中文；数字一律等宽（`tabular-nums`） |
| 字号 | 界面 14/22（`text-ui`、`text-sm`），对话正文 15/26（`text-prose`），说明 13/20（`text-caption`，最小，用于分组名、状态栏）；标题三级：`text-h1` 20/28、`text-h2` 16/24、`text-h3` 14/22，均 600；空状态大标题 `text-display` 28/36；主数字 `text-metric` 32/36、`text-metric-sm` 24/28 |
| 文字色 | 正文 `ink`；次要 `ink-2`（白底 6.6:1，深底 7.8:1）；`ink-3` 只给占位符和安静的图标（4.5:1），不写内容 |
| 中性色 | 底 `canvas`（外框、侧栏）、面 `surface`（屏幕本身、卡片）、浅底 `subtle`、悬停 `hover`、分隔线 `line`、控件边 `line-strong` |
| 铜色 | `copper` 只给主按钮、选中（`copper-fill`）和焦点环；不做装饰、不做强调字 |
| 结论色 | 通过 `success`、注意 `attention`（琥珀，与铜色分开，改自令牌的 #A4560B）、不通过 `error`，各有浅底 `*-fill`；浅底上的字用加深的 `attention-ink`、`agent-ink`（不低于 4.5:1）；总配图标，少量使用。Agent 的提案用 `agent` 青色 |
| 间距 | 4 的倍数，只用整数步（`p-3`、`gap-4`…）；屏幕边距 24，面板内边距 16 |
| 圆角 | 字段 8（`rounded-field`）、列表项 10（`rounded-nav`）、卡片 12（`rounded-card`）、面板与对话框 16（`rounded-sheet`）、输入框 24（`rounded-composer`）；按钮和标签是胶囊 |
| 尺寸 | 控件 36（紧凑 32）、表格行 36、页头 64、面板标题栏 44、状态栏 32 |
| 阴影 | 只给浮起来的东西：输入框 `shadow-composer`、菜单与浮在画布上的工具 `shadow-menu`、对话框 `shadow-modal`。卡片和面板不用阴影，用线 |
| 动效 | 小变化 150 ms（`duration-fast`），展开收起 200 ms（`duration-std`、`transition-height`），曲线 `ease-std`，不弹跳；进行中的步骤用 `shimmer`；系统要求少动时停。令牌里的 `--motion-fast` 120 ms 不再用于新界面 |
| 深浅色 | 顶栏切换，两套都成立；颜色全部来自令牌，换主题不改代码 |

## 部件（`ui/kit`）

| 部件 | 用途 |
| --- | --- |
| `frame`：`AppFrame` `TopBar` `ModeSwitch` `ModelBadge` `ThemeToggle` | 两种模式共用的外框：灰底上的顶栏和侧栏，屏幕是一张内嵌的白纸 |
| `chat/sidebar`：`ChatSidebar` `NewChatButton` `ChatSearch` `ChatGroup` `ChatItem` `ChatListEmpty` | 会话列表，按时间分组；打开的会话是选中色，干活中的有转圈；`ChatItem` 可经 `render` 渲染成链接，`ChatGroup` 负责 `<li>` |
| `chat/empty`：`AgentEmpty` `TaskStarter` `ChatNotice` | 空对话：一句话说能交办什么，加按两件事分组的现成任务 |
| `chat/messages`：`ThreadColumn` `UserMessage` `AssistantMessage` `Prose` `Typing` `threadViewportClass` | 人的话在右边灰泡里；Agent 的话不加泡，Markdown 包在 `Prose` 里；正在回答时三个点；对话视口顶部淡入 |
| `chat/steps`：`StepTrace` | 一次任务的步骤收成一行，点开是时间线（shadcn Trace）；进行中、等你审阅、失败、中止各有样子 |
| `chat/cards`：`RatingCard` `CheckCard` `ProposalCard` `FileCard` `ModelCard` `RefusalCard` `CardLoading` `CardFrame` `CardAction` `OpenInWorkbench` | 载流量结果、标准核对、待审改动、文件、三维模型、拒算或出错、读取中；一张卡一层，不套卡 |
| `chat/composer`：`ComposerFrame` `ComposerInput` `ComposerBar` `ComposerAttach` `ComposerSend` `ComposerStop` `FileChip` `composerInputClass` | 输入框；发送是墨色，停止在任务进行中出现 |
| `workbench/nav`：`WorkbenchNav` `NavSection` `NavItem` | 工作台的两个工作区（电缆型号、载流量计算）和最近的对象；`NavItem` 可经 `render` 渲染成路由链接 |
| `workbench/page`：`PageHeader` `Panel` `Split` `Toolbar` | 页头（标题加唯一主按钮）、贴边平铺的面板、可拖动分栏、表格上方的工具行 |
| `workbench/data-table`：`DataTable` | 高密度表：表头固定、行高 36、单位在表头、数值右对齐、可分组、可汇总、选中行铜色浅底，可选中的行能用键盘选 |
| `workbench/premise`：`PremiseStrip` `Given` `EmptyState` | 计算屏的“求什么、已知什么”；空状态 |
| `workbench/canvas`：`CanvasFrame` `CanvasToolbar` `CanvasTool` `CanvasLayer` `TemperatureLegend` | 断面画布外框：工具左上、视图右上、图例左下、状态栏在下；画布内容是 `ui/canvas` 自有绘图 |
| `marks`：`TierMark` `ReviewMark` `VerdictMark` `VerdictBar` `Dot` | 可信分档、审核状态、核对结论（一个词加一个图标；表格里用一条比例条） |
| `disclosure`：`Disclosure` `DisclosurePanel` `DisclosureMore` `DisclosureRoot` | 面板里点开才看的分组（损耗、热阻、已通过的核对项），“其余 N 项” |
| `metric`：`Metric` `LimitMeter` | 一屏的主数字；数值对着它的限值 |
| `properties`：`PropertyGroup` `PropertyList` | 名称、数值、单位三列对齐 |
| `icon`：`Icon` `ProductMark` `Spinner` | 自有图标 `design/icons`（`group/name`） |

接 assistant-ui 时：叶子部件都收任意属性，可放进原语的 `render={…}`（如 `<ComposerPrimitive.Send render={<ComposerSend />} />`）；只收 `className` 的原语用 `composerInputClass`。

## 五屏

| 屏 | 工程师在这屏要干成的事 |
| --- | --- |
| Agent 空状态 | 把一件电缆的事交给 Agent：说一句话、拖入结构表，或点一个现成的任务 |
| Agent 做完的对话 | 看 Agent 做了什么、算出了什么，审它提的改动，拿走结果和文件 |
| 型号库 | 找到一款型号，看清它每个规格的尺寸、审核状态和核对结果，打开它或导入新的结构表 |
| 一款型号的工作区 | 把一个规格的结构、参数和标准核对看全，决定改哪一层、出新版本 |
| 载流量计算 | 回答这款电缆这样敷设能带多大电流、哪根先到温限、依据是什么 |

## 能做和不能做

- 能：一屏一个铜色主按钮，指向下一步；其余按钮描边或无底。
- 能：面板贴边平铺、用线分隔；层级靠字号、粗细和留白，不靠框。
- 能：次要信息收进点开才看的地方（步骤要点、损耗与热阻、未覆盖的核对项、条款原文用悬停）。
- 能：长名字在列表里省略并在悬停时给全名；导航里的对象名可占两行。
- 不能：手写颜色值、方括号任意尺寸、行内样式；Tailwind 自带色板已关掉。
- 不能：在 `components/ui`、`kit` 之外直接用原生按钮、输入框、下拉、表格；不能再引入 Mantine。
- 不能：成行的灰色小字、卡片套卡片、标签加数字的墙；文字小于 13 px；用透明度把文字变淡。
- 不能：编数。示例数据取真实运行；没有真实值就摆空状态或拒算状态。

## 检查

`npm run build` 先跑 `node scripts/ui-lint.ts`（也可 `npm run lint:ui`），违反即失败：主题文件外的颜色值、自带色板和用变量绕开主题的颜色；方括号任意值、任意属性，页面里的 `(--变量)` 写法；行内样式；透明度变淡的文字；主题之外的阴影名；非整数步的间距；`components/ui` 与 `kit` 之外的原生按钮、输入框、下拉、表格和 `role="button"`；Mantine。字符串里的 `/*`、`//` 不当注释。重做前的页面列在脚本的豁免清单里，每项写明谁在什么时候删、现在还欠几处：欠得更多就失败，欠到 0 就必须删掉那一行，欠得更少按提示把数字改小。`--report` 列出每一处。
