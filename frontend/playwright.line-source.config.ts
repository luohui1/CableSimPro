import {defineConfig} from '@playwright/test';
import common from './playwright.config';
export default defineConfig({...common,
 outputDir:'test-results-line-source',
 reporter:[['list'],['junit',{outputFile:'test-results-line-source/browser-tests.xml'}]],
 projects:[{...common.projects![0],name:'line-source-chromium',testMatch:['plugin-line-source.spec.ts']}],
});
