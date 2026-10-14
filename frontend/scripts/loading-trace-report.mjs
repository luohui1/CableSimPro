import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

/** Correlate renderer samples, network timestamps and the outer ASGI sender. */
export async function loadingTraceReport(directory, serverFile, dist) {
  const files=(await fs.readdir(directory)).filter(f=>/-(cold|hot)\.json$/.test(f));
  const server=(await fs.readFile(serverFile,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const maps=new Map(), reports=[];
  async function mapped(frame) {
    if(!frame?.url)return frame;
    try {
      const name=new URL(frame.url).pathname.slice(1)+'.map';
      if(!maps.has(name))maps.set(name,new TraceMap(JSON.parse(await fs.readFile(path.join(dist,name),'utf8'))));
      return {...frame,original:originalPositionFor(maps.get(name),{line:frame.lineNumber+1,column:frame.columnNumber})};
    } catch{return frame;}
  }
  for(const file of files) {
    const page=JSON.parse(await fs.readFile(path.join(directory,file),'utf8'));
    const profile=JSON.parse(await fs.readFile(path.join(directory,file.replace('.json','-cpu.json')),'utf8'));
    const timeline=JSON.parse(await fs.readFile(path.join(directory,file.replace('.json','-timeline.json')),'utf8')).traceEvents;
    const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map();
    for(const n of profile.nodes)for(const id of n.children||[])parents.set(id,n.id);
    const document=page.requests.find(r=>(!r.type||r.type==='Document')&&new URL(r.url).pathname===new URL('http://localhost'+page.route.path).pathname);
    if(!document)throw Error(`找不到导航请求：${file}`);
    // CDP wall/monotonic clocks and performance.timeOrigin refer to different origins.
    const origin=document.start*1000+page.observed.timeOrigin-document.wall*1000;
    const commit=timeline.find(e=>e.name==='CommitLoad'&&e.args?.data?.isMainFrame&&e.args.data.url===document.url);
    const rendererThreads=timeline.filter(e=>e.ph==='M'&&e.name==='thread_name'&&e.args?.name==='CrRendererMain');
    const renderer=commit|| (rendererThreads.length===1?rendererThreads[0]:null);
    const samples=[];let timestamp=profile.startTime;
    for(let i=0;i<(profile.samples||[]).length;i++){const duration=profile.timeDeltas[i];samples.push({start:timestamp/1000,end:(timestamp+duration)/1000,id:profile.samples[i]});timestamp+=duration;}
    const tasks=[];
    for(const task of page.observed.longTasks) {
      const start=origin+task.startMs,end=start+task.durationMs,totals=new Map();
      for(const sample of samples) {
        const overlap=Math.min(end,sample.end)-Math.max(start,sample.start);if(overlap<=0)continue;
        const node=nodes.get(sample.id);if(!node)continue;
        const prior=totals.get(node.id)||{node,selfMs:0};prior.selfMs+=overlap;totals.set(node.id,prior);
      }
      const stack=async id=>{const rows=[];while(id&&rows.length<10){rows.push(await mapped(nodes.get(id)?.callFrame));id=parents.get(id);}return rows;};
      const top=await Promise.all([...totals.values()].sort((a,b)=>b.selfMs-a.selfMs).slice(0,8).map(async v=>({selfMs:Math.round(v.selfMs),frame:await mapped(v.node.callFrame),stack:await stack(v.node.id)})));
      const slices=renderer?timeline.filter(e=>e.ph==='X'&&e.pid===renderer.pid&&e.tid===renderer.tid&&e.ts/1000>=start&&e.ts/1000<end&&['Layout','UpdateLayoutTree','EvaluateScript','FunctionCall','CompileScript','ParseHTML','MinorGC','MajorGC'].includes(e.name)).map(e=>({name:e.name,ms:e.dur/1000,args:e.args})):[];
      tasks.push({...task,top,slices,rendererIdentified:!!renderer});
    }
    const network=page.observed.resources.map(r=>{
      const url=new URL(r.name),epoch=page.observed.timeOrigin/1000+r.requestStart/1000;
      const request=page.requests.filter(q=>q.url===r.name).sort((a,b)=>Math.abs(a.wall*1000-page.observed.timeOrigin-r.startTime)-Math.abs(b.wall*1000-page.observed.timeOrigin-r.startTime))[0];
      const candidates=server.filter(s=>s.path===url.pathname&&s.query===url.search.slice(1));
      const closest=candidates.sort((a,b)=>Math.abs(a.start-epoch)-Math.abs(b.start-epoch))[0];
      // A cached response has no new ASGI send. Do not attach a previous visit's
      // same-URL request when a precise current request cannot be matched.
      const sent=!request?.cache&&closest&&Math.abs(closest.start-epoch)<1?closest:null;
      return {url:url.pathname+url.search,stage:r.startTime>page.observed.mainMs?'after-body':'first-screen',startMs:r.startTime,ttfbMs:r.responseStart-r.requestStart,receiveMs:r.responseEnd-r.responseStart,queuedMs:r.requestStart-r.fetchStart,bytes:r.decodedBodySize,encoding:request?.headers?.['content-encoding']||r.contentEncoding||null,
        wireReceiveMs:request?.end&&request?.timing?.receiveHeadersEnd>=0?(request.end-request.timing.requestTime-request.timing.receiveHeadersEnd/1000)*1000:null,
        dataNotificationsMs:request?.lastData&&request?.firstData?(request.lastData-request.firstData)*1000:null,
        asgi:sent?{startMs:sent.start*1000-page.observed.timeOrigin,firstBodyMs:sent.first_body*1000-page.observed.timeOrigin,lastBodyMs:sent.last_body*1000-page.observed.timeOrigin,bodySpanMs:(sent.last_body-sent.first_body)*1000,bytes:sent.bytes,bodies:sent.bodies,encoding:sent.response_headers?.['content-encoding']||null}:null};
    });
    const report={page:page.route,phase:page.phase,browserIdentity:page.browserIdentity||null,clockAnchor:{documentUrl:document.url,monotonicOriginMs:origin,documentOffsetMs:document.start*1000-origin},mainMs:page.observed.mainMs,frameMs:page.observed.frameMs,tasks,network};
    await fs.writeFile(path.join(directory,file.replace('.json','-attribution.json')),JSON.stringify(report,null,2));
    reports.push(report);
  }
  const frame=f=>f?.original?.source?`${f.original.source.split('/frontend/').at(-1)}:${f.original.line} ${f.original.name||f.functionName}`:`${f?.functionName||'原生/未知'}`;
  let text='# 实际加载归因\n\nCPU 采样与 Chrome timeline 会增加开销，正文预算另用无 profiler 的 performance 巡检测量。ASGI 发送、浏览器网络与 renderer Resource Timing 独立记录，不把数据通知延迟冒称服务端计算。\n';
  for(const r of reports){text+=`\n## ${r.page.name} · ${r.phase}\n\n正文 ${r.mainMs.toFixed(1)} ms；首帧 ${r.frameMs?.toFixed(1)??'无'} ms。\n\n| 长任务起点 / 耗时 ms | 主要采样位置 | 布局 ms |\n|---|---|---|\n`;for(const t of r.tasks)text+=`| ${t.startMs.toFixed(1)} / ${t.durationMs} | ${t.top.slice(0,4).map(v=>frame(v.frame)+' '+v.selfMs+' ms').join('；')} | ${t.rendererIdentified?t.slices.filter(s=>s.name==='Layout'||s.name==='UpdateLayoutTree').reduce((n,s)=>n+s.ms,0).toFixed(1):'主线程未识别'} |\n`;
    text+='\n| 请求 / 阶段 | 起点 ms | 排队 ms | TTFB ms | 接收 ms | 网络完成 ms | ASGI 输出跨度 ms / body 数 |\n|---|---|---|---|---|---|---|\n';for(const n of r.network.filter(n=>n.url.startsWith('/api/')||n.receiveMs>100))text+=`| ${n.url} · ${n.stage} | ${n.startMs.toFixed(1)} | ${n.queuedMs.toFixed(1)} | ${n.ttfbMs.toFixed(1)} | ${n.receiveMs.toFixed(1)} | ${n.wireReceiveMs?.toFixed(1)??'—'} | ${n.asgi?n.asgi.bodySpanMs.toFixed(1)+' / '+n.asgi.bodies:'静态资源 / 缓存'} |\n`;
  }
  await fs.writeFile(path.join(directory,'attribution.md'),text);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await loadingTraceReport(...process.argv.slice(2));
