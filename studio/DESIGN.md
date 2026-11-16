# Cable Studio 界面规范

界面长什么样，以本文件和陈列页 `/gallery` 为准；方向和界面规矩见 [ROADMAP.md](ROADMAP.md)。页面只拼 `ui/kit` 与 `ui/components/ui` 的部件，不写自己的样式。陈列页里没有的部件，先加进 kit 和陈列页，再用。

## 主题（`ui/styles/theme.css`，由 `design/tokens.css` 补全）

| 项 | 取值 |
| --- | --- |
| 字体 | 令牌 `--font-ui`：Inter 写拉丁字母和数字，Noto Sans SC 写中文；数字一律等宽（`tabular-nums`） |
| 字号 | 界面 14/22（`text-ui`、`text-sm`），对话正文 15/26（`text-prose`），说明 13/20（`text-caption`，最小，用于分组名、状态栏）；标题三级：`text-h1` 20/28、`text-h2` 16/24、`text-h3` 14/22，均 600；空状态大标题 `text-display` 28/36；主数字 `text-metric` 32/36、`text-metric-sm` 24/28 |
| 文字色 | 正文 `ink`；次要 `ink-2`（白底 6.6:1，深底 7.8:1）；`ink-3` 只给占位符和安静的图标（4.5:1），不写内容 |
| 中性色 | 底 `canvas`（外框、侧栏）、面 `surface`（屏幕本身、卡片）、浅底 `subtle`、悬停 `hover`、分隔线 `line`、控件边 `line-strong` |
| 铜色 | `copper` 只给主按钮、选中（`copper-fill`）和焦点环；不做装饰、不做强调字 |
| 结论色 | 通过 `success`、注意 `attention`（琥珀 #9A6700 / 深色 #D29922，与铜色分开）、不通过 `error`，各有浅底 `*-fill`；浅底上的字用加深的 `attention-ink`、`agent-ink`（不低于 4.5:1）；总配图标，少量使用。Agent 的提案用 `agent` 青色 |
| 间距 | 4 的倍数，只用整数步（`p-3`、`gap-4`…）；屏幕边距 24，面板内边距 16 |
| 圆角 | 字段 8（`rounded-field`）、列表项 10（`rounded-nav`）、卡片 12（`rounded-card`）、面板与对话框 16（`rounded-sheet`）、输入框 24（`rounded-composer`）；按钮和标签是胶囊 |
| 尺寸 | 控件 36（紧凑 32）、表格行 36、页头 64、面板标题栏 44、状态栏 32 |
| 阴影 | 只给浮起来的东西：输入框 `shadow-composer`、菜单与浮在画布上的工具 `shadow-menu`、对话框 `shadow-modal`。卡片和面板不用阴影，用线 |
| 动效 | 小变化 150 ms（`duration-fast`），展开收起 200 ms（`duration-std`、`transition-height`），曲线 `ease-std`，不弹跳；进行中的步骤用 `shimmer`；系统要求少动时停。时长取令牌 `--motion-fast`、`--motion-standard` |
| 深浅色 | 顶栏切换，两套都成立；颜色全部来自令牌，换主题不改代码 |

## 部件（`ui/kit`）

来源一列写部件建在哪个库的哪个组件上；“自有”是这款产品自己的版面或绘图，后面写为什么没有现成的可用。`ui/components/ui` 全部取自 shadcn/ui 的 base-nova（Base UI）并按主题改过；例外是 `number-field`（照 shadcn 的写法包 Base UI NumberField，shadcn 没有这一项）、`command`（cmdk）、`sonner`（sonner）、`chart`（recharts）。

