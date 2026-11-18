---
title: release.toml 配置
description: 发行版配置文件各项的含义、默认值和取值规则。
sidebar:
  order: 2
---

安装包根目录带一份 `release.toml`（UTF-8 编码）；安装时把它复制到解压目录之外保存，启动时用 `--config` 指定（见[安装](../)）。相对路径以配置文件所在目录为基准；Windows 路径请写成正斜杠（如 `D:/CableSimPro-data`）或放在 TOML 单引号里。配置文件不在程序完整性摘要之内，可以随时编辑，**升级时继续使用同一份**。

## [server] 服务

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `host` | `"127.0.0.1"` | 监听地址，必须是 IP 地址或 `localhost`。只允许本机访问时保持默认；内网访问见[内网部署](../intranet/)。 |
| `port` | `8100` | 界面和所有接口共用这一个端口。端口已被占用时启动失败，不会改用别的端口。 |
| `open_browser` | `true` | 启动后是否自动打开浏览器。服务器上设为 `false` 或启动时加 `--no-browser`。 |
| `startup_timeout_seconds` | `300` | 等待服务就绪的上限。首次生成示例可能需要几分钟；超时即判定启动失败，升级时会恢复升级前的快照。 |
| `trusted_hosts` | `[]` | 允许出现在浏览器地址栏里的主机名或 IP。只接受明确的名字，不支持通配符。 |

## [storage] 数据

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `data_dir` | `"~/CableSimPro-data"` | 工程库、数据集、复现资料、工程证据、备份和保留的各个程序版本都放在这里。`~` 指用户主目录。必须在解压目录之外。 |

数据目录里的主要内容：

| 位置 | 内容 |
| --- | --- |
| `engineering.sqlite` | 工程库（工程、研究、运行、型号、交付记录） |
| `datasets/`、`library/`、`engineering-evidence/` | 数据集、复现资料、工程证据 |
| `programs/<构建编号前16位>/` | 已安装的各个程序版本及其独立 Python 环境 |
| `release-snapshots/` | 每次升级前自动创建的工程库快照 |

## [initialization] 初始化

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `seed_examples` | `true` | 只在工程库不存在时生效：用随附的公开教学输入生成示例工程。设为 `false` 得到空工程库。已有工程库无论如何都不会被重新生成或替换。 |

## [model] 模型

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `base_url` | `""` | OpenAI 兼容接口的完整 API 基址，如 `https://llm.example.com/v1`。留空表示不调用模型。 |
| `model` | `""` | 模型名。 |
| `api_key_env` | `"CABLESIM_LLM_API_KEY"` | 保存密钥的**环境变量名**。密钥本身不要写进配置文件。 |

这些值只是初始连接。管理员在界面“设置 → AI 模型”里保存过的设置优先于本文件。详见[接入模型](../model/)。

## [[processes]] 伴随进程

可以追加随应用一起启动和停止的进程。安装包自带的 `release.toml` 中，这一节只是注释掉的示例：当前安装包不包含 Agent 对话服务，也不会启动它。格式如下：

```toml
[[processes]]
name = "companion"
command = ["{python}", "{app_dir}/path/to/service.py"]
cwd = "."
required = true
env = { HOST = "127.0.0.1" }
```

- `command` 是参数数组，直接执行，不经过 shell；不会自动下载进程依赖。
- 占位符 `{python}` 是发行环境的解释器，`{app_dir}`、`{data_dir}` 是当前程序目录和数据目录的绝对路径。
- `env` 只放非敏感设置。
- `required = true` 的进程退出会停止整个应用；可选进程退出不影响核心工作台。
