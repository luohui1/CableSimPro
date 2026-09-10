import {defineConfig} from '@playwright/test';
import common from './playwright.config';
export default defineConfig({...common,
 projects:common.projects?.filter(p=>['chromium','webkit'].includes(p.name!)).map(p=>({...p,testMatch:['pc-studio.spec.ts','asset-library.spec.ts','study-preflight.spec.ts']})),
 outputDir:'test-results-pc',
 reporter:[['list'],['junit',{outputFile:'test-results-pc/pc-browser.xml'}]],
});