| 部件 | 用途 | 来源 |
| --- | --- | --- |
| `frame`：`AppFrame` `TopBar` `ModeSwitch` `ModelBadge` `ThemeToggle` | 两种模式共用的外框：灰底上的顶栏和侧栏，屏幕是一张内嵌的白纸 | 模式切换 shadcn Tabs；模型徽标 shadcn Tooltip 加 @lobehub/icons-static-svg 的厂商标；主题切换 shadcn Button 加 lucide 的太阳；外框是自有版面 |
| `chat/sidebar`：`ChatSidebar` `NewChatButton` `ChatSearch` `ChatGroup` `ChatItem` `ChatListEmpty` | 会话列表，按时间分组；打开的会话是选中色，干活中的有转圈；`ChatItem` 可经 `render` 渲染成链接，`ChatGroup` 负责 `<li>` | 新对话 shadcn Button，搜索 shadcn InputGroup；分组和会话项暂是自有列表项（Base UI useRender），要换成 shadcn sidebar 的菜单部件，见“选型结论” |
| `chat/empty`：`AgentEmpty` `TaskStarter` `TileFact` `EmptyStatus` `ChatNotice` | 空对话：一句话说能交办什么，加按两件事分组的现成任务，底部一行是依据和库里的数 | 现成任务 shadcn Item（渲染成按钮），提示条 shadcn Alert；版面、两块图（电缆断面、土里的温度场）和底部事实行是自有：这是产品自己的封面 |
| `chat/messages`：`ThreadColumn` `UserMessage` `AssistantMessage` `Prose` `Typing` `StreamCaret` `TurnSpacer` `useLastTurnAtTop` `threadViewportClass` | 人的话在右边灰泡里；Agent 的话不加泡，Markdown 包在 `Prose` 里；正在回答时三个点，字在出来时末尾是光标；对话视口顶部淡入 | 列表、滚动和流式由 assistant-ui 的 ThreadPrimitive、MessagePrimitive 负责，这里是经 `render` 放进去的版面和排版（自有） |
| `chat/steps`：`StepTrace` | 一次任务的步骤收成一行，点开是时间线；进行中、等你审阅、失败、中止各有样子 | shadcn Trace |
| `chat/cards`：`RatingCard` `CheckCard` `ProposalCard` `FileCard` `ModelCard` `RefusalCard` `CardLoading` `CardFrame` `CardAction` `OpenInWorkbench` `RatingTableCard` `StandardProposalCard` `CorrectionCard` `RelatedLinks` | 载流量结果、标准核对、待审改动、文件、三维模型（视口 2:1，切换在视口下面，不压在模型上）、拒算或出错、读取中；载流量表（变化的条件一列、每种敷设一列，拒算的格写“拒算”）、标准提案（每个尺寸带出处，标准不规定的照原话列出）、GB 50217 校正（校正后电流、逐个系数的条件和条款页码、基准原话和核对人、适用范围）；一步碰到的几个对象排成一行链接组；一张卡一层，不套卡 | shadcn Item、Collapsible、Badge、Button、ToggleGroup、Skeleton、Input；拒算卡内部 shadcn Alert；三维视口由页面传入（three.js） |
| `section-thumb`：`SectionThumb` `thumbOf` | 一次运行的敷设断面缩略图，4:3：土壤按方法给出的温度场着色，电缆按比例画出各层，先到温限的那根描铜色圈，地面在视野里时画地面线；`thumbOf(运行记录)` 给出它要的场景和温度场，方法没给出解析温度场（或与发布的节点对不上）时只画土壤；`crop` 填满别的比例的框 | 自有绘图：`ui/canvas` 的场景、电缆图形和温度场模型，逐像素算出土壤颜色 |
| `chat/composer`：`ComposerFrame` `ComposerInput` `ComposerBar` `ComposerAttach` `ComposerSend` `ComposerStop` `FileChip` `composerInputClass` | 输入框；有内容时发送是铜色（这一屏的主按钮），没内容时是灰的；有待审卡时用 `ComposerSend quiet`，有内容也是描边，铜色让给“接受”；停止在任务进行中出现 | shadcn Button，附件 shadcn Attachment；行为由 assistant-ui 的 ComposerPrimitive 负责，浮起的圆角框是自有版面 |
| `workbench/nav`：`WorkbenchNav` `NavSection` `NavItem` | 工作台的两个工作区（电缆型号、载流量计算）和最近的对象；`NavItem` 可经 `render` 渲染成路由链接 | 暂是自有列表项（Base UI useRender），要换成 shadcn sidebar 的菜单部件，见“选型结论” |
| `workbench/page`：`PageHeader` `PageTabs` `Panel` `Split` `Toolbar` `SelectionBar` | 页头（面包屑、标题、唯一主按钮）、同一对象的几页、贴边平铺的面板、可拖动分栏、表格上方的工具行；勾了几行时工具行换成选择条（已选几个、对它们能做的事、清除选择） | 面包屑 shadcn Breadcrumb，页签 shadcn Tabs，分栏 shadcn Resizable（react-resizable-panels）；面板和工具行是自有版面 |
| `workbench/form`：`FormSection` `FormRow` `UnitInput` `ChoiceCards` `ChoiceSelect` `Segmented` `SourceTag` `FormNote` `DropZone` | 表单：名称在左、控件在右，单位在框内成列；几种做法用卡片，固定清单用下拉，几个短词用分段；值的出处（标准、推算、给定、厂家表、人工填写，不认识的出处照原名显示）；动手前要知道的事；拖放文件（`onFiles` 收到拖入或选中的文件） | 表单行 shadcn Field；带单位的数 Base UI NumberField；卡片选择 shadcn RadioGroup；下拉 shadcn Select；分段 shadcn ToggleGroup；出处 shadcn Badge；说明块 shadcn Alert；拖放 react-dropzone；`FormSection` 是带标题的版面分区（标题是页面大纲里的 h2，所以不用 fieldset 的 legend） |
| `workbench/form` 补：`ReadonlyValue` `ConnectionCheck`；`FormSection split` | 只显示不改的值（来自环境变量）；一个服务连不连得上（还没检查、正在检查、连通、连不上并给原话）；设置页的左说明右字段 | 检查按钮 shadcn Button；只读值是自有文字块（只读输入框能聚焦，看着像能改） |
| `workbench/flow`：`FlowLayout` `Stepper` | 一屏分步的任务（导入结构表、按标准生成）：步骤一列在左，当前步的内容在右，往前走的按钮在下 | 步骤的状态和前后移动 @stepperize/react；步骤列的样子和版面是自有（shadcn 与 Base UI 都没有分步条） |
| `workbench/runs`：`RunRail` | 一个工程的运行记录排成一行，旧的在前；多了横向滚动；Agent 算的、输入改过之后的各带一个点 | 悬停说明 shadcn Tooltip；记录条是自有（没有现成的运行记录条） |
| `workbench/side-editor`：`SideEditor` `SideEditorSection` | 从右边停靠出来的编辑栏，占结论面板的位置，画面不动；顶上是撤销、重做（`tools`，只作用于还没应用的改动），底部是唯一的应用动作 | 按钮 shadcn Button；停靠栏是自有版面：shadcn Sheet 是盖住画面的对话框，这里要画面不动、边改边看 |
| `workbench/review`：`ReviewTrack` `ReviewActions` `VersionSelect` `SpecSwitch` | 一个版本的审核：四个状态竖排，到过的记下谁、何时、说了什么；每个状态下人能走的一步；页头的版本切换；同一系列里换规格（打字找或用箭头走到相邻的） | 按钮 shadcn Button，版本切换 shadcn Select，换规格 Base UI Combobox（shadcn combobox）；四个状态的竖排是自有 |
| `workbench/chart`：`CurveChart` `TargetBar` | 结果图：一个结果随一个条件的曲线，工程取值和比较水平是参考线；表格里数值对目标的比例条 | 曲线 shadcn Chart（recharts）；比例条是自有 SVG |
| `theme-color`：`useThemeColor` | 给 CSS 之外画图的东西（三维视口、画布）取主题色，换主题时重取 | 自有 |
| `workbench/data-table`：`DataTable` | 高密度表：表头固定、行高 36、单位在表头、数值右对齐、可分组、可汇总、选中行铜色浅底，可选中的行能用键盘选；放在表单或说明里时用 `framed` 自带圆角边框；`checked` 加一列勾选（批量计算、批量审核），表头一个全选；没有宽度的一列可设 `truncate`，窄了截断、悬停给全名 | shadcn Table，勾选 shadcn Checkbox（部分勾选是一横）；固定表头、分组、汇总和键盘选择写在 kit 里（表在几十行以内，见“选型结论”） |
| `workbench/premise`：`PremiseStrip` `Given` `GivenMore` `EmptyState` | 计算屏的“求什么、已知什么”（`Given active` 是编辑栏正打开的那一项，“其余 N 项”收起少改的条件）；空状态 | 其余 N 项 shadcn Popover，空状态 shadcn Empty；前提带和一项已知（打开编辑栏的按钮）是自有 |
| `workbench/canvas`：`CanvasFrame` `CanvasToolbar` `CanvasTool` `CanvasLayer` `CanvasNote` `TemperatureLegend` | 断面画布外框：工具左上、视图右上、图例左下、状态栏在下 | 工具条 Base UI Toolbar，工具 shadcn Button、Toggle 加 Tooltip；外框是自有版面，图例和画布内容是 `ui/canvas` 的自有绘图 |
| `marks`：`TierMark` `ReviewMark` `VerdictMark` `VerdictBar` `Dot` `CellStatus` `StatusLine` | 可信分档、审核状态、核对结论（一个词加一个图标；表格里用一条比例条）；表格格子里的状态字（拒算、最热、与现在相同，带原话的悬停给出）；一行状态（图标带颜色，字是正文色） | 分档和审核状态 shadcn Badge，格子状态字的原话 shadcn Tooltip；结论词、比例条、状态点和状态行是自有（一个图标加一句字） |
| `disclosure`：`Disclosure` `DisclosurePanel` `DisclosureMore` `DisclosureRoot` | 面板里点开才看的分组（损耗、热阻、已通过的核对项），“其余 N 项” | shadcn Collapsible |
| `metric`：`Metric` `LimitMeter` `MetricGroup` `MetricText` | 一屏的主数字；数值对着它的限值；几个一起读的数放进一个框；结论是一句话时（先到温限的那根）用 `MetricText` | 限值条 Base UI Meter；主数字和数组是自有排版 |
| `properties`：`PropertyGroup` `PropertyList` `PointList` | 名称、数值、单位三列对齐；带标题的要点列表（方法卡的适用范围、假设、验证算例），长了收进“其余 N 条” | 自有（三列对齐的 `dl`、带标题的 `ul`） |
| `icon`：`Icon` `ProductMark` `Spinner` | 自有图标 `design/icons`（`group/name`） | 自有；lucide-react 只补自有图标里缺的（主题切换的太阳） |

