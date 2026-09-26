# 插件契约设计（cablesim.plugin/2）

版本：0.1 设计草案，待评审
日期：2026-09-26
适用：取代 `plugin-spec/README.md`（v1，`cablesim.plugin/1`）成为插件的目标契约。评审通过前不改代码；v1 在迁移完成前继续有效。

相关文档：[系统架构](./SYSTEM_ARCHITECTURE.md) · [模块实施细则](./MODULE_DESIGN.md) · [领域模型](./DOMAIN_MODEL.md) · [结果类型](./RESULT_TYPES.md)

## 0. 一页结论

- **宿主不内置算法。** 热网络、查表法、IEC 方法、FEM、电热、暂态和校核全部是插件。新增一种方法只需要新增插件包，不改宿主代码。
- **插件是一个独立发行包**：清单 + 参数 schema + 程序 + 验证算例 + 许可证 + 签名。客户和合作方可以自己开发、签名、交付。
- **执行协议与语言无关**：宿主在独立作业目录里写入 `request.json`，启动插件声明的入口程序，读取插件写出的 `result.json` 和文件。Python、C++、Fortran 程序和 COMSOL 调用都走同一协议；Python SDK 只是这个协议的封装。
- **插件只读固定快照、只写结果。** 插件拿不到数据库、工程 ID 之外的任何状态，也不能修改工程；导入、建模类插件只能产出"提案"，由人批准。
- **输入输出都是类型化的**：输入是宿主给出的领域快照（SI 单位、稳定语义 ID）+ 按 JSON Schema 校验的方法参数；输出只能使用平台统一的结果类型词表。前端、报告、比较、扫描、选型据此通用处理，不按插件写特例。
- **信任分级**：第一方、合作方（发布者密钥签名）、本地开发（未签名，只能在开发模式运行且结果带标记）。v2 提供进程隔离和资源限制，但**不是安全沙箱**，不承诺可运行恶意代码。

## 1. 设计目标与约束

| 编号 | 约束 | 来源 |
| --- | --- | --- |
| C1 | 宿主中不出现任何物理公式，也不出现按插件 ID 分支的代码 | 2026-09-25 决定 |
| C2 | 客户 / 合作方近期就要编写插件：SDK 独立发布，插件独立签名、独立版本、独立环境 | 2026-09-26 决定 |
| C3 | 插件可以是 Python，也可以是外部程序；宿主不假定插件语言 | 2026-09-26 决定 |
| C4 | 领域覆盖直埋 / 排管 / 多回路、空气 / 隧道 / 竖井 / 桥架、三芯 / 铠装 / 多芯、暂态 / 动态载流量 | 2026-09-26 决定 |
| C5 | 每个结果可追溯到输入快照、方法版本、插件发行摘要和实际执行环境 | PRD G2、MODULE_DESIGN §4 |
| C6 | 不产生假结果：缺数据、超范围、不收敛必须明确失败；每个输出单独标注可用性 | PRD §10 |
| C7 | 本机单用户部署下可离线安装和运行（客户现场常无外网） | PRD NFR-04 |

从 v1 **原样保留**的设计（已经验证合理，不重做）：

- 插件 ID 格式 `publisher.name`；插件版本只接受精确的 `x.y.z`；依赖只写精确版本，检测缺失、循环、冲突和深度。
- 安装两步走：先生成只读安装计划（依赖闭包、权限、许可、文件摘要），再按计划摘要批准。
- 项目插件锁 `ProjectPluginLock` 及其 revision / digest 语义（MODULE_DESIGN §4.2）。
- 权限与作用（effect）显式声明，没有审批、解锁、shell、任意路径或 URL 权限。
- 证据四分：来源身份、文件完整性、接口测试、数值验证，互不替代。
- 最小环境变量、独立作业目录、超时终止、请求 UUID 幂等、重启后 running 标为 interrupted。
- 运行期间工程被修改时，结果按固定快照封存为历史结果，不冒充当前结果。

## 2. 概念

