# 工程质感工作台增量

基于 PR #19 的 `6c68239badcb58c9bbcdf4181ea03a2b8dfa6ea9`，继续在同一专业模式中整理界面，不另建演示应用。

## 面板层次

主内容仍为纯白，导航、工具带、模型台面、参数组与读数区用不同明度和阴影分层。移除主面板边框与参数行底线，输入边界、焦点、真实表格结构和工程截面引线仍保留。命令条和当前画布页签用海军蓝；读数卡嵌入统一浅灰底座，参数组使用局部白色表面。窄屏、分组草稿、锁定、键盘与专注画布行为继续复用现有实现。

新增 surface、shadow、stage、layout tokens，仍由 tokens.json 自动生成 tokens.css。工业外观样式作用域为 .white-workbench，不将第二模式或 legacy 页面改成另一套皮肤。强制色彩模式恢复可见边界，减少动态效果偏好关闭过渡。

## 实时模型，不是电缆照片

- 工作台新增可切换的材质预览；关闭时使用原简化着色和照明。同一 WebGL canvas、工程版本、相机控制和导出来源保留。
- 铜/铝金属、粗糙半导电层、乳白绝缘、金属屏蔽与深色护套使用分开的光学预设。护套和绝缘采用有限的 clearcoat，绝缘不启用 transmission，避免透明渲染额外开销。
- 两份 64×64 线性 DataTexture 提供金属微纹理与聚合物粗糙度/微小凹凸。固定种子，离线生成，不依赖图片 CDN 或外部图像加载。
- 切口边缘的光照倒角限制在原内外半径和轴向长度以内；铜线与屏蔽线仍属于示意外观，不是厂家绞合/屏蔽设计。
- 复用已有 RoomEnvironment/PMREM，增加明暗有区分的主光、补光和轮廓光，仅一盏灯生成 1024×1024 阴影。地面只接收展示投影，不加入相机包围盒或导出。
- 外观组和导出组联合去重释放几何、材质和纹理；额外释放实例缓冲和阴影资源。没有无限动画循环，交互/尺寸/输入变动才重绘。未宣称 FPS 提升或完整显存基准。
- GLB 仍导出原六层等效工程几何，不包含示意线股、展示倒角、光学微纹理、摄影台或光源。不修改求解器、材料热物性或温度数据。

这些材质是视觉预设，不是实测光学常数；写实化不等同制造图或标准认证。没有新增铠装层、结构参数或计算域。主截图必须来自浏览器实际运行，不用生成图代替应用验收。

## 验证方法

沿用 18 组铜/铝、截面和显示模式几何测试；新增 5 组光学约束，检查固定纹理、颜色空间、材质类型、半径/轴长界限、资源只释放一次、线股实例与顶点预算、单阴影光源。

新增两个真实后端浏览器用例：外框/参数底线取消且面板仍有层级；材质开关不产生 POST、不替换 canvas；真实下载 GLB 并解析其中六层和零贴图；修改参数后分层预览、版本与同一 canvas 保持一致。原 7 个工作台用例和既有兼容性用例不删除、不增大超时、不添加重试。

完整矩阵每个桌面项目增加 2 项：Chromium 88、WebKit 88、mobile-webkit 11、四个 Windows 项目各 61。仍要求 12 份完整且无重复、失败、错误或跳过的报告。

本地已用实际依赖完成生产构建、243 项后端测试、18+5 组视觉几何/光学约束、35 项输出证据、40 项扫描比较和 token/资产检查。本地 Chromium 的 localhost 导航被管理策略阻止（ERR_BLOCKED_BY_ADMINISTRATOR），未绕过。实际页面与跨浏览器结果应以对应提交的 Actions JUnit、GLB 和截图为准，不能用本地编译替代。

基线完整 CI run 203 / 34305174248 已结束且为 failure，不能继续称为运行中。本次重构不宣称解决所有既有跨平台失败；PR 保持 draft，main 不合并。

## 官方实现依据（2026-09-09 核对）

- Three.js MeshStandardMaterial：Metallic-Roughness、环境贴图、roughnessMap 的线性数据语义。https://threejs.org/docs/pages/MeshStandardMaterial.html
- Three.js MeshPhysicalMaterial：clearcoat、传输开销及环境贴图建议。https://threejs.org/docs/pages/MeshPhysicalMaterial.html
- Three.js PMREMGenerator：按粗糙度预滤波环境照明。https://threejs.org/docs/pages/PMREMGenerator.html
- Three.js Shadows：每个投影光源增加场景绘制成本。https://threejs.org/manual/en/shadows.html

上述来源支持渲染实现和开销取舍，不验证 CableSimPro 的电热模型。
