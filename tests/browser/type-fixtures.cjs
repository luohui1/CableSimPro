'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const cleanupPending = [];

async function request(base, route, body, method = body ? 'POST' : 'GET', headers = {}) {
  const response = await fetch(base + '/api' + route, {
    method, headers: {'Content-Type': 'application/json', ...headers},
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(route + ' ' + response.status + ': ' + raw); }
  assert.ok(response.ok, route + ' ' + response.status + ': ' + JSON.stringify(data));
  return data;
}

async function startServer({lifecycle = false} = {}) {
  const parent = path.resolve(root, '.tmp');
  const owned = path.join(parent, 'type-browser-' + randomUUID());
  assert.ok(owned.startsWith(parent + path.sep));
  fs.mkdirSync(owned, {recursive: true});
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const source = lifecycle ? String.raw`import importlib.util, json, os
from pathlib import Path
from copy import deepcopy
from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from design.workbench.serve import app
spec = importlib.util.spec_from_file_location('type_receipt_fixture', Path(os.environ['TYPE_TEST_ROOT'])/'tests/test_type_versions.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
patch = MonkeyPatch()
with TestClient(app) as client:
    w = module.workspace(client)
    runs = module.seed_evidence(client, w, patch)
    historical = module.workspace(client)
    runs.update(module.seed_evidence(client, historical, patch))
    def get_run(wid, rid, cache=None):
        value = deepcopy(runs[rid])
        if app.state.workspace_store.snapshot(wid)['revision'] != value['snapshot']['workspace_revision']:
            value['freshness'] = 'historical'
        return value
    patch.setattr(app.state.research, 'get_run', get_run)
    (Path(os.environ['TYPE_TEST_DIR'])/'fixture.json').write_text(json.dumps({'workspace_id':w['id'], 'historical_workspace_id':historical['id']}), 'utf-8')
` : String.raw`import json, os
from pathlib import Path
from design.workbench.serve import app
from backend.kernel.hpc_executor import HpcExecutor
from uuid import uuid4
root = Path(os.environ['TYPE_TEST_ROOT'])
owned = Path(os.environ['TYPE_TEST_DIR'])
profile = json.loads((root/'.data/hpc/config.json').read_text('utf-8'))
profile['remote_plugins'] = sorted(set(profile.get('remote_plugins', [])) | {'cablesim.iec60287', 'cablesim.type-electrical'})
(owned/'hpc-profile.json').write_text(json.dumps(profile), 'utf-8')
class IsolatedHpcExecutor(HpcExecutor):
    def check(self, plugin_id, capability, cases, *, expected_manifest=None):
        # Each disposable server owns a fresh preflight namespace; the shared
        # budget ledger still accounts all work and guards engineering retries.
        executor = self.for_operation(str(uuid4()))
        return executor.check(plugin_id, capability, cases, expected_manifest=expected_manifest)
app.state.research.executor = IsolatedHpcExecutor(profile=owned/'hpc-profile.json', root=owned/'remote-runs')
`;
  fs.writeFileSync(path.join(owned, 'type_browser_server.py'), source, 'utf8');
  const server = spawn(path.join(root, '.venv/Scripts/python.exe'), [
    '-m', 'uvicorn', 'type_browser_server:app', '--app-dir', owned,
    '--host', '127.0.0.1', '--port', String(port),
  ], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, CABLESIM_DESIGN_DB: path.join(owned, 'types.sqlite'),
      TYPE_TEST_ROOT: root, TYPE_TEST_DIR: owned},
  });
  let log = '';
  const accountingFile = path.join(root, '.data/pruning/browser-accounting', path.basename(owned)+'.json');
  const collect = bytes => { log += bytes.toString(); };
  server.stdout.on('data', collect);
  server.stderr.on('data', collect);
  async function close() {
    if (server.exitCode === null) {
      if (process.platform === 'win32') {
        await new Promise((resolve, reject) => {
          const killer = spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
            windowsHide: true, stdio: 'ignore',
          });
          killer.once('exit', resolve);
          killer.once('error', reject);
        });
      } else {
        server.kill('SIGTERM');
        await new Promise(resolve => server.once('exit', resolve));
      }
    }
    const jobs = new Map(), runsRoot = path.join(owned, 'remote-runs');
    if (fs.existsSync(runsRoot)) {
      for (const runId of fs.readdirSync(runsRoot)) {
        const submissions = path.join(runsRoot, runId, 'submissions');
        if (!fs.existsSync(submissions)) continue;
        for (const token of fs.readdirSync(submissions)) {
          const file = path.join(submissions, token, 'accounting.json');
          if (!fs.existsSync(file)) continue;
          const row = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (row.job_id) jobs.set(row.job_id, {job_id:row.job_id,
            actual_cpu_seconds:row.actual_cpu_seconds, terminal:row.terminal});
        }
      }
    }
    fs.mkdirSync(path.dirname(accountingFile), {recursive:true});
    fs.writeFileSync(accountingFile, JSON.stringify({server_id:path.basename(owned), jobs:[...jobs.values()]}, null, 2));
    fs.writeFileSync(path.join(root, '.data/pruning/browser-server.log'), log);
    assert.ok(path.resolve(owned).startsWith(parent + path.sep));
    try { fs.rmSync(owned, {recursive: true, force: true}); }
    catch (error) { console.error('Temporary cleanup: ' + error.message); }
    if (fs.existsSync(owned)) {
      cleanupPending.push(owned);
      console.error('CLEANUP_PENDING ' + owned);
    }
  }
  try {
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Isolated server startup: ' + log)), 120000);
      const ready = bytes => {
        if (bytes.toString().includes('Uvicorn running')) {
          clearTimeout(deadline);
          resolve();
        }
      };
      server.stderr.on('data', ready);
      server.once('error', error => { clearTimeout(deadline); reject(error); });
      server.once('exit', code => { clearTimeout(deadline); reject(new Error('Server exit ' + code + ': ' + log)); });
    });
    const base = 'http://127.0.0.1:' + port;
    const fixture = lifecycle ? JSON.parse(fs.readFileSync(path.join(owned, 'fixture.json'), 'utf8')) : {};
    return {base, fixture, owned, close, log: () => log};
  } catch (error) {
    await close();
    throw error;
  }
}