```text
插件包 (Package)  ──含──>  能力 (Capability) × N
   │                          │ kind = method | geometry | mesh | import | export | data
   │ 签名 / 摘要 / 许可           │ 声明：领域需求、参数 schema、适用范围、输出类型、证据
   ▼                          ▼
项目插件锁 (精确版本)  ──>  研究 (Study：选定能力 + 参数)  ──>  运行 (Run：固定快照上的一次执行)
                                                                │
                                                     结果 (Result，类型化) + 工件 (Artifact，文件)
```

| 术语 | 含义 |
| --- | --- |
| 插件包 | 一个可分发、可签名的发行单元，对应一个插件 ID 的一个版本 |
| 能力 | 插件对外提供的一个可调用功能；取代 v1 的 `command`。一个包可以提供多个能力 |
| 方法（method） | 产生工程结果的计算能力，如稳态载流量、暂态温升、截面场 |
| 领域快照 | 宿主从已保存工程生成的、单位已统一为 SI 的只读输入（结构见 `DOMAIN_MODEL.md`） |
| 方法参数 | 方法自身的设置（网格密度、收敛容差、损耗系数取法等），按插件自带 JSON Schema 校验 |
| 研究驱动器 | 宿主的通用编排：单次运行、参数扫描、反向选型、方案比较、多步流程。驱动器不懂物理，只按能力声明组合调用 |

### 2.1 能力种类

| kind | 用途 | 可以产出 | 不可以 |
| --- | --- | --- | --- |
| `method` | 工程计算：载流量、温度、损耗、场、暂态、校核 | 结果 + 工件 | 修改工程 |
| `geometry` | 由领域快照生成几何（STEP、B-Rep、GLB） | 几何工件 | 把展示几何当分析几何 |
| `mesh` | 由几何生成网格 | 网格工件 | 自己决定材料或边界数值 |
| `import` | 把外部资料（厂家表、CableModelKit 包、CAD）转成工程提案 | 提案 + 工件 | 直接写工程；提案需人工批准 |
| `export` | 从已封存运行生成报告、计算书、数据文件 | 交付文件 | 重新计算；读取未指定的运行 |
| `data` | 纯数据包：材料库、载流量表、校正系数表；无可执行代码 | 可被方法引用的数据资产 | 包含程序 |

参数扫描、选型、比较**不是**插件种类，而是宿主驱动器（§8）。它们只依赖方法声明的输出类型，因此对任意方法都适用。

## 3. 插件包

### 3.1 包结构

发行文件为 `<publisher>.<name>-<version>.cspkg`（zip 容器，不压缩也可）：

```text
plugin.json                 清单（§4），由 schema 校验
schemas/                    各能力的参数 JSON Schema、自定义结果 schema
src/  或  bin/<platform>/    Python 源码 / 预编译程序（按平台）
wheels/                     可选：离线安装用的依赖 wheel（带哈希）
requirements.lock           Python 依赖锁（精确版本 + 哈希），python 运行方式必需
validation/                 验证算例：输入、期望输出、容差、出处
LICENSE, NOTICE, SBOM.json  许可与依赖清单
signature.json              签名（§7.2）；本地开发包可以没有
```

仓库内的第一方插件放在 `plugins/<plugin-id>/`，结构相同，由构建脚本打包。插件只对**自己包内的文件**计算摘要，改一个插件不会让其他插件的封签失效（修掉 v1 共享宿主文件导致连带重封的问题）。

### 3.2 独立运行环境

每个 `(插件 ID, 版本)` 有自己的运行环境，互不干扰（不同插件可以用不同版本的 gmsh、numpy）：

- **python**：安装时宿主为该版本创建独立虚拟环境，按 `requirements.lock` 安装，强制 `--require-hashes --only-binary=:all:`（只装 wheel，不执行 setup.py）。包内带 `wheels/` 时完全离线安装。
- **executable**：包内按平台放预编译程序，宿主不安装任何东西。
- 环境建好后做一次"自检运行"（§5.5），自检通过才标记为可执行。

## 4. 清单 `plugin.json`

