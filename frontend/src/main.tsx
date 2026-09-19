import {createRoot} from 'react-dom/client';
import {lazy,Suspense} from 'react';
const WorkflowApp=lazy(()=>import('./workflow/WorkflowApp'));
const LegacyEntry=lazy(()=>import('./LegacyEntry'));
const workflow=new URLSearchParams(location.search).get('workflow')==='1';
createRoot(document.getElementById('root')!).render(<Suspense fallback={<p>正在打开工程…</p>}>{workflow?<WorkflowApp/>:<LegacyEntry/>}</Suspense>);
