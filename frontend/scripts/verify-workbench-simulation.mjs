// Use isolated-e2e.mjs with the release database. API calls below only read
// saved evidence; every change goes through a visible mouse/keyboard action.
// The cloud walkthrough stops at input preflight and never submits a solver.
import fs from 'node:fs/promises';
import path from 'node:path';
import { walkthrough } from './verify-workbench-support.mjs';
import { parameterSchema } from '../src/lib/study-parameter-form.ts';
import { displayName, displayText } from '../src/lib/display-names.ts';

await walkthrough('simulation', async ({
  page, expect, base, api, choose, capture, step, check, out, size, tag, report,
}) => {
  const evidence = { source: {}, comparison: {}, parameters: {}, preflight: {}, focus: [], nativeRuns: [] };
  const onRequest = request => {
    if (request.method() === 'POST' && /\/runs$/.test(new URL(request.url()).pathname)) {
      evidence.nativeRuns.push({ url: request.url(), body: request.postDataJSON() });
    }
  };
  page.on('request', onRequest);
  const studyPath = row => `/api/workspaces/${row.workspace}/studies/${row.id}`;
  const hpcStudyPath = row => `/api/hpc/workspaces/${row.workspace}/studies/${row.id}`;
  const configuration = row => row.definition.modules?.['thermal-field'] || row.definition;
  const form = page.getByLabel('有限元方法参数', { exact: true });
  const mesh = form.locator('input[data-field-path="/mesh/size_m"]');
  let createdComparison;
  async function readyPreflight(dialog, response, result, saved) {
    const request = new URL(response.url()), workspace = await api(`/api/workspaces/${saved.workspace}`);
    const method = configuration(saved).method;
    expect(response.ok(), '输入预检必须读取成功').toBe(true);
    expect(response.request().method()).toBe('GET');
    expect(request.pathname).toBe(`${hpcStudyPath(saved)}/input-preflight`);
    expect(request.searchParams.get('expected_revision')).toBe(String(workspace.revision));
    expect(request.searchParams.get('expected_study_revision')).toBe(String(saved.revision));
    expect(request.searchParams.get('module')).toBe(saved.definition.modules?.['thermal-field'] ? 'thermal-field' : null);
    expect(result.local_only).toBe(true);
    expect(result.ready).toBe(false);
    expect(typeof result.input_ready).toBe('boolean');
    if (result.method_scopes?.length) expect(result.method_scopes[0].method).toEqual(method);
    await expect(dialog).toHaveAccessibleDescription(`${method.plugin_id === 'cablesim.simulation' ? '电缆有限元仿真' : displayName(method.plugin_id)} · ${method.version}`);
    // Receiving input-preflight is not the final UI state: the control still
    // refreshes availability before replacing its loading body with these cases.
    await expect(dialog.getByText('正在核对已保存输入', { exact: true })).toBeHidden();
    await expect(dialog.locator('.run-checks')).toBeVisible();
    await expect(dialog.locator('.run-checks > div')).toHaveCount(result.cases.length + (result.crosschecks?.length || 0));
    const summary = dialog.getByRole('region', { name: '预检步骤', exact: true });
    await expect(summary.getByText(`输入完整性与范围：${result.input_ready ? '已通过输入检查' : '请修正下列缺项'}`, { exact: true })).toBeVisible();
    await expect(summary.locator('.solver-location')).toContainText('超算');
    await expect(summary.getByText('未配置', { exact: true })).toBeVisible();
    await expect(summary.getByRole('link', { name: '去设置', exact: true })).toHaveAttribute('href', /^\/settings\/compute(?:\?|$)/);
    await expect(dialog).not.toContainText(/读取配置中|能力声明未读取|配置读取失败/);
    await expect(dialog.getByRole('button', { name: '确认并运行', exact: true })).toBeDisabled();
    return { workspace: saved.workspace, study: saved.id, revision: workspace.revision, studyRevision: saved.revision,
      module: request.searchParams.get('module'), method, inputReady: result.input_ready, visible: await dialog.innerText() };
  }
  async function readyComputeSettings(method) {
    const [profile, cards] = await Promise.all([api('/api/hpc/profile'), api('/api/methods?view=summary')]);
    expect(profile.configured).toBe(false);
    expect(profile.status).toBe('not_configured');
    const card = cards.find(row => ['plugin_id', 'version', 'release_digest'].every(key => row.method[key] === method[key]));
    const capability = card?.capabilities.find(row => row.id === method.capability);
    expect(capability, '设置页须显示保存方法固定发行的能力').toBeTruthy();
    expect(capability.solver).toBe('slurm');
    const settings = page.getByRole('region', { name: '超算连接', exact: true });
    await expect(settings).toHaveAttribute('data-state', 'empty');
    await expect(settings.getByRole('button', { name: '测试连接', exact: true })).toBeDisabled();
    await expect(settings).toContainText('先保存完整连接配置。');
    await expect(page.getByRole('region', { name: '本机能力', exact: true })).toBeVisible();
    const remote = page.getByRole('region', { name: '超算能力', exact: true });
    await expect(remote).toBeVisible();
    const row = remote.getByRole('listitem').filter({ has: page.getByText(capability.title, { exact: true }) })
      .filter({ has: page.getByText(`${card.name} · ${method.version}`, { exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.solver-location')).toContainText('超算');
    await expect(row.getByText('未配置', { exact: true })).toBeVisible();
    await expect(page.getByText('读取配置中', { exact: true })).toHaveCount(0);
    return { method, profile: { configured: profile.configured, status: profile.status }, capability: await row.innerText() };
  }
  async function readyRunDirectory() {
    const listing = await api('/api/index/objects?kind=run&limit=10&offset=0');
    const card = listing.items.find(row => row.parent?.kind === 'study');
    expect(card, '真实发布库首屏须有保存运行，不能只等空作业区').toBeTruthy();
    const region = page.getByRole('region', { name: '运行', exact: true });
    const table = region.getByRole('table', { name: '运行', exact: true });
    await expect(table).toBeVisible();
    await expect(region.getByText('正在读取方法与结论', { exact: true })).toBeHidden({ timeout: 90000 });
    await expect(region.getByRole('button', { name: '重新读取摘要', exact: true })).toHaveCount(0);
    await expect(table.getByRole('link', { name: '保存运行', exact: true })).toHaveCount(0);
    const row = table.getByRole('row').filter({ has: page.locator(`a[href*=${JSON.stringify('run=' + card.id)}]`) });
    await expect(row).toHaveCount(1);
    const target = new URL(await row.locator('a[href*="run="]').first().getAttribute('href'), base);
    expect(target.pathname).toBe('/studies/' + card.parent.id);
    expect(target.searchParams.get('run')).toBe(card.id);
    await expect(row.getByRole('cell').nth(3)).toContainText(' · ');
    await expect(row.getByRole('cell').nth(4)).not.toHaveText('—');
    return { run: card.id, study: card.parent.id, method: await row.getByRole('cell').nth(3).innerText(),
      conclusion: await row.getByRole('cell').nth(4).innerText() };
  }
  // These helpers only select/enter visible controls. The schema supplies units,
  // and saved API reads supply object identities and traceable source values.
  async function editor(scope, pointer) {
    const group=scope.locator(`[data-field-path=${JSON.stringify(pointer)}]`).first();
    await expect(group).toBeAttached();
    const parents=await group.locator('xpath=ancestor::details[not(@open)]').all();
    for(const parent of parents.reverse())await parent.locator(':scope > summary').click();
    return group;
  }
  const schemaAt=(schema,pointer)=>pointer.slice(1).split('/').reduce((field,key)=>{
    const expanded=parameterSchema(field,schema);
    return expanded.properties?.[key] || expanded.prefixItems?.[Number(key)] || expanded.additionalProperties || expanded.items || {};
  },schema);
  async function number(scope,schema,pointer,value) {
    expect(Number.isFinite(value),pointer+' 必须来自明确值').toBe(true);
    const field=parameterSchema(schemaAt(schema,pointer),schema), unit=field['x-unit'] || parameterSchema(schemaAt(schema,pointer.slice(0,pointer.lastIndexOf('/'))),schema)['x-unit'] || {};
    const group=await editor(scope,pointer),input=group.locator('input').first();
    await input.fill(String(value*(unit.scale ?? 1)+(unit.offset ?? 0)));await input.press('Tab');
  }
  async function select(scope,pointer,value,schema) {
    const group=await editor(scope,pointer);await group.getByRole('combobox').click();
    const field=parameterSchema(schemaAt(schema,pointer),schema), choices=page.getByRole('option');
    const index=Array.isArray(field.enum) && value!==undefined ? field.enum.indexOf(value) : 0;
    expect(index).toBeGreaterThanOrEqual(0);await choices.nth(index).click();
  }
  async function source(scope,pointer,value) {
    const group=await editor(scope,pointer),detail=group.locator('details').first();
    if(await detail.count() && await detail.getAttribute('open')===null)await detail.locator(':scope > summary').click();
    await group.locator('textarea,input').first().fill(value);
  }
  async function inheritedChoice(scope, schema, pointer, value) {
    const field=parameterSchema(schemaAt(schema,pointer),schema);
    expect(field.enum, pointer+' 必须由真实契约接受保存值').toContain(value);
    const label=field['x-enum-labels']?.[value] || displayName(value);
    await expect((await editor(scope,pointer)).getByRole('combobox')).toContainText(displayText(label));
  }
  async function showCreateAction(dialog) {
    const action=dialog.getByRole('button',{name:'建立研究',exact:true});
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeInViewport({ratio:1});
  }
  async function expectInvalidFocus(control, pointer) {
    try {
      await expect(control).toBeEnabled();
      await expect(control).toHaveAttribute('aria-invalid','true');
      await expect(control).toBeFocused();
    } finally {
      // Inspect only: never repair focus from the test or hide its original failure.
      const state=await control.evaluate(target=>{
        const describe=node=>node instanceof Element ? {
          tag:node.tagName,id:node.id,role:node.getAttribute('role'),
          path:node.closest('[data-field-path]')?.getAttribute('data-field-path'),
          invalid:node.getAttribute('aria-invalid'),disabled:node.matches(':disabled'),
        } : null;
        return {target:describe(target),active:describe(document.activeElement),focused:target===document.activeElement};
      }).catch(error=>({inspectionError:error.message}));
      evidence.focus.push({pointer,...state});
    }
  }
  async function inspectMethodVersion(method,scope=form,expectedHeight=36,prefix='03') {
    const control=scope.getByRole('combobox',{name:'方法版本',exact:true});
    const fullName=scope.locator('.study-method-current-name');
    await expect(fullName).toBeVisible();
    await fullName.scrollIntoViewIfNeeded();
    await control.scrollIntoViewIfNeeded();
    const cards=await api('/api/methods?view=summary');
    const card=cards.find(row=>row.method.plugin_id===method.plugin_id
      && row.method.version===method.version && row.method.release_digest===method.release_digest
      && row.capabilities.some(capability=>capability.id===method.capability));
    expect(card,'方法名称须来自保存 pin 对应的真实方法清单').toBeTruthy();
    const capability=card.capabilities.find(row=>row.id===method.capability);
    const selectedText=(await control.locator(':scope > span').first().innerText()).trim();
    const completeName=displayText(`${card.name} · ${capability.title} · ${method.version}`);
    expect(selectedText).toBe(method.version);
    await expect(fullName).toHaveText(completeName);
    await expect(fullName).toBeInViewport({ratio:1});
    await expect(control).toHaveAccessibleDescription(completeName);
    const layout=await control.evaluate(button=>{
      const rect=element=>{
        const box=element.getBoundingClientRect();
        return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height};
      };
      const value=button.querySelector(':scope > span:first-child'),arrow=button.querySelector('[data-select-arrow]');
      const textRects=element=>{
        const text=[],nodes=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
        for(let node=nodes.nextNode();node;node=nodes.nextNode()){
          if(!node.textContent.trim())continue;
          const range=document.createRange();range.selectNodeContents(node);
          text.push(...[...range.getClientRects()].map(box=>({left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height})));
        }
        return text;
      };
      const name=document.getElementById(button.getAttribute('aria-describedby'));
      const style=getComputedStyle(button),box=rect(button);
      const label=button.labels[0],field=button.closest('.select-field');
      const ancestors=[];
      for(let node=field;node;node=node.parentElement){
        if(node.clientWidth && /auto|scroll/.test(getComputedStyle(node).overflowX))
          ancestors.push({selector:node.className || node.tagName,width:node.clientWidth,scrollWidth:node.scrollWidth});
      }
      return {button:box,field:rect(field),label:rect(label),arrow:rect(arrow),
        minimumHeight:parseFloat(style.minHeight),fontSize:parseFloat(getComputedStyle(value).fontSize),text:textRects(value),
        name:{...rect(name),fontSize:parseFloat(getComputedStyle(name).fontSize),text:textRects(name)},
        inner:{left:box.left+parseFloat(style.borderLeftWidth),right:box.right-parseFloat(style.borderRightWidth),
          top:box.top+parseFloat(style.borderTopWidth),bottom:box.bottom-parseFloat(style.borderBottomWidth)},
        ancestors,viewport:innerWidth};
    });
    const measuredVersion={method,selectedText,completeName,expectedHeight,layout};
    evidence.parameters[expectedHeight===32?'inspectorMethodVersion':'methodVersion']=measuredVersion;
    await check(`方法版本控件保持 ${expectedHeight}px，关联完整名称可读且无越界横滚`,
      Math.abs(layout.minimumHeight-expectedHeight)<1 && Math.abs(layout.button.height-expectedHeight)<1
      && layout.fontSize>=13 && layout.label.bottom<=layout.button.top
      && Math.abs(layout.button.width-layout.field.width)<1
      && layout.button.left>=0 && layout.button.right<=layout.viewport
      && layout.arrow.left>=layout.button.left && layout.arrow.right<=layout.button.right
      && layout.arrow.top>=layout.button.top && layout.arrow.bottom<=layout.button.bottom
      && layout.text.length>0 && layout.text.every(box=>box.width>0 && box.height>0
        && box.left>=layout.inner.left && box.right<=Math.min(layout.arrow.left,layout.inner.right)
        && box.top>=layout.inner.top && box.bottom<=layout.inner.bottom)
      && layout.name.fontSize>=13 && layout.name.top>=layout.button.bottom
      && layout.name.left>=layout.field.left && layout.name.right<=Math.min(layout.field.right,layout.viewport)
      && layout.name.text.length>0 && layout.name.text.every(box=>box.width>0 && box.height>0
        && box.left>=layout.name.left && box.right<=layout.name.right
        && box.top>=layout.name.top && box.bottom<=layout.name.bottom)
      && layout.ancestors.every(node=>node.scrollWidth<=node.width+1),
      measuredVersion);
    await capture(`${prefix}-method-version-complete`);
    await control.focus();await page.keyboard.press('Enter');
    const listbox=page.getByRole('listbox');await expect(listbox).toBeVisible();
    const options=listbox.getByRole('option');
    expect(await options.count(),'已保存方法必须有可核对的真实版本选项').toBeGreaterThan(0);
    const labels=[];
    for(const option of await options.all()){
      await option.scrollIntoViewIfNeeded();
      const measured=await option.evaluate(node=>{
        const value=node.querySelector(':scope > span:first-child'),range=document.createRange();
        range.selectNodeContents(value);
        const box=node.getBoundingClientRect(),list=node.closest('[role="listbox"]');
        return {text:value.textContent.trim(),left:box.left,right:box.right,top:box.top,bottom:box.bottom,
          textRects:[...range.getClientRects()].map(rect=>({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom})),
          width:list.clientWidth,scrollWidth:list.scrollWidth,viewport:innerWidth};
      });
      labels.push(measured.text);
      await check('方法版本选项完整可读且不产生横向滚动',measured.left>=0 && measured.right<=measured.viewport
        && measured.scrollWidth<=measured.width+1 && measured.textRects.every(rect=>rect.left>=measured.left
          && rect.right<=measured.right && rect.top>=measured.top && rect.bottom<=measured.bottom),measured);
    }
    expect(labels).toContain(completeName);
    measuredVersion.options=labels;
    await capture(`${prefix}-method-version-options`);
    await page.keyboard.press('Escape');await expect(control).toBeFocused();
    await expect(control.locator(':scope > span').first()).toHaveText(selectedText);
  }

  let primaryFailure;
  try {
    const projects = await api('/api/workspaces');
    const studies = (await Promise.all(projects.map(project =>
      api(`/api/workspaces/${project.id}/studies`),
    ))).flat();
    const thermalStudies = studies.filter(row =>
      row.definition.method.capability === 'iec-thermal-field',
    );
    const thermal = thermalStudies.find(row => /排管/.test(row.definition.title)) || thermalStudies[0];
    const iecStudies = studies.filter(row => row.definition.method.plugin_id === 'cablesim.iec60287');
    const iec = iecStudies.find(row => row.workspace === thermal?.workspace && row.definition.driver?.kind === 'single')
      || iecStudies.find(row => row.definition.driver?.kind === 'single') || iecStudies[0];
    expect(iec, '发布库须提供已保存的 IEC 研究，不能伪造基线').toBeTruthy();
    expect(thermal, '发布库须提供真实有限元输入，以检查被新建卡点阻断的后续页面').toBeTruthy();
    const referenceThermal=thermalStudies.find(row=>row.workspace===iec.workspace);
    expect(referenceThermal,'对照边界必须来自同一工程的真实保存研究').toBeTruthy();
    const referenceParameters=configuration(referenceThermal).parameters;
    const bounds=referenceParameters.domain_options?.bounds_m;
    expect(bounds,'有限域来自真实保存有限元研究的 domain_options，不生成占位边界').toHaveLength(4);
    evidence.source = {
      iec: { workspace: iec.workspace, study: iec.id, title: iec.definition.title },
      thermal: { workspace: thermal.workspace, study: thermal.id, title: thermal.definition.title },
      comparisonReference: { workspace:referenceThermal.workspace, study:referenceThermal.id, revision:referenceThermal.revision,
        path:'/parameters/domain_options/bounds_m', bounds },
      downstreamScope: '新建对照若受阻，后续参数与预检独立使用发布库既有有限元输入；不算新建链路通过。',
    };

    if (report.phase === 'after') await step('00-project-solver-locations', async () => {
      const writesBefore = report.writes.length;
      const cards = await api('/api/methods?view=summary');
      const declared = study => {
        const pin = study.definition.method;
        return cards.find(card => ['plugin_id', 'version', 'release_digest'].every(key => card.method[key] === pin[key]))
          ?.capabilities.find(capability => capability.id === pin.capability);
      };
      const femCapability = declared(referenceThermal), iecCapability = declared(iec);
      expect(femCapability, '工程概览必须使用同一固定发行的有限元能力').toBeTruthy();
      expect(iecCapability, '工程概览必须使用同一固定发行的 IEC 能力').toBeTruthy();
      expect(femCapability.solver).toBe('slurm');
      expect(iecCapability.solver || 'local').toBe('local');
      await page.goto(`${base}/studies?workspace=${iec.workspace}&theme=light`);
      const table = page.getByRole('table', { name: '本工程研究', exact: true });
      const rowFor = study => table.getByRole('row').filter({ has: page.locator(`a[href^=${JSON.stringify('/studies/' + study.id + '/')}]`) });
      const femRow = rowFor(referenceThermal), iecRow = rowFor(iec);
      await expect(femRow).toHaveCount(1); await expect(iecRow).toHaveCount(1);
      const femLocation = femRow.locator('.solver-location'), iecLocation = iecRow.locator('.solver-location');
      await expect(femLocation).toContainText('超算');
      await expect(femLocation).not.toContainText('本机');
      await expect(iecLocation).toContainText('本机');
      const shown = { fem: await femLocation.innerText(), iec: await iecLocation.innerText() };
      await femLocation.scrollIntoViewIfNeeded(); await expect(femLocation).toBeInViewport({ ratio: 1 });
      await capture('00-project-fem-location');
      await iecLocation.scrollIntoViewIfNeeded(); await expect(iecLocation).toBeInViewport({ ratio: 1 });
      await capture('00-project-iec-location');
      check('工程概览按固定能力显示有限元超算、IEC本机，不用进程隔离策略替代求解位置',
        /超算/.test(shown.fem) && !/本机/.test(shown.fem) && /本机/.test(shown.iec),
        { shown, fem: { method: referenceThermal.definition.method, capability: femCapability }, iec: { method: iec.definition.method, capability: iecCapability } });
      const setup = femLocation.getByRole('link', { name: '去设置', exact: true });
      await expect(setup).toBeVisible(); await setup.focus(); await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/settings\/compute/);
      await expect(page.getByRole('region', { name: '超算连接', exact: true })).toBeVisible();
      evidence.projectSettings = await readyComputeSettings(configuration(referenceThermal).method);
      check('工程概览的超算设置入口可用键盘打开，且不提交配置或运行', report.writes.length === writesBefore,
        { writesBefore, writesAfter: report.writes.length, url: page.url() });
      evidence.projectSolverLocations = shown;
    });

    if (report.phase === 'after') await step('00a-empty-hpc-jobs-open-real-simulation', async () => {
      const endpoint = studyPath(thermal), workspaceEndpoint = `/api/workspaces/${thermal.workspace}`;
      const [beforeJobs, beforeStudy, beforeWorkspace] = await Promise.all([
        api('/api/hpc/jobs?offset=0&limit=20'), api(endpoint), api(workspaceEndpoint),
      ]);
      expect(beforeJobs.items, '只使用真实无超算作业的发布库，不删除作业制造空态').toEqual([]);
      const writesBefore = report.writes.length;
      await page.goto(base + '/runs?theme=light');
      const jobs = page.getByRole('region', { name: '超算作业', exact: true });
      await expect(jobs.getByRole('heading', { name: '尚无超算作业', exact: true })).toBeVisible();
      evidence.runDirectory = await readyRunDirectory();
      const start = jobs.getByRole('link', { name: '选择仿真研究', exact: true });
      await start.scrollIntoViewIfNeeded();
      await expect(start).toBeInViewport({ ratio: 1 });
      await expect(page.locator('.button-primary:visible,.button-run:visible')).toHaveCount(1);
      await capture('00a-empty-hpc-jobs-action');
      if (size.width === 1366) { await start.focus(); await start.press('Enter'); }
      else await start.click();
      await page.waitForURL(url => url.pathname === '/studies' && url.searchParams.get('kind') === 'simulation'
        && url.searchParams.get('theme') === 'light');
      await expect(page.getByRole('heading', { name: '电缆仿真研究', exact: true })).toBeVisible();
      const table = page.getByRole('table', { name: '研究列表', exact: true });
      await expect(table).toBeVisible();
      const study = table.locator('a.object-link[href^="/studies/' + thermal.id + '/"]');
      await expect(study).toHaveCount(1);
      const target = new URL(await study.getAttribute('href'), base);
      expect(target.pathname).toMatch(new RegExp('^/studies/' + thermal.id + '/'));
      expect(target.searchParams.get('workspace')).toBe(thermal.workspace);
      await study.scrollIntoViewIfNeeded();
      await capture('00a-hpc-empty-start-lists-real-simulations');
      if (size.width === 1920) { await study.focus(); await study.press('Enter'); }
      else await study.click();
      await page.waitForURL(url => url.pathname === target.pathname && url.searchParams.get('workspace') === thermal.workspace);
      await expect(page.locator('.study-workbench')).toBeVisible();
      await expect(page.getByRole('navigation', { name: '工程浏览器', exact: true })).toBeVisible();
      await capture('00a-hpc-empty-start-opens-saved-simulation');
      const [afterJobs, afterStudy, afterWorkspace] = await Promise.all([
        api('/api/hpc/jobs?offset=0&limit=20'), api(endpoint), api(workspaceEndpoint),
      ]);
      check('超算作业空态可键鼠进入真实仿真研究，未提交作业或修改保存输入', report.writes.length === writesBefore
        && afterJobs.items.length === 0 && afterJobs.total === beforeJobs.total
        && afterStudy.id === beforeStudy.id && afterStudy.revision === beforeStudy.revision
        && JSON.stringify(afterStudy.definition) === JSON.stringify(beforeStudy.definition)
        && afterWorkspace.revision === beforeWorkspace.revision
        && JSON.stringify(afterWorkspace.domain) === JSON.stringify(beforeWorkspace.domain),
      { study: thermal.id, workspace: thermal.workspace, url: page.url(), writes: report.writes.slice(writesBefore) });
      evidence.hpcEmptyStart = { study: thermal.id, workspace: thermal.workspace, url: page.url(), jobs: afterJobs.items.length };
    });

    if (report.phase === 'after') await step('00b-unconfigured-native-empty-starts', async () => {
      const endpoint = studyPath(iec), workspaceEndpoint = `/api/workspaces/${iec.workspace}`;
      const [beforeStudy, beforeWorkspace, beforeRuns] = await Promise.all([
        api(endpoint), api(workspaceEndpoint), api(endpoint + '/runs?view=summary&limit=100'),
      ]);
      expect(beforeStudy.definition.method.plugin_id).toBe('cablesim.iec60287');
      expect(beforeStudy.definition.driver.kind).toBe('single');
      const runPins = rows => rows.map(row => ({ id: row.id, sequence: row.sequence, status: row.status,
        inputDigest: row.input_digest, outputDigest: row.output_digest, module: row.snapshot?.module || '' }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const writesBefore = report.writes.length;
      evidence.nativeEmptyStarts = [];
      for (const [module, tab, keyboard] of [['transient', 'history', true], ['sheath-losses', 'results', false], ['sheath-losses', 'losses', true]]) {
        expect(beforeStudy.definition.modules?.[module], '仅走查实际尚未配置的模块，不删除已有配置').toBeFalsy();
        expect(beforeRuns.items.some(run => run.snapshot?.module === module), '空态不能借已有模块运行代替').toBe(false);
        await page.goto(`${base}/studies/${iec.id}/${module}/${tab}?workspace=${iec.workspace}&theme=light&inspector=input`);
        const setup = page.getByRole('region', { name: '模块配置', exact: true });
        await expect(setup).toContainText('尚未配置该模块');
        const start = setup.getByRole('link', { name: '配置方法与参数', exact: true });
        await expect(start).toBeVisible();
        await capture(`00b-${module}-${tab}-empty-start`);
        if (keyboard) { await start.focus(); await start.press('Enter'); }
        else await start.click();
        await page.waitForURL(next => next.pathname === `/studies/${iec.id}/${module}/results`
          && next.searchParams.get('workspace') === iec.workspace && next.searchParams.get('theme') === 'light'
          && next.searchParams.get('inspector') === 'method' && !next.searchParams.get('run') && !next.searchParams.get('delivery'));
        await expect(form.getByRole('combobox', { name: '模块方法', exact: true })).toBeVisible();
        await expect(form.getByRole('button', { name: '为该模块建立方法配置', exact: true })).toBeEnabled();
        await expect(page.getByRole('toolbar', { name: '工程命令', exact: true }).getByRole('button', { name: '已保存', exact: true })).toBeVisible();
        await capture(`00b-${module}-${tab}-real-method-form-without-creating`);
        await page.goBack();
        await page.waitForURL(next => next.pathname === `/studies/${iec.id}/${module}/${tab}`
          && next.searchParams.get('workspace') === iec.workspace && next.searchParams.get('inspector') === 'input');
        await expect(setup).toContainText('尚未配置该模块');
        const [afterStudy, afterWorkspace, afterRuns] = await Promise.all([
          api(endpoint), api(workspaceEndpoint), api(endpoint + '/runs?view=summary&limit=100'),
        ]);
        const unchanged = afterStudy.revision === beforeStudy.revision && afterWorkspace.revision === beforeWorkspace.revision
          && JSON.stringify(afterStudy.definition) === JSON.stringify(beforeStudy.definition)
          && JSON.stringify(afterWorkspace.domain) === JSON.stringify(beforeWorkspace.domain)
          && JSON.stringify(runPins(afterRuns.items)) === JSON.stringify(runPins(beforeRuns.items))
          && report.writes.length === writesBefore;
        check(`${module === 'transient' ? '暂态时间序列' : tab === 'losses' ? '护套损耗系数' : '护套损耗结果'}空态可${keyboard ? '用Enter' : '用鼠标'}打开真实方法配置且不建立配置或运行`, unchanged,
          { workspace: iec.workspace, study: iec.id, module, tab, studyRevision: afterStudy.revision,
            workspaceRevision: afterWorkspace.revision, writes: report.writes.slice(writesBefore) });
        evidence.nativeEmptyStarts.push({ module, tab, keyboard, unchanged, study: iec.id, workspace: iec.workspace });
        await capture(`00b-${module}-${tab}-returned-unchanged`);
      }
    });

    if (report.phase === 'after') await step('00c-batch-empty-starts-and-complete-controls', async () => {
      const endpoint = studyPath(iec), workspaceEndpoint = `/api/workspaces/${iec.workspace}`;
      const [beforeStudy, beforeWorkspace, beforeDatasets, beforeConfiguration] = await Promise.all([
        api(endpoint), api(workspaceEndpoint), api(endpoint + '/datasets'), api(endpoint + '/batch-configuration'),
      ]);
      expect(beforeDatasets, '只使用真实没有批量数据集的研究，不删除数据制造空态').toEqual([]);
      expect(beforeConfiguration.workspace_revision).toBe(beforeWorkspace.revision);
      expect(beforeConfiguration.study_revision).toBe(beforeStudy.revision);
      const writesBefore = report.writes.length;
      evidence.batchEmptyStarts = [];
      for (const [tab, keyboard] of [['results', false], ['execution', true]]) {
        await page.goto(`${base}/studies/${iec.id}/batch/${tab}?workspace=${iec.workspace}&theme=light`);
        const batch = page.locator('.study-batch');
        await expect(batch).toHaveAttribute('data-module-state', 'empty');
        await expect(batch.getByRole('heading', { name: '尚无批量数据集', exact: true })).toBeVisible();
        const start = batch.getByRole('link', { name: '设置批量参数', exact: true });
        await expect(page.locator('.button-primary:visible,.button-run:visible')).toHaveCount(1);
        await capture('00c-batch-' + tab + '-empty-start');
        if (keyboard) { await start.focus(); await start.press('Enter'); }
        else await start.click();
        await page.waitForURL(next => next.pathname === `/studies/${iec.id}/batch/space`
          && next.searchParams.get('workspace') === iec.workspace && next.searchParams.get('theme') === 'light'
          && !next.searchParams.get('run') && !next.searchParams.get('dataset'));
        await expect(batch).toHaveAttribute('data-module-state', /^(?:empty|success)$/);
        await expect(batch.getByRole('heading', { name: '参数空间', exact: true })).toBeVisible();
        evidence.batchEmptyStarts.push({ tab, keyboard, study: iec.id, workspace: iec.workspace });
        await capture('00c-batch-' + tab + '-same-study-parameter-space');
      }
      const batch = page.locator('.study-batch'), dock = page.locator('.workbench-dock-body');
      const selectedModule = beforeConfiguration.configuration?.definition?.source_module || '';
      const sourceModule = beforeConfiguration.source_modules.find(item => (item.id || '') === selectedModule);
      expect(sourceModule, '基准模块名称必须来自本研究真实批量配置接口').toBeTruthy();
      const sourceControl = batch.getByRole('combobox', { name: '基准模块', exact: true });
      const sourceLabel = displayText(sourceModule.title);
      await expect(sourceControl.locator(':scope > span').first()).toHaveText(sourceLabel);
      async function inspectControl(control, label, expectedHeight) {
        await control.scrollIntoViewIfNeeded();
        const layout = await control.evaluate(node => {
          const boxOf = element => { const b = element.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
          const host = node.closest('.number-input') || node, box = boxOf(host), inputBox = boxOf(node);
          const dock = node.closest('.workbench-dock-body'), boundary = boxOf(dock), style = getComputedStyle(node);
          const text = node instanceof HTMLInputElement ? node.value : node.querySelector(':scope > span:first-child')?.textContent || '';
          let complete;
          if (node instanceof HTMLInputElement) {
            const context = document.createElement('canvas').getContext('2d'); context.font = style.font;
            const width = context.measureText(text).width;
            complete = node.scrollWidth <= node.clientWidth + 1 && node.scrollLeft === 0
              && width <= node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) + 1;
          } else {
            const value = node.querySelector(':scope > span:first-child'), range = document.createRange();
            range.selectNodeContents(value);
            const valueBox = boxOf(value), arrow = node.querySelector('[data-select-arrow]');
            const rects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
            complete = rects.length > 0 && rects.every(rect => rect.left >= valueBox.left - 1
              && rect.right <= valueBox.right + 1 && rect.top >= valueBox.top - 1 && rect.bottom <= valueBox.bottom + 1
              && (!arrow || rect.right <= arrow.getBoundingClientRect().left + 1));
          }
          return { label: node.getAttribute('aria-label'), text, box, inputBox, boundary, font: parseFloat(style.fontSize), complete,
            contained: box.left >= boundary.left - 1 && box.right <= boundary.right + 1 && box.left >= 0 && box.right <= innerWidth
              && box.top >= 0 && box.bottom <= innerHeight && inputBox.left >= box.left - 1 && inputBox.right <= box.right + 1 };
        });
        check(`批量${label}完整可见且控件高${expectedHeight}px`, layout.complete && layout.contained
          && layout.font >= 13 && Math.abs(layout.box.height - expectedHeight) <= 1, { label, ...layout });
        return { label, ...layout };
      }
      const measured = [];
      for (const label of ['基准模块', '采样方式', '计算资源']) measured.push(await inspectControl(batch.getByRole('combobox', { name: label, exact: true }), label, 36));
      measured.push(await inspectControl(batch.getByRole('combobox', { name: '基准参数', exact: true }), '基准参数', 32));
      const numbers = batch.locator('.number-field');
      expect(await numbers.count()).toBeGreaterThanOrEqual(7);
      for (const field of await numbers.all()) measured.push(await inspectControl(field.locator('input'), await field.locator(':scope > label').innerText(), 36));
      const firstGrid = batch.locator(':scope > .input-form-grid').first();
      await firstGrid.scrollIntoViewIfNeeded(); await expect(firstGrid).toBeInViewport({ ratio: 1 });
      await capture('00c-batch-space-complete-base-and-sampling');
      await sourceControl.focus(); await sourceControl.press('Enter');
      const listbox = page.getByRole('listbox');
      const selected = listbox.locator('[role="option"][data-state="checked"]');
      await expect(selected).toHaveAccessibleName(sourceLabel);
      await capture('00c-batch-real-source-options-keyboard');
      await page.keyboard.press('Escape'); await expect(listbox).toBeHidden(); await expect(sourceControl).toBeFocused();
      await expect(sourceControl.locator(':scope > span').first()).toHaveText(sourceLabel);
      const execution = batch.locator('section.input-section').filter({ has: page.getByRole('heading', { name: '超算执行', exact: true }) });
      await execution.scrollIntoViewIfNeeded();
      await execution.getByRole('heading', { name: '超算执行', exact: true }).hover();
      await page.mouse.wheel(0, 120);
      await expect(execution).toBeInViewport({ ratio: 1 });
      await capture('00c-batch-space-complete-execution-values');
      const horizontal = await dock.evaluate(node => ({ dock: { width: node.clientWidth, scroll: node.scrollWidth },
        root: { width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth } }));
      check('批量参数空间不依赖横向滚动才能阅读控件', horizontal.dock.scroll <= horizontal.dock.width + 1
        && horizontal.root.scroll <= horizontal.root.width + 1, horizontal);
      const [afterStudy, afterWorkspace, afterDatasets, afterConfiguration] = await Promise.all([
        api(endpoint), api(workspaceEndpoint), api(endpoint + '/datasets'), api(endpoint + '/batch-configuration'),
      ]);
      check('批量空态键鼠往返和布局检查未保存配置或提交任务', report.writes.length === writesBefore
        && afterStudy.revision === beforeStudy.revision && afterWorkspace.revision === beforeWorkspace.revision
        && JSON.stringify(afterStudy.definition) === JSON.stringify(beforeStudy.definition)
        && JSON.stringify(afterWorkspace.domain) === JSON.stringify(beforeWorkspace.domain) && afterDatasets.length === 0
        && JSON.stringify(afterConfiguration.configuration) === JSON.stringify(beforeConfiguration.configuration)
        && afterConfiguration.lock_digest === beforeConfiguration.lock_digest,
      { study: iec.id, workspace: iec.workspace, method: afterConfiguration.method, lockDigest: afterConfiguration.lock_digest,
        writes: report.writes.slice(writesBefore), controls: measured, horizontal });
    });

    await step('01-saved-iec-study', async () => {
      await page.goto(`${base}/studies/${iec.id}/ampacity/results?workspace=${iec.workspace}&theme=light`);
      await expect(page.getByRole('navigation', { name: '工程浏览器', exact: true })).toBeVisible();
      await expect(page.locator('[data-drawing-canvas="laying"]')).toBeVisible();
      await expect(page.getByText('正在读取保存工况的模型输入',{exact:true})).toHaveCount(0);
      await check('能从已保存的 IEC 研究开始有限元对照', true, evidence.source.iec);
      if(report.phase==='after'){
        const tabs=page.getByRole('tablist',{name:'属性分页',exact:true});
        await tabs.getByRole('tab',{name:'方法',exact:true}).click();
        await inspectMethodVersion(iec.definition.method,page.getByRole('complementary',{name:'属性',exact:true}),32,'01-iec');
        await tabs.getByRole('tab',{name:'输入',exact:true}).click();
      }
    });

    await step('02-new-fem-comparison', async () => {
      await page.getByRole('navigation', { name: '工程浏览器', exact: true })
        .getByRole('button', { name: '新建研究', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '新建研究', exact: true });
      await dialog.getByRole('textbox', { name: '研究名称', exact: true })
        .fill(`IEC 有限元对照 · ${tag}`);
      await dialog.getByRole('button', { name: 'IEC 与有限元对比', exact: true }).click();
      const methods = await api('/api/methods');
      const comparisonMethod = methods.find(row => row.method.plugin_id === 'cablesim.simulation');
      const capability = comparisonMethod?.capabilities.find(row => row.id === 'iec-fem-comparison');
      expect(capability, '必须用真实能力声明核对计算位置').toBeTruthy();
      if(report.phase==='after'){
        await expect(dialog.locator('[data-contract-form="create-study"]')).toBeVisible();
        if(capability.solver==='slurm')await expect(dialog.locator('.add-study-method')).toContainText('超算');
      }
      const methodLabel = await dialog.locator('.add-study-method').innerText();
      evidence.comparison.solver = { declared: capability.solver, displayed: methodLabel };
      await check('有限元对照创建入口显示真实计算位置', capability.solver !== 'slurm' || /超算/.test(methodLabel),
        evidence.comparison.solver);
      const editors = await dialog.locator('[data-field-path] input, input[data-field-path], [data-field-path] [role="combobox"], textarea').count();
      evidence.comparison.editorCount = editors;
      await capture('02-comparison-parameters-before-submit');
      await showCreateAction(dialog);
      await capture('02-comparison-create-action');
      await check('新建有限元对照能填写必要参数', editors > 0, {
        step: '当前工程 → 新建研究 → IEC 与有限元对比',
        editorCount: editors,
        observed: await dialog.innerText(),
      });
      if(editors>0){
        const pin={...comparisonMethod.method,capability:'iec-fem-comparison'};
        const contracts=await api('/api/input-contracts?'+new URLSearchParams(pin));
        const schema=contracts.find(row=>row.method.release_digest===pin.release_digest && row.method.capability===pin.capability).parameter_schema;
        await choose('方法参数来源',`沿用已保存 IEC 参数 · ${iec.definition.title}`,dialog);
        for(const key of ['t4_form','eddy','rating_mode']){
          const value=iec.definition.parameters[key];
          if(value!==undefined && value!==null)await inheritedChoice(dialog,schema,'/iec/'+key,value);
        }
        await check('切换参数来源保留已保存 IEC 的真实选项',true,{t4_form:iec.definition.parameters.t4_form,eddy:iec.definition.parameters.eddy,rating_mode:iec.definition.parameters.rating_mode});
        // A temperature difference must not acquire an absolute-temperature
        // offset. Inspect the actual control before editing; do not compensate
        // for incorrect plugin metadata in the host or in the test's input.
        const differencePath='/temperature_tolerance_k';
        const differenceField=parameterSchema(schemaAt(schema,differencePath),schema);
        const differenceEditor=await editor(dialog,differencePath);
        await differenceEditor.scrollIntoViewIfNeeded();
        await expect(differenceEditor).toBeInViewport({ratio:1});
        const differenceInput=differenceEditor.locator('input').first();
        const differenceUnit=await differenceEditor.locator('[data-slot="input-group-addon"][data-align="inline-end"]').innerText();
        const differenceValue=await differenceInput.inputValue();
        const declaredDifferenceUnit=differenceField['x-unit'];
        evidence.comparison.temperatureDifference={pin,path:differencePath,declared:declaredDifferenceUnit,
          defaultSi:differenceField.default,displayedValue:differenceValue,displayedUnit:differenceUnit,
          visibleText:await differenceEditor.innerText()};
        await capture('02-comparison-temperature-difference-unit');
        check('温度更新容差按温差显示原默认值，不加绝对温度偏移',
          declaredDifferenceUnit?.si==='K' && declaredDifferenceUnit.scale===1 && declaredDifferenceUnit.offset===0
          && ['K','°C'].includes(differenceUnit.trim()) && differenceValue.trim()!==''
          && Number(differenceValue)===differenceField.default,
          evidence.comparison.temperatureDifference,{fatal:false});
        // An empty required field must be caught locally and receive focus.
        await dialog.getByRole('button',{name:'建立研究',exact:true}).click();
        await expect(dialog.locator('[role="alert"]:visible').first()).toBeVisible();
        await expectInvalidFocus((await editor(dialog,'/section_id')).getByRole('combobox'),'/section_id');
        const incomplete=await dialog.locator('[aria-invalid=true]').count();
        await check('创建缺项以真实字段标记并可修复',incomplete>0,{invalidFields:incomplete});
        await capture('02-comparison-missing-required-fields');
        await select(dialog,'/section_id',undefined,schema);
        await select(dialog,'/load_id',undefined,schema);
        await select(dialog,'/controls/operation','temperature',schema);
        // Mesh sizes come from the saved study. The node budget is an explicit
        // numerical control for this comparison, whose contract has a lower cap.
        const controls={mesh_size_m:referenceParameters.mesh.size_m,far_mesh_size_m:referenceParameters.mesh.far_size_m,mesh_transition_m:referenceParameters.mesh.transition_m,max_nodes:100000,
          tolerance_k:0.001,max_iterations:50,relaxation:0.7,current_upper_a:1000,current_tolerance_a:0.5};
        for(const [key,value] of Object.entries(controls))await number(dialog,schema,'/controls/'+key,value);
        await select(dialog,'/controls/rated_circuit',undefined,schema);
        for(const [index,value] of bounds.entries())await number(dialog,schema,'/bounds_m/'+index,value);
        await source(dialog,'/source',`界面输入走查：边界与网格尺寸明确沿用同工程保存研究「${referenceThermal.definition.title}」修订 ${referenceThermal.revision}；IEC 输入沿用「${iec.definition.title}」修订 ${iec.revision}。最大节点数 100000、迭代与电流搜索控制由本次走查明确填写；未提交求解，不形成工程结论。`);
        const ackTitle=parameterSchema(schema.properties.frozen_coefficients_acknowledged,schema).title;
        const toggle=dialog.getByRole('switch',{name:new RegExp(ackTitle)});
        const parents=await toggle.locator('xpath=ancestor::details[not(@open)]').all();
        for(const parent of parents.reverse())await parent.locator(':scope > summary').click();
        if(await toggle.getAttribute('aria-checked')!=='true')await toggle.click();
        await showCreateAction(dialog);
        await capture('02-comparison-filled-sourced-inputs');
      }
      const pending = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/workspaces/${iec.workspace}/studies`);
      await dialog.getByRole('button', { name: '建立研究', exact: true }).click();
      const response = await pending;
      evidence.comparison.status = response.status();
      evidence.comparison.response = await response.json();
      if (response.ok()) {
        await expect(dialog).not.toBeVisible();
        evidence.comparison.destination = page.url();
        createdComparison=evidence.comparison.response;
        const params=createdComparison.definition.parameters;
        check('创建保留降序网格尺度与真实来源',JSON.stringify(params.mesh_scales)==='[1.5,1,0.75]' && !!params.source && params.iec.ks===iec.definition.parameters.ks,{meshScales:params.mesh_scales,source:params.source,iecKs:params.iec.ks});
        const saved=await api(studyPath({workspace:iec.workspace,id:createdComparison.id}));
        for(const key of ['t4_form','eddy','rating_mode','ks','kp','corrugated_gap'])if(key in iec.definition.parameters){
          expect(saved.definition.parameters.iec[key],`保存后 IEC ${key} 须保留来源原值`).toEqual(iec.definition.parameters[key]);
        }
        expect(saved.definition.parameters.bounds_m,'保存负坐标与边界顺序').toEqual(bounds);
        expect(saved.definition.parameters.section_id,'截面引用属于原边界的保存工程').toBe(referenceParameters.domain_options.section_id);
        expect(saved.definition.parameters.load_id,'负荷引用属于原边界的保存工程').toBe(referenceParameters.domain_options.load_id);
        if(evidence.comparison.temperatureDifference)expect(saved.definition.parameters.temperature_tolerance_k,'只观察温差控件，不改写插件默认SI容差')
          .toBe(evidence.comparison.temperatureDifference.defaultSi);
        check('创建后的真实 API 保留 IEC 来源精度、选项与负坐标',true,{iec:saved.definition.parameters.iec,bounds:saved.definition.parameters.bounds_m});
      } else {
        await expect(dialog.getByRole('alert')).toBeVisible();
        evidence.comparison.message = await dialog.getByRole('alert').innerText();
        await capture('02-comparison-create-rejected');
      }
      await check('从 IEC 工程建立有限元对照成功', response.ok(), evidence.comparison);
      if (await dialog.isVisible()) await page.keyboard.press('Escape');
    });

    if(createdComparison)await step('02b-new-comparison-input-preflight',async()=>{
      const current={workspace:iec.workspace,id:createdComparison.id};
      const saved=await api(studyPath(current));
      const availability=await api(`${hpcStudyPath(current)}/availability`);
      expect(availability.configured).not.toBe(true);
      const pending=page.waitForResponse(response=>new URL(response.url()).pathname===`${hpcStudyPath(current)}/input-preflight`);
      await page.getByRole('toolbar',{name:'工程命令',exact:true}).getByRole('button',{name:/预检|运行/}).first().click();
      const response=await pending,result=await response.json();
      const dialog=page.getByRole('dialog',{name:'运行前预检',exact:true});await expect(dialog).toBeVisible();
      evidence.comparison.preflightView=await readyPreflight(dialog,response,result,saved);
      check('新建对照使用自己的保存输入完成真实预检',response.ok() && typeof result.input_ready==='boolean',{status:response.status(),result});
      await expect(dialog.getByRole('button',{name:'确认并运行',exact:true})).toBeDisabled();
      await expect(dialog.getByRole('link',{name:'去设置',exact:true})).toBeVisible();
      evidence.comparison.preflight=result;
      await capture('02b-new-comparison-no-hpc');await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
    });

    await step('03-saved-fem-parameters', async () => {
      await page.goto(`${base}/studies/${thermal.id}/thermal-field/results?workspace=${thermal.workspace}&theme=light&inspector=method`);
      await expect(form).toBeVisible();
      await expect(mesh).toBeVisible();
      await expect(mesh).toBeEditable();
      await inspectMethodVersion(configuration(thermal).method);
      evidence.parameters.originalMm = await mesh.inputValue();
      evidence.parameters.fields = await form.locator('[data-field-path]').evaluateAll(nodes =>
        [...new Set(nodes.map(node => node.dataset.fieldPath))],
      );
      for (const key of ['size_m', 'far_size_m', 'transition_m', 'max_nodes']) {
        await check(`有限元网格 ${key} 可直接填写`,
          await form.locator(`input[data-field-path="/mesh/${key}"]`).isVisible(),
          { study: thermal.id, field: `/mesh/${key}` });
      }
      if(report.phase==='after'){
        const stored=configuration(await api(studyPath(thermal))).parameters;
        const sources=Object.values(stored.material_thermal_resistivity || {}).map(row=>row.source).filter(Boolean);
        if(sources.length){
          const sourceDetail=form.locator('.parameter-source').first();
          await sourceDetail.locator(':scope > summary').click();
          const sourceInput=sourceDetail.locator('textarea');
          await expect(sourceInput).toHaveValue(sources[0]);
          await sourceInput.scrollIntoViewIfNeeded();
          await sourceInput.focus();await sourceInput.press('Control+Home');
          const sourceLayout=await sourceInput.evaluate(node=>{const box=node.getBoundingClientRect();return {
            inView:box.top>=0&&box.bottom<=innerHeight&&box.left>=0&&box.right<=innerWidth,
            font:parseFloat(getComputedStyle(node).fontSize),scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,
            wraps:node.scrollWidth<=node.clientWidth+1};});
          check('已保存来源可以在工作区完整展开阅读',sourceLayout.inView&&sourceLayout.font>=13&&sourceLayout.wraps,sourceLayout);
          await expect(sourceInput).toBeInViewport({ratio:1});
          await capture('03-full-source-readable');
          if(sourceLayout.scrollHeight>sourceLayout.clientHeight+1){
            await sourceInput.press('Control+End');
            await expect.poll(()=>sourceInput.evaluate(node=>node.scrollTop+node.clientHeight>=node.scrollHeight-1)).toBe(true);
            await capture('03-full-source-readable-end');
          }
          await expect(sourceInput).toHaveValue(sources[0]);
          await sourceDetail.locator(':scope > summary').click();
        }
      }
    });

    await step('04-missing-mesh-feedback', async () => {
      await mesh.fill('');
      await mesh.press('Tab');
      await page.keyboard.press('Control+s');
      const missingNotice = page.getByRole('alert').filter({ hasText: /请填写.*(?:网格|尺寸)|(?:网格|尺寸).*必填/ }).first();
      // Save commits the text asynchronously. A static aria description is
      // ordinary field help, never evidence that the missing input was caught.
      await missingNotice.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      const feedback = await mesh.evaluate(input => ({
        value: input.value,
        invalid: input.getAttribute('aria-invalid'),
        description: (input.getAttribute('aria-describedby') || '').split(/\s+/)
          .map(id => document.getElementById(id)?.textContent || '').join(' ').trim(),
      }));
      const alerts = await page.getByRole('alert').allTextContents();
      evidence.parameters.missing = { ...feedback, alerts };
      if(report.phase==='after'){
        await expectInvalidFocus(mesh,'/mesh/size_m');
        check('保存缺项聚焦对应必填网格且读屏可识别错误',true,{path:'/mesh/size_m',invalid:await mesh.getAttribute('aria-invalid')});
      }
      await check('缺少网格参数时保留输入并说明原因', feedback.value === ''
        && alerts.some(text => /请填写.*(?:网格|尺寸)|(?:网格|尺寸).*必填/.test(text)),
      evidence.parameters.missing);
      await mesh.scrollIntoViewIfNeeded();
      if (await missingNotice.isVisible()) await missingNotice.scrollIntoViewIfNeeded();
      if(report.phase==='after'){
        await expect(mesh).toBeInViewport({ratio:1});
        await expect(missingNotice).toBeInViewport({ratio:1});
      }
      await capture('04-empty-required-mesh');
    });

    await step('05-save-fem-parameters', async () => {
      // An explicit engineer edit, not an invented automatic solver default.
      const targetMm = Number(evidence.parameters.originalMm) === 2.5 ? 2.6 : 2.5;
      await mesh.fill(String(targetMm));
      await mesh.press('Tab');
      const save = page.getByRole('toolbar', { name: '工程命令', exact: true })
        .locator('[data-command-role=save]:visible');
      await expect(save).toBeEnabled();
      const pending = page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname === studyPath(thermal));
      await save.click();
      const response = await pending;
      evidence.parameters.saveStatus = response.status();
      await check('鼠标保存有限元参数有成功回执', response.ok(), { status: response.status() });
      if (!response.ok()) throw Error('有限元参数保存失败，不能把后续预检当成已保存输入的检查。');
      await expect(save).toHaveText('已保存');
      const saved = await api(studyPath(thermal));
      const stored = configuration(saved).parameters.mesh.size_m;
      evidence.parameters.saved = { displayedMm: targetMm, storedM: stored, revision: saved.revision };
      await check('毫米显示值正确保存为 SI 米', Math.abs(stored - targetMm / 1000) < 1e-12,
        evidence.parameters.saved);
      await page.reload();
      await expect(mesh).toHaveValue(String(targetMm));
    });

    await step('06-no-hpc-input-preflight', async () => {
      const saved = await api(studyPath(thermal));
      const query = saved.definition.modules?.['thermal-field'] ? '?module=thermal-field' : '';
      const availability = await api(`${hpcStudyPath(thermal)}/availability${query}`);
      evidence.preflight.availability = availability;
      // An unexpectedly configured machine needs a different, authorized HPC
      // walkthrough. Even native preflight is not sent from this cloud test.
      expect(availability.location, '此走查针对超算方法的缺环境路径').toBe('slurm');
      expect(availability.configured, '云端输入走查要求未配置超算，不能启动原生预检').not.toBe(true);
      await page.getByRole('tablist', { name: '属性分页', exact: true })
        .getByRole('tab', { name: '输入', exact: true }).click();
      await expect(page.getByRole('link', { name: '去设置', exact: true }).first()).toBeVisible();
      const setupText = await page.locator('.workbench-dock-body').innerText();
      await check('未配置超算时说明原因且仍可检查输入',
        /未配置/.test(setupText) && /输入检查可先完成/.test(setupText),
        { observed: setupText, availability });
      await capture('06-no-hpc-setup');
      const inputResponse = page.waitForResponse(response =>
        new URL(response.url()).pathname === `${hpcStudyPath(thermal)}/input-preflight`);
      const inputButton = page.getByRole('button', { name: '检查输入', exact: true });
      const trigger = await inputButton.isVisible() ? inputButton
        : page.getByRole('toolbar', { name: '工程命令', exact: true })
          .getByRole('button', { name: /预检|运行/ }).first();
      await expect(trigger).toBeEnabled();
      await trigger.click();
      const response = await inputResponse;
      evidence.preflight.status = response.status();
      evidence.preflight.result = await response.json();
      const dialog = page.getByRole('dialog', { name: '运行前预检', exact: true });
      await expect(dialog).toBeVisible();
      evidence.preflight.view = await readyPreflight(dialog, response, evidence.preflight.result, saved);
      evidence.preflight.visible = await dialog.innerText();
      await check('未配置超算也能获得真实输入预检结果', response.ok()
        && typeof evidence.preflight.result.input_ready === 'boolean', evidence.preflight);
      await check('超算不可用时运行按钮禁用并提供设置入口',
        await dialog.getByRole('button', { name: '确认并运行', exact: true }).isDisabled()
          && await dialog.getByRole('link', { name: '去设置', exact: true }).isVisible()
          && /未配置/.test(evidence.preflight.visible),
        { observed: evidence.preflight.visible });
      evidence.preflight.nativeExecution = '云端无法验证：未配置超算；仅检查输入，未提交原生预检或运行。';
    });

    await step('07-open-compute-settings', async () => {
      await page.getByRole('dialog', { name: '运行前预检', exact: true })
        .getByRole('link', { name: '去设置', exact: true }).click();
      await expect(page).toHaveURL(/\/settings\/compute/);
      const settings = page.getByRole('region', { name: '超算连接', exact: true });
      await expect(settings).toBeVisible();
      evidence.computeSettings = await readyComputeSettings(configuration(thermal).method);
      await expect(settings.getByRole('button', { name: '测试连接', exact: true })).toBeDisabled();
      await check('去设置能到达可理解的超算配置页面',
        await settings.getByLabel('分区', { exact: true }).isVisible()
          && await settings.getByLabel('远程工作目录', { exact: true }).isVisible()
          && /先保存完整连接配置/.test(await settings.innerText()),
        { observed: await settings.innerText() });
    });

    await step('08-new-native-task-form', async () => {
      await page.goto(`${base}/?theme=light`);
      await page.locator('.home-domains > div')
        .filter({ has: page.getByRole('link', { name: /电缆仿真/ }) })
        .getByRole('button', { name: '新建研究', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '新建研究', exact: true });
      await dialog.getByRole('textbox', { name: '研究名称', exact: true })
        .fill(`暂态温升参数填写 · ${tag}`);
      const project=dialog.getByRole('textbox',{name:'工程名称',exact:true});
      if(await project.count())await project.fill(`暂态走查工程 · ${tag}`);
      await choose('引用型号版本', /^YJL02-12\/20 kV 1×400（结构演示） · /, dialog);
      await dialog.getByRole('combobox', { name: '计算方法', exact: true }).click();
      await page.getByRole('option').first().click();
      const json = dialog.getByRole('textbox', { name: '方法参数 / SI', exact: true });
      if(await json.isVisible()){
      await capture('08-new-native-json-form');
      await dialog.getByRole('button', { name: '建立研究', exact: true }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      evidence.newTask = { rawJson: await json.isVisible(), message: await dialog.getByRole('alert').innerText() };
      await check('新建仿真任务可用有名称和单位的参数控件完成', !evidence.newTask.rawJson,
        { ...evidence.newTask, step: '首页 → 电缆仿真 → 新建研究 → 暂态温升 → 计算方法' });
      }else{
        const allocation=page.waitForResponse(response=>response.request().method()==='POST' && new URL(response.url()).pathname==='/api/design/study-workspaces');
        await dialog.getByRole('button',{name:'建立工程并配置仿真',exact:true}).click();
        const allocated=await allocation;expect(allocated.ok()).toBe(true);const workspace=await allocated.json();
        evidence.newTask={workspace:workspace.id,revision:workspace.revision,rawJson:false};
        await expect(dialog.locator('[data-contract-form="new-simulation"]')).toBeVisible();
        const methods=await api('/api/methods'),method=methods.find(row=>row.method.plugin_id==='cablesim.simulation');
        const pin={...method.method,capability:'transient-temperature'};
        const schema=(await api('/api/input-contracts?'+new URLSearchParams(pin))).find(row=>row.method.release_digest===pin.release_digest && row.method.capability===pin.capability).parameter_schema;
        await dialog.getByRole('button',{name:'建立研究',exact:true}).click();
        await expect(dialog.locator('[role="alert"]:visible').first()).toBeVisible();
        await capture('08-native-missing-inputs');
        await select(dialog,'/domain_options/section_id',undefined,schema);
        await select(dialog,'/domain_options/load_id',undefined,schema);
        for(const [index,value] of bounds.entries())await number(dialog,schema,'/domain_options/bounds_m/'+index,value);
        // Deliberately do not fabricate loss coefficients or material evidence.
        // Empty groups are explicit input omissions for the host's real preflight.
        for(const path of ['/domain_options/boundaries','/domain_options/per_cable','/domain_options/duct_air','/resistance_temperature_k']){
          const group=await editor(dialog,path);await group.getByRole('button',{name:'明确不提供此组分项',exact:true}).click();
        }
        await source(dialog,'/domain_options/source',`界面走查工程：引用真实型号建立工程；计算边界/网格来自「${referenceThermal.definition.title}」。尚未提供物理边界、逐层损耗和电阻温度证据，必须由正式输入预检指出，禁止求解。`);
        const section=workspace.domain.sections[0];
        const initial=section.medium?.surface_temperature ?? section.medium?.temperature;
        expect(typeof initial,'初温取自所选工程的已保存环境，不能猜测').toBe('number');
        await number(dialog,schema,'/time/initial_temperature_k',initial);
        await number(dialog,schema,'/time/step_s',60);await number(dialog,schema,'/time/steps',10);
        for(const key of ['size_m','far_size_m','transition_m'])await number(dialog,schema,'/mesh/'+key,referenceParameters.mesh[key]);
        await capture('08-native-typed-form');
        const created=page.waitForResponse(response=>response.request().method()==='POST' && new URL(response.url()).pathname===`/api/workspaces/${workspace.id}/studies`);
        await dialog.getByRole('button',{name:'建立研究',exact:true}).click();
        const response=await created;evidence.newTask.status=response.status();evidence.newTask.study=await response.json();
        check('首页仿真用真实对象与有单位控件建立研究',response.ok(),evidence.newTask);
        await expect(dialog).not.toBeVisible();
        const saved=await api(`/api/workspaces/${workspace.id}/studies/${evidence.newTask.study.id}`);
        check('新研究保存真实截面与负荷引用',workspace.domain.sections.some(row=>row.id===saved.definition.parameters.domain_options.section_id) && workspace.domain.load_cases.some(row=>row.id===saved.definition.parameters.domain_options.load_id),saved.definition.parameters.domain_options);
        await page.reload();await expect(page.getByRole('navigation',{name:'工程浏览器',exact:true})).toBeVisible();
        const availability=await api(`${hpcStudyPath({workspace:workspace.id,id:saved.id})}/availability`);
        expect(availability.configured).not.toBe(true);
        const pending=page.waitForResponse(response=>new URL(response.url()).pathname===`${hpcStudyPath({workspace:workspace.id,id:saved.id})}/input-preflight`);
        await page.getByRole('toolbar',{name:'工程命令',exact:true}).getByRole('button',{name:/预检|运行/}).first().click();
        const responseCheck=await pending,result=await responseCheck.json();
        const preflight=page.getByRole('dialog',{name:'运行前预检',exact:true});await expect(preflight).toBeVisible();
        evidence.newTask.preflightView=await readyPreflight(preflight,responseCheck,result,saved);
        check('新建仿真恢复后保留真实预检与禁用原因',responseCheck.ok() && typeof result.input_ready==='boolean' && await preflight.getByRole('button',{name:'确认并运行',exact:true}).isDisabled(),{result,availability});
        evidence.newTask.preflight=result;
      }
    });
  } catch (error) {
    primaryFailure = error;
  }
  try {
    // This read-only empty-state check is independent of the native form flow.
    // Its result never replaces a failure in the main simulation journey.
    if (report.phase === 'after') await step('09-hybrid-model-directory', async () => {
      let identity = evidence.source.iec;
      if (!identity) {
        const projects = await api('/api/workspaces');
        const saved = (await Promise.all(projects.map(project => api(`/api/workspaces/${project.id}/studies`)))).flat();
        const study = saved.find(row => row.definition.method.plugin_id === 'cablesim.iec60287') || saved[0];
        expect(study, '空态走查仍须使用真实已保存研究').toBeTruthy();
        identity = { workspace: study.workspace, study: study.id, title: study.definition.title };
      }
      const endpoint = studyPath({ workspace: identity.workspace, id: identity.study });
      const workspaceEndpoint = `/api/workspaces/${identity.workspace}`;
      const [savedStudy, savedWorkspace] = await Promise.all([api(endpoint), api(workspaceEndpoint)]);
      const writesBefore = report.writes.length, runsBefore = evidence.nativeRuns.length;
      const directoryResponse = page.waitForResponse(response => response.request().method() === 'GET'
        && new URL(response.url()).pathname === '/api/model-artifacts');
      // Leave any blocked main-flow dialog without saving or resuming its work.
      const leave = dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss();
      page.on('dialog', leave);
      let response;
      try {
        [, response] = await Promise.all([
          page.goto(`${base}/studies/${identity.study}/hybrid/sources?workspace=${identity.workspace}&theme=light`),
          directoryResponse,
        ]);
      } finally { page.off('dialog', leave); }
      expect(response.ok(), '模型目录必须是真实成功响应').toBe(true);
      const directory = await response.json();
      expect(Array.isArray(directory)).toBe(true);
      const hybrid = page.locator('.hybrid-study');
      await expect(hybrid.locator('.hybrid-sources')).toBeVisible();
      const families = { direct_single: '直埋单回', direct_double: '直埋双回', duct: '排管', backfill: '矩形回填', layered_soil: '分层土壤' };
      const familyLabel = (await hybrid.locator('.hybrid-sources dt').filter({ hasText: /^场景族$/ })
        .locator('xpath=following-sibling::dd[1]').innerText()).trim();
      const family = Object.keys(families).find(key => families[key] === familyLabel);
      expect(family, '适用场景须来自当前保存研究的可见来源').toBeTruthy();
      const compatible = directory.filter(row => row.availability === 'available' && row.family === family);
      evidence.hybridEmpty = { identity, family, directory: directory.map(row => ({
        model_sha256: row.model_sha256, family: row.family, availability: row.availability,
      })), compatible: compatible.length, status: 'checking',
        coverage: { initialEmpty: false, refreshedEmpty: false, requirementsReturn: false } };
      const select = hybrid.getByRole('combobox', { name: '模型版本', exact: true });
      const predict = hybrid.getByRole('button', { name: /^(保存并)?预测$/ });
      const reason = hybrid.getByRole('status');
      async function availableDirectory(rows, stage) {
        await expect(select).toBeEnabled();
        const selectedText = await select.innerText();
        await select.click();
        const listbox = page.getByRole('listbox'), options = listbox.getByRole('option');
        const label = row => displayText(`${row.name} · ${row.model_version}`);
        await expect(options).toHaveCount(rows.length);
        for (const [index, row] of rows.entries()) await expect(options.nth(index)).toHaveAccessibleName(label(row));
        const savedModel = rows.find(row => row.model_sha256 === savedStudy.definition.parameters?.model_sha256);
        const selected = listbox.locator('[role="option"][data-state="checked"]');
        await expect(selected).toHaveCount(savedModel ? 1 : 0);
        if (savedModel) await expect(selected).toHaveAccessibleName(label(savedModel));
        await page.keyboard.press('Escape');
        await expect(listbox).toBeHidden();
        await expect(select).toBeFocused();
        await expect(select).toHaveText(savedModel ? label(savedModel) : selectedText);
        if (!savedModel) await expect(predict).toBeDisabled();
        const predictionDisabled = await predict.isDisabled();
        if (predictionDisabled) {
          await expect(reason).toBeVisible();
          await expect(predict).toHaveAccessibleDescription(await reason.innerText());
        }
        evidence.hybridEmpty.available = { stage, models: rows.map(row => row.model_sha256),
          selected: savedModel?.model_sha256 || null, predictionDisabled };
      }
      async function uncovered(stage, detail) {
        evidence.hybridEmpty.status = 'not-covered';
        evidence.hybridEmpty.reason = detail;
        const shot = await capture(`09-hybrid-model-directory-${stage}`);
        const handoff = { label: '混合模型空态与训练要求往返', ...size, status: '云端无法验证',
          owner: '维护者验收种子', stage, detail, screenshot: shot.screenshot, evidence: evidence.hybridEmpty };
        report.handoffs ||= [];
        report.handoffs.push(handoff);
        check('混合模型空态与训练要求往返具有真实可验证条件', false, handoff, { fatal: false });
      }
      if (compatible.length) {
        await availableDirectory(compatible, 'initial');
        await uncovered('initial-nonempty', '当前真实目录已有适用模型，空态恢复未覆盖；保留真实模型与已保存引用。');
      } else {
        await expect(select).toBeDisabled();
        await expect(predict).toBeDisabled();
        await expect(reason).toBeVisible();
        await expect(reason).toContainText(directory.length ? '已登记模型中没有适用于' : '尚无已登记的训练模型');
        await expect(reason).toContainText(familyLabel);
        await expect(predict).toHaveAccessibleDescription(await reason.innerText());
        await check('没有适用模型时可见禁用原因且正文至少 13px',
          await reason.evaluate(node => parseFloat(getComputedStyle(node).fontSize)) >= 13,
          { reason: await reason.innerText(), ...evidence.hybridEmpty });
        evidence.hybridEmpty.coverage.initialEmpty = true;
        await capture('09-hybrid-model-empty');
        const tabs = page.getByRole('tablist', { name: '混合载流量页签', exact: true });
        evidence.hybridEmpty.primaryActions = [];
        for (const [tab, label, interaction] of [
          ['results', '预测结果', 'keyboard'], ['validation', '模型验证', 'mouse'], ['sources', '来源', 'keyboard'],
        ]) {
          const target = tabs.getByRole('tab', { name: label, exact: true });
          if (interaction === 'keyboard') { await target.focus(); await target.press('Enter'); }
          else await target.click();
          await expect(target).toHaveAttribute('aria-selected', 'true');
          await expect(page).toHaveURL(new RegExp(`/hybrid/${tab}\\?`));
          await expect(predict).toBeDisabled();
          await expect(predict).toHaveAccessibleDescription(await reason.innerText());
          // Disabled controls retain their visual weight: count them as well.
          const primary = page.locator('.button-primary:visible,.button-run:visible');
          await expect(primary).toHaveCount(1);
          await expect(primary).toHaveAccessibleName('查看混合方法与训练要求');
          const state = { tab, interaction, primary: await primary.innerText(), predictionDisabled: await predict.isDisabled() };
          evidence.hybridEmpty.primaryActions.push(state);
          check(`混合研究${label}仅保留训练要求一个主操作且说明预测禁用原因`, true, state);
          await capture(`09-hybrid-${tab}-single-primary`);
        }
        const refreshed = page.waitForResponse(reply => reply.request().method() === 'GET'
          && new URL(reply.url()).pathname === '/api/model-artifacts');
        await hybrid.getByRole('button', { name: '重新读取模型目录', exact: true }).click();
        const freshResponse = await refreshed;
        expect(freshResponse.ok()).toBe(true);
        const freshDirectory = await freshResponse.json();
        expect(Array.isArray(freshDirectory)).toBe(true);
        const freshCompatible = freshDirectory.filter(row => row.availability === 'available' && row.family === family);
        evidence.hybridEmpty.refreshed = { directory: freshDirectory.map(row => ({
          model_sha256: row.model_sha256, family: row.family, availability: row.availability,
        })), compatible: freshCompatible.length };
        await check('重新读取模型目录发送真实 GET 且未提交预测', evidence.nativeRuns.length === runsBefore,
          { status: freshResponse.status(), models: freshDirectory.length, runs: evidence.nativeRuns.slice(runsBefore) });
        if (freshCompatible.length) {
          await availableDirectory(freshCompatible, 'refreshed');
          await uncovered('changed-after-refresh', '重新读取后真实目录出现适用模型；初始空态已核对，完整空态恢复与训练要求往返未覆盖。');
        } else {
          await expect(hybrid.getByRole('button', { name: '重新读取模型目录', exact: true })).toBeEnabled();
          await expect(select).toBeDisabled();
          await expect(predict).toBeDisabled();
          await expect(reason).toContainText(freshDirectory.length ? '已登记模型中没有适用于' : '尚无已登记的训练模型');
          await expect(predict).toHaveAccessibleDescription(await reason.innerText());
          evidence.hybridEmpty.coverage.refreshedEmpty = true;
          await capture('09-hybrid-model-directory-refreshed');
          const methods = await api('/api/methods');
          const method = methods.find(row => row.method.plugin_id === 'cablesim.hybrid-rating');
          const training = method?.capabilities.find(row => row.id === 'train-model');
          expect(training, '训练要求入口须对应真实插件能力声明').toBeTruthy();
          const returnUrl = page.url();
          const guidance = hybrid.getByRole('link', { name: '查看混合方法与训练要求', exact: true });
          await guidance.focus();
          await expect(guidance).toBeFocused();
          await page.keyboard.press('Enter');
          await expect(page).toHaveURL(/\/plugins\/cablesim\.hybrid-rating(?:\?|$)/);
          const detail = page.getByRole('article', { name: method.name, exact: true });
          await expect(detail).toBeVisible();
          await detail.getByRole('tablist', { name: '插件详情', exact: true }).getByRole('tab', { name: /^能力 \d+$/ }).click();
          await detail.getByRole('heading', { name: training.title, exact: true }).scrollIntoViewIfNeeded();
          await expect(detail.getByRole('heading', { name: training.title, exact: true })).toBeVisible();
          const trainingCard = detail.locator('.capability').filter({
            has: page.getByRole('heading', { name: training.title, exact: true }),
          });
          const trainingLocation = trainingCard.locator('.solver-location');
          await expect(trainingLocation).toContainText(/求解位置：\s*超算/);
          evidence.hybridEmpty.training = { capability: training.id, solverLocation: await trainingLocation.innerText() };
          await capture('09-hybrid-training-requirements');
          await page.goBack();
          await expect(page).toHaveURL(returnUrl);
          await expect(select).toBeDisabled();
          await expect(predict).toBeDisabled();
          await expect(reason).toBeVisible();
          await capture('09-hybrid-returned-to-sources');
          evidence.hybridEmpty.coverage.requirementsReturn = true;
        }
      }
      const [studyAfter, workspaceAfter] = await Promise.all([api(endpoint), api(workspaceEndpoint)]);
      expect(studyAfter.definition).toEqual(savedStudy.definition);
      expect(studyAfter.revision).toBe(savedStudy.revision);
      expect(workspaceAfter.domain).toEqual(savedWorkspace.domain);
      expect(workspaceAfter.revision).toBe(savedWorkspace.revision);
      await check('模型目录各分支保留研究与工程且不写入或提交运行',
        report.writes.length === writesBefore && evidence.nativeRuns.length === runsBefore,
        { url: page.url(), studyRevision: studyAfter.revision, workspaceRevision: workspaceAfter.revision,
          writes: report.writes.slice(writesBefore), runs: evidence.nativeRuns.slice(runsBefore) });
      if (Object.values(evidence.hybridEmpty.coverage).every(Boolean)) evidence.hybridEmpty.status = 'empty-state-actions-verified';
    });
  } catch (error) {
    if (primaryFailure) check('混合模型空态独立步骤未通过', false, error.message, { fatal: false });
    else primaryFailure = error;
  } finally {
    page.off('request', onRequest);
    await fs.writeFile(path.join(out, `simulation-detail-${size.width}x${size.height}.json`),
      JSON.stringify(evidence, null, 2));
    expect(evidence.nativeRuns, '缺环境走查禁止任何原生 POST /runs').toEqual([]);
  }
  if (primaryFailure) throw primaryFailure;
});