```json
{
  "schema": "cablesim.plugin/2",
  "id": "cablesim.thermal-network",
  "version": "1.0.0",
  "name": "稳态热网络载流量",
  "publisher": {"id": "cablesim", "name": "CableSimPro"},
  "host_api": {"major": 2, "min_minor": 0},
  "license": {"spdx": "Apache-2.0", "review_required": false},
  "platforms": ["windows-x64", "linux-x64"],
  "runtime": {
    "kind": "python",
    "python": ">=3.11,<3.14",
    "entry": "cablesim_thermal_network.main",
    "lock": "requirements.lock"
  },
  "permissions": ["study.run", "artifact.write"],
  "dependencies": [],
  "resources": {"timeout_s": 60, "memory_mb": 512, "network": "none"},
  "capabilities": ["...见 §4.2..."],
  "files": [{"path": "src/cablesim_thermal_network/main.py", "sha256": "…", "size_bytes": 10240}]
}
```

### 4.1 顶层字段

| 字段 | 说明 | 相对 v1 的变化 |
| --- | --- | --- |
| `schema` | 固定 `cablesim.plugin/2` | 新版本号 |
| `id` / `version` | 同 v1：`publisher.name`、精确 `x.y.z` | 不变 |
| `publisher` | `id` 必须等于 ID 前缀，且与签名密钥绑定（§7） | v1 为自由字符串 |
| `host_api` | 需要的宿主 API 主版本和最低次版本；宿主主版本不同则拒绝加载 | v1 为固定 `api_major=1` |
| `license` | SPDX 表达式；含 GPL 等需审查的依赖时 `review_required=true` | 合并 v1 三个许可字段 |
| `platforms` | `os-arch`，如 `windows-x64`、`linux-x64` | 增加架构 |
| `runtime` | 运行方式与入口（§5.1） | v1 的 `host` / `frontend` 取消 |
| `permissions` | `project.read`、`study.run`、`artifact.read`、`artifact.write`、`project.propose` | 不变 |
| `dependencies` | 依赖的其他插件（精确版本），如方法依赖某个 `data` 包 | 不变 |
| `requirements` | 取消；Python 依赖进 `requirements.lock`，外部软件进 `runtime.tools` | 变化 |
| `resources` | 默认超时、内存上限、是否需要网络；宿主可以设更严的上限 | 新增 |
| `capabilities` | 能力列表（§4.2） | 取代 `commands` + `category` + `scope` |
| `files` | 包内每个文件的路径、摘要、大小 | 只覆盖包内文件 |

### 4.2 能力声明（以 `method` 为例）

```json
{
  "kind": "method",
  "id": "steady-ampacity",
  "title": "稳态载流量与导体温度",
  "analysis": "steady_state",
  "domain": {
    "schema": "cablesim.domain/1",
    "supports": {
      "section_kinds": ["ground"],
      "enclosures": ["duct", "duct_bank"],
      "constructions": ["single_core"],
      "armour": false,
      "max_circuits": 6,
      "load_cases": ["steady"]
    },
    "requires": ["cable_types[].cores[].conductor.r20", "sections[].medium.soil"]
  },
  "parameters": {"schema": "schemas/steady-ampacity.params.json"},
  "outputs": [
    {"key": "ampacity",              "type": "quantity", "per": "circuit", "required": true},
    {"key": "conductor_temperature", "type": "quantity", "per": "core",    "required": true},
    {"key": "losses.conductor",      "type": "quantity", "per": "core"},
    {"key": "thermal_resistance",    "type": "table",    "per": "cable"},
    {"key": "conductor_temperature", "type": "curve",    "x": "current"}
  ],
  "standards": [{"ref": "IEC 60287-1-1", "clauses": ["<按标准原文填写>"], "coverage": "partial"},
                {"ref": "IEC 60287-2-1", "clauses": ["<按标准原文填写>"], "coverage": "partial"}],
  "validation": {"level": "analytic-benchmark", "cases": ["validation/single-circuit-flat.json"]},
  "limitations": ["均匀土壤、恒温地表", "不计土壤干燥", "交流电阻系数按方法参数给定，不计算集肤与邻近效应"],
  "check": "static+dynamic"
}
```

