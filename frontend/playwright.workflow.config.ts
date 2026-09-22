import {defineConfig} from '@playwright/test';
import common from './playwright.config';
export default defineConfig({...common,
 outputDir:'test-results-workflow',
 reporter:[['list'],['junit',{outputFile:'test-results-workflow/browser-tests.xml'}]],
 projects:[{...common.projects![0],name:'workflow-chromium',testMatch:['professional-design.spec.ts','engineering-workflow.spec.ts','workflow-home.spec.ts','dual-mode.spec.ts','same-workspace.spec.ts']}],
});