接 assistant-ui 时：叶子部件都收任意属性，可放进原语的 `render={…}`（如 `<ComposerPrimitive.Send render={<ComposerSend />} />`）；只收 `className` 的原语用 `composerInputClass`。

### 选型结论

装之前逐个核对过：还在维护、支持 React 19 与 Tailwind 4、许可证 MIT、Apache-2.0、BSD 或 ISC。

- 已装：cmdk 1.1.1（命令面板，带 Radix 的无样式依赖，只在这里用）、sonner 2.0.8（轻提示）、react-dropzone 20.2.0（拖放）、@stepperize/react 8.0.1（分步状态）、@lobehub/icons-static-svg 1.102.0（模型厂商标），都是 MIT。
- @lobehub/icons 不装：它依赖 @lobehub/ui 和 antd；同一套图标的纯 SVG 包是 @lobehub/icons-static-svg。
- react-data-grid（7.0.0-beta.64）不用：还是 beta，只能逐格复制粘贴和拖拽填充，没有区域选择；我们的表在几十行以内，shadcn Table 够用。
- react-zoom-pan-pinch（4.2.0）不用：画布自己有缩放、平移和适应窗口，再叠一层是两套手势抢同一个滚轮。
- @scena/react-ruler 不装：最后一次发布在 2023 年 7 月，已停更。
- emblor（标签输入）、react-arborist（树）暂不需要：现在没有这两种界面。
- shadcn sidebar（base-nova，约 730 行，依赖 button、input、separator、sheet、skeleton、tooltip、use-mobile）采用其菜单部件：`SidebarGroup` `SidebarGroupLabel` 换 `NavSection` `ChatGroup`，`SidebarMenuButton`（`isActive`）换 `NavItem` `ChatItem`，`SidebarMenuSub` 放嵌套的最近对象，`SidebarMenuBadge` 放数量，`SidebarMenuAction` 放会话的更多操作，`SidebarMenuSkeleton` 放读取中，`SidebarInput` 换会话搜索。用 `collapsible="none"`：侧栏始终展开，不用它的折叠、Cookie 记忆和手机抽屉。菜单按钮要在 `SidebarProvider` 里用，所以外框包一层 `SidebarProvider`；kit 的接口不变，壳层只加这一层。单独一批做，做之前先告诉执行会话。