| 字段 | 作用 |
| --- | --- |
| `analysis` | `steady_state`、`transient`、`cyclic`、`emergency`、`field`、`crosscheck` 等，供前端分组和驱动器选择 |
| `domain.schema` | 读取的领域模型主版本；宿主只把该版本的快照交给插件 |
| `domain.supports` | **静态适用范围**：宿主在调用插件前就能判断"这个工程这个方法不能算"，并告诉用户原因 |
| `domain.requires` | 必需字段路径；缺失时预检直接定位到字段，不启动插件 |
| `parameters.schema` | JSON Schema 2020-12；带单位的字段用 `x-quantity` 标注物理量。前端按它生成参数表单，工程助手按它生成工具参数 |
| `outputs` | 声明输出的语义键、结果类型和粒度（[结果类型](./RESULT_TYPES.md)）；物理量由语义键决定，不必重复声明；`required` 输出缺失视为运行失败 |
| `standards` | 引用的标准（含版次）、条款及覆盖程度（`full` / `partial` / `reference`），由插件作者按标准原文填写；只作说明，不等于合规认证。本文示例中的标准仅为示意 |
| `validation` | 验证等级（沿用 v1 四级）和算例；等级高于 `unverified` 必须带算例 |
| `limitations` | 随每个结果进入报告的局限说明 |
| `check` | `static`：只用静态声明预检；`static+dynamic`：还调用插件的 check 阶段（§5.3） |

其他种类的差异：`geometry` / `mesh` 声明 `produces` 工件类型；`import` 声明接受的文件类型并输出提案；`export` 声明接受的运行结果类型和产出格式；`data` 没有 `runtime`，只声明数据文件和 schema。

### 4.3 多步链路

需要上游工件的能力声明 `inputs.artifacts`：

```json
"inputs": {"artifacts": [{"role": "mesh", "type": "mesh.section2d", "schema": "cablesim.mesh/1"}]}
```

研究配置里的"流程"由宿主按类型把上一步的输出接到下一步（例如 geometry → mesh → method → export）。取代 v1 写死在宿主里的 `SOURCE_FILES` 映射。上游工件必须来自同一固定快照的运行，摘要一致才能使用。

## 5. 执行协议 `cablesim.run/2`

### 5.1 运行方式

| `runtime.kind` | 入口 | 适用 |
| --- | --- | --- |
| `python` | `entry` 为模块名；宿主用插件自己的环境执行 `python -I -m cablesim_sdk.run <entry>` | 大部分插件 |
| `executable` | `entry` 为包内相对路径，按平台选择，如 `bin/windows-x64/solver.exe` | C++ / Fortran 求解器 |
| `executable` + `tools` | 同上，并声明需要的外部软件，如 `{"id": "comsol", "version": ">=6.2"}`；软件位置由用户在宿主设置中配置 | COMSOL、ANSYS 等需许可的软件 |

宿主从不经 shell 启动，也不接受清单或请求中的任意命令行。

### 5.2 作业目录

```text
<job>/
  input/request.json        宿主写入，只读
  input/artifacts/…         上游工件副本（只读），带摘要
  output/                   插件唯一可写的位置
  output/result.json        插件必须写出
  output/…                  插件声明的工件文件
```

`request.json`：

```json
{
  "protocol": "cablesim.run/2",
  "phase": "run",
  "run_id": "…",
  "capability": "steady-ampacity",
  "domain": {"schema": "cablesim.domain/1", "snapshot": {"…": "SI 单位的领域快照"}, "digest": "…"},
  "parameters": {"…": "已按 schema 校验"},
  "cases": [{"case_id": "base", "overrides": {}}],
  "artifacts": [{"role": "mesh", "path": "input/artifacts/mesh.msh", "sha256": "…", "schema": "cablesim.mesh/1"}],
  "limits": {"timeout_s": 60, "memory_mb": 512}
}
```

`cases` 支持批量：扫描、选型可以在一次进程里算多个工况，避免上百次进程启动。每个 case 的覆盖值只能改驱动器声明的路径，结果按 case 分别返回。

