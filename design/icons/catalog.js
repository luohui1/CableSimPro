const catalog = [
  {
    "group": "nav",
    "label": "导航",
    "icons": [
      {
        "name": "home",
        "title": "首页"
      },
      {"name":"cable-type","title":"型号"},
      {"name":"study","title":"研究"},
      {
        "name": "library",
        "title": "库"
      },
      {
        "name": "plugin",
        "title": "插件"
      },
      {
        "name": "settings",
        "title": "设置"
      },
      {
        "name": "recent",
        "title": "最近"
      }
    ]
  },
  {
    "group": "object",
    "label": "工程对象",
    "icons": [
      {
        "name": "overview",
        "title": "概况"
      },
      {
        "name": "cable",
        "title": "电缆结构"
      },
      {
        "name": "section",
        "title": "敷设截面"
      },
      {
        "name": "route",
        "title": "线路"
      },
      {
        "name": "conditions",
        "title": "工况与判据"
      },
      {
        "name": "study",
        "title": "计算"
      },
      {
        "name": "delivery",
        "title": "交付"
      }
    ]
  },
  {
    "group": "action",
    "label": "操作",
    "icons": [
      {
        "name": "add",
        "title": "添加"
      },
      {
        "name": "edit",
        "title": "编辑"
      },
      {
        "name": "delete",
        "title": "删除"
      },
      {
        "name": "duplicate",
        "title": "创建副本"
      },
      {
        "name": "undo",
        "title": "撤销"
      },
      {
        "name": "redo",
        "title": "重做"
      },
      {
        "name": "save",
        "title": "保存"
      },
      {
        "name": "import",
        "title": "导入"
      },
      {
        "name": "export",
        "title": "导出"
      },
      {
        "name": "search",
        "title": "搜索"
      },
      {
        "name": "filter",
        "title": "筛选"
      },
      {
        "name": "more",
        "title": "更多"
      },
      {
        "name": "close",
        "title": "关闭"
      },
      {
        "name": "chevron-down",
        "title": "展开"
      },
      {
        "name": "chevron-right",
        "title": "进入"
      },
      {
        "name": "external",
        "title": "在新窗口打开"
      },
      {
        "name": "copy",
        "title": "复制"
      },
      {
        "name": "history",
        "title": "历史记录"
      },
      {
        "name": "compare",
        "title": "比较"
      },
      {
        "name": "refresh",
        "title": "刷新"
      }
    ]
  },
  {
    "group": "run",
    "label": "运行",
    "icons": [
      {
        "name": "run",
        "title": "运行"
      },
      {
        "name": "stop",
        "title": "停止"
      },
      {
        "name": "preflight",
        "title": "预检"
      }
    ]
  },
  {
    "group": "agent",
    "label": "工程助手",
    "icons": [
      {
        "name": "agent",
        "title": "工程助手"
      },
      {
        "name": "proposal",
        "title": "变更提案"
      },
      {
        "name": "approve",
        "title": "批准"
      },
      {
        "name": "reject",
        "title": "拒绝"
      },
      {
        "name": "retry",
        "title": "重试"
      },
      {
        "name": "branch",
        "title": "分支"
      },
      {
        "name": "send",
        "title": "发送"
      },
      {
        "name": "attach",
        "title": "附加资料"
      },
      {
        "name": "step-read",
        "title": "已读取"
      },
      {
        "name": "step-run",
        "title": "已运行"
      }
    ]
  }
];

