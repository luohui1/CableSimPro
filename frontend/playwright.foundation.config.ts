import {defineConfig} from '@playwright/test';
import common from './playwright.config';
export default defineConfig({...common, projects: common.projects?.filter(p=>p.name==='chromium').map(p=>({...p,testMatch:['study-preflight.spec.ts']})), outputDir:'test-results-foundation', reporter:[['list'],['junit',{outputFile:'test-results-foundation/foundation-browser.xml'}]]});