### 5.3 三个阶段

| phase | 用途 | 要求 |
| --- | --- | --- |
| `check` | 动态预检：检查静态声明表达不了的条件（如几何是否可剖分、参数组合是否收敛可期） | 必须快（默认 10 s 内），无副作用，只返回问题列表 |
| `run` | 正式计算 | 写出 `result.json` 与工件 |
| `selftest` | 安装后自检：运行包内一个最小验证算例 | 用于确认环境可执行，不作为数值验证 |

### 5.4 结果 `result.json`

```json
{
  "protocol": "cablesim.run/2",
  "cases": [{
    "case_id": "base",
    "status": "succeeded",
    "results": [
      {"key": "ampacity", "type": "quantity", "entity": "circuit/c1", "value": 612.4, "unit": "A"},
      {"key": "conductor_temperature", "type": "quantity", "entity": "cable/c1-L2/core/1", "value": 363.15, "unit": "K"},
      {"key": "losses.conductor", "type": "quantity", "entity": "cable/c1-L1/core/1", "status": "unavailable", "reason": "R20_NOT_PROVIDED"}
    ],
    "artifacts": [{"path": "output/field.vtu", "type": "field.section2d", "schema": "cablesim.field/1"}],
    "warnings": [{"code": "SOIL_DRYING_IGNORED", "message": "未计土壤干燥"}],
    "evidence": {"prepared_input_digest": "…", "iterations": 7, "residual": 1e-9}
  }],
  "environment": {"python": "3.12.4", "packages": {"numpy": "2.3.1"}, "solver": "thermal-network 1.0.0"}
}
```

- `status`：`succeeded`、`failed`、`not_applicable`。失败必须带 `code` 和 `message`，不得输出伪造数值。
- 每个结果带 `entity`（领域快照里的稳定语义 ID），前端、比较和报告靠它对齐，不靠数组下标。
- 单个输出不可用时写 `status: unavailable` 和原因，不用 0 或空值顶替。
- 数值一律 SI（温度用 K）；前端和报告负责显示单位换算。
- `prepared_input_digest`：插件把领域快照转换成自己分析输入后的摘要，作为方法级追溯证据。

宿主收到后校验：结构符合 schema、`required` 输出齐全、结果键和类型与声明一致、单位与物理量匹配、工件只在 `output/` 内且类型已声明。任一不符，运行记为 `failed(OUTPUT_CONTRACT_VIOLATION)`，结果不展示。之后宿主计算每个工件的 SHA-256 并封存。

### 5.5 进度、日志与退出

- 插件可向 stdout 逐行写 JSON 事件：`{"event": "progress", "stage": "mesh", "done": 3, "total": 10}`、`{"event": "log", "level": "info", "message": "…"}`。宿主只显示真实阶段和计数，不伪造百分比。
- stderr 保存为诊断日志（截断到上限）。
- 退出码 0 表示已写出 `result.json`（成功与否看其中 status）；非 0 或没有 `result.json` 记为 `failed(PLUGIN_CRASHED)`；超时记为 `failed(TIMEOUT)` 并终止整个进程树。
- 取消：宿主终止进程树，运行记为 `cancelled`，已写出的文件不作为结果。

### 5.6 Python SDK

`cablesim-plugin-sdk` 作为独立 Python 包发布（插件环境里安装），只封装协议，不包含任何算法：

```python
from cablesim_sdk import method, Result, NotApplicable
from cablesim_sdk.domain.v1 import DomainSnapshot

@method("steady-ampacity")
def steady_ampacity(domain: DomainSnapshot, params: Params) -> Result:
    if not domain.cable_types[0].cores[0].conductor.r20:
        raise NotApplicable("R20_NOT_PROVIDED", "需要厂家 R20")
    ...
    return Result().quantity("ampacity", circuit.uid, value_a, "A")
```

SDK 同时提供：领域快照的类型定义（与宿主同一份 schema 生成）、单位工具、`cablesim-plugin` 命令行（`new` 生成模板、`validate` 校验清单、`test` 用验证算例离线跑、`pack` 打包、`sign` 签名）。插件作者不需要启动宿主就能开发和测试。

