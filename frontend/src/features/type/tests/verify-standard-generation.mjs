import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {expect as baseExpect} from '@playwright/test';
import {typeFixture,root} from './fixture.mjs';
import {checkLayout} from './ui-checks.mjs';

const output=path.join(root,'.data/standard-generation');await fs.mkdir(output,{recursive:true});
process.env.E2E_DATABASE_SOURCE ||= path.join(root,'.data/type-basis/validation/engineering.sqlite');
const fixture=await typeFixture({main:true,build:path.join(output,'frontend')}),{page}=fixture;
const expect=baseExpect.configure({timeout:30000}),report={checks:[],errors:fixture.errors,runtime:fixture.runtime,completeGeneration:'blocked: missing sealed Annex A/B parameters and page records'};
async function select(name,option){await page.getByRole('combobox',{name,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();}
try {
  for(const width of [1366,1920])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:width===1366?768:1080});
    await page.goto(`${fixture.url}/types?create=1&theme=${theme}`);
    const dialog=page.getByRole('dialog',{name:'新建型号设计',exact:true});await expect(dialog).toBeVisible();
    await page.getByRole('radio',{name:'按标准生成',exact:true}).check();
    await expect(page.getByRole('combobox',{name:'额定电压',exact:true})).toBeVisible();
    await page.getByRole('textbox',{name:'型号名称',exact:true}).fill(`YJV22 8.7/15 3×240 依据草稿 ${width} ${theme}`);
    await select('结构类型','三芯');await select('额定电压','8.7/15 kV');
    await page.getByRole('textbox',{name:'导体截面',exact:true}).fill('240');
    await select('导体几何','等截面积实心圆 · 理想化');await page.getByRole('textbox',{name:'芯间净距',exact:true}).fill('0');
    await select('生成范围','完整护层 · 核对附录依据');await page.getByRole('button',{name:'生成结构提案',exact:true}).click();
    await expect(dialog.getByRole('alert')).toContainText(/缺少已核验的计算依据/);
    await expect(dialog.getByRole('alert')).toContainText(/B.1/);
    await expect(page.locator('[aria-label="结构提案"]')).toHaveCount(0);
    report.checks.push({width,theme,state:'unsupported',layout:await checkLayout(page,'[role=dialog]')});
    await select('生成范围','绝缘线芯 · 护层待设计');await page.getByRole('button',{name:'生成结构提案',exact:true}).click();
    const proposal=page.locator('[aria-label="结构提案"]');await expect(proposal).toBeVisible();
    await expect(proposal).toContainText('4.5 mm');await expect(proposal).toContainText(/GB\/T 12706.2.*表 7.*第 7 页/);
    await expect(page.getByRole('button',{name:'确认并建立草稿',exact:true})).toBeDisabled();
    const gate=page.getByRole('checkbox',{name:'已核对标准值、推导条件与缺项',exact:true});await expect(gate).not.toBeChecked();
    report.checks.push({width,theme,state:'proposal',layout:await checkLayout(page,'[role=dialog]')});
    if(width===1366&&theme==='light')await page.screenshot({path:path.join(output,'insulation-proposal.png')});
    await gate.check();await page.getByRole('button',{name:'确认并建立草稿',exact:true}).click();
    await expect(dialog).toBeHidden();await expect(page).toHaveURL(/\/types\/[^/]+\/structure\//);
    await expect(page.locator('[data-type-page="structure"]')).toBeVisible();
    const wid=new URL(page.url()).pathname.split('/')[2],saved=await fixture.api(`/api/workspaces/${wid}`);
    assert.equal(saved.domain.cable_types[0].cores.length,3);
    for(const core of saved.domain.cable_types[0].cores)assert.equal(core.layers.find(l=>l.role==='insulation').thickness,.0045);
    assert.ok(Object.values(saved.domain.provenance).some(p=>String(p.reference).includes('cablesim.standard-basis-ref/1')));
    report.checks.push({width,theme,state:'confirmed-draft',layout:await checkLayout(page,'.type-root')});
  }
  assert.deepEqual(fixture.errors,[]);
}catch(error){report.failure=String(error.stack||error);report.log=fixture.log();console.error(report.failure);await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{await fixture.close();report.closed=true;await fs.writeFile(path.join(output,'browser.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({checks:report.checks.length,closed:report.closed,failure:report.failure}));
