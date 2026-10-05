// BrowserOS neo scenario. Run against an isolated database containing three
// raw published three-core specimens; model preparation never approves records.
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
    await page.goto('http://127.0.0.1:8037/design/workbench/');
    await ready('[data-action="amp-new"]');
    await page.evaluate(() => {window.__threeCoreJourney = {start: Date.now(), operations: [], basis: 'published YJV22 with explicitly given reference parameters; 350 A inquiry'};});
    await activate('button', '新建研究');
    await ready('#amp-new-task');
    await page.selectOption(await ref('combobox', '研究任务'), 'selection');
    await record('客户问询选型');
    const model=(await page.evaluate(()=>[...document.querySelector('#amp-new-workspace').options].find(o=>o.text.includes('YJV22-8.7/15 kV 3×300'))?.value)).value;
    if(!model)throw new Error('Published 3×300 model missing');
    await page.selectOption(await ref('combobox','引用型号版本'),model);await record('选择真实3×300');
    await page.fill(await ref('spinbutton', '要求电流 / A'), '350');
    await record('填写每回路350A');
    await activate('button','采用参考输入');
    await activate('checkbox','同一组参数用于本次同系列候选');
    const values = (await page.evaluate(() => ({target: document.querySelector('#amp-new-target').value,
      layout: document.querySelector('#amp-new-three-core').value,
      draft: document.querySelector('#amp-new-draft-candidates').checked}))).value;
    if (values.target !== '350' || values.layout !== 'three_core_ducts_horizontal' || values.draft) throw new Error('New inquiry input mismatch');
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
    if (!text.includes('381.4') || !text.includes('推荐 YJV22-8.7/15 kV 3×300')) throw new Error('Expected real 350 A inquiry result missing');
    return {stage: 'result', text};
  }
  if (stage === 'report') {
    await activate('button', '生成客户计算书');
    await ready('iframe[title="计算书预览"]');
    return {stage: 'report', text: (await page.snapshot({mode: 'interactive', depth: 7})).text};
  }
  if (stage === 'download') {
    const download = await page.download(await ref('link', '下载计算书'));
    await record('下载计算书');
    const receipt = (await page.evaluate(() => ({...window.__threeCoreJourney,
      seconds: (Date.now() - window.__threeCoreJourney.start) / 1000,
      operationsCount: window.__threeCoreJourney.operations.length, url: location.href}))).value;
    if (receipt.seconds > 300) throw new Error('Journey time budget exceeded: ' + JSON.stringify(receipt));
    return {download, receipt};
  }
  throw new Error('Unknown scenario stage');
}