## 6. 宿主侧执行流程

```text
预检 ──> 准入 ──> 执行 ──> 校验 ──> 封存
 │        │        │        │        │
 │        │        │        │        └ 结果、工件摘要、实际环境随 Run 保存；工件只读
 │        │        │        └ 按声明校验 result.json（§5.4）
 │        │        └ 独立进程、独立目录、最小环境变量、资源上限、超时
 │        └ 固定：工程版本 + 研究版本 + 插件锁 + 领域快照摘要 + 参数摘要（MODULE_DESIGN §6）
 └ 静态：插件已启用且环境可用、domain.supports、domain.requires、参数 schema
   动态：可选 check 阶段
```

预检不创建运行、不修改工程。任何一步失败都给出"哪个对象 / 字段、为什么、怎么改"。

## 7. 信任、签名与隔离

### 7.1 信任分级

| 级别 | 条件 | 默认行为 |
| --- | --- | --- |
| 第一方 | 由 CableSimPro 发布密钥签名 | 可安装 |
| 合作方 | 由用户或管理员已加入信任列表的发布者密钥签名 | 安装时显示发布者和权限，确认后安装 |
| 本地开发 | 未签名，从本地目录加载 | 只在开发模式可用；结果带"未签名插件"标记，不能进入正式交付 |

### 7.2 签名

- `signature.json` 包含：清单摘要、包内文件清单摘要、发布者 ID、密钥指纹、Ed25519 签名。
- 宿主信任库保存"发布者 ID → 公钥"。插件 ID 前缀必须与签名发布者一致，防止冒用命名空间。
- 同一 ID 和版本、但摘要不同的包一律拒绝（沿用 v1）。
- 签名只证明**来源和完整性**，不证明插件安全或数值正确。公共市场所需的撤回、过期、密钥轮换（TUF 等）留到企业阶段单独设计。

### 7.3 隔离与资源限制

v2 能做到：独立进程；工作目录限定在作业目录；最小环境变量（不继承 Key、代理、数据库路径）；内存和 CPU 时间上限（Windows Job Object / Linux rlimit、cgroup）；超时终止进程树；输出文件数量和大小上限。

v2 **做不到**：阻止插件进程读取本机其他文件或访问网络。`resources.network = "none"` 在 v2 中只是声明和审查依据，不是强制。因此：只安装信任的发布者；需要运行不可信代码时，使用后续的容器运行方式（`runtime.kind = "container"`，不在 v2 范围）。这一点要在安装界面上如实提示。

## 8. 宿主的研究驱动器

驱动器是宿主的通用编排逻辑，只依赖能力声明，不懂物理：

| 驱动器 | 需要能力声明的什么 | 行为 |
| --- | --- | --- |
| 单次运行 | 任意 method | 一个 case |
| 参数扫描 | 被扫描的领域路径或参数在 schema 中是数值型 | 生成多个 case；每个采样点独立成败 |
| 反向选型 | 方法输出含 `ampacity`（或用户选定的目标输出）；候选来自型号库 | 每个候选完整重算，记录淘汰原因；不按截面比例推算 |
| 方案比较 | 两个运行的输出键和实体对齐 | 先比输入和方法差异，再比同键同实体的结果 |
| 多步流程 | `inputs.artifacts` 与上游 `produces` 类型匹配 | 按固定步骤执行，中间结果全部留档 |
| 交叉校核 | 两个方法有相同输出键 | 同一快照分别计算，报告差异，不自动判定谁对 |

## 9. 前端与工程助手

- **不加载插件前端代码**（v2 不做）。参数表单由参数 schema 生成（可带 `x-ui` 提示：分组、顺序、滑块等）；结果由结果类型的通用渲染器显示（数值表、三相明细、曲线、时间序列、截面场、几何）。
- 需要特殊展示的，先扩展结果类型词表，而不是给插件开 UI 口子。
- 工程助手的工具清单由插件注册表自动生成：每个能力一个工具，参数取自其 schema，作用按 `permissions` 分为只读、提案、发起研究三类。撤掉宿主里单独维护的 `runtime.capabilities` 表。

