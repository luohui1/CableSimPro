# 批量仿真与数据集边界

## 保存与执行

批量模块位于保存研究内，输入为一个研究工况、版本化参数空间和执行设置。宿主只负责采样、快照、预算、执行与工件；计算和适用范围判断仍属于选定插件。网格、拉丁超立方、随机三种采样使用保存的 MT19937 种子；每个生成后的物理输入单独保存并计算 SHA256。离散排列在显式坐标上操作，几何重叠由插件拒绝，不补造电缆结构。

`backend/kernel/batch_service.py`保存配置修订及请求幂等键，并检查工程/研究修订、锁摘要和方法封签。`batch_runtime.py`冻结运行代码与插件声明文件；`batch_worker.py`使用同一结果契约。默认执行后端为Slurm，所有真实仿真、原生验证和性能测试在计算节点执行；本机只作开发及轻量单元检查。离线进程池保留但默认禁用，须管理员显式设置`allow_local_fallback=true`才可使用。账户限制导致数组最多同时8个任务时，任务内部按保存的索引组顺序执行；不会申请整节点。

数据集的本地 `plan.json`、`integrity.json`、`inputs/`不可变；`samples/`为当前状态，`attempts/`保留各次执行，`raw/`保存压缩的原始运行工件。重复点击复用同一请求；成功样本不重算，失败样本只有明确重试才产生新尝试。进程退出、求解器超时、环境缺失、数值未收敛和传输中断有独立状态。已知作业终止但缺结果的样本会封存基础设施失败，不留作“待运行”，也不伪造数值。

同一批在本机和超算重复验证时，收集器保留已有终态记录，把远端副本存入`replicas/<submission-token>/`。输入、方法和运行文件摘要一致后才比较量值。相同格式不意味着不同操作系统产生逐位相同的网格；必须给出实际差异、容差、节点数和网格摘要。

## 导出契约

`POST /api/workspaces/{wid}/studies/{sid}/datasets/{id}/export`导出ZIP，包含：

| 文件 | 内容 |
| --- | --- |
| `samples.csv` | 所有样本、参数、状态、计时和错误；无效样本的结果列留空 |
| `valid.csv` | 仅有效样本；包含运行条件和额定条件的独立量值列 |
| `samples.jsonl` | 完整行级来源、求解器、网格、收敛、错误、运行与摘要信息 |
| `metadata.json` | `cablesim.dataset/1`、基准输入、采样定义、单位、方法/插件版本、来源快照、数量/失败率、生成时间、文件哈希、远端记账 |

内容摘要决定不可变导出目录；再次下载会核对文件哈希。CSV中可能作为公式解析的文本加前导单引号，JSONL保留原文。SI值不按界面显示精度舍入，摄氏温度只在界面显示。每行`case_sha256`同时绑定输入和方法设置；`raw_sha256`绑定原始运行。工件大体积场数据保留于原始数据目录，CSV不嵌入节点数组。

`valid=true`表示该方法声明的数值门槛通过，不能解释为工程认证。`thermal-dataset`至少执行三档网格，保存运行点导体温度、指定回路允许电流、网格序列、能量残差和收敛门槛；其余回路保持采样负荷。所有数据固定`authority=reference_only`、`engineering_approval=false`。一般方法未做网格检查时明确记录`mesh_status=not_assessed`。

## SSH、Slurm与预算

管理员在`.data/hpc/config.json`配置SSH别名、显式SSH配置文件、远程根目录、Python/求解器路径及模块；这些内容不来自样本输入。封包仅允许运行代码、插件声明资产和数值输入，排除本地标准、论文、项目书、工程资料库及凭据。上传/下载按8 MiB内容校验分块续传；提交意图和Slurm作业名称绑定固定UUID，中断恢复先核对原作业，不盲目重发`sbatch`。不能确定提交是否成功时停在`submission_unknown`。

预算账本`.data/hpc/budget.sqlite`在提交前事务化预留：任务数×每任务分配核数×申请时间；单次不得超过2000核时，累计实际用量与未结算预留之和不得超过20000核时。dg83的`MaxMemPerCPU=6500 MB`，因此预估核数取`max(1, ceil(memory_mb / 6500))`，8192 MB任务按2核记账；计算仍限制为一个线程。最终以`sacct`的数组分配行`CPUTimeRAW`结算，不重复累加`.batch/.extern`。调度器终止宽限期可能使实际核秒高于请求墙时，账本使用实际值，不将其截断到预估。超限保留输入并停止新提交，交由用户决定。

