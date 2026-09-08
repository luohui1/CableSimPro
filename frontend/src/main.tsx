import {createRoot} from 'react-dom/client';
import {lazy,Suspense} from 'react';
import EngineeringWorkspace from './EngineeringWorkspace';
const LegacyStudio=lazy(()=>import('./Studio'));
const legacy=new URLSearchParams(location.search).get('legacy')==='1';
createRoot(document.getElementById('root')!).render(legacy?<Suspense fallback={<p>正在打开迁移界面…</p>}><LegacyStudio/></Suspense>:<EngineeringWorkspace/>);