## 版式

每屏在 `/gallery#screen=<名字>` 全屏打开。左列是名字，右列是工程师在这屏要干成的事。

| 屏 | 工程师在这屏要干成的事 |
| --- | --- |
| `agent-empty` Agent 空状态 | 把一件电缆的事交给 Agent：说一句话、拖入结构表，或从两类现成的任务里点一个 |
| `agent-chat` Agent 做完的对话 | 看 Agent 做了什么、算出了什么，审它提的改动，拿走结果和文件 |
| `agent-running` Agent 步骤进行中 | 看 Agent 正在做哪一步、做完了哪几步，需要时停下它 |
| `agent-streaming` Agent 回答正在写出 | 边看结果卡边读 Agent 正在写的交代，不必等它写完 |
| `agent-waiting` Agent 提案等你决定 | 看清 Agent 要建或要改的每一项，接受，或写下原因拒绝 |
| `agent-refused` Agent 拒算，附件上传中 | 看懂为什么没有算出结果、缺什么或超出什么范围，并接着交办下一件事 |
| `agent-error` Agent 出错 | 知道任务停在哪一步、为什么停，确认服务恢复后重试 |
| `agent-model` Agent 三维模型卡（实时取自宿主） | 转着看 Agent 建好的三维实体，剖开看各层，下载 STEP，或到工作台接着看 |
| `library` 型号库 | 找到一款型号，看清它每个规格的尺寸、审核状态和核对结果，打开它或导入新的结构表 |
| `library-batch` 型号库 · 选了几个规格 | 给几个规格一起做同一件事：计算与核对、提交审核、审核通过、出规格书；审核只能由人做 |
| `import-upload` 导入结构表 · 上传 | 把厂家的结构表交给软件：拖进来，或先用公开样例试一遍 |
| `import-sheet` 导入结构表 · 选工作表 | 挑出要导入的那张工作表，一张表成一个系列 |
| `import-columns` 导入结构表 · 列对应 | 确认表里每一列对应哪个字段，不对的改掉，不要的列不导入 |
| `import-preview` 导入结构表 · 预览 | 看每一行会生成什么规格、哪些行能导入、哪些行跳过，尺寸怎么闭合 |
| `import-commit` 导入结构表 · 导入 | 补齐系列信息和表里没有的尺寸及依据，把整张表导入成一批第 1 版草稿 |
| `type-new-manual` 新建型号 · 从零填写 | 从导体往外逐层填出一个规格，边填边看断面，建成第 1 版草稿 |
| `type-new-standard-conditions` 新建型号 · 按标准生成 · 条件 | 说清按哪份标准、什么样的电缆，给出屏蔽厚度，让标准给出初始结构 |
| `type-new-standard` 新建型号 · 按标准生成 · 提案与对照 | 看标准给出的各层尺寸和每个数的出处，与厂家手册对照，再决定补齐并建成草稿 |
| `type-new-standard-create` 新建型号 · 按标准生成 · 补齐并建成 | 填上标准不规定的导体外径和成品外径，定下放进哪个系列，建成第 1 版草稿 |
| `series` 型号工作区 · 结构与核对 | 把一个规格的结构和标准核对看全，决定改哪一层、出新版本 |
| `series-edit` 型号工作区 · 修改结构 | 改原表给出的尺寸，写下原因，存成下一版草稿；原来那一版和它的结果都留着 |
| `series-review` 型号工作区 · 审核 | 看清这一版还有哪些缺项，确认看过，写下审核意见，审核通过 |
| `series-sheet` 型号工作区 · 规格书 | 确认规格书按哪一版、写进哪些内容，生成 PDF |
| `series-params` 型号工作区 · 参数 | 查一个版本的电气参数和短路电流：算了哪些、依据哪条，还缺什么 |
| `series-rating` 型号工作区 · 载流量表 | 读一个版本的载流量表：每种敷设、每档土壤热阻率下的允许电流，以及它可信到什么程度 |
| `series-versions` 型号工作区 · 版本与文件 | 看这个规格有哪几版、每版为什么改、审到哪一步，提交、审核、发布或出新版本，拿走文件 |
| `projects` 载流量计算 · 全部工程 | 看所有工程各算的是哪款电缆、怎么敷设、最近一次校核的结果和可信程度，打开一个接着算 |
| `project-new` 新建载流量工程 | 为一个规格开一个载流量工程：选规格、选敷设方式、填工况，建好就算 |
| `rating` 载流量计算 | 回答这款电缆这样敷设能带多大电流、哪根先到温限、依据是什么 |
| `rating-edit` 载流量计算 · 改已知条件 | 改一个已知条件，一边看着原来的结果，一边决定按新条件重算 |
| `rating-sweep` 载流量计算 · 扫描 | 看一个条件从小到大变化时，允许电流和导体温度怎么走，哪一点最紧 |
| `rating-selection` 载流量计算 · 选型 | 按目标电流从一个系列里选出最小够用的截面，并看清其余规格为什么不选 |
| `settings-model` 设置 · Agent 用的模型（实时取自宿主） | 确认 Agent 用的是哪个接口、哪个模型，密钥配了没有，连不连得上 |
| `settings-model-missing` 设置 · 模型未配置 | 看到模型还没配置，照着说明设好环境变量再重启 |

