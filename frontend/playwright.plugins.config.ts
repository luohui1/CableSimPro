import {defineConfig} from '@playwright/test';
import common from './playwright.config';
export default defineConfig({...common,
 outputDir:'test-results-plugins',
 reporter:[['list'],['junit',{outputFile:'test-results-plugins/browser-tests.xml'}]],
 projects:[{...common.projects![0],name:'plugins-chromium',testMatch:['plugin-center.spec.ts']}],
});
