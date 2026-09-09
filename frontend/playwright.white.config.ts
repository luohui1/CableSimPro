import {defineConfig} from '@playwright/test';
import common from './playwright.config';
// Same real-backend tests, one focused verification lane; no mocks or retries.
export default defineConfig({...common,projects:common.projects?.filter(p=>p.name==='chromium'||p.name==='webkit').map(p=>({...p,testMatch:['white-workbench.spec.ts','light-studio.spec.ts','dual-mode.spec.ts','engineering-pulse.spec.ts']})),outputDir:'test-results-white',reporter:[['list'],['junit',{outputFile:'test-results-white/white-tests.xml'}],['html',{open:'never',outputFolder:'playwright-report-white'}]]});