拼这些屏的约定：

- 工作台每一屏的页头都是面包屑加标题：面包屑从工作区写起（电缆型号 › 型号库 › 系列，载流量计算 › 全部工程），标题是这一屏的对象。
- 型号库：审核一列默认安静，只有待审核、已审核、已发布用胶囊；核对一列写全（不通过、通过、缺项），比例条各段之间留缝；选中的行末有“打开”，双击或回车也打开；宽屏（2xl 起）在右边多一栏选中规格的预览（断面、关键尺寸、核对、打开），1366 下收起。
- 型号工作区：分层表里选中或悬停的一层，在断面上用铜色描出它的环，并在断面左下写出这一层的名称和尺寸；断面有缩小、适应窗口、放大；状态栏说清断面一共几层（几芯各几层、共用几层）和右表一行对应几环。
- 计算屏的“已知”在 1366 下保持一行：环境、系统、护套这类少改的条件收进“其余 N 项”，宽屏上照常排开。
- 打开一段做完的对话时，最后一轮的提问在视口顶上（`useLastTurnAtTop` 加 `TurnSpacer`），不把上一轮的卡片切一半；正在进行的对话停在底部。
- 一个规格的四页共用页头：标题是型号（YJV22-8.7/15 kV），后面是换规格（`SpecSwitch`，同一系列里打字找或走到相邻的）、版本切换和审核状态，下面是页签；页里显示的是页头所选的那一版。载流量表挂在算它的那一版上。
- 型号库可以勾选几行：工具行换成选择条，对勾选的规格计算与核对、提交审核、审核通过、出规格书；审核按钮只给人。审核状态筛选留着（审核员要找“待审核”的），用一个下拉，审核一列照旧安静。
- 修改结构、审核、规格书是对话框：修改结构只列原表给出的尺寸，改过的打点并写出原值，原因必填，存成下一版草稿；审核先给这一版的核对比例条和缺项提示，勾选“看过”后才能确认，意见必填；规格书写明按哪一版、写进哪些内容，没审核过的版本每页标“草稿”。
- 一个工程的运行记录在页头下排成一行；“求什么、已知什么”说的是选中的那条记录。
- 改已知条件用侧栏 `SideEditor`，画面留着：改动先攒着，点“按新条件计算”才有新记录。在画布上直接改（拖间距、点埋深）也是待应用的改动，计入“改了 N 项”，画布上用 `CanvasNote` 写出改了什么；撤销、重做只作用于待应用的改动。方法参数（集肤系数 ks、邻近系数 kp）在侧栏的“方法参数”折叠组里，前提带里归进“其余 N 项”。
- 结果先给结论（主数字、先到温限、选定规格），再给表和图；拒算的规格写方法给的原话，不当成零。
- 审核按钮只给人：Agent 的提案走待审卡，不会出现提交审核、审核通过、发布。
- 对话进行中：侧栏那条会话转圈，输入框的发送换成停止；步骤在做的那一步转圈并展开；字还在出来时末尾是光标，第一个字出来前是三个点。
- 等人决定时，待审卡的“接受”是那屏唯一的铜色按钮，输入框提示先审提案；发送用 `ComposerSend quiet`，有内容也不变铜色。
- 拒算卡在步骤下面时，步骤不再重复原因；连不上本机服务是输入框上方的出错条，带重试。
- 空状态的两块是这款产品自己的图：型号是电缆断面，载流量是电缆在土里的温度场；数字是库里真有的。现成任务写成宿主真跑过的工程场景；输入框下有一行结构表投放区；底部是依据的标准、库里有多少系列和规格、两个工作区用的方法（名字加版本），全部取自数据；窄屏时换行，不用省略号截掉字。不用表情符号，不用成片的虚线框。
- 三维卡的网格向宿主要（`library.geometry`，宿主建一次后留着），不进仓库；视口铺满卡里的灰底（`cad-fill`），底色用 `useThemeColor('--fill')` 跟着主题换。接法照 `ui/pages/gallery/live-screens.tsx` 的 `ModelCardLive`。
- 设置页的模型一节只读：值来自环境变量，页面上显示接口主机、模型名和“密钥已配置 / 未配置”，从不显示密钥本身；宿主还没回话时什么都不断言；怎么配置用宿主自己的说明原文（宿主只在未配置时给）。宿主还没有检查连通的操作，连通检查的按钮在接上之前不可用。
- 铜色只给主按钮、选中和焦点；“当前”算选中：曲线上的工程取值、分步里的当前步、表里选中的行。图标、标题不用铜色。
- 方法写名字加版本（“IEC 60287 稳态载流量 1.2.0”），名字取插件清单的 `name` 或能力的 `title`。插件标识（`cablesim.iec60287`）和内部编号（运行 `run-…`、规格 `s-…`、工程 `p-…`）不上屏，只进计算书、规格书的出处页。
- 宿主没给的数是“—”，不是 0；方法没给结果的点或规格写方法的原话（如“该负荷下无有效稳态解；减小负荷或使用数值模型。”），不当成数。
- 示例数据在 `ui/pages/gallery/host-records.ts`（本分支宿主的记录）、`library-data.ts`、`samples.ts`、`run-document.ts`；屏里的数都从这里取。
- 标准给出的值带条款和页码；表里写“手册未列”“—”，不编值。

