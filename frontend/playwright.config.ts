import {defineConfig,devices} from '@playwright/test';
import path from 'node:path';
export default defineConfig({
 testDir:'./pro-e2e',timeout:60000,expect:{timeout:15000},fullyParallel:false,workers:1,retries:0,maxFailures:0,
 reporter:[['list'],['html',{open:'never'}],['junit',{outputFile:'test-results/browser-tests.xml'}]],
 use:{baseURL:'http://127.0.0.1:8000',trace:'retain-on-failure',screenshot:'only-on-failure',video:'off'},
 projects:[
  {name:'chromium',testMatch:['desktop.spec.ts','domains.spec.ts','field-scale.spec.ts','vertical.spec.ts','v05.spec.ts','same-workspace.spec.ts','enterprise.spec.ts','dual-mode.spec.ts','agent-studio.spec.ts','light-studio.spec.ts'],use:{...devices['Desktop Chrome'],viewport:{width:1600,height:1000},launchOptions:{executablePath:process.env.CABLESIM_TEST_CHROMIUM,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}}},
  {name:'webkit',testMatch:['desktop.spec.ts','domains.spec.ts','field-scale.spec.ts','vertical.spec.ts','v05.spec.ts','same-workspace.spec.ts','enterprise.spec.ts','dual-mode.spec.ts','agent-studio.spec.ts','light-studio.spec.ts'],use:{...devices['Desktop Safari'],viewport:{width:1600,height:1000}}},
  {name:'mobile-webkit',testMatch:['mobile.spec.ts','v05-mobile.spec.ts','same-workspace-mobile.spec.ts','enterprise-mobile.spec.ts','dual-mode-mobile.spec.ts','agent-studio-mobile.spec.ts'],use:{...devices['iPhone 13'],browserName:'webkit'}}
 ],
 webServer:{command:'python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000',cwd:'..',url:'http://127.0.0.1:8000/api/health',timeout:60000,reuseExistingServer:!process.env.CI,env:{CABLESIM_DB:path.resolve(process.cwd(),'../.data/pro-e2e.sqlite')}}
});
