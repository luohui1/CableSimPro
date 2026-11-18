---
title: 部署本文档站点
description: 构建本文档站点，并把静态文件放到 Nginx、内网服务器或 GitHub Pages 上离线使用。
sidebar:
  order: 7
---

本文档站点是纯静态网页：HTML、CSS、JavaScript、图片、公式字体和中文搜索索引全部在构建产物里，打开时不访问任何外部资源，可以放进没有外网的内网服务器使用。

## 获取构建产物

**直接下载**：向 main 的推送和每个拉取请求的 CI 都会构建站点，在 GitHub Actions 对应运行的 “Docs site” 任务里下载产物 `docs-site`（保留 14 天），解压后就是可以直接部署的站点目录。

**自己构建**（需要 Node.js 22.12+ 和 Python 3.11+，Python 用于从后端导出接口说明）：

```sh
pip install -r backend/requirements.txt
cd site
npm ci
npm run build
```

产物在 `site/dist/`。构建会同时执行内部信息检查，发现内部主机名、本机路径、密钥等内容会失败。

## 放到网站根目录

默认构建假定站点位于网站根目录（`/`）。把 `dist/` 中的全部文件复制到 Nginx 的站点目录即可：

```nginx
server {
    listen 80;
    server_name docs.example.com;
    root /opt/cablesimpro-docs;   # dist/ 的内容
    index index.html;
    location / {
        try_files $uri $uri/ =404;
    }
}
```

任何能提供静态文件的服务器都可以（IIS、Apache、对象存储的静态网站功能等），只要目录地址能返回其中的 `index.html`。

## 放到子路径

要放在已有网站的子路径下（如 `https://intranet.example.com/cablesimpro-docs/`），构建时用 `DOCS_BASE` 指定这个路径，再把产物放到对应目录：

```sh
DOCS_BASE=/cablesimpro-docs/ npm run build
```

```nginx
location /cablesimpro-docs/ {
    alias /opt/cablesimpro-docs/;
    try_files $uri $uri/ =404;
}
```

页面中的链接和搜索索引都带有构建时的路径，所以**同一份产物只能放在构建时指定的路径下**；换路径需要重新构建。

## 本机预览

```sh
cd site
npm run preview
```

然后在浏览器打开命令输出的地址。直接双击 `index.html` 以 `file://` 打开时，中文搜索等功能无法使用，请通过 Web 服务器访问。

## GitHub Pages

仓库的 `.github/workflows/docs-pages.yml` 已准备好发布到 GitHub Pages 的工作流：只在 `main` 分支更新或手动触发时构建，并且只有仓库变量 `DOCS_PAGES_ENABLED` 为 `true` 时才真正发布。启用步骤：

1. 仓库 Settings → Pages，Source 选择 “GitHub Actions”。
2. 仓库 Settings → Secrets and variables → Actions → Variables，新建 `DOCS_PAGES_ENABLED`，值为 `true`。
3. 在 Actions 页面手动运行 “Docs site to GitHub Pages”，或等待下一次 `main` 分支更新。

工作流会自动设置正确的站点地址和子路径。

## 发布清单与检查

- 发布哪些 `docs/` 文档由 `site/publish.json` 明确列出；未列出的文档默认不发布。
- 内部信息检查规则在 `site/internal-check.json`。
- `npm run check:links` 检查站内死链，`npm run check:search` 用真实浏览器抽检中文搜索。