## 能做和不能做

- 能：一屏一个铜色主按钮，指向下一步；其余按钮描边或无底。对话页里有内容时的发送就是这个按钮；有待审卡时是“接受”。
- 能：面板贴边平铺、用线分隔；层级靠字号、粗细和留白，不靠框。
- 能：次要信息收进点开才看的地方（步骤要点、损耗与热阻、未覆盖的核对项、条款原文用悬停）。
- 能：长名字在列表里省略并在悬停时给全名；导航里的对象名可占两行。
- 不能：手写颜色值、方括号任意尺寸、行内样式；Tailwind 自带色板已关掉。
- 不能：在 `components/ui`、`kit` 之外直接用原生按钮、输入框、下拉、表格；不能再引入 Mantine。
- 不能：成行的灰色小字、卡片套卡片、标签加数字的墙；文字小于 13 px；用透明度把文字变淡。
- 不能：编数。示例数据取真实运行；没有真实值就摆空状态或拒算状态。
- 不能：屏上出现插件标识和内部编号（`cablesim.*`、`run-…`、`s-…`、`p-…`）；方法写名字加版本。
- 不能：一屏两个铜色按钮。有待审卡时“接受”是主按钮，其余（包括有内容的发送）降成描边。

## 检查

`npm run build` 先跑 `node scripts/ui-lint.ts`（也可 `npm run lint:ui`），违反即失败：主题文件外的颜色值、自带色板和用变量绕开主题的颜色；方括号任意值、任意属性，页面里的 `(--变量)` 写法；行内样式；透明度变淡的文字；主题之外的阴影名；非整数步的间距；`components/ui` 与 `kit` 之外的原生按钮、输入框、下拉、表格和 `role="button"`；Mantine。字符串里的 `/*`、`//` 不当注释。重做前的页面列在脚本的豁免清单里，每项写明谁在什么时候删、现在还欠几处：欠得更多就失败，欠到 0 就必须删掉那一行，欠得更少按提示把数字改小。`--report` 列出每一处。