const additions = [
  {group:'module',label:'可选模块',icons:[{"name":"structure","title":"结构设计"},{"name":"standard-check","title":"标准核对"},{"name":"electrical","title":"电气参数"},{"name":"rating-table","title":"载流量表"},{"name":"short-circuit","title":"短路容量"},{"name":"sweep","title":"参数扫描"},{"name":"method-compare","title":"方法对比"},{"name":"datasheet","title":"规格书"},{"name":"add-module","title":"添加模块"}]},
  {
    "group": "source",
    "label": "来源与引用",
    "icons": [
      {
        "name": "from-library",
        "title": "库引用"
      },
      {
        "name": "from-standard",
        "title": "标准值"
      },
      {
        "name": "from-document",
        "title": "资料来源"
      },
      {
        "name": "from-user",
        "title": "用户录入"
      },
      {
        "name": "derived",
        "title": "推导值"
      },
      {
        "name": "locked",
        "title": "锁定"
      },
      {
        "name": "unlocked",
        "title": "解锁"
      }
    ]
  },
  {
    "group": "calc",
    "label": "计算能力",
    "icons": [
      {
        "name": "ampacity",
        "title": "载流量"
      },
      {
        "name": "thermal-field",
        "title": "温度场"
      },
      {
        "name": "electric-field",
        "title": "电场"
      },
      {
        "name": "magnetic-field",
        "title": "磁场"
      },
      {
        "name": "short-circuit",
        "title": "短路热稳定"
      },
      {
        "name": "induced-voltage",
        "title": "感应电压与环流"
      },
      {
        "name": "electrical-params",
        "title": "电气参数"
      },
      {
        "name": "voltage-drop",
        "title": "电压降"
      },
      {
        "name": "selection",
        "title": "选型"
      },
      {
        "name": "cross-check",
        "title": "交叉校核"
      },
      {
        "name": "sweep",
        "title": "参数扫描"
      }
    ]
  },
  {
    "group": "tool",
    "label": "建模工具",
    "icons": [
      {
        "name": "select",
        "title": "选择"
      },
      {
        "name": "pan",
        "title": "平移"
      },
      {
        "name": "zoom-in",
        "title": "放大"
      },
      {
        "name": "zoom-out",
        "title": "缩小"
      },
      {
        "name": "fit",
        "title": "适应窗口"
      },
      {
        "name": "place-cable",
        "title": "放置电缆"
      },
      {
        "name": "duct-bank",
        "title": "排管"
      },
      {
        "name": "medium-zone",
        "title": "介质分区"
      },
      {
        "name": "dimension",
        "title": "尺寸标注"
      },
      {
        "name": "measure",
        "title": "测量"
      },
      {
        "name": "snap",
        "title": "捕捉"
      },
      {
        "name": "align",
        "title": "对齐"
      },
      {
        "name": "section-cut",
        "title": "剖切"
      },
      {
        "name": "view-3d",
        "title": "三维查看"
      }
    ]
  },
  {
    "group": "route",
    "label": "线路对象",
    "icons": [
      {
        "name": "segment",
        "title": "线路分段"
      },
      {
        "name": "joint",
        "title": "接头与接头井"
      },
      {
        "name": "crossing",
        "title": "交叉"
      },
      {
        "name": "heat-source",
        "title": "外部热源"
      },
      {
        "name": "bonding",
        "title": "接地方式"
      },
      {
        "name": "profile",
        "title": "纵断面"
      }
    ]
  },
  {
    "group": "resource",
    "label": "资源种类",
    "icons": [
      {
        "name": "material",
        "title": "材料"
      },
      {
        "name": "cable-type",
        "title": "电缆型号"
      },
      {
        "name": "section-template",
        "title": "截面模板"
      },
      {
        "name": "route-template",
        "title": "线路模板"
      },
      {
        "name": "condition-set",
        "title": "工况模板"
      },
      {
        "name": "calc-scheme",
        "title": "计算方案"
      },
      {
        "name": "delivery-template",
        "title": "交付模板"
      }
    ]
  },
  {
    "group": "result",
    "label": "结果与交付",
    "icons": [
      {
        "name": "scalar",
        "title": "数值结论"
      },
      {
        "name": "table",
        "title": "数值表"
      },
      {
        "name": "curve",
        "title": "曲线"
      },
      {
        "name": "field",
        "title": "场分布"
      },
      {
        "name": "radial",
        "title": "径向分布"
      },
      {
        "name": "snapshot",
        "title": "运行快照"
      },
      {
        "name": "report",
        "title": "计算书"
      },
      {
        "name": "evidence",
        "title": "验证依据"
      }
    ]
  },
  {
    "group": "action",
    "label": "操作",
    "icons": [
      {
        "name": "publish",
        "title": "发布到库"
      },
      {
        "name": "detach",
        "title": "脱离引用"
      },
      {
        "name": "replace",
        "title": "替换引用"
      },
      {
        "name": "locate",
        "title": "定位对象"
      },
      {
        "name": "sort-ascending",
        "title": "升序"
      },
      {
        "name": "sort-descending",
        "title": "降序"
      },
      {
        "name": "visible",
        "title": "显示对象"
      },
      {
        "name": "hidden",
        "title": "隐藏对象"
      }
    ]
  }
];
additions.push(...[{"group":"action","label":"","icons":[{"name":"arrow-down","title":"向下"},{"name":"arrow-left","title":"向左"},{"name":"arrow-right","title":"向右"},{"name":"arrow-up","title":"向上"},{"name":"check","title":"确认"},{"name":"chevron-left","title":"返回"},{"name":"chevron-up","title":"收起"},{"name":"chevrons-up-down","title":"切换"},{"name":"clear","title":"清空"},{"name":"code","title":"代码"},{"name":"cut","title":"剪切"},{"name":"grip","title":"拖动"},{"name":"minus","title":"减少"},{"name":"paste","title":"粘贴"},{"name":"percent","title":"百分比"},{"name":"pin","title":"固定"},{"name":"resize-horizontal","title":"调整宽度"},{"name":"unpin","title":"取消固定"}]},{"group":"agent","label":"","icons":[{"name":"checkpoint","title":"检查点"},{"name":"commit","title":"变更提交"},{"name":"message","title":"消息"},{"name":"reasoning","title":"推理"}]},{"group":"nav","label":"","icons":[{"name":"sidebar","title":"侧栏"},{"name":"simulation","title":"电缆仿真"},{"name":"theme","title":"主题"},{"name":"workbench","title":"工作台"}]},{"group":"object","label":"","icons":[{"name":"file","title":"文件"},{"name":"folder","title":"文件夹"}]},{"group":"status","label":"状态","icons":[{"name":"current","title":"当前"},{"name":"error","title":"错误"},{"name":"info","title":"信息"},{"name":"pending","title":"等待"},{"name":"spinner","title":"执行中"},{"name":"warning","title":"警告"}]},{"group":"tool","label":"","icons":[{"name":"terminal","title":"终端"}]}]);
for (const addition of additions) {
  const existing=catalog.find(group=>group.group===addition.group);
  if(existing)existing.icons.push(...addition.icons);else catalog.push(addition);
}
const total=catalog.reduce((count,group)=>count+group.icons.length,0);
const loadedIcons=new Map();

