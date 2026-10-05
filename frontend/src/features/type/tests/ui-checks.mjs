import assert from 'node:assert/strict';

export async function checkLayout(page) {
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(() => {
    const dialog = document.querySelector('[role=dialog]'), scope = dialog || document;
    const rect = node => {
      const box = node.getBoundingClientRect(); let left = Math.max(0, box.left), top = Math.max(0, box.top), right = Math.min(innerWidth, box.right), bottom = Math.min(innerHeight, box.bottom);
      for (let parent = node.parentElement; parent; parent = parent.parentElement) { const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect(); if (/(hidden|auto|scroll)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); } if (/(hidden|auto|scroll)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); } }
      return { left, top, right, bottom, width: right-left, height: bottom-top };
    };
    const visible = node => { const box = rect(node); return box.width > 1 && box.height > 1 && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[aria-hidden=true]'); };
    const nodes = [...scope.querySelectorAll('button,label,input,td,th,p,h1,h2,h3,dt,dd,span')].filter(node => node.textContent.trim() && visible(node));
    const minimumFont = Math.min(...nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
    const controls = [...scope.querySelectorAll('button,input,select,textarea,[role=combobox]')].filter(node => visible(node) && !node.closest('[role=tooltip]'));
    const overlap = [];
    for (let first=0;first<controls.length;first++) for (let second=first+1;second<controls.length;second++) {
      const a = controls[first], b = controls[second]; if (a.contains(b) || b.contains(a)) continue;
      const x=rect(a), y=rect(b), width=Math.min(x.right,y.right)-Math.max(x.left,y.left), height=Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top);
      if (width>2 && height>2) overlap.push([a.getAttribute('aria-label') || a.textContent.trim(), b.getAttribute('aria-label') || b.textContent.trim()]);
    }
    const parse = value => { const values = value.match(/[\d.]+/g)?.map(Number); return values && values.length >= 3 ? [...values.slice(0,3),values[3] ?? 1] : null; };
    const blend = (front, back) => front.slice(0,3).map((value,index)=>value*front[3]+back[index]*(1-front[3]));
    const luminance = color => color.slice(0,3).map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    const contrast = [];
    for (const node of nodes.filter(node=>node.children.length===0 && !node.closest(':disabled,[aria-disabled=true]') && !node.closest('svg'))) {
      const style=getComputedStyle(node), color=parse(style.color); if (!color) continue;
      const chain=[]; for(let parent=node;parent;parent=parent.parentElement)chain.unshift(parent);
      let background=[255,255,255], opacity=1;
      for(const parent of chain){const current=getComputedStyle(parent), bg=parse(current.backgroundColor); if(bg)background=blend(bg,background);opacity*=Number(current.opacity);}
      if(opacity<1)continue;
      const foreground=blend(color,background), one=luminance(foreground), two=luminance(background), ratio=(Math.max(one,two)+.05)/(Math.min(one,two)+.05);
      const size=parseFloat(style.fontSize), large=size>=24 || size>=18.66 && Number(style.fontWeight)>=700;
      if(ratio < (large?3:4.5)-.02)contrast.push({text:node.textContent.trim().slice(0,60),ratio:Number(ratio.toFixed(2))});
    }
    return { width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth || document.documentElement.scrollHeight>innerHeight,minimumFont,overlap,contrast };
  });
  assert.equal(result.overflow,false,'页面越界'); assert.ok(result.minimumFont>=13,'字号小于13');
  assert.deepEqual(result.overlap,[],'交互控件重叠'); assert.deepEqual(result.contrast,[],'文字对比度不足');
  return result;
}
