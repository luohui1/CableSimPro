// Use isolated-e2e.mjs with the release database. API calls below only read
// saved evidence; every change goes through a visible mouse/keyboard action.
// The cloud walkthrough stops at input preflight and never submits a solver.
import fs from 'node:fs/promises';
import path from 'node:path';
import { walkthrough } from './verify-workbench-support.mjs';

await walkthrough('simulation', async ({
  page, expect, base, api, choose, capture, step, check, out, size, tag,
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
      await choose('引用型号版本', /YJL02.*1×400/, dialog);
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
