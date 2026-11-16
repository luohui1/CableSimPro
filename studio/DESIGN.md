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
| `workbench/page`：`PageHeader` `PageTabs` `Panel` `Split` `Toolbar` | 页头（标题加唯一主按钮）、同一对象的几页、贴边平铺的面板、可拖动分栏、表格上方的工具行 |
| `workbench/form`：`FormSection` `FormRow` `UnitInput` `ChoiceCards` `ChoiceSelect` `SourceTag` `FormNote` `DropZone` | 表单：名称在左、控件在右，单位在框内成列；几种做法用卡片，固定清单用下拉；值的出处（标准、推算、给定、厂家表、人工填写）；动手前要知道的事；拖放文件 |
| `workbench/flow`：`FlowLayout` `Stepper` | 一屏分步的任务（导入结构表、按标准生成）：步骤一列在左，当前步的内容在右，往前走的按钮在下 |
| `workbench/runs`：`RunRail` | 一个工程的运行记录排成一行，旧的在前；多了横向滚动；Agent 算的、输入改过之后的各带一个点 |
| `workbench/side-editor`：`SideEditor` `SideEditorSection` | 从右边停靠出来的编辑栏，占结论面板的位置，画面不动；底部是唯一的应用动作 |
| `workbench/review`：`ReviewTrack` `ReviewActions` `VersionSelect` | 一个版本的审核：四个状态竖排，到过的记下谁、何时、说了什么；每个状态下人能走的一步；页头的版本切换 |
| `workbench/chart`：`CurveChart` `TargetBar` | 结果图（recharts）：一个结果随一个条件的曲线，工程取值和比较水平是参考线；表格里数值对目标的比例条 |
| `workbench/form` 补：`ReadonlyValue` `ConnectionCheck`；`FormSection split` | 只显示不改的值（来自环境变量）；一个服务连不连得上（还没检查、正在检查、连通、连不上并给原话）；设置页的左说明右字段 |
| `theme-color`：`useThemeColor` | 给 CSS 之外画图的东西（三维视口、画布）取主题色，换主题时重取 |
| `workbench/data-table`：`DataTable` | 高密度表：表头固定、行高 36、单位在表头、数值右对齐、可分组、可汇总、选中行铜色浅底，可选中的行能用键盘选 |
| `workbench/premise`：`PremiseStrip` `Given` `EmptyState` | 计算屏的“求什么、已知什么”；空状态 |
| `workbench/canvas`：`CanvasFrame` `CanvasToolbar` `CanvasTool` `CanvasLayer` `TemperatureLegend` | 断面画布外框：工具左上、视图右上、图例左下、状态栏在下；画布内容是 `ui/canvas` 自有绘图 |
| `marks`：`TierMark` `ReviewMark` `VerdictMark` `VerdictBar` `Dot` | 可信分档、审核状态、核对结论（一个词加一个图标；表格里用一条比例条） |
| `disclosure`：`Disclosure` `DisclosurePanel` `DisclosureMore` `DisclosureRoot` | 面板里点开才看的分组（损耗、热阻、已通过的核对项），“其余 N 项” |
| `metric`：`Metric` `LimitMeter` | 一屏的主数字；数值对着它的限值 |
| `properties`：`PropertyGroup` `PropertyList` | 名称、数值、单位三列对齐 |
| `icon`：`Icon` `ProductMark` `Spinner` | 自有图标 `design/icons`（`group/name`） |