async function workspace(base, modelId = 'system.cu-xlpe-al-240') {
  const models = await request(base, '/design/cable-models');
  const model = models.find(item => item.id === modelId);
  assert.ok(model, 'Missing model ' + modelId);
  return request(base, '/design/type-workspaces', {model_id: model.id, content_sha256: model.content_sha256});
}

async function manufacturer(base, caseId) {
  const cases = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/standard_check_cases.json'), 'utf8'));
  const fixture = cases.find(item => item.case_id === caseId);
  assert.ok(fixture, 'Missing manufacturer fixture ' + caseId);
  const w = await workspace(base);
  await request(base, '/workspaces/' + w.id + '/domain', {
    expected_revision: w.revision, document: fixture.input,
  }, 'PUT');
  return request(base, '/workspaces/' + w.id);
}

async function study(base, w, pluginId, capability, parameters, driver) {
  const entry = (await request(base, '/methods')).find(item => item.method.plugin_id === pluginId);
  const definition = {title: '浏览器验收 · ' + capability, input_source: 'domain',
    method: {...entry.method, capability}, parameters, expected_revision: w.revision};
  if (driver) definition.driver = driver;
  const saved = await request(base, '/workspaces/' + w.id + '/studies', definition);
  const route = '/workspaces/' + w.id + '/studies/' + saved.id;
  const preflight = await request(base, route + '/preflight?expected_revision=' + w.revision + '&expected_study_revision=' + saved.revision);
  assert.ok(preflight.ready, JSON.stringify(preflight));
  const run = await request(base, route + '/runs', {request_id: randomUUID(), expected_revision: w.revision,
    expected_study_revision: saved.revision, lock_digest: preflight.lock_digest, scope_acknowledged: true});
  assert.ok(['succeeded', 'partial'].includes(run.status), JSON.stringify(run));
  return run;
}

