import assert from 'node:assert/strict';

/** Shared by every owned module and research drawing; folded trace is excluded. */
export async function checkDetailRules(page, selector) {
  const result=await page.locator(selector).first().evaluate(scope=>{
    const visible=node=>{
      if(node.closest('[hidden],[aria-hidden=true]'))return false;
      for(let p=node;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open&&!p.querySelector(':scope > summary')?.contains(node))return false;
      return node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden';
    };
    const excessive=[];
    const walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()) {
      const node=walker.currentNode.parentElement;
      if(!node||!visible(node)||node.closest('.type-result-trace,input,textarea,script,style,[data-saved-formula]'))continue;
      for(const match of walker.currentNode.textContent.matchAll(/(?:\d+\.\d{5,})/g)) {
        const significant=match[0].replace('.','').replace(/^0+/,'').replace(/0+$/,'');
        if(significant.length>7)excessive.push({text:match[0],container:node.className});
      }
    }
    const scrollable=node=>visible(node)&&/(auto|scroll)/.test(getComputedStyle(node).overflowY)&&node.clientHeight>4&&node.scrollHeight>node.clientHeight+2;
    const nested=[];
    for(const node of scope.querySelectorAll('*'))if(scrollable(node))for(let parent=node.parentElement;parent&&scope.contains(parent);parent=parent.parentElement)if(scrollable(parent)){nested.push({inner:node.className,outer:parent.className});break;}
    const native=[...scope.querySelectorAll('select,input[type=checkbox],input[type=radio],[role=checkbox]')].filter(node=>visible(node)&&!node.closest('svg')&&(node.tagName==='SELECT'||node.matches('input')||node.dataset.slot!=='checkbox')).map(node=>node.outerHTML.slice(0,180));
    return {excessive,nested,native};
  });
  assert.deepEqual(result.excessive,[],'工程视图出现完整浮点数');
  assert.deepEqual(result.nested,[],'出现嵌套纵向滚动区');
  assert.deepEqual(result.native,[],'选择控件未使用统一组件');
  return result;
}
