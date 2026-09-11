import {defineConfig} from '@playwright/test';
import common from './playwright.config';

// Supplemental kit tests run alongside, not instead of, the existing CI matrix.
export default defineConfig({...common,
 outputDir:'test-results-kit',
 reporter:[['list'],['html',{open:'never',outputFolder:'playwright-report-kit'}],['junit',{outputFile:'test-results-kit/kit-tests.xml'}]],
 projects:[{...common.projects![0],name:'kit-chromium',testMatch:['metal-kit.spec.ts','engineering-pulse.spec.ts']}],
});