接 assistant-ui 时：叶子部件都收任意属性，可放进原语的 `render={…}`（如 `<ComposerPrimitive.Send render={<ComposerSend />} />`）；只收 `className` 的原语用 `composerInputClass`。

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
| `import-upload` 导入结构表 · 上传 | 把厂家的结构表交给软件：拖进来，或先用公开样例试一遍 |
| `import-sheet` 导入结构表 · 选工作表 | 挑出要导入的那张工作表，一张表成一个系列 |
| `import-columns` 导入结构表 · 列对应 | 确认表里每一列对应哪个字段，不对的改掉，不要的列不导入 |
| `import-preview` 导入结构表 · 预览 | 看每一行会生成什么规格、哪些行能导入、哪些行跳过，尺寸怎么闭合 |
| `import-commit` 导入结构表 · 导入 | 补齐系列信息和表里没有的尺寸及依据，把整张表导入成一批第 1 版草稿 |
| `type-new-manual` 新建型号 · 从零填写 | 从导体往外逐层填出一个规格，边填边看断面，建成第 1 版草稿 |
| `type-new-standard` 新建型号 · 按标准生成 | 看标准给出的各层尺寸和每个数的出处，与厂家手册对照，再决定补齐并建成草稿 |
| `series` 型号工作区 · 结构与核对 | 把一个规格的结构和标准核对看全，决定改哪一层、出新版本 |
| `series-params` 型号工作区 · 参数 | 查一个版本的电气参数和短路电流：算了哪些、依据哪条，还缺什么 |
| `series-rating` 型号工作区 · 载流量表 | 读一个版本的载流量表：每种敷设、每档土壤热阻率下的允许电流，以及它可信到什么程度 |
| `series-versions` 型号工作区 · 版本与文件 | 看这个规格有哪几版、每版为什么改、审到哪一步，提交、审核、发布或出新版本，拿走文件 |
| `project-new` 新建载流量工程 | 为一个规格开一个载流量工程：选规格、选敷设方式、填工况，建好就算 |
| `rating` 载流量计算 | 回答这款电缆这样敷设能带多大电流、哪根先到温限、依据是什么 |
| `rating-edit` 载流量计算 · 改已知条件 | 改一个已知条件，一边看着原来的结果，一边决定按新条件重算 |
| `rating-sweep` 载流量计算 · 扫描 | 看一个条件从小到大变化时，允许电流和导体温度怎么走，哪一点最紧 |
| `rating-selection` 载流量计算 · 选型 | 按目标电流从一个系列里选出最小够用的截面，并看清其余规格为什么不选 |
| `settings-model` 设置 · Agent 用的模型（实时取自宿主） | 确认 Agent 用的是哪个接口、哪个模型，密钥配了没有，连不连得上 |
| `settings-model-missing` 设置 · 模型未配置 | 看到模型还没配置，照着说明设好环境变量再重启 |

拼这些屏的约定：

- 一个规格的四页共用页头：标题后是版本切换和审核状态，下面是页签；页里显示的是页头所选的那一版。载流量表挂在算它的那一版上。
- 一个工程的运行记录在页头下排成一行；“求什么、已知什么”说的是选中的那条记录；改已知条件用侧栏，画面留着，算了才有新记录。
- 结果先给结论（主数字、先到温限、选定规格），再给表和图；拒算的规格写方法给的原话，不当成零。
- 审核按钮只给人：Agent 的提案走待审卡，不会出现提交审核、审核通过、发布。
- 对话进行中：侧栏那条会话转圈，输入框的发送换成停止；步骤在做的那一步转圈并展开；字还在出来时末尾是光标，第一个字出来前是三个点。
- 等人决定时，待审卡的“接受”是那屏唯一的铜色按钮，输入框提示先审提案。
- 拒算卡在步骤下面时，步骤不再重复原因；连不上本机服务是输入框上方的出错条，带重试。
- 空状态的两块是这款产品自己的图：型号是电缆断面，载流量是电缆在土里的温度场；数字是库里真有的。
- 三维卡的网格向宿主要（`library.geometry`，宿主建一次后留着），不进仓库；视口铺满卡里的灰底（`cad-fill`），底色用 `useThemeColor('--fill')` 跟着主题换。接法照 `ui/pages/gallery/live-screens.tsx` 的 `ModelCardLive`。
- 设置页的模型一节只读：值来自环境变量，页面上显示接口主机、模型名和“密钥已配置 / 未配置”，从不显示密钥本身；怎么改用宿主自己的说明原文。
- 标准给出的值带条款和页码；表里写“手册未列”“—”，不编值。

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