async function svg(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('素材读取失败：' + url);
  return response.text();
}
function level(n) {
  return '<svg class="verification" viewBox="0 0 18 18" fill="none" aria-hidden="true">' +
    [1,2,3,4,5].map(i => '<circle cx="9" cy="9" r="' + (i*1.65-.75) + '" stroke="currentColor" stroke-width="' + (i<=n?.85:.4) + '"' + (i<=n?'':' stroke-dasharray=".5 1.5"') + '/>').join('') + '</svg>';
}
async function start() {
  const mark = await svg('../brand/mark.svg');
  const wordmark = await svg('../brand/wordmark.svg');
  document.querySelector('#identity-mark').innerHTML = mark;
  document.querySelector('#brand-pair').innerHTML = ['light','dark'].map(theme =>
    '<div class="theme-sample brand-sample" data-theme="'+theme+'"><div class="wordmark">'+wordmark+'</div><div class="brand-sizes">'+
    [16,24,48].map(size=>'<div class="size-example" style="--size:'+size+'px">'+mark+'<small class="mono">'+size+'</small></div>').join('')+
    '</div></div>').join('');
  const states = [['current','当前'],['historical','历史'],['draft','草稿'],['failed','失败'],['running','执行中'],['queued','排队']];
  document.querySelector('#symbol-pair').innerHTML = ['light','dark'].map(theme =>
    '<div class="theme-sample" data-theme="'+theme+'"><div class="symbols">'+states.map(([state,label])=>'<span class="symbol-item"><span class="status '+state+'"></span>'+label+'</span>').join('')+
    '</div><div class="symbols symbol-subrow">'+[['pass','满足'],['fail','不满足'],['unknown','无法判断']].map(([state,label])=>'<span class="symbol-item"><span class="criterion '+state+'"></span>'+label+'</span>').join('')+
    '</div><div class="symbols symbol-subrow">'+['未验证','接口测试','解析基准','参考基准','交叉验证'].map((label,i)=>'<span class="symbol-item">'+level(i+1)+'<span>'+label+'</span></span>').join('')+'</div></div>').join('');
  for (const {group,label,icons} of catalog) {
    const section = document.createElement('section');
    section.className = 'section';
    section.dataset.group = group;
    section.id = 'group-'+group;
    section.classList.add('catalog-group');
    section.innerHTML = '<div class="section-heading"><h2>'+label+'</h2><span class="note mono">'+group+' · '+icons.length+'</span></div><div class="icon-grid"></div>';
    const entries = await Promise.all(icons.map(async item=>({...item,svg:await svg('./'+group+'/'+item.name+'.svg')})));
    entries.forEach(item=>loadedIcons.set(group+'/'+item.name,item));
    section.querySelector('.icon-grid').innerHTML = entries.map(item=>
      '<article class="icon-item" data-search="'+item.name+' '+item.title+' '+group+' '+label+'"><button class="icon-choice icon-card" data-icon-key="'+group+'/'+item.name+'" aria-pressed="false" aria-label="预览选中：'+item.title+'"><span class="icon-name"><span>'+item.title+'</span><code>'+item.name+'</code></span><span class="icon-themes">'+
      ['light','dark'].map(theme=>'<span class="icon-strip" data-theme="'+theme+'">'+[16,20,24].map(size=>'<span class="icon-glyph" style="--size:'+size+'px" title="'+size+' px" aria-hidden="true">'+item.svg+'</span>').join('')+'</span>').join('')+'</span></button></article>').join('');
    document.querySelector('#catalog').append(section);
  }
  document.querySelector('#catalog-summary').textContent=total+' 个原创图标 · '+catalog.length+' 个分组。点击任意图标预览选中动效，左右依次为 16 / 20 / 24 px。';
  document.querySelector('#group-filter').innerHTML='<option value="">全部分组</option>'+catalog.map(group=>'<option value="'+group.group+'">'+group.label+' · '+group.icons.length+'</option>').join('');
  document.querySelector('#group-links').innerHTML=catalog.map(group=>'<a href="#group-'+group.group+'" data-filter="'+group.group+'">'+group.label+'</a>').join('');
  const reduced=()=>document.querySelector('#reduce').checked;
  const durationScale=()=>document.querySelector('#slow-selection').checked?3:1;
  const selectionMedia=matchMedia('(prefers-reduced-motion: reduce)');
  const selection=CableIconSelection.mount(document.querySelector('#catalog'),{reduced,durationScale,onChange:(key,effect)=>{
    document.querySelector('#selection-readout').textContent=loadedIcons.get(key).title+' · '+key+' · '+effect.label;
  }});
  const samples=[
    ['navigation','全局导航',['nav/home','nav/cable-type','nav/study','nav/library','nav/plugin','nav/settings']],
    ['objects','工程目录',['object/cable','object/section','object/route','object/study']],
    ['tools','编辑工具',['tool/select','tool/pan','tool/snap','tool/measure']]
  ];
  let activeExample=1;
  const examples=samples.map(([name,label,keys],exampleIndex)=>{
    const row=document.createElement('div');row.className='selection-example';
    row.innerHTML='<span class="note">'+label+'</span><div class="icon-choices" data-selection-mode="navigation" role="group" aria-label="'+label+'">'+keys.map((key,index)=>'<button class="icon-choice" data-icon-key="'+key+'" aria-pressed="'+(index===0)+'"><span class="icon-glyph" aria-hidden="true">'+loadedIcons.get(key).svg+'</span>'+loadedIcons.get(key).title+'</button>').join('')+'</div>';
    document.querySelector('#selection-examples').append(row);
    return CableIconSelection.mount(row.querySelector('.icon-choices'),{reduced,durationScale,onChange:(key,effect)=>{activeExample=exampleIndex;document.querySelector('#example-readout').textContent=loadedIcons.get(key).title+' · '+effect.label;}});
  });
  const syncPreviewMotion=()=>{
    const disabled=selectionMedia.matches||reduced();
    document.documentElement.dataset.reduced=String(disabled);
    document.querySelector('#slow-selection').disabled=disabled;
    document.querySelector('#selection-motion-state').textContent=disabled?(selectionMedia.matches?'系统已开启减少动态效果 · 直接切换':'减少动态效果已开启 · 直接切换'):(durationScale()===3?'慢放 · 960 ms':'正常速度 · 320 ms');
    if(disabled){selection.settle();examples.forEach(example=>example.settle());}
  };
  document.querySelector('#replay-selection').addEventListener('click',()=>examples[activeExample].replay());
  document.querySelector('#reduce').addEventListener('change',syncPreviewMotion);
  document.querySelector('#slow-selection').addEventListener('change',syncPreviewMotion);
  selectionMedia.addEventListener('change',syncPreviewMotion);syncPreviewMotion();
  const filter=()=>{
    const value=document.querySelector('#search').value.trim().toLowerCase(),group=document.querySelector('#group-filter').value;
    for (const item of document.querySelectorAll('.icon-item')) item.hidden=!item.dataset.search.toLowerCase().includes(value)||(group&&item.closest('[data-group]').dataset.group!==group);
    for (const group of document.querySelectorAll('[data-group]')) group.hidden=![...group.querySelectorAll('.icon-item')].some(item=>!item.hidden);
    const count=document.querySelectorAll('.icon-item:not([hidden])').length;
    document.querySelector('#count').textContent=count+' / '+total;
    document.querySelector('#empty').hidden=count!==0;
    selection.refresh();
  };
  document.querySelector('#search').addEventListener('input',filter);
  document.querySelector('#group-filter').addEventListener('change',filter);
  document.querySelectorAll('[data-filter]').forEach(link=>link.addEventListener('click',()=>{document.querySelector('#group-filter').value=link.dataset.filter;document.querySelector('#search').value='';filter();}));
  filter();
  document.querySelector('#theme').addEventListener('click',event=>{
    const dark=document.documentElement.dataset.theme!=='dark';
    document.documentElement.dataset.theme=dark?'dark':'light';
    event.currentTarget.setAttribute('aria-pressed',String(dark));
    event.currentTarget.textContent=dark?'页面：深色':'页面：浅色';
  });
  await document.fonts.ready;
  document.documentElement.dataset.ready='true';
}
start().catch(error=>{
  document.querySelector('#catalog').innerHTML='<p class="loading-error">素材未能加载。请在 design 目录执行 npm ci，然后 npm run preview。</p>';
  console.error(error);
});