async function shortCircuit(base, w) {
  const parameters = {cable_type_id: w.domain.cable_types[0].id, duration_s: 1,
    initial_temperature_k: 363.15, final_temperature_k: 523.15, interest_times_s: [.25, 1, 4]};
  parameters.sources = Object.fromEntries(Object.keys(parameters).filter(key => key !== 'cable_type_id')
    .map(key => [key, '独立手算条件；非厂家试验结果']));
  return study(base, w, 'cablesim.type-electrical', 'short-circuit', parameters);
}

async function rating(base, w, parameters) {
  const rows = ['trefoil', 'flat', 'ducts', 'air'].map(layout => ({case_id: 'compare-' + layout,
    name: '验收 ' + layout, layout, depth_m: 1}));
  const definition = await request(base, '/design/workspaces/' + w.id + '/rating-table-definition', {
    expected_revision: w.revision, rows, parameters,
  });
  return study(base, w, definition.method.plugin_id, definition.method.capability, definition.parameters, definition.driver);
}


async function benchmark(base) {
  const w = await workspace(base);
  const d=structuredClone(w.domain),fixture=JSON.parse(fs.readFileSync(process.env.CABLESIM_TB880_FIXTURE||path.join(root,'.data/tb880/fixtures/tb880-case-0-1.json'),'utf8')),si=fixture.inputSi,c=d.cable_types[0];
  d.name=c.label='TB 880 · 合成验收数据（载流量表）';c.rating={...c.rating,u0:si.phaseToGroundVoltageV,u:si.lineToLineVoltageV,um:145000,max_conductor_temperature:{normal:363.15}};
  c.cores[0].conductor={...c.cores[0].conductor,nominal_area:.000630,diameter:.0303,r20:2.83e-5,r20_basis:'design'};
  [.0015,.0155,.0013,.0008,.0035].forEach((t,i)=>c.common_layers[i].thickness=t);
  for(const m of d.materials){if(m.category==='conductor')m.temperature_coefficient_20=.00393;else if(m.category==='semiconductor')m.thermal_resistivity=2.5;else if(m.category==='insulation')Object.assign(m,{thermal_resistivity:3.5,relative_permittivity:2.5,loss_tangent:.001});else if(m.category==='metal')Object.assign(m,{electrical_resistivity_20:2.84e-8,temperature_coefficient_20:.00403});else if(m.category==='polymer')m.thermal_resistivity=3.5;}
  const src={kind:'user',reference:'合成验收数据：采用 TB 880 case 0-1 pp.62–75 的校核尺寸、物性和电压；其余来源保留，非厂家数据；SHA256 '+fixture.source.pdfSha256,reviewed:false};
  d.provenance['/cable_types/'+c.id.replaceAll('/','~1')]=src;
  for(const core of c.cores)d.provenance['/cable_types/'+c.id.replaceAll('/','~1')+'/cores/'+core.id.replaceAll('/','~1')+'/conductor']=src;
  for(const l of c.common_layers)d.provenance['/cable_types/'+c.id.replaceAll('/','~1')+'/common_layers/'+l.role]=src;
  for(const m of d.materials)if(m.category!=='soil')for(const k of ['thermal_resistivity','temperature_coefficient_20','relative_permittivity','loss_tangent','electrical_resistivity_20'])if(m[k]!=null)d.provenance['/materials/'+m.id.replaceAll('/','~1')+'/'+k]=src;
  if(JSON.stringify(d)!==JSON.stringify(w.domain))await request(base,'/workspaces/'+w.id+'/domain',{expected_revision:w.revision,document:d},'PUT');
  return request(base, '/workspaces/' + w.id);
}