作业号、节点、CPU秒、退出码和状态随结果保存。进程树RSS以20 ms间隔采样；共享内存页会重复计入，不能与Slurm的单进程MaxRSS等同。远端源编译Elmer记录源码包及可执行文件、HeatSolve和ResultOutput模块摘要；Python补丁版本及Windows/Linux构建差异明确保留。

命令入口为`python -m backend.kernel.batch_cli --help`；研究API包含`batch-configuration`、`batch-preflight`、`datasets`、`datasets/{id}/resume`。研究页面参数空间/样本结果/执行记录使用这些真实接口，修改配置后仍可查看原数据集并标记历史输入。

原生回归入口为`python scripts/run_plugin_tests_hpc.py`，可用`--test plugin-tests/<file>.py`选择范围，`--resume <本地证据目录>`恢复查询。只上传Python源、声明资产和数值夹具，计算节点运行`backend/kernel/hpc_test_worker.py`，回收JUnit、输出日志、依赖版本、Slurm作业号与实际核时；测试失败和缺环境均保留，不生成替代数值。直接在本机调用`plugin-tests`会明确跳过原生计算，不能据此声称原生门禁通过。

COMSOL对照使用超算既有6.2安装`/data/app/comsol/62/multiphysics/bin/comsol`及其许可证，记录`license_source=hpc-installation`、软件完整版本、作业号、节点、生成Java与模型摘要；以`batch -np 1`执行。账户共享锁路径由管理员配置，禁止在登录节点或本机启动真实COMSOL。开源求解器保留各自版本与开源许可来源。安装了其他商业软件不自动扩大本轮求解范围。

## 项目书和CableLab对接

依据本地项目书《基于混合物理-数据驱动的高精度电缆载流量预测模型开发》PDF第4–6页：FEM仿真数据、IEC物理基线和现场测量是三种来源；其拟定目标为`k = I_true / I_IEC`，并计划8:2分层训练/测试。本轮只交付仿真数据与元数据，未训练模型、未声称项目书MAPE目标达成，也未将合成排管几何视为厂家数据。

训练导入器应先校验文件摘要与单位，再筛选有效、适用范围一致的样本；同一基准工程及其近邻参数族应按组划分，避免重复网格、后端副本或重试进入训练/测试两侧。IEC基线须用支持同一结构、敷设和接地口径的方法独立计算，绑定其运行ID/版本/条款/输入摘要。缺少IEC覆盖就保留`I_IEC=null`、`k=null`；不得拿GB查表值、热网络近似或失败回退值当IEC基线。仿真标签应命名`I_FEM`，现场确认的数据才可使用“实测/校准真值”语义。

对`D:/work/项目综合`仅作只读核对：

| CableLab现有契约 | 与本数据集的关系 |
| --- | --- |
| `backend/packages/cable-calc-core/src/contracts/types.ts` 的 `CalcInput` | `sectionMm2`、`ambientTempC`、直埋`spacing`毫米串及型号/敷设代码，需要独立显式映射；三回路中心间距不能擅自等同查表间距 |
| 同文件 `CalcResult.modelCode=GB_TABLE` | `baseAmpacityA`及正式修正系数属于GB发布模型，不是`I_IEC`或FEM标签 |
| `contracts/iec60287.ts` | 独立SI实验契约；必须匹配`calculationBranch`、导体几何、敷设、接地、热阻模型等适用条件 |
| `services/calculation-api/README.md` 的正式接口 | `authoritative`依赖发布绑定、幂等请求、数据库落库及版本校验；本批量导出不能直接成为正式run |
| 同README的reference/experimental接口 | 声明`reference_only`、`experimental`及非正式持久化边界，不能跨模型回退 |

导入适配建议以`dataset_id + sample_id + case_sha256`作为研究样本身份，保留FEM、IEC、现场三套来源字段；使用显式转换 `mm²=m²×10⁶`、`°C=K−273.15`、`mm=m×1000`。当前未实现CableLab数据集接收/训练API，也未修改其代码或数据库。两边未来对接应通过独立的研究数据入口，经过数据质量、模型适用范围、误差、超范围拒绝及联合发布审核后再决定正式使用；仿真或代理模型不能自行升级为工程结论。
