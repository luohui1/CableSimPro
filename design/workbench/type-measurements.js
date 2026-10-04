'use strict';
// Reported values retain their own identity, source and SI unit; design facts stay independent.
window.TypeMeasurements=(()=>{
  let H;const kinds={r20:['R₂₀','Ω/km',1000,'ohm/m'],minimum_thickness:['最薄点','mm',1000,'m'],maximum_thickness:['最大实测厚度','mm',1000,'m'],mean_thickness:['平均实测厚度','mm',1000,'m'],minimum_tape_thickness:['单带最薄点','mm',1000,'m'],screen_area:['金属截面','mm²',1e6,'m2']};
  const E=v=>H.esc(v),B=(label,key,extra='')=>H.button(label,'','type-measurement-'+key,extra);
  function targets(){
    const rows=H.entries().map(e=>({core:e.coreId,role:e.role,label:e.label}));
    for(const [i,c]of H.type().cores.entries())for(const role of ['metallic_screen','metallic_sheath']){const core=H.type().cores.length>1?c.id:null;if(!rows.some(r=>r.core===core&&r.role===role))rows.push({core,role,label:(H.type().cores.length>1?`芯 ${i+1} · `:'')+H.roleNames[role]+'（构造待补）'});}
    return rows.filter(e=>['conductor','insulation','conductor_screen','insulation_screen','metallic_screen','metallic_sheath','bedding','separator','armour','oversheath'].includes(e.role));
  }
  let activeTargets=[],selectedId=null;
  function open(id=null,target=null){
    if(H.state.busy)return;const record=(H.state.draft.measurements||[]).find(r=>r.id===id);selectedId=record?.id||null;activeTargets=targets();
    const current=record||target,targetCore=record?record.core:target?.core_id??null,selected=activeTargets.findIndex(t=>t.core===targetCore&&t.role===current?.role);
    H.openDialog(record?'编辑出厂数据':'录入出厂数据',`<form id="factory-data-form"><label class="field"><span>关联对象</span><select id="factory-target">${activeTargets.map((t,i)=>`<option value="${i}" ${i===(selected<0?0:selected)?'selected':''}>${E(t.label)}</option>`).join('')}</select></label><label class="field"><span>数据项</span><select id="factory-quantity">${Object.entries(kinds).map(([k,[label]])=>`<option value="${k}" ${record?.quantity===k?'selected':''}>${label}</option>`).join('')}</select></label><label class="field"><span>数值</span><span class="input-unit"><input id="factory-value" type="number" min="0" step="any" value="${record?E(record.value*kinds[record.quantity][2]):''}" required><small id="factory-unit"></small></span></label><label class="field"><span>数据性质</span><select id="factory-basis"><option value="measurement" ${record?.basis==='measurement'?'selected':''}>实测 / 出厂试验值</option><option value="manufacturer_limit" ${record?.basis==='manufacturer_limit'?'selected':''}>厂家声明上限</option></select></label><label class="field"><span>试验报告 / 数据表出处</span><input id="factory-reference" required value="${E(record?.source.reference||'')}" placeholder="报告编号、样品编号或厂家数据表页码"></label><p class="subtle">设计参数另行保存；录入后旧核对快照保留为历史。</p><p id="factory-error" class="warning" role="alert" hidden></p></form>`,`${record?B('删除记录','delete'):''}${B('保存出厂数据','save','class="primary"')}`);
    updateQuantity();H.$('#factory-value').focus();
  }
  function updateQuantity(){
    const target=activeTargets[Number(H.$('#factory-target').value)],select=H.$('#factory-quantity');
    for(const option of select.options)option.disabled=target.role==='conductor'?option.value!=='r20':option.value==='r20'||option.value==='screen_area'&&!['metallic_screen','metallic_sheath','armour'].includes(target.role);
    if(select.selectedOptions[0].disabled)select.value=[...select.options].find(o=>!o.disabled).value;
    H.$('#factory-basis option[value=manufacturer_limit]').disabled=select.value!=='r20';
    if(select.value!=='r20')H.$('#factory-basis').value='measurement';
    H.$('#factory-unit').textContent=kinds[select.value][1];
  }
  function error(message,selector){const el=H.$(selector);el.setAttribute('aria-invalid','true');el.focus();H.$('#factory-error').textContent=message;H.$('#factory-error').hidden=false;}
  async function save(){
    if(H.state.busy)return;const target=activeTargets[Number(H.$('#factory-target').value)],quantity=H.$('#factory-quantity').value,kind=kinds[quantity],number=Number(H.$('#factory-value').value),reference=H.$('#factory-reference').value.trim(),basis=H.$('#factory-basis').value;
    if(H.$('#factory-value').value===''||!Number.isFinite(number)||number<=0||number/kind[2]>(kind[3]==='ohm/m'?1:kind[3]==='m2'?.01:.5)){error('请输入正数，并核对 '+kind[1]+' 单位。','#factory-value');return;}
    if(!reference){error('请填写报告编号及样品编号，或厂家数据表出处。','#factory-reference');return;}
    const records=structuredClone(H.state.draft.measurements||[]),previous=records.find(r=>r.cable_type===H.type().id&&r.core===target.core&&r.role===target.role&&r.quantity===quantity);
    if(previous&&previous.id!==selectedId){error('此对象已录入该数据项，请编辑已有记录。','#factory-quantity');return;}
    for(const id of ['factory-value','factory-reference','factory-quantity'])H.$('#'+id).removeAttribute('aria-invalid');
    H.$('#factory-error').hidden=true;
    const item={id:selectedId||'measurement/'+crypto.randomUUID(),cable_type:H.type().id,core:target.core,role:target.role,quantity,value:number/kind[2],unit:kind[3],basis,source:{kind:basis==='measurement'?'measurement':'manufacturer',reference,reviewed:false}};
    const i=records.findIndex(r=>r.id===selectedId);if(i<0)records.push(item);else records[i]=item;
    H.edit('measurements',records);selectedId=item.id;await H.save();if(!H.state.dirty){H.$('#modal').close();H.notify('已保存出厂数据，旧结果保留为历史');H.renderWorkspace();}
  }
  function list(){
    const records=(H.state.draft.measurements||[]).filter(r=>r.cable_type===H.type().id);if(!records.length)return '';
    return `<details class="factory-records"><summary>出厂数据 · ${records.length} 项</summary><table class="standard-table"><thead><tr><th>对象 / 数据项</th><th>实测或声明值</th><th>来源</th><th></th></tr></thead><tbody>${records.map(r=>{const [label,unit,scale]=kinds[r.quantity],core=H.type().cores.findIndex(c=>c.id===r.core);return `<tr><td>${core>=0?'芯 '+(core+1)+' · ':''}${E(H.roleNames[r.role])}<small>${label}</small></td><td class="number">${H.fmt(r.value*scale,4)} ${unit}<small>${r.basis==='measurement'?'实测值':'厂家声明上限'}</small></td><td>${E(r.source.reference)}</td><td>${B('编辑','edit:'+r.id,'class="quiet"')}</td></tr>`;}).join('')}</tbody></table></details>`;
  }
  async function action(key){if(key==='new'){open(null,TypeStandards.selectedTarget?.());return;}if(key==='save')return save();if(key.startsWith('edit:'))return open(key.slice(5));if(key==='delete'&&selectedId){H.edit('measurements',(H.state.draft.measurements||[]).filter(r=>r.id!==selectedId));await H.save();H.$('#modal').close();H.renderWorkspace();}}
  function keydown(event){if(!H?.$('#factory-data-form'))return false;if(event.key==='Enter'||(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();save().catch(H.fail);return true;}return false;}
  document.addEventListener('change',e=>{if(H&&['factory-target','factory-quantity'].includes(e.target.id))updateQuantity();});
  return {init:h=>{H=h;},action,keydown,list};
})();
