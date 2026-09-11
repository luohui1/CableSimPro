# 设计依据与开源复用调查

核对日期：2026-09-11。以下来自上游官方文档/包元数据；不是第三方排名或星数背书。

| 参考 | 采用的原则 | 官方来源 |
|---|---|---|
| VS Code extension manifest | manifest、兼容版本、contributes；依赖与套件分开 | https://code.visualstudio.com/api/references/extension-manifest |
| napari npe2 | 惰性命令/读写贡献，浏览时只读声明 | https://napari.org/dev/plugins/technical_references/contributions.html |
| PyPA plugin discovery | 安装 metadata 与实际加载是两件事 | https://packaging.python.org/en/latest/guides/creating-and-discovering-plugins/ |
| TUF | 分发信任根、签名角色、过期与一致性 | https://theupdateframework.io/docs/metadata/ |
| OCI image manifest | 内容寻址描述符/类型；作为后续分发选项 | https://specs.opencontainers.org/image-spec/manifest/ |
| CadQuery | 参数化 CAD 与 STEP 交换，Python 包 2.8.0 | https://cadquery.readthedocs.io/en/latest/importexport.html ; https://pypi.org/project/cadquery/ |
| Gmsh | 分域二维/三维网格；4.15.2；GPL 分发/商业许可边界 | https://gmsh.info/ ; https://pypi.org/project/gmsh/ |
| scikit-fem | P1 弱形式/按域装配；12.0.2；BSD-3-Clause | https://scikit-fem.readthedocs.io/en/latest/howto.html ; https://pypi.org/project/scikit-fem/ |
| meshio | 网格转换，5.3.5；MIT | https://pypi.org/project/meshio/ |
| PyVista | 已有场统计、contour 与 VTK 交换；0.49.0；MIT | https://pypi.org/project/pyvista/ ; https://docs.pyvista.org/ |

版本仅代表本轮集成候选与 CI 安装目标。Windows/Linux/macOS 环境和原生库依赖需要
各自执行验证；单一 Ubuntu job 不能当作三平台全部验收。

高级 DOLFINx、Elmer、FEMM、MFEM 和 vtk.js 保留为后续方向；本批未锁其版本/授权，
无实现或原生环境验证，不在市场标为可安装。

本批工作分支：feat/plugin-ecosystem-v01，基于 R2 64a2a4f。
本轮没有改动独立 CableModelKit/ReportEngine，也没有合并 main 或并行 R3 UI 分支。
