import fs from "node:fs/promises";
import { existsSync } from 'node:fs';
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const frontend = path.join(root, "frontend");
const python = process.env.PYTHON || [path.join(root,'.venv','Scripts','python.exe'),path.join(root,'.venv','bin','python')].find(existsSync) || 'python';
const script = process.argv[2];
if (!script || path.dirname(script) !== ".")
  throw Error("只能执行 frontend/scripts 中的验收脚本");
const visibleTextScript = ['verify-visible-text.mjs', 'verify-visible-text-states.mjs', 'verify-regularity.mjs', 'verify-performance.mjs', 'verify-loading-trace.mjs'].includes(script);
const realUseScript = script === 'verify-real-use.mjs';
if (realUseScript && (['agent', 'history', 'undo-history'].includes(process.env.REAL_USE_MODE)
    || process.env.REAL_USE_PHASE === 'agent-real-use' || process.env.REAL_USE_TASKS
    || ['REAL_USE_HISTORY', 'REAL_USE_RESUME_MISSING', 'REAL_USE_RESUME_TASKS'].some(name => process.env[name] === '1'))
  || script === 'verify-form-real-use.mjs' && process.env.FORMS_REAL_USE_HISTORY_ONLY === '1'
  || script === 'verify-public-workflows.mjs' && process.env.PUBLIC_MODE === 'agent-decisions')
  throw Error('旧 Agent 浏览器场景已迁移，请运行 cd studio && npm run walk:fusion；真实模型验收另行记录。');
