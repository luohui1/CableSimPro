'use strict';
window.ReproductionLibrary=(()=>{
  let H, token=0, controller, catalog=null, detail=null, phase='loading', failure='', prefs={query:'',kind:'all',status:'all'}, undo=[];
  const kinds={paper:'论文',standard:'标准算例',comsol:'COMSOL 教程',benchmark:'教学基准'};
  const statuses={reproduced:'已复现',partial:'部分',missing_data:'缺资料',capability_gap:'能力缺口'};
  const tabs={results:'结果对照',overlay:'曲线叠加',convergence:'网格收敛',sources:'输入来源',scope:'覆盖与限制'};
  const quantityNames={series_resistance_ohm_m:'线对交流电阻',current_rms_a:'电流',current_density_rms:'电流密度',current_density_phase:'电流密度相位',magnetic_flux_density_rms:'磁通密度',magnetic_flux_density_integrated_rms:'磁通密度 · 分布电流积分',maximum_temperature_k:'最高温度',probe_temperature_k:'测点温度',ampacity_a:'允许电流',lambda1:'护套损耗系数',sheath_joule_loss:'护套损耗',sheath_voltage_peak:'护套峰值电压',conductor_loss:'导体损耗',screen_loss:'屏蔽损耗',armor_loss:'铠装损耗'};
  const handles=path=>/^\/library\/reproductions(?:\/|\?|$)/.test(path);
  const routeParts=()=>H.state.route.split('?')[0].split('/').filter(Boolean);
  const snapshot=()=>new URLSearchParams(H.state.route.split('?')[1]||'').get('snapshot');
  const suffix=()=>snapshot()?'?snapshot='+snapshot():'';
  const e=value=>H.esc(typeof value==='string'?value:JSON.stringify(value??''));
  const shortName=item=>item.short_title||item.title;
  Object.assign(quantityNames,{conductor_temperature_k:'导体温度',conductor_mean_temperature:'导体平均温度',screen_mean_temperature:'屏蔽平均温度',armor_mean_temperature:'铠装平均温度',fiber_mean_temperature:'光纤钢管平均温度',conductor_loss_w_m:'导体损耗',screen_loss_w_m:'铜丝屏蔽损耗',sheath_loss_w_m:'护套损耗',armour_loss_w_m:'铠装损耗',foil_loss_w_m:'铝箔损耗',fiber_loss:'光纤钢管损耗',total_loss_w_m:'总损耗',ac_resistance_ohm_m:'交流电阻',cross_section_area:'截面面积'});
  const title=row=>{const key=row.quantity||'',matrix=/^(floating|grounded)-C(\d)(\d)$/.exec(key),thermal=/^phase(\d)-mean-temperature$/.exec(key);if(matrix)return `${matrix[1]==='floating'?'护套浮置':'护套接地'} · C${matrix[2]}${matrix[3]}`;if(thermal)return `相${thermal[1]}平均温度`;return ({'maximum-temperature':'最高温度','air-pocket-mean-temperature':'空气腔平均温度'})[key]||quantityNames[key]||key||row.id;};
  const variantName=value=>({default:'基准工况','full-field':'完整截面',dry:'干土',wet:'湿土',single_point:'单点接地',both_ends:'双端接地',cross_bonded:'交叉互联',trefoil:'三叶形',flat:'平排',case1:'单根通流',case2:'同相电流',case3:'反相电流'})[value]||value;
  const status=item=>`<span class="rep-state ${item.status}"><i aria-hidden="true"></i>${statuses[item.status]||item.status}</span>`;
  function converted(value,unit,quantity=''){
    if(unit==='K'&&/temperature/.test(quantity))return {value:value-273.15,unit:'°C'};
    const conversion={T:[1e6,'μT'],'ohm/m':[1e6,'μΩ/m'],'F/m':[1e12,'pF/m'],'A/m^2':[1e-3,'kA/m²'],'m^2':[1e6,'mm²'],deg:[1,'°']};
    const [scale,u]=conversion[unit]||[1,unit];return {value:value*scale,unit:u};
  }
  const numeric=value=>!Number.isFinite(value)?'—':value!==0&&(Math.abs(value)<.001||Math.abs(value)>=1e6)?value.toExponential(3):new Intl.NumberFormat('zh-CN',{minimumFractionDigits:3,maximumFractionDigits:3}).format(Object.is(value,-0)?0:value);
  function display(value,unit,quantity=''){
    if(!Number.isFinite(value))return '—';const shown=converted(value,unit,quantity);
    return `<span title="${e('原始值：'+value+' '+unit)}">${numeric(shown.value)}</span>${shown.unit&&shown.unit!=='1'?` <span class="rep-unit">${e(shown.unit)}</span>`:''}`;
  }
  const percent=value=>Number.isFinite(value)?numeric(value*100)+'%':'—';
  const time=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'无记录';
  function visible(){return (catalog?.items||[]).filter(i=>(prefs.kind==='all'||i.kind===prefs.kind)&&(prefs.status==='all'||i.status===prefs.status)&&`${i.id} ${shortName(i)} ${i.title} ${i.citation}`.toLowerCase().includes(prefs.query.trim().toLowerCase())).sort((a,b)=>Number(b.has_results)-Number(a.has_results)||a.id.localeCompare(b.id));}
  function remember(){undo.push({...prefs});if(undo.length>40)undo.shift();}
  function savePreferences(){try{localStorage.setItem('csp-reproduction-view',JSON.stringify(prefs));}catch{H.notify('浏览器未保存筛选偏好，当前结果仍可查看。');}}
  function filters(){return `<form id="rep-filter" class="rep-filters" role="search"><label><span>检索</span><input type="search" id="rep-query" aria-label="搜索论文、作者或编号" placeholder="论文、作者或编号" value="${e(prefs.query)}"></label><label><span>类型</span><select id="rep-kind" aria-label="来源类型"><option value="all">全部类型</option>${Object.entries(kinds).map(([k,v])=>`<option value="${k}" ${prefs.kind===k?'selected':''}>${v}</option>`).join('')}</select></label><label><span>状态</span><select id="rep-status" aria-label="复现状态"><option value="all">全部状态</option>${Object.entries(statuses).map(([k,v])=>`<option value="${k}" ${prefs.status===k?'selected':''}>${v}</option>`).join('')}</select></label><button type="submit">检索</button>${H.button('重置','','rep-reset','class="quiet"')}</form>`;}
  function summary(){
    return Object.entries(kinds).map(([kind,label])=>{const all=(catalog?.items||[]).filter(i=>i.kind===kind&&i.count_as_source),done=all.filter(i=>i.has_results&&i.status==='reproduced').length,partial=all.filter(i=>i.has_results&&i.status==='partial').length;return `<span>${label} <strong>${done}</strong> 已复现 · <strong>${partial}</strong> 部分</span>`;}).join('');
  }
  function statusOverview(){
    const items=(catalog?.items||[]).filter(i=>(prefs.kind==='all'||i.kind===prefs.kind)&&`${i.id} ${shortName(i)} ${i.title} ${i.citation}`.toLowerCase().includes(prefs.query.trim().toLowerCase()));
    return `<div class="rep-overview" role="group" aria-label="状态总览与快速筛选">${Object.entries({all:'全部',...statuses}).map(([key,label])=>`<button type="button" data-rep-status="${key}" aria-pressed="${prefs.status===key}">${label}<strong>${items.filter(i=>key==='all'||i.status===key).length}</strong></button>`).join('')}</div>`;
  }
  function conclusion(){
    const relative=detail.rows.filter(r=>Number.isFinite(r.relative_difference));
    const absolute=detail.rows.filter(r=>Number.isFinite(r.difference)&&r.unit==='K');
    const original=relative.length?`对原文最大偏差 ${percent(Math.max(...relative.map(r=>Math.abs(r.relative_difference))))}`:absolute.length?`对原文最大温差 ${display(Math.max(...absolute.map(r=>Math.abs(r.difference))),'K')}`:'原文数值对照未齐';
    const native=[Number.isFinite(detail.max_comsol_deviation)?`对 COMSOL 最大相对偏差 ${percent(detail.max_comsol_deviation)}`:'',Number.isFinite(detail.max_comsol_temperature_difference_k)?`对 COMSOL 最大温差 ${display(detail.max_comsol_temperature_difference_k,'K')}`:''].filter(Boolean).join(' · ')||'COMSOL 对照未齐';
    const text=detail.status==='reproduced'?'声明范围内已复现':detail.status==='partial'?'已有部分结果，覆盖尚未闭合':detail.status==='missing_data'?'输入资料不全，尚未复现':'求解能力尚未覆盖';
    return `<section class="rep-conclusion" aria-label="复现结论"><strong>${text}</strong><div>${detail.has_results?`<span>${original}</span><span>${native}</span>`:''}<a href="#/library/reproductions/${detail.id}/scope${suffix()}">${detail.status==='reproduced'?'查看验证范围':'查看未覆盖项'}</a></div></section>`;
  }
  function histories(){const current=detail||catalog;return `<label class="rep-history"><span>记录版本</span><select id="rep-snapshot" aria-label="复现库历史版本">${(current?.history||[]).map((r,i)=>`<option value="${i===0?'':r.id}" ${(snapshot()||'')===(i===0?'':r.id)?'selected':''}>${i===0?'当前 · ':'历史 · '}${time(r.created_at)}</option>`).join('')}</select></label>`;}
  function list(){const items=visible();return `<section class="rep-catalog"><div class="rep-heading"><h2>复现库</h2>${histories()}${H.button('刷新','action/refresh','rep-refresh')}</div>${statusOverview()}<div class="rep-counts" aria-label="按来源分类统计">${summary()}</div>${filters()}<div class="rep-table-scroll">${items.length?`<table class="rep-table" aria-label="复现目标"><thead><tr><th>目标 / 来源</th><th>类型</th><th>状态</th><th class="number">对原文最大偏差</th><th class="number">对 COMSOL 偏差</th></tr></thead><tbody>${items.map(i=>`<tr data-rep-id="${e(i.id)}" tabindex="0" aria-label="${e(i.id+' '+shortName(i))}"><td><a title="${e(i.title)}" href="#/library/reproductions/${encodeURIComponent(i.id)}/results${suffix()}"><span class="rep-id">${e(i.id)}</span>${e(shortName(i))}</a><small>${e(i.scope)}</small></td><td>${kinds[i.kind]}</td><td>${status(i)}</td><td class="number">${percent(i.max_relative_deviation)}</td><td class="number">${Number.isFinite(i.max_comsol_deviation)?percent(i.max_comsol_deviation):display(i.max_comsol_temperature_difference_k,'K')}</td></tr>`).join('')}</tbody></table>`:`<div class="rep-empty"><h3>没有符合条件的目标</h3><p>调整关键词或状态筛选。</p>${H.button('清除筛选','','rep-reset')}</div>`}</div><div class="rep-foot"><span>${items.length} / ${catalog.items.length} 个目标</span><span>按独立来源统计；网格和工况不重复计数，教学与几何验证单列</span></div></section>`;}
  function rail(){return `<nav class="rep-rail" aria-label="复现目标目录"><a class="rep-back" href="#/library/reproductions${suffix()}">${H.icon('action/chevron-down')}全部目标</a>${Object.entries(kinds).map(([kind,label])=>{const rows=visible().filter(i=>i.kind===kind);return rows.length?`<section><h3>${label}</h3>${rows.map(i=>`<a title="${e(i.title)}" href="#/library/reproductions/${encodeURIComponent(i.id)}/results${suffix()}" ${i.id===detail.id?'aria-current="page"':''}><span class="rep-id">${e(i.id)}</span><span>${e(shortName(i))}</span></a>`).join('')}</section>`:'';}).join('')}</nav>`;}
  function comparison(){return detail.rows.length?`<div class="rep-table-scroll"><table class="rep-table rep-result-table" aria-label="论文、开源与COMSOL结果对照"><thead><tr><th>量 / 工况</th><th class="number">${({paper:'论文原文',standard:'标准印刷值',comsol:'教程原文',benchmark:'参考值'})[detail.kind]}</th><th class="number">开源结果</th><th class="number">COMSOL 结果</th><th class="number">开源 − 原文</th><th class="number">相对偏差</th><th class="number">对 COMSOL</th></tr></thead><tbody>${detail.rows.map(r=>`<tr><td>${e(title(r))}<small>${e(variantName(r.variant))}${r.entity?' · '+e(r.entity):''}${Number.isInteger(r.probe_index)?' · 测点 '+(r.probe_index+1):''}</small></td><td class="number">${r.reference_approximate?'≈ ':''}${display(r.reference,r.unit,r.quantity)}</td><td class="number">${display(r.open_source,r.unit,r.quantity)}</td><td class="number">${display(r.comsol,r.unit,r.quantity)}</td><td class="number">${display(r.difference,r.unit==='K'?'K':r.unit)}</td><td class="number ${r.status==='outside_tolerance'?'warning':''}">${percent(r.relative_difference)}${r.status==='outside_tolerance'?'<small>超出声明容差</small>':''}</td><td class="number">${Number.isFinite(r.comsol_relative_difference)?percent(r.comsol_relative_difference):display(r.comsol_difference,r.unit)}</td></tr>`).join('')}</tbody></table></div><div class="rep-note">${[...new Set(detail.rows.map(r=>r.reason).filter(Boolean))].map(t=>`<p>${e(t)}</p>`).join('')}</div>`:`<div class="rep-empty"><h3>尚无可比较的结果</h3><p>${e(detail.coverage)}</p><a href="#/library/reproductions/${detail.id}/sources${suffix()}">查看输入来源与缺项</a></div>`;}
  function series(){const groups=new Map();for(const row of detail.convergence||[]){if(!Number.isFinite(row.value)||!Number.isFinite(row.nodes))continue;const key=row.variant+' · '+row.quantity;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}return groups;}
  function seriesMetric(group){const first=group[0];return detail.rows.find(r=>r.variant===first.variant&&(r.id.endsWith('/'+first.quantity)||r.quantity===first.quantity))||detail.rows.find(r=>r.quantity===first.quantity)||{quantity:first.quantity,unit:''};}
  function convergence(){const groups=series();if(!groups.size)return `<div class="rep-empty"><h3>无有限元网格序列</h3><p>${e(detail.mesh_note)}</p></div>`;return `<label class="rep-metric"><span>比较量</span><select id="rep-metric" aria-label="收敛曲线比较量">${[...groups.entries()].map(([k,values])=>`<option value="${e(k)}">${e(variantName(values[0].variant)+' · '+title(seriesMetric(values)))}</option>`).join('')}</select></label><div id="rep-chart"></div><p class="rep-note">${e(detail.mesh_note)}</p>`;}
  function overlayGroups(){
    const groups=new Map();for(const row of detail.rows){
      if(!['reference','open_source','comsol'].some(key=>Number.isFinite(row[key])))continue;
      const key=[row.quantity,row.unit,Number.isInteger(row.probe_index)?row.variant:'',Number.isInteger(row.probe_index)?row.entity:''].join('|');
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
    }return groups;
  }
  function overlay(){const groups=overlayGroups();if(!groups.size)return `<div class="rep-empty"><h3>尚无曲线数据</h3><p>取得可比较的原始量值后显示。</p></div>`;
    return `<label class="rep-metric"><span>比较量</span><select id="rep-overlay-metric" aria-label="叠加曲线比较量">${[...groups.entries()].map(([key,rows])=>`<option value="${e(key)}">${e(title(rows[0])+(Number.isInteger(rows[0].probe_index)?' · '+variantName(rows[0].variant)+' · '+rows[0].entity:''))}</option>`).join('')}</select></label><div id="rep-overlay-chart"></div><p class="rep-note">连线仅连接已保存样本；缺失值留空，不生成拟合结果。</p>`;
  }
  function plot(host,metric,points,xlabel,{reference=null,categorical=false}={}){
    const names={reference:'原文参考',open_source:'开源',comsol:'COMSOL'},unit=converted(0,metric.unit,metric.quantity).unit;
    const unchecked=new Set([...host.querySelectorAll('[data-rep-series]')].filter(input=>!input.checked).map(input=>input.dataset.repSeries));
    const available=Object.keys(names).filter(key=>points.some(p=>p.solver===key)||(key==='reference'&&Number.isFinite(reference)));
    const shown=points.filter(p=>!unchecked.has(p.solver));
    const allx=points.map(p=>p.x),xmin=Math.min(...allx),xmax=Math.max(...allx);
    if(Number.isFinite(reference)&&!unchecked.has('reference'))shown.push({solver:'reference',x:xmin,value:reference,referenceLine:true},{solver:'reference',x:xmax,value:reference,referenceLine:true});
    const width=Math.max(320,Math.floor(host.clientWidth)),height=300,pad={left:88,right:24,top:32,bottom:58};
    const ys=shown.map(p=>converted(p.value,metric.unit,metric.quantity).value),low=Math.min(...ys),high=Math.max(...ys),magnitude=Math.max(Math.abs(low),Math.abs(high));
    const resolution=magnitude===0?1e-6:magnitude<.001||magnitude>=1e6?10**(Math.floor(Math.log10(magnitude))-3):.001,padding=Math.max((high-low)*.12,2*resolution),lo=low-padding,hi=high+padding;
    const x=v=>pad.left+(xmax===xmin?.5:(v-xmin)/(xmax-xmin))*(width-pad.left-pad.right),y=v=>height-pad.bottom-(v-lo)/(hi-lo)*(height-pad.top-pad.bottom);
    const grid=shown.length?Array.from({length:5},(_,i)=>{const value=lo+(hi-lo)*i/4;return `<line x1="${pad.left}" y1="${y(value)}" x2="${width-pad.right}" y2="${y(value)}" class="rep-grid"/><text x="${pad.left-12}" y="${y(value)+4}" text-anchor="end">${numeric(value)}</text>`;}).join(''):'';
    const curves=available.map(solver=>{const rows=shown.filter(p=>p.solver===solver).sort((a,b)=>a.x-b.x);if(!rows.length)return '';
      return `<polyline class="rep-curve ${solver}" data-series="${solver}" points="${rows.map(p=>`${x(p.x)},${y(converted(p.value,metric.unit,metric.quantity).value)}`).join(' ')}"/>${rows.filter(p=>!p.referenceLine).map(p=>`<circle class="rep-point ${solver}" cx="${x(p.x)}" cy="${y(converted(p.value,metric.unit,metric.quantity).value)}" r="4"><title>${e(names[solver]+' · '+(p.label||p.x)+' · '+p.value+' '+metric.unit)}</title></circle>`).join('')}`;
    }).join('');
    const ticks=[...new Set(allx)].sort((a,b)=>a-b),stride=Math.max(1,Math.ceil(ticks.length/7));
    const spaced=[];for(const v of ticks.filter((_,i)=>i%stride===0||i===ticks.length-1)){if(v===xmax)while(spaced.length&&x(v)-x(spaced.at(-1))<68)spaced.pop();if(!spaced.length||x(v)-x(spaced.at(-1))>=68)spaced.push(v);}
    const labels=spaced.map(v=>`<text class="rep-x-tick" x="${x(v)}" y="${height-30}" text-anchor="middle">${categorical?v:H.fmt(v,0)}</text>`).join('');
    const legend=`<div class="rep-chart-legend" role="group" aria-label="叠加数据系列">${available.map(key=>`<label><input type="checkbox" data-rep-series="${key}" ${unchecked.has(key)?'':'checked'}><svg viewBox="0 0 28 10" aria-hidden="true"><line x1="0" y1="5" x2="28" y2="5" class="rep-curve ${key}"/></svg>${names[key]}</label>`).join('')}</div>`;
    host.innerHTML=legend+(shown.length?`<svg viewBox="0 0 ${width} ${height}" class="rep-chart" role="img" aria-label="${e(title(metric)+'叠加图；横轴'+xlabel+'，纵轴'+unit)}"><title>${e(title(metric))} · 原文、开源与 COMSOL 叠加</title><text x="${pad.left}" y="18">${e(title(metric)+' / '+unit)}</text>${grid}${curves}${labels}<text x="${width/2}" y="${height-6}" text-anchor="middle">${e(xlabel)}</text></svg>`:'<div class="rep-empty"><p>选择至少一个数据系列。</p></div>');
  }
  function drawChart(){
    const host=H.$('#rep-chart');if(host){const group=series().get(H.$('#rep-metric').value)||[];if(group.length){const metric=seriesMetric(group);
      plot(host,metric,group.map(r=>({...r,x:r.nodes,label:r.nodes+' 节点'})),'网格节点数',{reference:metric.status==='not_comparable'?null:metric.reference});
      host.insertAdjacentHTML('beforeend',`<table class="rep-table" aria-label="网格收敛数据"><thead><tr><th>求解器</th><th class="number">节点数</th><th class="number">网格尺寸</th><th class="number">量值</th></tr></thead><tbody>${group.map(r=>`<tr><td>${r.solver==='comsol'?'COMSOL':'开源'}</td><td class="number">${H.fmt(r.nodes,0)}</td><td class="number">${display(r.mesh_size_m,'m')}</td><td class="number">${display(r.value,metric.unit,metric.quantity)}</td></tr>`).join('')}</tbody></table>`);
    }}
    const over=H.$('#rep-overlay-chart');if(over){const rows=overlayGroups().get(H.$('#rep-overlay-metric').value)||[];if(!rows.length)return;
      const timed=rows.every(r=>Number.isFinite(r.time_s)),points=rows.flatMap((r,i)=>['reference','open_source','comsol'].filter(key=>Number.isFinite(r[key])).map(solver=>({solver,x:timed?r.time_s:i+1,value:r[solver],label:variantName(r.variant)+(r.entity?' · '+r.entity:'')+(Number.isInteger(r.probe_index)?' · 测点 '+(r.probe_index+1):'')})));
      plot(over,rows[0],points,timed?'时间 / s':'样本序号',{categorical:!timed});
      over.insertAdjacentHTML('beforeend',`<table class="rep-table" aria-label="曲线叠加数据"><thead><tr><th>样本 / 工况</th><th class="number">原文</th><th class="number">开源</th><th class="number">COMSOL</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1} · ${e(variantName(r.variant))}${r.entity?' · '+e(r.entity):''}${Number.isInteger(r.probe_index)?' · 测点 '+(r.probe_index+1):''}</td>${['reference','open_source','comsol'].map(key=>`<td class="number">${key==='reference'&&r.reference_approximate?'≈ ':''}${display(r[key],r.unit,r.quantity)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    }
  }
  function sources(){return `<section class="rep-sources"><h3>原始文献与定位</h3><p>${e(detail.citation)}</p>${detail.url?`<a href="${e(detail.url)}" target="_blank" rel="noopener noreferrer">打开原文来源</a>`:''}<p>${e(detail.reference_location)}</p><h3>冻结输入</h3>${detail.inputs.length?detail.inputs.map(i=>`<dl>${Object.entries(i).map(([k,v])=>`<dt>${e(({paths:'输入字段',source:'来源',note:'参数与说明',pdf_page:'PDF页',printed_page:'印刷页'})[k]||k)}</dt><dd>${e(v)}</dd>`).join('')}</dl>`).join(''):'<p>尚未取得可冻结的完整输入。</p>'}<h3>求解与证据</h3>${(detail.runs||[]).map(r=>`<p>${e(r.plugin_id||'')} ${e(r.plugin_version||'')} · ${e(r.method_version||'')}</p>`).join('')}<details><summary>原始记录与摘要</summary>${detail.evidence.map(r=>`<p>${e(r.path)}</p><code>${e(r.sha256)}</code>`).join('')||'<p>暂无求解证据文件。</p>'}</details></section>`;}
  function scope(){return `<section class="rep-sources"><h3>已覆盖范围</h3><p>${e(detail.scope)}</p><h3>限制与偏差原因</h3>${detail.limitations.map(t=>`<p>${e(t)}</p>`).join('')}${detail.assumptions?.length?'<h3>采用的假设</h3>'+detail.assumptions.map(t=>`<p>${e(t)}</p>`).join(''):''}<p>复现状态仅对应上述目标，不构成工程审批或整篇论文所有结论的验证。</p></section>`;}
  function selected(){const tab=routeParts()[3]||'results';return `<div class="rep-detail">${rail()}<section class="rep-main"><div class="rep-detail-heading"><div><h2 title="${e(detail.title)}">${e(shortName(detail))}</h2><div class="rep-meta">${status(detail)}<span>${e(detail.id)} · ${kinds[detail.kind]}</span></div></div>${H.button('导出对照','action/export','rep-export','class="primary" title="导出已保存证据 Ctrl+S"')}</div>${conclusion()}<nav class="rep-tabs" aria-label="复现详情页签">${Object.entries(tabs).map(([k,v])=>`<a href="#/library/reproductions/${detail.id}/${k}${suffix()}" ${tab===k?'aria-current="page"':''}>${v}</a>`).join('')}<span class="spacer"></span>${histories()}</nav><div class="rep-content">${tab==='overlay'?overlay():tab==='convergence'?convergence():tab==='sources'?sources():tab==='scope'?scope():comparison()}</div></section></div>`;}
  function render(){if(!handles(H.state.route))return;
    H.$('#header').innerHTML=`<a href="#/library">库</a><span aria-hidden="true">/</span><a href="#/library/reproductions${suffix()}">复现库</a><span class="spacer"></span>${H.button('快捷键','','rep-shortcuts','class="quiet"')}`;
    const current=detail||catalog;H.$('#status').innerHTML=`<span>${phase==='loading'?'正在读取证据':phase==='error'?'读取失败':current?.historical?'历史记录':'已保存证据'}</span><span class="spacer"></span><span>${time(current?.created_at)}</span><span>复现结果 · 未作工程审批</span>`;
    if(phase==='loading'){H.$('#workspace').innerHTML='<div class="rep-empty" role="status" aria-live="polite"><h2>正在读取复现记录…</h2></div>';return;}
    if(phase==='error'){H.$('#workspace').innerHTML=`<div class="rep-empty" role="alert"><h2>复现记录读取失败</h2><p>${e(failure)}</p>${H.button('重试','action/refresh','rep-refresh','class="primary"')}</div>`;return;}
    if(!catalog?.items.length){H.$('#workspace').innerHTML=`<div class="rep-empty"><h2>尚无复现记录</h2><p>导入求解报告后，论文与算例会出现在这里。</p>${H.button('刷新','action/refresh','rep-refresh')}</div>`;return;}
    H.$('#workspace').innerHTML=`${current?.historical?'<div class="rep-historical">历史证据快照 <a href="#/library/reproductions">返回当前记录</a></div>':''}${detail?selected():list()}`;
    H.$('.rep-rail [aria-current]')?.scrollIntoView({block:'nearest'});drawChart();
  }
  async function route(){const mine=++token;controller?.abort();controller=new AbortController();phase='loading';failure='';detail=null;render();
    try{const query=snapshot()?'?snapshot='+snapshot():'';const data=await H.api('/foundation/reproductions'+query,{signal:controller.signal});if(mine!==token)return;catalog=data;
      const id=routeParts()[2];if(id){const item=await H.api('/foundation/reproductions/'+encodeURIComponent(id)+query,{signal:controller.signal});if(mine!==token)return;detail=item;}
      phase='ready';render();
    }catch(error){if(mine!==token)return;phase='error';failure=error.message;render();}
  }
  async function action(name){if(!handles(H.state.route))return;
    if(name==='rep-refresh'){if(phase!=='loading')await route();return;}
    if(name==='rep-reset'){remember();prefs={query:'',kind:'all',status:'all'};savePreferences();render();return;}
    if(name==='rep-export'&&detail){const raw=JSON.stringify(detail,null,2),url=URL.createObjectURL(new Blob([raw],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='reproduction-'+detail.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);H.notify('已导出当前已保存证据，含来源与版本。');return;}
    if(name==='rep-shortcuts')H.openDialog('复现库快捷键','<div class="shortcut-list"><span><kbd>Enter</kbd> 检索 / 打开选中目标</span><span><kbd>Esc</kbd> 返回列表 / 取消检索输入</span><span><kbd>Ctrl+Z</kbd> 撤销筛选修改</span><span><kbd>Ctrl+S</kbd> 保存当前对照为 JSON</span></div>');
  }
  function keydown(event){if(!handles(H.state.route)||H.$('#modal').open)return false;const mod=event.ctrlKey||event.metaKey;
    if(mod&&event.key.toLowerCase()==='s'){event.preventDefault();if(detail)action('rep-export');else H.notify('先打开一个目标，再保存它的对照记录。');return true;}
    if(mod&&event.key.toLowerCase()==='z'&&!event.target.matches('input')){event.preventDefault();if(undo.length){prefs=undo.pop();savePreferences();render();}return true;}
    if(event.key==='Enter'&&event.target.id==='rep-query'){event.preventDefault();H.$('#rep-filter').requestSubmit();return true;}
    if(event.key==='Enter'&&event.target.closest('[data-rep-id]')){event.preventDefault();location.hash='/library/reproductions/'+event.target.closest('[data-rep-id]').dataset.repId+'/results'+suffix();return true;}
    if(event.key==='Escape'){event.preventDefault();if(event.target.id==='rep-query'){event.target.value=prefs.query;event.target.blur();}else if(detail)location.hash='/library/reproductions'+suffix();return true;}return false;
  }
  function init(helpers){H=helpers;try{const saved=JSON.parse(localStorage.getItem('csp-reproduction-view')||'null');if(saved&&typeof saved.query==='string'&&(saved.kind==='all'||kinds[saved.kind])&&(saved.status==='all'||statuses[saved.status]))prefs=saved;}catch{}
    document.addEventListener('click',event=>{const button=event.target.closest('[data-rep-status]');if(!button||!handles(H.state.route))return;remember();prefs={...prefs,status:button.dataset.repStatus};savePreferences();render();});
    document.addEventListener('submit',event=>{if(event.target.id!=='rep-filter')return;event.preventDefault();remember();prefs={query:H.$('#rep-query').value,kind:H.$('#rep-kind').value,status:H.$('#rep-status').value};savePreferences();render();});
    document.addEventListener('change',event=>{if(['rep-metric','rep-overlay-metric'].includes(event.target.id)||event.target.matches('[data-rep-series]'))drawChart();if(event.target.id==='rep-snapshot'){location.hash=H.state.route.split('?')[0]+(event.target.value?'?snapshot='+event.target.value:'');}if(['rep-kind','rep-status'].includes(event.target.id))H.$('#rep-filter').requestSubmit();});
    window.addEventListener('resize',()=>{if(handles(H.state.route))drawChart();});
  }
  return {init,handles,route,render,action,keydown};
})();
