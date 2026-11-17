// Use isolated-e2e.mjs with the release database. API calls below only read
// saved evidence; every change goes through a visible mouse/keyboard action.
// The cloud walkthrough stops at input preflight and never submits a solver.
import fs from 'node:fs/promises';
import path from 'node:path';
import { walkthrough } from './verify-workbench-support.mjs';
import { displayText } from '../src/lib/display-names.ts';

await walkthrough('simulation', async ({
  page, expect, base, api, choose, capture, step, check, out, size, tag, report,
}) => {
  const evidence = { source: {}, comparison: {}, parameters: {}, preflight: {}, nativeRuns: [] };
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
    evidence.source = {
      iec: { workspace: iec.workspace, study: iec.id, title: iec.definition.title },
      thermal: { workspace: thermal.workspace, study: thermal.id, title: thermal.definition.title },
      downstreamScope: '新建对照若受阻，后续参数与预检独立使用发布库既有有限元输入；不算新建链路通过。',
    };

    await step('01-saved-iec-study', async () => {
      await page.goto(`${base}/studies/${iec.id}/ampacity/results?workspace=${iec.workspace}&theme=light`);
      await expect(page.getByRole('navigation', { name: '工程浏览器', exact: true })).toBeVisible();
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
      const methodLabel = await dialog.locator('.add-study-method').innerText();
      evidence.comparison.solver = { declared: capability.solver, displayed: methodLabel };
      await check('有限元对照创建入口显示真实计算位置', capability.solver !== 'slurm' || /超算/.test(methodLabel),
        evidence.comparison.solver);
      const editors = await dialog.locator('[data-field-path] input, input[data-field-path], [data-field-path] [role="combobox"], textarea').count();
      evidence.comparison.editorCount = editors;
      await capture('02-comparison-parameters-before-submit');
      await check('新建有限元对照能填写必要参数', editors > 0, {
        step: '当前工程 → 新建研究 → IEC 与有限元对比',
        editorCount: editors,
        observed: await dialog.innerText(),
      });
      const pending = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/workspaces/${iec.workspace}/studies`);
      await dialog.getByRole('button', { name: '建立研究', exact: true }).click();
      const response = await pending;
      evidence.comparison.status = response.status();
      evidence.comparison.response = await response.json();
      if (response.ok()) {
        await expect(dialog).not.toBeVisible();
        evidence.comparison.destination = page.url();
      } else {
        await expect(dialog.getByRole('alert')).toBeVisible();
        evidence.comparison.message = await dialog.getByRole('alert').innerText();
        await capture('02-comparison-create-rejected');
      }
      await check('从 IEC 工程建立有限元对照成功', response.ok(), evidence.comparison);
      if (await dialog.isVisible()) await page.keyboard.press('Escape');
    });

    await step('03-saved-fem-parameters', async () => {
      await page.goto(`${base}/studies/${thermal.id}/thermal-field/results?workspace=${thermal.workspace}&theme=light&inspector=method`);
      await expect(form).toBeVisible();
      await expect(mesh).toBeVisible();
      await expect(mesh).toBeEditable();
      if(report.phase==='after')await inspectMethodVersion(configuration(thermal).method);
      evidence.parameters.originalMm = await mesh.inputValue();
      evidence.parameters.fields = await form.locator('[data-field-path]').evaluateAll(nodes =>
        [...new Set(nodes.map(node => node.dataset.fieldPath))],
      );
      for (const key of ['size_m', 'far_size_m', 'transition_m', 'max_nodes']) {
        await check(`有限元网格 ${key} 可直接填写`,
          await form.locator(`input[data-field-path="/mesh/${key}"]`).isVisible(),
          { study: thermal.id, field: `/mesh/${key}` });
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
      await choose('引用型号版本', /^YJL02-12\/20 kV 1×400（结构演示） · /, dialog);
      await dialog.getByRole('combobox', { name: '计算方法', exact: true }).click();
      await page.getByRole('option').first().click();
      const json = dialog.getByRole('textbox', { name: '方法参数 / SI', exact: true });
      await expect(json).toBeVisible();
      await capture('08-new-native-json-form');
      await dialog.getByRole('button', { name: '建立研究', exact: true }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      evidence.newTask = { rawJson: await json.isVisible(), message: await dialog.getByRole('alert').innerText() };
      await check('新建仿真任务可用有名称和单位的参数控件完成', !evidence.newTask.rawJson,
        { ...evidence.newTask, step: '首页 → 电缆仿真 → 新建研究 → 暂态温升 → 计算方法' });
    });
  } finally {
    page.off('request', onRequest);
    await fs.writeFile(path.join(out, `simulation-detail-${size.width}x${size.height}.json`),
      JSON.stringify(evidence, null, 2));
    expect(evidence.nativeRuns, '缺环境走查禁止任何原生 POST /runs').toEqual([]);
  }
});
