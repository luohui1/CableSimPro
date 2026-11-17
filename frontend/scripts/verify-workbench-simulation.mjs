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
  async function inspectMethodVersion(method) {
    const control=form.getByRole('combobox',{name:'方法版本',exact:true});
    await control.scrollIntoViewIfNeeded();
    const cards=await api('/api/methods?view=summary');
    const card=cards.find(row=>row.method.plugin_id===method.plugin_id
      && row.method.version===method.version && row.method.release_digest===method.release_digest
      && row.capabilities.some(capability=>capability.id===method.capability));
    expect(card,'方法名称须来自保存 pin 对应的真实方法清单').toBeTruthy();
    const capability=card.capabilities.find(row=>row.id===method.capability);
    const selectedText=(await control.locator(':scope > span').first().innerText()).trim();
    expect(selectedText).toBe(displayText(`${card.name} · ${capability.title} · ${method.version}`));
    const layout=await control.evaluate(button=>{
      const rect=element=>{
        const box=element.getBoundingClientRect();
        return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height};
      };
      const value=button.querySelector(':scope > span:first-child'),arrow=button.querySelector('[data-select-arrow]');
      const range=document.createRange();range.selectNodeContents(value);
      const label=button.labels[0],field=button.closest('.select-field');
      const ancestors=[];
      for(let node=field;node;node=node.parentElement){
        if(node.clientWidth && /auto|scroll/.test(getComputedStyle(node).overflowX))
          ancestors.push({selector:node.className || node.tagName,width:node.clientWidth,scrollWidth:node.scrollWidth});
      }
      return {button:rect(button),field:rect(field),label:rect(label),arrow:rect(arrow),
        text:[...range.getClientRects()].map(box=>({left:box.left,right:box.right,top:box.top,bottom:box.bottom})),
        ancestors,viewport:innerWidth};
    });
    evidence.parameters.methodVersion={method,selectedText,layout};
    await check('方法版本独占整行且完整文字、箭头不越界，无横向滚动',
      Math.abs(layout.button.height-36)<1 && layout.label.bottom<=layout.button.top
      && Math.abs(layout.button.width-layout.field.width)<1
      && layout.button.left>=0 && layout.button.right<=layout.viewport
      && layout.arrow.left>=layout.button.left && layout.arrow.right<=layout.button.right
      && layout.arrow.top>=layout.button.top && layout.arrow.bottom<=layout.button.bottom
      && layout.text.every(box=>box.left>=layout.button.left && box.right<=layout.arrow.left
        && box.top>=layout.button.top && box.bottom<=layout.button.bottom)
      && layout.ancestors.every(node=>node.scrollWidth<=node.width+1),
      evidence.parameters.methodVersion);
    await capture('03-method-version-complete');
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
    expect(labels).toContain(selectedText);
    evidence.parameters.methodVersion.options=labels;
    await capture('03-method-version-options');
    await page.keyboard.press('Escape');await expect(control).toBeFocused();
    await expect(control.locator(':scope > span').first()).toHaveText(selectedText);
  }

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

    await step('01-saved-iec-study', async () => {
      await page.goto(`${base}/studies/${iec.id}/ampacity/results?workspace=${iec.workspace}&theme=light`);
      await expect(page.getByRole('navigation', { name: '工程浏览器', exact: true })).toBeVisible();
      await expect(page.locator('[data-drawing-canvas="laying"]')).toBeVisible();
      await expect(page.getByText('正在读取保存工况的模型输入',{exact:true})).toHaveCount(0);
      await check('能从已保存的 IEC 研究开始有限元对照', true, evidence.source.iec);
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
      const availability=await api(`${hpcStudyPath(current)}/availability`);
      expect(availability.configured).not.toBe(true);
      const pending=page.waitForResponse(response=>new URL(response.url()).pathname===`${hpcStudyPath(current)}/input-preflight`);
      await page.getByRole('toolbar',{name:'工程命令',exact:true}).getByRole('button',{name:/预检|运行/}).first().click();
      const response=await pending,result=await response.json();
      const dialog=page.getByRole('dialog',{name:'运行前预检',exact:true});await expect(dialog).toBeVisible();
      check('新建对照使用自己的保存输入完成真实预检',response.ok() && typeof result.input_ready==='boolean',{status:response.status(),result});
      await expect(dialog.getByRole('button',{name:'确认并运行',exact:true})).toBeDisabled();
      await expect(dialog.getByRole('link',{name:'去设置',exact:true})).toBeVisible();
      evidence.comparison.preflight=result;
      await capture('02b-new-comparison-no-hpc');await page.keyboard.press('Escape');
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
          await expect(sourceDetail.locator('textarea')).toHaveValue(sources[0]);
          await capture('03-full-source-readable');
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
      await capture('04-empty-required-mesh');
      if (await missingNotice.isVisible()) await missingNotice.scrollIntoViewIfNeeded();
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
      await expect(dialog.getByText(/输入完整性与范围：/)).toContainText(/已通过输入检查|请修正下列缺项/);
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
        check('新建仿真恢复后保留真实预检与禁用原因',responseCheck.ok() && typeof result.input_ready==='boolean' && await preflight.getByRole('button',{name:'确认并运行',exact:true}).isDisabled(),{result,availability});
        evidence.newTask.preflight=result;
      }
    });
  } finally {
    page.off('request', onRequest);
    await fs.writeFile(path.join(out, `simulation-detail-${size.width}x${size.height}.json`),
      JSON.stringify(evidence, null, 2));
    expect(evidence.nativeRuns, '缺环境走查禁止任何原生 POST /runs').toEqual([]);
  }
});
