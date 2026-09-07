# v0.3 架构与验收

## 数据路径

画布/属性/Agent → 受约束 Change → Scenario 校验 → 参数锁 → SQLite BEGIN IMMEDIATE + expected_revision → 新版本。

LangGraph 规划图：plan_task → validate_proposal。复用严格本地解析器或服务端 Responses 函数调用。客户端没有执行任意代码或数据库工具。规划本身不改工程，保存待审批候选。

执行图：验证输入快照 → engineering_tool（calculate/sweep/inspect）。SQLite 保存批准后的模型和不可变输出。无稳定解显示空运行状态而非假数值。提案仅存服务端，审批只接收 ID 和预期版本，不接受客户端篡改后的候选内容。

持久化表：workspaces / workspace_history / workspace_proposals / workspace_runs / workspace_audit。事务避免两个同版本请求都成功。运行与引用独立于旧项目表，后者没有被覆盖或删除。

## 交互范围

工程树以单方案、单回路为当前计算域，不是装饰性的任意多回路树。拖动平行排列的中相调整所有相的共同埋深，外相可同时改变中心距；三角排列保持等边约束。AI 关闭后仍可手动操作。布局可停靠与调整；关闭面板后使用“重置布局”恢复。

属性变更在失焦/Enter 时提交，校验失败不写入服务器。锁定限制人工和 Agent，解锁必须显式操作。当前实现仍需进一步强化复杂未提交输入状态、面板恢复和可访问性；不得宣传为已完成通用 CAD 验收。

资料提取只识别明确文字节选。页码为用户声明；SHA-256 对应输入原文，并不证明原文真实。字段被后续编辑后，引用显示为历史引用，不能冒充当前来源。

## 测试分层

- 原数学退化解、热平衡、单调性和 API 测试继续运行。
- 新增事务版本、重复/过期/跨工程审批、无效路径、锁约束、并发、重启、引用冲突测试。
- 浏览器用真实 HTTP 后端测试模型、导出、属性、撤销重做、刷新重开、Agent 审批、画布拖动、资料来源、扫描、图形和移动布局。
- 浏览器报告附实际截图；不是生成的设计稿。
- 模拟云端返回仅验证工具契约；未验证真实密钥和实际模型成功率。

## 开源使用

Dockview 开源核心负责停靠；Konva/react-konva 负责二维事件与渲染；TanStack Table 使用 v9 的兼容入口；Lucide 提供图标；Three.js 显示结构；LangGraph 负责有限图执行。没有拉入每一个提过的框架：CopilotKit/AG-UI、vtk.js、FEM/CAD 内核暂未集成。

官方参考：
- https://dockview.dev/docs/core/panels/add/
- https://konvajs.org/docs/react/Drag_And_Drop.html
- https://github.com/TanStack/table
- https://docs.langchain.com/oss/python/langgraph/overview
- https://developers.openai.com/api/docs/guides/function-calling

新版本是工作空间和审批基础设施的升级，不改变现有热网络的工程认证状态。
