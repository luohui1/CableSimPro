import {defineConfig,devices} from '@playwright/test';
import path from 'node:path';
// Every spec exercises the single WorkflowApp shell.
const workflow=['engineering-workflow.spec.ts','workflow-home.spec.ts','workflow-project.spec.ts','workspace-refinement.spec.ts','professional-design.spec.ts','professional-home.spec.ts'];
// Plugin specs need plugins/requirements-native.txt installed.
const plugins=['plugin-center.spec.ts','plugin-workspace.spec.ts','plugin-electrothermal.spec.ts','plugin-line-source.spec.ts'];
const chromium={executablePath:process.env.CABLESIM_TEST_CHROMIUM,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']};
export default defineConfig({
 testDir:'./pro-e2e',timeout:60000,expect:{timeout:15000},fullyParallel:false,workers:1,retries:0,maxFailures:0,
 reporter:[['list'],['html',{open:'never'}],['junit',{outputFile:'test-results/browser-tests.xml'}]],
 use:{baseURL:'http://127.0.0.1:8000',trace:'retain-on-failure',screenshot:'only-on-failure',video:'off'},
 projects:[
  {name:'chromium',testMatch:workflow,use:{...devices['Desktop Chrome'],viewport:{width:1600,height:1000},launchOptions:chromium}},
  {name:'workflow-plugins',testMatch:plugins,use:{...devices['Desktop Chrome'],viewport:{width:1600,height:1000},launchOptions:chromium}},
  {name:'webkit',testMatch:workflow,use:{...devices['Desktop Safari'],viewport:{width:1600,height:1000}}}
 ],
 webServer:{command:'python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000',cwd:'..',url:'http://127.0.0.1:8000/api/health',timeout:60000,reuseExistingServer:!process.env.CI,env:{CABLESIM_DB:path.resolve(process.cwd(),'../.data/pro-e2e.sqlite')}}
});