## 10. 版本与兼容

| 对象 | 版本方式 | 兼容规则 |
| --- | --- | --- |
| 插件 | 精确 `x.y.z` | 项目锁定精确版本；升级是显式操作，旧运行保留原版本 |
| 宿主插件 API | `major.minor` | 主版本不同拒绝加载；次版本只做向后兼容的新增 |
| 领域模型 | `cablesim.domain/N` | 插件声明读取的主版本；宿主可同时提供多个主版本的快照（过渡期） |
| 结果类型词表 | `cablesim.results/N` | 新增类型不破坏旧插件；改变已有类型语义必须升主版本 |
| 执行协议 | `cablesim.run/N` | 与宿主插件 API 主版本同步 |

## 11. 生命周期

```text
获取包（文件导入 / 目录） → 校验签名与摘要 → 安装计划（依赖、权限、许可、资源、外部软件）
  → 用户批准 → 建立独立环境 → selftest → 可用
  → 项目启用（写入项目插件锁） → 研究中选用 → 运行
升级：安装新版本（并存），项目显式切换锁；旧运行仍指向旧版本
卸载：被项目锁或历史运行引用时只允许"停用"，环境可删，发行记录与历史结果保留
```

## 12. 从 v1 迁移

| v1 现状 | v2 处理 |
| --- | --- |
| `plugins/registry.json` 一个文件 17 个清单 + `plugins/releases/` 2 个 | 每个插件一个目录 `plugins/<id>/`，各自 `plugin.json` |
| `ampacity-core`、`model-core`、`report-core`（`runtime: host`） | 热网络拆为 `cablesim.thermal-network`（method）；模型生成成为 `geometry`；报告成为 `export`。宿主中的 `engine.py` 删除 |
| `field_analysis.py`、`vertical.py`、`selection.py` | 前两者成为 method 插件；选型改为宿主通用驱动器 |
| 6 个 worker 插件的 `HANDLERS` / `OUTPUTS` / `ARGUMENTS` / `SOURCE_FILES` / `managed_commands` 写死在宿主 | 迁入各插件的清单与入口；宿主只剩通用执行器 |
| 8 个 roadmap 条目 | 保留为目录里的"规划"说明，不作为插件包 |
| `EngineeringRuntime.capabilities` 12 项 | 读写工程、提案、报告等宿主操作保留为宿主 API；计算类全部由插件注册表生成 |
| 前端 `PluginResult` / `BuriedResult` 按命令 ID 特判 | 改为结果类型渲染器 |

迁移顺序：
1. 为现有热网络和直埋 FEM 输出建立"黄金值"回归测试。
2. 实现 v2 清单模型、通用执行器、SDK 最小版；把热网络作为第一个 v2 插件迁出，结果与黄金值一致。
3. 迁移其余 worker 插件，删除宿主中的写死映射。
4. 结果类型渲染器替换前端特判；工程助手改用注册表。
5. 验收：不改宿主代码，把 GB 50217 查表法作为新插件接入（`data` 包 + `method`）。

v1 清单在迁移期间由兼容层读取，迁移完成后删除兼容层。

## 13. 待评审问题

1. **清单格式**：本文采用 JSON（与现有 JSON Schema 一致，跨语言）。如果合作方主要是 Python 开发者，也可以改为 TOML，由工具转成 JSON。
2. **进程启动开销**：Python 插件每次运行约 0.3–1 s 启动时间。批量 `cases` 能覆盖扫描和选型；是否还需要常驻进程模式，等性能实测后决定。
3. **外部软件许可**：COMSOL 等软件的许可证和路径由用户配置，宿主不分发。是否需要记录许可证服务器信息作为运行证据？
4. **合作方插件分发**：v2 只支持"文件导入 + 签名校验"。是否需要一个私有插件目录（企业内网）作为下一步？
5. **数值验证责任**：合作方插件的 `validation.level` 由发布者自报。平台是否要求第一方复核后才能在正式报告中使用？
