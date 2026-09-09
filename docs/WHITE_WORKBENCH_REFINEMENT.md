# 纯白专业工作台：布局收敛与交互回归

## 范围

以 PR #19 的 `0479172ec70b15685bb8b690eabf5dbba21220ac` 为固定基线，继续同一 `design/white-workbench-v077` 分支。优先第一模式的真实页面，不另做图片界面或并行演示。保留纯白底色和本地山景装饰，不生成新图，也不把装饰图作为实时工程模型。

## 先核对上一轮失败

专项 run `34301954079` 已失败，不能称为浏览器验收完成。

- artifact `10085318249` 的设计 JUnit：10 tests / 2 failures。两个浏览器均在计算书断言失败；界面采用一位小数，HTML 计算书采用两位小数。测试现按真实响应核对报告精度、完整输入摘要及运行温度，不修改求解数字来迎合截图。
- artifact `10085420743` 的兼容性 JUnit：42 tests / 3 failures。两项来自参数输入字体被缩到 13px；恢复桌面 14px，窄屏输入 16px。
- 另一项来自 WebKit 拒绝旧提案后立即重载：trace 中 POST 被导航取消，记录为 Load request cancelled。测试先确认拒绝响应 HTTP 200 和提案卡移除，再重载并保留原版本、提案消失断言；没有增加超时、重试或删掉测试。这不等于新增了强制关闭页面时的保存保障。

## 已实现

1. 在现有 token 单一来源中加入输入字体、触控高度、参数栏与画布尺寸；生成 CSS 保持逐字检查，避免手写常量覆盖后再次缩小输入。
2. 新增原生 DisclosureGroup 组件。参数分组可以点击、Enter 或 Space 展开/收起；收起不卸载输入，未提交草稿和锁定状态仍保留，组标题显示待处理数量。仍使用原 Property 编辑/校验/锁定链。
3. 桌面参数行采用标签/数值横向对齐，压缩空隙而不是缩小数字。窄屏可重排，依据核对入口不再被隐藏。
4. 将次要型号/选型/资料入口留在可展开区域；常用编辑、运行与报告动作不移除。
5. 新增“专注画布”本地视图开关，暂时收起目录、参数与结果区，Esc 恢复。保留同一个 WebGL canvas、草稿、工程 ID、revision 与输出证据；不新增工程模式或隐式求解。
6. 工作台保存提示区分输入待提交、正在处理和已保存，避免草稿存在时仍标注已保存。

## 方法依据

- W3C WAI-ARIA APG Disclosure Pattern：原生按钮的 Enter/Space、aria-expanded 和 aria-controls 语义。https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
- W3C WCAG Understanding Reflow：信息与操作在窄视口应可用；二维图表有其布局特点，不应通过隐藏关键表单来回避重排。https://www.w3.org/WAI/WCAG22/Understanding/reflow.html

以上仅为实现依据，自动化 axe 和指定尺寸测试不代表完整 WCAG 合规审计。

## 验证与交接

保留原 5 个工作台用例，新增 2 个真实后端浏览器用例：折叠后的草稿/锁定/键盘访问，以及专注画布前后 canvas、输入、版本与无 POST 副作用。每个桌面项目增加 2 项；完整矩阵更新为 Chromium 86、WebKit 86、mobile-webkit 11、四个 Windows 项目各 59，仍要求 12 份报告完整、无重复/失败/错误/跳过。

本地后端 243 项通过；纯模块输出证据 35 项、扫描比较 40 项、token 生成/颜色对/图片摘要检查通过。真实依赖下 TypeScript/Vite 可构建。当前本地浏览器对 localhost 返回 ERR_BLOCKED_BY_ADMINISTRATOR，不绕过策略，不把这次本地浏览器尝试当作页面验收。提交后浏览器结果以对应 head 的 Actions JUnit、trace 与实际截图为准，完整状态记录在 PR #19。

不改变物理内核、审批权限和存储协议，不修改 main 或上游开发分支，不声称修复了既有 Windows 请求长尾问题。
