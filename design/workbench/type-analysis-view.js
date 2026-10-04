'use strict';
// Presentation only: every engineering value and curve point is a sealed plugin output.
window.TypeAnalysisView=(()=>{
  let H,curveObserver,curveRender;
  function mount(){curveObserver?.disconnect();const el=H.$('.analysis-curve-plot');if(!el||!curveRender)return;const draw=()=>{if(el.isConnected)el.innerHTML=curveRender(el.clientWidth,el.clientHeight);};draw();curveObserver=new ResizeObserver(draw);curveObserver.observe(el);}
  const E=v=>H.esc(v),ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
  const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b)),suffix=r=>r.id.split(':').at(-1),plain=r=>r.title.replace(/^芯\s*\d+\s*·\s*/,'');
  const labels={conductor:'导体',metallic_screen:'金属屏蔽',metallic_sheath:'金属护套'},states={available:'已计算',missing:'缺项',uncovered:'范围外',not_applicable:'超出范围'};
  const units={'A':[.001,'kA',3],'A/m':[1000,'A/km',3],'Ω/m':[1000,'Ω/km',4],'F/m':[1e9,'μF/km',3],'H/m':[1e6,'mH/km',3],'W/m':[1000,'W/km',3]};
  function number(value,digits=3){return Number.isFinite(value)?H.groupNumber(value.toPrecision(digits)):'—';}
  function value(row,showUnit=true,full=false){if(!row||!Number.isFinite(row.value))return '—';const [scale,unit,digits]=units[row.unit]||[1,row.unit==='1'?'':row.unit,3];const text=full?String(row.value*scale):row.unit==='1'?row.value.toFixed(3):number(row.value*scale,digits);return text+(showUnit&&unit?' '+unit:'');}
  const sourceDocument=run=>run?.snapshot.cases[0]?.input;
  function identical(a,run){
    const d=sourceDocument(run),c=d?.cable_types?.find(c=>c.id===a.cable_type_id);if(c?.cores.length!==3)return false;
    const physical=core=>({conductor:core.conductor,layers:core.layers,observations:(d.measurements||[]).filter(m=>m.core===core.id).map(({id,core,...data})=>data)});
    const signature=core=>a.rows.filter(r=>r.target.core_id===core.id).map(({id,title,target,...data})=>({key:suffix({id}),...data,target:{...target,core_id:null}}));
    return c.cores.slice(1).every(core=>same(physical(core),physical(c.cores[0]))&&same(signature(core),signature(c.cores[0])));
  }
  function records(a,run){
    const d=sourceDocument(run),c=d?.cable_types?.find(c=>c.id===a.cable_type_id),merged=identical(a,run),first=c?.cores[0]?.id;
    return a.rows.flatMap((r,index)=>merged&&r.target.core_id&&r.target.core_id!==first?[]:[{...r,index,title:merged&&r.target.core_id?'芯 1–3（相同） · '+plain(r):r.title}]);
  }
  function components(a,run){
    const list=records(a,run),groups=[];
    for(const r of list){if(!/-adiabatic$|-nonadiabatic$|-factor$/.test(suffix(r)))continue;
      const key=(r.target.core_id||'common')+':'+r.target.role;let g=groups.find(g=>g.key===key);
      if(!g){const prefix=r.title.startsWith('芯 1–3')?'芯 1–3（相同） · ':r.title.match(/^芯\s*\d+\s*·\s*/)?.[0]||'';g={key,label:prefix+(labels[r.target.role]||'金属组件'),records:{},index:r.index};groups.push(g);}
      g.records[suffix(r).endsWith('-nonadiabatic')?'nonadiabatic':suffix(r).endsWith('-adiabatic')?'adiabatic':'factor']=r;
    }
    return groups;
  }
  function snapshotParameters(run){return run?.snapshot.definition.parameters||{};}
  function conclusion(a,run,module){
    if(!a)return '尚未计算。';const p=snapshotParameters(run),shown=records(a,run);
    if(module==='short-circuit'){
      const rows=shown.filter(r=>suffix(r)==='conductor-adiabatic'),available=rows.filter(r=>r.status==='available');
      const condition=Number.isFinite(p.initial_temperature_k)&&Number.isFinite(p.final_temperature_k)?`${H.fmt(p.initial_temperature_k-273.15,1)}→${H.fmt(p.final_temperature_k-273.15,1)} °C`:'温度待补';
      const time=p.duration_s==null?'持续时间待补':H.fmt(p.duration_s,3)+' s';
      const metals=shown.filter(r=>r.target.role!=='conductor'&&suffix(r).endsWith('-adiabatic'));
      const tail=metals.length&&!metals.some(r=>r.status!=='available')?'；金属组件分别列出':'';
      if(!available.length)return '导体短路容量尚无数值，请查看校核项。';
      const values=available.map(r=>r.value),range=values.every(v=>v===values[0])?value(available[0]):`${number(Math.min(...values)*.001)}–${number(Math.max(...values)*.001)} kA`;
      return `导体 ${time}可承受 ${range}（每芯，${condition}，绝热）${tail}。`;
    }
    const ac=shown.filter(r=>suffix(r)==='ac'&&r.status==='available'),cap=shown.find(r=>suffix(r)==='capacitance'&&r.status==='available');
    const temp=p.temperature_k==null?'工作温度待补':H.fmt(p.temperature_k-273.15,1)+' °C';
    if(!ac.length)return `交流电阻尚无数值（${temp}），请查看校核项。`;
    const values=ac.map(r=>r.value),resistance=values.every(v=>v===values[0])?value(ac[0]):`${number(Math.min(...values)*1000,4)}–${number(Math.max(...values)*1000,4)} Ω/km`;
    return `${temp}交流电阻 ${resistance}${cap?'；每相电容 '+value(cap):''}。`;
  }
  function conditions(run,module,current){const p=snapshotParameters(run),temperature=k=>p[k]==null?'待补':H.fmt(p[k]-273.15,1)+' °C';const text=module==='short-circuit'?`导体 ${temperature('initial_temperature_k')} → ${temperature('final_temperature_k')} · ${p.duration_s==null?'持续时间待补':H.fmt(p.duration_s,3)+' s'} · 绝热 / 非绝热对照`:`工作温度 ${temperature('temperature_k')} · ${p.frequency_hz==null?'频率待补':H.fmt(p.frequency_hz,2)+' Hz'} · ${p.phase_voltage_v==null?'运行相电压待补':H.fmt(p.phase_voltage_v/1000,3)+' kV 相电压'}`;
    return `<div class="analysis-conditions"><span>${E(text)}</span><span class="spacer"></span><span id="analysis-freshness" class="${current?'':'warning'}">${current?'当前结果':'历史结果'}</span></div>`;}
  function selectedCell(g,selected){return Object.values(g.records).some(r=>r.index===selected);}
  function rowStatus(g){const a=g.records.adiabatic,n=g.records.nonadiabatic;if(a?.status==='available'&&n?.status==='available')return '已计算';if(a?.status==='available')return '绝热已计算 · 非绝热'+(states[n?.status]||'待补');return states[a?.status||n?.status]||'待补数据';}
  function results({a,run,module,selected,current,curveComponent,curvePoint}){
    curveObserver?.disconnect();curveRender=null;
    if(!a)return '<div class="study-empty"><h3>尚无计算快照</h3><p>保存方法条件后计算。</p></div>';
    let table;
    if(module==='short-circuit'){
      const groups=components(a,run),extra=records(a,run).find(r=>suffix(r)==='parallel-fault-sharing');
      table=`<table class="standard-table analysis-short-table"><thead><tr><th>组件</th><th>绝热 / kA</th><th>修正因数 ε</th><th>非绝热 / kA</th><th>状态</th></tr></thead><tbody>${groups.map(g=>`<tr data-action="type-electrical-row:${g.index}" tabindex="0" aria-label="${E(g.label)}的计算依据" class="${selectedCell(g,selected)?'selected':''}"><td>${E(g.label)}</td><td class="number">${E(value(g.records.adiabatic,false))}</td><td class="number">${E(value(g.records.factor,false))}</td><td class="number">${E(value(g.records.nonadiabatic,false))}</td><td>${E(rowStatus(g))}</td></tr>`).join('')}${extra?`<tr data-action="type-electrical-row:${extra.index}" tabindex="0"><td>并联金属总容量</td><td class="number">—</td><td class="number">—</td><td class="number">—</td><td>未覆盖</td></tr>`:''}</tbody></table>`;
    }else table=`<table class="standard-table"><thead><tr><th>参数</th><th>数值</th><th>性质</th><th>状态</th><th>依据</th></tr></thead><tbody>${records(a,run).map(r=>`<tr data-action="type-electrical-row:${r.index}" tabindex="0" aria-label="${E(r.title)}的计算依据" class="${selected===r.index?'selected':''}"><td>${E(r.title)}</td><td class="number">${E(value(r))}</td><td>${E({derived:'推导值',design:'设计值',measurement:'实测值',manufacturer_limit:'厂家声明上限',unknown:'未明确'}[r.basis]||r.basis)}</td><td>${states[r.status]}</td><td><span>${E(r.standard)}</span><small>${E(r.clause)}</small></td></tr>`).join('')}</tbody></table>`;
    return `<p class="analysis-conclusion" id="analysis-conclusion">${E(conclusion(a,run,module))}</p>${conditions(run,module,current)}<div class="standard-table-scroll analysis-details">${table}</div>${module==='short-circuit'?curve(a,run,curveComponent,curvePoint,current):''}`;
  }
  function curve(a,run,selected,point,current){
    const data=a.curve,groups=components(a,run);if(!data)return '<div class="analysis-curve-empty">此快照未包含时间曲线；更新计算可生成。</div>';
    const group=groups.find(g=>g.key===selected)||groups[0];if(!group)return '';
    const series=data.series.filter(s=>Object.values(group.records).some(r=>r.id===s.row_id)),available=series.filter(s=>s.values_a.some(Number.isFinite));
    const choice=`<select data-analysis-curve-component aria-label="曲线组件">${groups.map(g=>`<option value="${E(g.key)}" ${g.key===group.key?'selected':''}>${E(g.label)}</option>`).join('')}</select>`;
    const head=`<div class="analysis-curve-head"><h3>短路电流—持续时间</h3>${choice}<span class="spacer"></span><span>0.1–5 s · 对数横轴${current?'':' · 历史'}</span></div>`;
    if(!available.length)return `<section class="analysis-curve">${head}<p class="analysis-curve-empty">该组件缺少完整输入，未生成曲线。</p></section>`;
    const pointChoices=data.times_s.filter(t=>data.highlighted_times_s.includes(t)),active=Number.isInteger(point)&&point>=0&&point<data.times_s.length?point:data.times_s.indexOf(data.selected_time_s);
    const readout=active<0?'选择采样点查看完整数值':`${H.fmt(data.times_s[active],4)} s · `+available.map(s=>(s.model==='adiabatic'?'绝热 ':'非绝热 ')+number(s.values_a[active]*.001)+' kA').join(' · ');
    curveRender=(w,h)=>{
    const peak=Math.max(...available.flatMap(s=>s.values_a.filter(Number.isFinite)))*.001,rough=Math.max(peak*1.08/4,.25),magnitude=10**Math.floor(Math.log10(rough)),step=Math.max(1,[1,2,3,5,10].find(n=>n*magnitude>=rough)*magnitude),max=Math.max(step,Math.ceil(peak/step)*step),left=56,right=24,top=20,bottom=44,plotW=w-left-right,plotH=h-top-bottom;
    const x=t=>left+Math.log(t/.1)/Math.log(50)*plotW,y=i=>top+plotH-i*.001/max*plotH;
    const xticks=[.1,.2,.5,1,2,5],yticks=Array.from({length:Math.round(max/step)+1},(_,i)=>i*step);
    const paths=available.map(s=>{let line='',connected=false;for(let i=0;i<data.times_s.length;i++){const value=s.values_a[i];if(!Number.isFinite(value)){connected=false;continue;}line+=(connected?'L':'M')+x(data.times_s[i]).toFixed(2)+','+y(value).toFixed(2);connected=true;}return `<path class="analysis-curve-line ${s.model==='nonadiabatic'?'nonadiabatic':''}" d="${line}"/>`;}).join('');
    const marks=available.flatMap(s=>data.times_s.flatMap((t,i)=>data.highlighted_times_s.includes(t)&&Number.isFinite(s.values_a[i])?[`<circle class="analysis-curve-mark ${s.model==='nonadiabatic'?'nonadiabatic':''}" cx="${x(t)}" cy="${y(s.values_a[i])}" r="4"/>`]:[])).join('');
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${E(group.label)}的短路电流持续时间曲线，横轴为对数时间，纵轴为kA">${yticks.map(t=>`<line class="analysis-curve-grid" x1="${left}" x2="${w-right}" y1="${top+plotH-t/max*plotH}" y2="${top+plotH-t/max*plotH}"/><text class="analysis-curve-tick" x="${left-12}" y="${top+plotH-t/max*plotH+4}" text-anchor="end">${Math.round(t)}</text>`).join('')}${xticks.map(t=>`<line class="analysis-curve-grid" x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${top+plotH}"/><text class="analysis-curve-tick" x="${x(t)}" y="${h-20}" text-anchor="middle">${t}</text>`).join('')}<text class="analysis-curve-tick" x="${left}" y="14">kA</text><text class="analysis-curve-tick" x="${w-right}" y="${h-2}" text-anchor="end">持续时间 / s</text>${paths}${marks}${active>=0?`<line class="analysis-curve-cursor" x1="${x(data.times_s[active])}" x2="${x(data.times_s[active])}" y1="${top}" y2="${top+plotH}"/>`:''}${data.times_s.map((t,i)=>`<rect class="analysis-curve-hit" data-action="type-electrical-curve-point:${i}" x="${x(t)-8}" y="${top}" width="16" height="${plotH}"><title>${E(H.fmt(t,6)+' s；'+available.map(s=>(s.model==='adiabatic'?'绝热 ':'非绝热 ')+String(s.values_a[i])+' A').join('；'))}</title></rect>`).join('')}</svg>`;};
    return `<section class="analysis-curve">${head}<div class="analysis-curve-plot"></div><div class="analysis-curve-key"><span class="analysis-curve-swatch"></span><span>绝热</span><span class="analysis-curve-swatch nonadiabatic"></span><span>非绝热</span><span class="spacer"></span><select data-analysis-curve-point aria-label="关注时间点"><option value="">关注时间点</option>${pointChoices.map(t=>`<option value="${data.times_s.indexOf(t)}" ${data.times_s[active]===t?'selected':''}>${H.fmt(t,4)} s</option>`).join('')}</select></div><p class="analysis-curve-readout number">${E(readout)}${data.selected_time_s!=null&&!data.selected_time_in_range?'；当前计算时间在图域外':''}</p></section>`;
  }
  function precision(a,run,index){const row=a.rows[index],group=components(a,run).find(g=>Object.values(g.records).some(r=>r.index===index));if(group)return `<div class="inspector-section"><h3>完整计算精度</h3><dl class="standard-detail">${[['adiabatic','绝热'],['factor','非绝热修正因数'],['nonadiabatic','非绝热']].map(([key,label])=>`<dt>${label}</dt><dd class="number">${E(value(group.records[key],true,true))}</dd>`).join('')}</dl><p class="subtle">${E(group.label)}</p></div>`;return `<div class="inspector-section"><h3>完整计算精度</h3><p class="number">${E(value(row,true,true))}</p></div>`;}
  return {init:h=>{H=h;},mount,value,records,components,conclusion,results,precision};
})();
