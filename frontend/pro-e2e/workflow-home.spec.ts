import {test,expect} from '@playwright/test';

test('home browse is read-only, explicit create and saved project reopen share one workspace',async({page,request},info)=>{
 const created:string[]=[];
 page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/workspaces'))created.push(r.url())});
 await page.goto('/?workflow=1');await expect(page.getByRole('heading',{name:'从一个工程开始。'})).toBeVisible();
 expect(created).toEqual([]);
 await page.screenshot({path:info.outputPath('project-home.png')});
 const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/workspaces'));
 await page.getByRole('button',{name:'新建研究工程',exact:false}).click();const w=await (await response).json();
 await expect(page.getByTestId('workflow-revision')).toHaveText('rev.1');expect(created).toHaveLength(1);
 await page.getByRole('navigation',{name:'工程对象'}).getByRole('button',{name:'导体',exact:true}).click();
 await page.getByLabel('20°C 导体电阻',{exact:true}).fill('0.0754');await expect(page.getByRole('button',{name:'返回工程首页'})).toBeDisabled();
 await page.getByRole('button',{name:'保存全部修改'}).click();await expect(page.getByTestId('workflow-revision')).toHaveText('rev.2');
 // Give this synthetic fixture a unique name using the existing public edit API.
 const name=`工程重开验证 ${w.id.slice(0,8)}`;
 expect((await request.post(`/api/workspaces/${w.id}/edit`,{data:{expected_revision:2,changes:[{path:'name',value:name}]}})).ok()).toBe(true);
 await page.getByRole('button',{name:'读取最新版本'}).click();await expect(page.getByTestId('workflow-revision')).toHaveText('rev.3');
 await page.getByRole('button',{name:'返回工程首页'}).click();await expect(page.getByRole('heading',{name:'最近工程'})).toBeVisible();
 await page.locator('.wf-recent').getByRole('button',{name:new RegExp(name)}).click();await expect(page.getByTestId('workflow-revision')).toHaveText('rev.3');
 await page.getByRole('navigation',{name:'工程对象'}).getByRole('button',{name:'导体',exact:true}).click();await expect(page.getByLabel('20°C 导体电阻',{exact:true})).toHaveValue('0.0754');
 expect(new URL(page.url()).searchParams.get('project')).toBe(w.id);expect(created).toHaveLength(1);
});
