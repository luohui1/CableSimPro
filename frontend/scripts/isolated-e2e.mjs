import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const frontend = path.join(root, "frontend");
const script = process.argv[2];
if (!script || path.dirname(script) !== ".")
  throw Error("只能执行 frontend/scripts 中的验收脚本");
const source = path.resolve(
  process.env.E2E_DATABASE_SOURCE ||
    path.join(root, script === 'verify-display-names.mjs' ? '.data/engineering-demo/engineering.sqlite' : ".data/frontend-integration/engineering.sqlite"),
);
const scratchRoot = path.resolve(root, ".tmp/frontend-e2e");
const scratch = path.join(scratchRoot, randomUUID());
if (!scratch.startsWith(scratchRoot + path.sep)) throw Error("临时目录越界");
const database = path.join(scratch, "workspace.sqlite");
const owned = [];
let backendOutput = "";
let previewShutdownUrl;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
async function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    windowsHide: true,
    ...options,
  });
  const [code] = await once(child, "exit");
  if (code !== 0) throw Error(command + " 退出 " + code);
}
async function ready(url, child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null)
      throw Error("临时服务启动失败：" + backendOutput.slice(-3000));
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {}
    await delay(250);
  }
  throw Error("临时服务启动超时：" + url);
}
try {
  await fs.mkdir(scratch, { recursive: true });
  await run(
    process.env.PYTHON || "python",
    [
      "-c",
      "import sqlite3,sys; from pathlib import Path; source=Path(sys.argv[1]).resolve(); target=Path(sys.argv[2]).resolve(); assert source!=target; a=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True); b=sqlite3.connect(target); a.backup(b); b.close(); a.close()",
      source,
      database,
    ],
    { stdio: "inherit" },
  );
  const backendPort = await port(),
    frontendPort = await port();
  const environment = {
    ...process.env,
    CABLESIM_DB: database,
    CABLESIM_DATASETS_DIR: path.join(scratch, "datasets"),
    TEMP: scratch,
    TMP: scratch,
    BACKEND_URL: "http://127.0.0.1:" + backendPort,
  };
  if (
    [
      "verify-research.mjs",
      "verify-native-preflight.mjs",
      "verify-research-navigation.mjs",
      "verify-research-presentation.mjs",
      "verify-research-refinement.mjs",
      "verify-research-finishing.mjs",
      "verify-expansion.mjs",
      "verify-expansion-states.mjs",
      "verify-catalog-controls.mjs",
    ].includes(script)
  )
    await run(
      process.env.PYTHON || "python",
      [path.join(frontend, "scripts/seed-research-fixtures.py")],
      { env: environment, stdio: "inherit" },
    );
  const isolatedCad = ["verify-research-refinement.mjs", "verify-expansion.mjs", "verify-expansion-states.mjs", "verify-display-names.mjs"].includes(script);
  const launchArgs = isolatedCad
    ? [
        "-c",
        [
          "import os,uvicorn",
          "from pathlib import Path",
          "from backend.main import app",
          "from backend.plugin_host.resident import ResidentRunner",
          "root=Path(os.environ['TEMP']).resolve()",
          "app.state.previews.jobs=root/'cad-jobs'",
          "app.state.previews.jobs.mkdir()",
          "app.state.previews.runner=ResidentRunner(root/'cad-workers')",
          "@app.post('/__e2e/close-previews')",
          "def close_previews():",
          "    app.state.previews.close()",
          "    return {'closed':True}",
          `uvicorn.run(app,host='127.0.0.1',port=${backendPort})`,
        ].join("\n"),
      ]
    : [
        "-m",
        "uvicorn",
        "backend.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        String(backendPort),
      ];
  if (isolatedCad)
    previewShutdownUrl = environment.BACKEND_URL + "/__e2e/close-previews";
  const backend = spawn(process.env.PYTHON || "python", launchArgs, {
    cwd: root,
    env: environment,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  owned.push(backend);
  for (const stream of [backend.stdout, backend.stderr])
    stream.on("data", (chunk) => {
      backendOutput = (backendOutput + chunk.toString()).slice(-12000);
    });
  await ready(environment.BACKEND_URL + "/api/health", backend);
  const preview = spawn(
    process.execPath,
    [
      path.join(frontend, "node_modules/vite/bin/vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(frontendPort),
      "--strictPort",
    ],
    { cwd: frontend, env: environment, windowsHide: true, stdio: "ignore" },
  );
  owned.push(preview);
  const url = "http://127.0.0.1:" + frontendPort;
  await ready(url, preview);
  console.log("独立临时验收数据库已启动；开发数据库仅作为只读备份来源。");
  await run(process.execPath, [path.join(frontend, "scripts", script)], {
    cwd: frontend,
    env: { ...environment, FRONTEND_URL: url, E2E_ISOLATED: "1" },
    stdio: "inherit",
  });
} finally {
  if (previewShutdownUrl) {
    const response = await fetch(previewShutdownUrl, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
    }).catch(() => null);
    console.log("本任务 CAD 常驻进程关闭：" + (response?.ok === true));
  }
  for (const child of owned.reverse()) {
    if (child.exitCode === null) {
      const closed = once(child, "exit");
      child.kill();
      await Promise.race([closed, delay(4000)]);
    }
  }
  if (path.resolve(scratch).startsWith(scratchRoot + path.sep)) {
    await fs.rm(scratch, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 400,
    });
    console.log(
      "临时验收数据库、服务与目录已清理：" +
        !(await fs.stat(scratch).then(
          () => true,
          () => false,
        )),
    );
  }
}
