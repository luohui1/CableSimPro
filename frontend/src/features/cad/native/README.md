# OCCT 视口原生构建

本目录只负责浏览器 AIS/V3d/WebGL 视口，不提供电缆计算算法。源码与使用方 `CadViewport` 一起维护；CadQuery 几何插件和超算 CAD Python 环境保持独立。

`runtime.lock.json` 锁定 OCCT 7.9.0 的上游提交、Emscripten 3.1.73、CMake 3.31.6 和 Ninja 1.12.1。`build.py` 从本目录读取 CMake/C++ 源码，工作目录可以是仓库中的任意位置。

在仓库根目录执行：

```sh
# 干净检出：自动下载校验工具链、源码，构建并准备生产资产
python frontend/src/features/cad/native/prepare.py --jobs 4
# 手动构建：已安装工具链，上游 OCCT checkout 必须为锁定提交且无修改
python frontend/src/features/cad/native/build.py --source /path/to/OCCT --jobs 4
# 仅重建视口：复用已锁定的静态库、着色器和许可
python frontend/src/features/cad/native/build.py --bridge-only --jobs 4
node frontend/src/features/cad/prepare-runtime.mjs
```

工具安装目录为 `.data/occt-toolchain/`：`emsdk/`、`ninja/ninja.exe`，CMake 可安装在项目 `.venv` 或 `cmake/cmake-3.31.6-windows-x86_64/`。上游源码来自 [OCCT](https://github.com/Open-Cascade-SAS/OCCT/tree/V7_9_0)，Emscripten 来自 [emsdk](https://github.com/emscripten-core/emsdk)。默认构建 TKV3d、TKOpenGles 及其依赖，输出至 `.data/occt-toolchain/viewer/`。

首次构建会生成 `occt/cablesim-build.json`，记录安装 SDK 的版本、静态库、着色器与许可摘要。`--bridge-only` 先核对该记录，不依赖任何旧视口产物；库变更后须重新完整构建。现有 SDK 迁移时保留其原版本，迁移记录明确说明静态库未重建。

`prepare.py` 的自动重建支持 Windows x64、Python 3.11+、Node.js、Git。OCCT 通过 Git 获取 `runtime.lock.json` 中固定的提交，构建前核对提交摘要与工作树无修改。`downloads.lock.json` 锁定三个工具链压缩包的 URL 与 SHA256，下载完成后先校验再解压；工具和源码单独安装在 `.data/occt-toolchain/bootstrap/`。工具安装记录核对文件树，变更时从已校验归档恢复。首次编译 OCCT 静态库及视口，后续可复用锁定 SDK；`--download-cache` 可指定已有归档缓存，缓存文件仍须通过锁定摘要。有效运行资产可在其他平台复用，自动源码重建目前仅支持 Windows x64。

每次视口构建的 `build.json` 保存锁定版本、六份原生源码/构建配置的 SHA256、SDK 记录摘要及 JS/WASM/许可摘要。`prepare-runtime.mjs` 核对全部版本、源码和分发文件后，才将已校验字节写入 `cad/node_modules/.cache/cablesim-occt/`；`--check-only` 只校验不写入。源码变化、WASM 损坏或许可证缺失均拒绝准备资产。Vite 从这个前端缓存生成带内容哈希的正式资源 URL。

分发须保留 `LICENSE_LGPL_21.txt`、`OCCT_LGPL_EXCEPTION.txt`、对应 OCCT/桥接源码与重建方法；许可证随构建复制且参与摘要校验。构建产物、工具链和临时 CMake 目录不入库。验证入口见上一级 [README](../README.md)。
