import {defineConfig} from '@playwright/test';
import common from './playwright.config';
export default defineConfig({...common,
 projects:common.projects?.filter(p=>['chromium','webkit'].includes(p.name!)).map(p=>({...p,testMatch:['study-preflight.spec.ts','asset-library.spec.ts']})),
 outputDir:'test-results-foundation',
 reporter:[['list'],['junit',{outputFile:'test-results-foundation/foundation-browser.xml'}]]
});