const formsUseScript = ['verify-form-real-use.mjs', 'verify-client-real-use.mjs', 'verify-public-read-use.mjs', 'verify-read-path.mjs'].includes(script);
const apiGenerationScript = script === 'generate-api.mjs';
const serverTrace = script === 'verify-loading-trace.mjs' || script === 'verify-performance.mjs' && !!process.env.LOADING_SERVER_TRACE;
const source = path.resolve(
  process.env.E2E_DATABASE_SOURCE ||
    path.join(root, visibleTextScript || realUseScript || formsUseScript || apiGenerationScript ? '.data/release/engineering.sqlite' : script === 'verify-type-resilience.mjs' ? '.data/standard-check/validation.sqlite' : ['verify-workbench.mjs','verify-component-foundation.mjs','verify-version-status.mjs','verify-host-connections.mjs','verify-inquiry.mjs','verify-display-names.mjs','verify-documents.mjs','verify-document-batch.mjs','verify-accessibility.mjs'].includes(script) ? '.data/engineering-demo/engineering.sqlite' : ".data/frontend-integration/engineering.sqlite"),
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
async function isolateReproductionLibrary() {
  // Some fixture scripts deliberately create this directory themselves.
  // Preserve that explicit contract; never silently select the host's global library.
  if (process.env.CABLESIM_REPRODUCTION_LIBRARY) {
    console.log('使用显式验证证据目录（保留脚本自建夹具约定）：' + process.env.CABLESIM_REPRODUCTION_LIBRARY);
    return process.env.CABLESIM_REPRODUCTION_LIBRARY;
  }
  const sourceDatabase = await fs.realpath(source);
  const releaseDatabase = await fs.realpath(path.join(root, '.data/release/engineering.sqlite'))
    .catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const required = sourceDatabase === releaseDatabase;
  const sourceLibrary = path.join(path.dirname(sourceDatabase), 'library');
  const library = path.join(scratch, 'library');
  const state = await fs.lstat(sourceLibrary)
    .catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!state) {
    if (required) throw Error('发布验证证据库缺失：' + sourceLibrary + '；请先完成发布种子生成。');
    await fs.mkdir(library);
    console.log('来源未配置验证证据库；使用隔离空目录，不读取全局证据：' + library);
    return library;
  }
  if (!state.isDirectory()) throw Error('验证证据库必须是实际目录：' + sourceLibrary);
  async function manifest(folder, relative = '') {
    const files = [];
    const entries = await fs.readdir(path.join(folder, relative), { withFileTypes: true });
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) files.push(...await manifest(folder, name));
      else if (entry.isFile()) {
        const bytes = await fs.readFile(path.join(folder, name));
        files.push({ path: name.split(path.sep).join('/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      } else throw Error('验证证据库包含非普通文件：' + path.join(folder, name));
    }
    return files;
  }
  const files = await manifest(sourceLibrary);
  if (required && !files.some(file => file.path === 'index.json'))
    throw Error('发布验证证据索引缺失：' + path.join(sourceLibrary, 'index.json'));
  await fs.cp(sourceLibrary, library, { recursive: true, force: false, errorOnExist: true });
  const expected = JSON.stringify(files);
  if (JSON.stringify(await manifest(sourceLibrary)) !== expected || JSON.stringify(await manifest(library)) !== expected)
    throw Error('验证证据库在复制期间发生变化或副本字节不一致；未启动验收服务。');
  console.log('验证证据库只读复制与逐文件摘要核对：' + JSON.stringify({ source: sourceLibrary, isolated: library, files }));
  return library;
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
  const reproductionLibrary = await isolateReproductionLibrary();
  const backendPort = await port(),
    frontendPort = await port();
  servicePorts.push(backendPort, frontendPort);
  const environment = {
    ...process.env,
    CABLESIM_DB: database,
    E2E_PYTHON: python,
    // 工作台验收不调用模型，不复用来源库的系统凭据。
    CABLESIM_AGENT_KEY_STORE: 'memory',
    CABLESIM_DATASETS_DIR: path.join(scratch, "datasets"),
    CABLESIM_REPRODUCTION_LIBRARY: reproductionLibrary,
    TEMP: scratch,
    TMP: scratch,
    BACKEND_URL: "http://127.0.0.1:" + backendPort,
    E2E_SEED_RECEIPT: seedReceipt,
  };
  if (serverTrace) {
    const output = path.resolve(process.env.LOADING_TRACE_OUTPUT || path.join(root, '.data/fix-round/shared-shell/loading-path/trace'));
    environment.LOADING_TRACE_OUTPUT = output;
    environment.LOADING_SERVER_TRACE = path.resolve(process.env.LOADING_SERVER_TRACE || output + '-server.jsonl');
    await fs.mkdir(path.dirname(environment.LOADING_SERVER_TRACE), { recursive: true });
  }
  if (realUseScript) {
    // Only non-secret deployed connection values enter the form. The actual editor starts empty.
    const deployed = JSON.parse(await fs.readFile(path.join(root, '.data/hpc/config.json'), 'utf8'));
    const envPath = deployed.environment?.path || (typeof deployed.python === 'string' && deployed.python.endsWith('/bin/python') ? deployed.python.slice(0, -11) : null);
    if (!envPath || !deployed.remote_root?.endsWith('/jobs')) throw Error('真实环境路径尚未登记，不能猜测超算目录');
    environment.E2E_HPC_INPUT = JSON.stringify({ ssh_alias: 'dghpc', partition: 'dg83', remote_workdir: deployed.remote_root.slice(0, -5), environment: { kind: deployed.environment?.kind || 'python', path: envPath }, budget_core_hours: 2000, total_budget_core_hours: 20000 });
    await fs.mkdir(path.join(scratch, '.data/hpc'), { recursive: true });
    if (process.env.REAL_USE_MODE === 'readonly') await fs.copyFile(path.join(root, '.data/hpc/config.json'), path.join(scratch, 'administrator-profile.json'));
  }
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
  const isolatedCad = visibleTextScript || realUseScript || formsUseScript || apiGenerationScript || ["verify-accessibility.mjs", "verify-research-refinement.mjs", "verify-expansion.mjs", "verify-expansion-states.mjs", "verify-display-names.mjs"].includes(script);
  const launchArgs = isolatedCad
    ? [
        "-c",
        [
          "import os,uvicorn",
          "from pathlib import Path",
          "from backend.main import app",
          ...(script === 'verify-public-read-use.mjs' && process.env.PUBLIC_READ_PHASE === 'before' ? [
            // Run the committed middleware for a real before/after cache comparison.
            // Keep the live host, plugins and saved results otherwise identical.
            "import ast,subprocess,backend.main as host_main",
            "baseline=ast.parse(subprocess.check_output(['git','show',os.environ.get('PUBLIC_READ_BASELINE','HEAD')+':backend/main.py'],text=True,encoding='utf-8'))",
            "node=next(n for n in baseline.body if isinstance(n,ast.ClassDef) and n.name=='LocalBoundary')",
            "namespace=dict(vars(host_main))",
            "exec(compile(ast.Module(body=[node],type_ignores=[]),'<committed-cache-baseline>','exec'),namespace)",
            "host_main.LocalBoundary.__call__=namespace['LocalBoundary'].__call__",
          ] : []),
          ...(['verify-performance.mjs', 'verify-loading-trace.mjs'].includes(script) ? [
            "import re",
            "from starlette.responses import JSONResponse",
            "@app.middleware('http')",
            "async def readonly_audit(request,call_next):",
            "    allowed=request.method in ('GET','HEAD','OPTIONS') or request.url.path=='/__e2e/close-previews' or (request.method=='POST' and (request.url.path=='/api/plugin-queries/cablesim.standards-basis/lookup' or re.fullmatch(r'/api/workspaces/[0-9a-fA-F-]{36}/geometry-preview',request.url.path)))",
            "    if not allowed: return JSONResponse({'detail':'性能巡检只读，未执行计算或保存'},status_code=403,headers={'X-Audit-Blocked':'1'})",
            "    return await call_next(request)",
          ] : []),
          "from backend.plugin_host.resident import ResidentRunner",
          "root=Path(os.environ['TEMP']).resolve()",
          ...(realUseScript || formsUseScript || apiGenerationScript ? [
            "import backend.kernel.hpc_jobs as hpc_api",
            "hpc_api.ROOT=root",
            "app.state.research.executor.profile=root/('administrator-profile.json' if os.environ.get('REAL_USE_MODE')=='readonly' else '.data/hpc/config.json')",
            "app.state.research.executor.root=root/'hpc-runs'",
            "app.state.research.executor.ledger=root/'hpc-budget.sqlite'",
          ] : []),
          "app.state.previews.jobs=root/'cad-jobs'",
          "app.state.previews.jobs.mkdir()",
          "app.state.previews.runner=ResidentRunner(root/'cad-workers')",
          "@app.post('/__e2e/close-previews')",
          "def close_previews():",
          "    app.state.previews.close()",
          "    return {'closed':True}",
          ...(serverTrace ? [
            "import time,json",
            "original_app=app",
            ...(process.env.LOADING_TRACE_WARM === '1' ? [
              "from functools import wraps",
              "from backend.kernel.research import Research",
              "def trace_warm(method):",
              "    @wraps(method)",
              "    def measured(self,*args,**kwargs):",
              "        item={'phase':method.__name__,'start':time.time()}",
              "        try: return method(self,*args,**kwargs)",
              "        finally:",
              "            item['done']=time.time()",
              "            with open(os.environ['LOADING_SERVER_TRACE'],'a',encoding='utf-8') as log: log.write(json.dumps(item)+'\\n')",
              "    return measured",
              "Research.warm_catalogs=trace_warm(Research.warm_catalogs)",
            ] : []),
            "async def traced_app(scope,receive,send):",
            "    if scope['type']!='http': return await original_app(scope,receive,send)",
            "    item={'path':scope['path'],'query':scope.get('query_string',b'').decode(),'start':time.time(),'bytes':0,'bodies':0}",
            "    async def traced_send(message):",
            "        if message['type']=='http.response.start': item.update(headers=time.time(),status=message['status'],response_headers={k.decode():v.decode() for k,v in message.get('headers',[])})",
            "        if message['type']=='http.response.body':",
            "            item.setdefault('first_body',time.time());item.update(last_body=time.time(),bytes=item['bytes']+len(message.get('body',b'')),bodies=item['bodies']+1)",
            "        await send(message)",
            "    try: await original_app(scope,receive,traced_send)",
            "    finally:",
            "        item['done']=time.time()",
            "        if scope['path'].startswith('/api/index/'):",
            "            from backend.index import get_index",
            "            item['index_read']=get_index(original_app.state.research).last_read",
            "        with open(os.environ['LOADING_SERVER_TRACE'],'a',encoding='utf-8') as log: log.write(json.dumps(item)+'\\n')",
          ] : []),
          `uvicorn.run(${serverTrace ? 'traced_app' : 'app'},host='127.0.0.1',port=${backendPort})`,
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
  if (apiGenerationScript) {
    console.log(`隔离 OpenAPI 服务：后端 PID ${backend.pid} / ${backendPort}`);
    await run(process.execPath, [path.join(frontend, 'scripts', script), ...process.argv.slice(3)], { cwd: frontend, env: environment, stdio: 'inherit' });
  } else {
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
  // The visible-text audit must keep the frontend snapshot stable while other threads build.
  // An explicitly supplied frozen snapshot is already isolated; serve it read-only.
  const suppliedPreview = process.env.E2E_FRONTEND_DIST ? await fs.realpath(process.env.E2E_FRONTEND_DIST) : undefined;
  const sharedDist = await fs.realpath(path.join(frontend, 'dist')).catch(() => path.join(frontend, 'dist'));
  const previewDist = suppliedPreview && suppliedPreview !== sharedDist ? suppliedPreview : path.join(scratch, 'preview-dist');
  if ((visibleTextScript || realUseScript || formsUseScript) && process.env.E2E_DEV !== '1')
    if (previewDist === path.join(scratch, 'preview-dist')) await fs.cp(sharedDist, previewDist, { recursive: true });
  const preview = spawn(
    process.execPath,
    [
      path.join(frontend, "node_modules/vite/bin/vite.js"),
      ...(process.env.E2E_DEV === '1' ? [] : ['preview']),
      ...((visibleTextScript || realUseScript || formsUseScript) && process.env.E2E_DEV !== '1' ? ['--outDir', previewDist] : []),
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
  console.log("独立临时验收数据库已启动；来源库仅用于只读备份。");
  await run(process.execPath, [path.join(frontend, "scripts", script)], {
    cwd: frontend,
    env: { ...environment, FRONTEND_URL: url, E2E_ISOLATED: "1" },
    stdio: "inherit",
  });
  }
} finally {
  if ((realUseScript || script === 'verify-client-real-use.mjs') && process.env.REAL_USE_CAPTURE_DATABASE === '1' && existsSync(database)) {
    // Keep actual workspace/configuration state for subsequent read-only inspection.
    const evidence = path.join(root, '.data/fix-round/shared-shell/real-use', script === 'verify-client-real-use.mjs' ? 'client-observed.sqlite' : 'observed.sqlite');
    await run(python, ['-c', "import sqlite3,sys; from pathlib import Path; a=sqlite3.connect(Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()", database, evidence], {stdio:'inherit'}).catch(error => console.error('真实使用记录备份失败：' + error.message));
  }
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
    let open = false;
    for (let attempt = 0; attempt < 25; attempt++) {
      open = await new Promise(resolve => {
        const socket = net.createConnection({host:'127.0.0.1',port:servicePort});
        socket.setTimeout(800);
        socket.once('connect',()=>{socket.destroy();resolve(true);});
        socket.once('error',()=>resolve(false));
        socket.once('timeout',()=>{socket.destroy();resolve(false);});
      });
      if (!open) break;
      await delay(200); // Windows can release the listening socket just after the process exit event.
    }
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
