import {defineConfig,devices} from '@playwright/test';
import common from './playwright.config';
// Browser device-scale emulation on an actual Windows runner, not OS DPI changes.
export default defineConfig({...common,
 testMatch:['same-workspace.spec.ts','windows-native.spec.ts','enterprise.spec.ts'],
 outputDir:'test-results-windows',
 reporter:[['list'],['html',{open:'never',outputFolder:'playwright-report-windows'}],['junit',{outputFile:'test-results-windows/windows-tests.xml'}]],
 projects:[...[1,1.25,1.5].map(scale=>({name:`windows-chromium-${scale}`,testMatch:['same-workspace.spec.ts','windows-native.spec.ts','enterprise.spec.ts'],use:{...devices['Desktop Chrome'],viewport:{width:1536,height:960},deviceScaleFactor:scale,launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}}})),
 {name:'windows-edge-1.25',testMatch:['same-workspace.spec.ts','windows-native.spec.ts','enterprise.spec.ts'],use:{...devices['Desktop Edge'],channel:'msedge',viewport:{width:1536,height:960},deviceScaleFactor:1.25,launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}}}]
});
