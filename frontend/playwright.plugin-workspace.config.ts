import {defineConfig} from '@playwright/test';
import common from './playwright.config';
export default defineConfig({...common,
 outputDir:'test-results-plugin-workspace',
 reporter:[['list'],['junit',{outputFile:'test-results-plugin-workspace/browser-tests.xml'}]],
 projects:[{...common.projects![0],name:'plugin-workspace-chromium',testMatch:['plugin-center.spec.ts','plugin-workspace.spec.ts']}],
});
