import fs from "node:fs/promises";
import { existsSync } from 'node:fs';
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const frontend = path.join(root, "frontend");
const python = process.env.PYTHON || [path.join(root,'.venv','Scripts','python.exe'),path.join(root,'.venv','bin','python')].find(existsSync) || 'python';
const script = process.argv[2];
if (!script || path.dirname(script) !== ".")
  throw Error("只能执行 frontend/scripts 中的验收脚本");
const source = path.resolve(
  process.env.E2E_DATABASE_SOURCE ||
    path.join(root, script === 'verify-type-resilience.mjs' ? '.data/standard-check/validation.sqlite' : ['verify-workbench.mjs','verify-component-foundation.mjs','verify-version-status.mjs','verify-host-connections.mjs','verify-inquiry.mjs','verify-display-names.mjs','verify-documents.mjs','verify-document-batch.mjs','verify-accessibility.mjs'].includes(script) ? '.data/engineering-demo/engineering.sqlite' : ".data/frontend-integration/engineering.sqlite"),
);
const scratchRoot = path.resolve(root, ".tmp/frontend-e2e");
const scratch = path.join(scratchRoot, randomUUID());
if (!scratch.startsWith(scratchRoot + path.sep)) throw Error("临时目录越界");
const database = path.join(scratch, "workspace.sqlite");
const owned = [];
const servicePorts = [];
let backendOutput = "";
let previewOutput = "";
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
async function ready(url, child, output = () => backendOutput) {
  // 后端启动时会预热研究与运行读取；大的演示库冷启动约 30 s，等待上限 60 s
  for (let attempt = 0; attempt < 240; attempt++) {
    if (child.exitCode !== null)
      throw Error("临时服务启动失败：" + output().slice(-3000));
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {}
    await delay(250);
  }
  throw Error("临时服务启动超时：" + url);
}
try {
  await fs.mkdir(scratch, { recursive: true });
  console.log('本任务隔离目录：' + scratch);
  await run(
    python,
    [
      "-c",
      "import sqlite3,sys; from pathlib import Path; source=Path(sys.argv[1]).resolve(); target=Path(sys.argv[2]).resolve(); assert source!=target; a=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True); b=sqlite3.connect(target); a.backup(b); b.close(); a.close()",
      source,
      database,
    ],
    { stdio: "inherit" },
  );
  const sourceReceipt = path.join(path.dirname(source), path.parse(source).name + '.seed.json');
  const seedReceipt = path.join(scratch, 'seed.json');
  if (script === 'verify-display-names.mjs') await fs.copyFile(sourceReceipt, seedReceipt);
  const backendPort = await port(),
    frontendPort = await port();
  servicePorts.push(backendPort, frontendPort);
  const environment = {
    ...process.env,
    CABLESIM_DB: database,
    // 验收库的 Agent 密钥只放进程内存，不碰本机系统凭据库
    CABLESIM_AGENT_KEY_STORE: "memory",
    CABLESIM_DATASETS_DIR: path.join(scratch, "datasets"),
    TEMP: scratch,
    TMP: scratch,
    BACKEND_URL: "http://127.0.0.1:" + backendPort,
    E2E_SEED_RECEIPT: seedReceipt,
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
      python,
      [path.join(frontend, "scripts/seed-research-fixtures.py")],
      { env: environment, stdio: "inherit" },
    );
  const isolatedCad = ["verify-accessibility.mjs", "verify-research-refinement.mjs", "verify-expansion.mjs", "verify-expansion-states.mjs", "verify-display-names.mjs"].includes(script);
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
  const backend = spawn(python, launchArgs, {
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
  if (script === 'verify-display-names.mjs') {
    // Refresh installed IEC releases only in the private backup. Preserve
    // historical runs and the source demonstration database.
    await run(python, ['-c', [
      'import importlib.util,json,sys',
      'from pathlib import Path',
      "path=Path('frontend/scripts/seed-engineering-demo.py')",
      "spec=importlib.util.spec_from_file_location('isolated_engineering_seed',path)",
      'seed=importlib.util.module_from_spec(spec);spec.loader.exec_module(seed)',
      "receipt=json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))",
      "assert receipt['complete']",
      'seed.refresh_saved_demo(sys.argv[1],receipt)',
    ].join('\n'), environment.BACKEND_URL, seedReceipt], {env:environment,stdio:'inherit'});
  }
  const preview = spawn(
    process.execPath,
    [
      path.join(frontend, "node_modules/vite/bin/vite.js"),
      ...(process.env.E2E_DEV === '1' ? [] : ['preview']),
      "--host",
      "127.0.0.1",
      "--port",
      String(frontendPort),
      "--strictPort",
    ],
    { cwd: frontend, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  owned.push(preview);
  for (const stream of [preview.stdout, preview.stderr]) stream.on('data', chunk => { previewOutput = (previewOutput + chunk.toString()).slice(-12000); });
  console.log(`隔离服务：后端 PID ${backend.pid} / ${backendPort}；预览 PID ${preview.pid} / ${frontendPort}`);
  const url = "http://127.0.0.1:" + frontendPort;
  await ready(url, preview, () => previewOutput);
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
      if (process.platform === 'win32') {
        try { await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {stdio:'ignore'}); }
        catch (error) { if (child.exitCode === null) throw error; }
      } else child.kill();
      await Promise.race([closed, delay(4000)]);
    }
  }
  for (const servicePort of servicePorts) {
    const open = await new Promise(resolve => {
      const socket = net.createConnection({host:'127.0.0.1',port:servicePort});
      socket.setTimeout(800);
      socket.once('connect',()=>{socket.destroy();resolve(true);});
      socket.once('error',()=>resolve(false));
      socket.once('timeout',()=>{socket.destroy();resolve(false);});
    });
    if(open)throw Error('本任务服务端口未关闭：'+servicePort);
  }
  console.log('本任务服务与子进程退出、端口关闭已核对。');
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
