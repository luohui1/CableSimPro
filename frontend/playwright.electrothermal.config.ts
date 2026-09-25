import {defineConfig} from '@playwright/test';
import common from './playwright.config';
export default defineConfig({...common,
 outputDir:'test-results-electrothermal',
 reporter:[['list'],['junit',{outputFile:'test-results-electrothermal/browser-tests.xml'}]],
 projects:[{...common.projects![0],name:'electrothermal-chromium',testMatch:['plugin-center.spec.ts','plugin-workspace.spec.ts','plugin-electrothermal.spec.ts']}],
});