async function comparisonExamples(base, parameters) {
  const first = await workspace(base);
  const document = structuredClone(first.domain), cable = document.cable_types[0];
  document.name = cable.label = '绝缘厚度方案验证 8.7/15 kV 1×240（合成验收数据）';
  cable.rating.u0 = 8700; cable.rating.u = 15000; cable.rating.um = 17500;
  cable.cores[0].conductor.diameter = .018;
  cable.cores[0].conductor.r20_basis = 'design';
  cable.cores[0].conductor.form = 'stranded_round_compacted';
  cable.cores[0].conductor.lay_factor = 1.02;
  [.0008,.0045,.0008,.0006,.0018].forEach((thickness,index)=>cable.common_layers[index].thickness=thickness);
  const densities = {conductor:8900, semiconductor:1200, insulation:920, metal:2700, polymer:1400};
  for (const material of document.materials) {
    if (densities[material.category]) material.density = densities[material.category];
    if (material.category === 'conductor') material.standard_kind = 'copper_bare';
  }
  document.provenance['/'] = {kind:'user', reference:'方案比较的显式合成验收密度与绞入系数；非厂家数据', reviewed:false};
  await request(base, '/workspaces/' + first.id + '/domain', {expected_revision:first.revision, document}, 'PUT');
  const a = await request(base, '/workspaces/' + first.id);
  const branch = await request(base, '/types/' + a.id + '/plans', {expected_revision:a.revision, request_id:randomUUID(), name:'绝缘厚度方案 B'});
  let b = await request(base, '/workspaces/' + branch.workspace_id);
  const changed = structuredClone(b.domain);
  changed.cable_types[0].common_layers[1].thickness += .0005;
  await request(base, '/workspaces/' + b.id + '/domain', {expected_revision:b.revision, document:changed}, 'PUT');
  b = await request(base, '/workspaces/' + b.id);
  for (const w of [a,b]) {
    await study(base, w, 'cablesim.cable-geometry', 'concentric-model', {cable_type_id:w.domain.cable_types[0].id, length_m:.1});
    await rating(base, w, {...parameters, reference_basis:'iec2023', t4_form:'exact'});
  }
  const j = await manufacturer(base, 'jiangnan-10kv');
  const jBranch = await request(base, '/types/' + j.id + '/plans', {expected_revision:j.revision, request_id:randomUUID(), name:'三芯结构方案 B'});
  let jb = await request(base, '/workspaces/' + jBranch.workspace_id);
  const jChanged = structuredClone(jb.domain);
  for (const core of jChanged.cable_types[0].cores) {
    const radius = core.conductor.diameter/2 + core.layers.reduce((sum, layer) => sum+layer.thickness, 0);
    core.layers.find(layer => layer.role === 'insulation').thickness += .0005;
    core.x *= (radius+.0005)/radius;
    core.z *= (radius+.0005)/radius;
  }
  await request(base, '/workspaces/' + jb.id + '/domain', {expected_revision:jb.revision, document:jChanged}, 'PUT');
  jb = await request(base, '/workspaces/' + jb.id);
  for (const w of [j,jb]) await shortCircuit(base, w);
  function mass(d) {
    const t=d.cable_types[0], materials=new Map(d.materials.map(m=>[m.id,m]));
    const c=t.cores[0].conductor;
    let total=c.nominal_area*c.lay_factor*materials.get(c.material).density*1000, radius=c.diameter/2;
    for(const l of t.common_layers) {
      const outer=radius+l.thickness;
      total+=Math.PI*(outer*outer-radius*radius)*materials.get(l.material).density*1000;
      radius=outer;
    }
    return total;
  }
  return {examples:{single_core:{a:a.id,b:b.id},jiangnan:{a:j.id,b:jb.id}},
    hand_check:{mass_delta_kg_km:58.07548179426081, copper_mass_kg_km:2178.72,
      recomputed_mass_delta_kg_km:mass(b.domain)-mass(a.domain)}};
}

module.exports = {root, request, startServer, workspace, manufacturer, study, shortCircuit, rating, benchmark, comparisonExamples, cleanupPending};
