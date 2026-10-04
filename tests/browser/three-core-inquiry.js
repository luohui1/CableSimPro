// BrowserOS neo scenario. Run against an isolated database containing three
// explicitly sourced hand-check draft models (240/300/400 mm²), never approvals.
// Read this file into neo.run, then call threeCoreInquiry(browser, pageId).
async function threeCoreInquiry(browser, pageId, stage = 'start') {
  const page = browser.page(pageId);
  const ref = async (role, name) => {
    const snapshot = await page.snapshot({mode: 'interactive', depth: 8});
    const found = snapshot.refs.find(r => r.role === role && r.name === name);
    if (!found) throw new Error('Missing control: ' + role + ' / ' + name);
    return found.ref;
  };
  const record = label => page.evaluate(label => {
    window.__threeCoreJourney.operations.push({label, at: Date.now()});
  }, label);
  // Neo native mouse coordinates can drift on Windows at 150% scaling. Use
  // trusted CDP pointer events, still addressed by the observed snapshot ref.
  const activate = async (role, name) => {
    const handle = await page.resolveRef(await ref(role, name));
    await page.cdp('DOM.scrollIntoViewIfNeeded', JSON.stringify({backendNodeId: handle.backendNodeId}));
    const {model} = await page.cdp('DOM.getBoxModel', JSON.stringify({backendNodeId: handle.backendNodeId}));
    const x = (model.content[0] + model.content[2]) / 2;
    const y = (model.content[1] + model.content[5]) / 2;
    await page.cdp('Input.dispatchMouseEvent', JSON.stringify({type: 'mousePressed', button: 'left', clickCount: 1, x, y}));
    await page.cdp('Input.dispatchMouseEvent', JSON.stringify({type: 'mouseReleased', button: 'left', clickCount: 1, x, y}));
    await record(name);
  };
  const ready = async selector => {
    if (!(await page.waitForSelector(selector)).matched) throw new Error('Not ready: ' + selector);
  };
  if (stage === 'start') {
    await page.goto('http://127.0.0.1:8033/design/workbench/');
    await ready('[data-action="amp-new"]');
    await page.evaluate(() => {window.__threeCoreJourney = {start: Date.now(), operations: [], basis: 'explicit hand-check draft models'};});
    await activate('button', '新建研究');
    await ready('#amp-new-task');
    await page.selectOption(await ref('combobox', '研究任务'), 'selection');
    await record('客户问询选型');
    await page.fill(await ref('spinbutton', '要求电流 / A'), '400');
    await record('填写每回路400A');
    await activate('checkbox', '包含草稿候选');
    const values = (await page.evaluate(() => ({target: document.querySelector('#amp-new-target').value,
      layout: document.querySelector('#amp-new-three-core').value,
      draft: document.querySelector('#amp-new-draft-candidates').checked}))).value;
    if (values.target !== '400' || values.layout !== 'three_core_ducts_horizontal' || !values.draft) throw new Error('New inquiry input mismatch');
    await activate('button', '建立研究');
    await ready('[data-action="amp-workflow-next"]');
    await activate('button', '保存并预检候选');
    await ready('#selection-ack');
    return {stage: 'preflight', text: (await page.snapshot({mode: 'interactive', depth: 7})).text};
  }
  if (stage === 'run') {
    await activate('checkbox', '已核对范围；不适用候选只保存拒绝记录');
    await activate('button', '确认并计算');
    await ready('.selection-conclusion');
    const text = await page.read();
    if (!text.includes('423.4') || !text.includes('数值满足')) throw new Error('Expected draft 400 mm² result missing');
    return {stage: 'result', text};
  }
  if (stage === 'report') {
    await activate('button', '导出校核记录');
    await ready('iframe[title="计算书预览"]');
    return {stage: 'report', text: (await page.snapshot({mode: 'interactive', depth: 7})).text};
  }
  if (stage === 'download') {
    const download = await page.download(await ref('link', '下载计算书'));
    await record('下载计算书');
    const receipt = (await page.evaluate(() => ({...window.__threeCoreJourney,
      seconds: (Date.now() - window.__threeCoreJourney.start) / 1000,
      operationsCount: window.__threeCoreJourney.operations.length, url: location.href}))).value;
    if (receipt.operationsCount > 10 || receipt.seconds > 300) throw new Error('Journey budget exceeded: ' + JSON.stringify(receipt));
    return {download, receipt};
  }
  throw new Error('Unknown scenario stage');
}
