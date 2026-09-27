import {defineConfig,devices} from '@playwright/test';
import common from './playwright.config';
// Browser device-scale emulation on an actual Windows runner, not OS DPI changes.
const specs=['windows-native.spec.ts','engineering-workflow.spec.ts','workflow-project.spec.ts','professional-design.spec.ts'];
const args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];
export default defineConfig({...common,
 testMatch:specs,
 outputDir:'test-results-windows',
 reporter:[['list'],['html',{open:'never',outputFolder:'playwright-report-windows'}],['junit',{outputFile:'test-results-windows/windows-tests.xml'}]],
 projects:[...[1,1.25,1.5].map(scale=>({name:`windows-chromium-${scale}`,testMatch:specs,use:{...devices['Desktop Chrome'],viewport:{width:1536,height:960},deviceScaleFactor:scale,launchOptions:{args}}})),
 {name:'windows-edge-1.25',testMatch:specs,use:{...devices['Desktop Edge'],channel:'msedge',viewport:{width:1536,height:960},deviceScaleFactor:1.25,launchOptions:{args}}}]
});
