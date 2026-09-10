import {useState} from 'react';
import {Box,Check,FolderOpen,Play} from 'lucide-react';
import {Button,Badge,Panel,MetricTile} from './primitives';
import {CollectionEmpty} from './CollectionWorkspace';
import {SurfaceNotice,WorkspacePage} from './WorkspacePage';
/** A real component specimen, not a screenshot/theme or fabricated engineering output. */
export default function ComponentGallery(){
 const [variant,setVariant]=useState('default');
 return <WorkspacePage title="组件参考" context="设计系统" description="使用与工作台相同的组件、字号和状态。示例不创建工程，不输出计算值。">
  <div className="pc-specimens">
   <Panel title="操作与状态"><div className="pc-specimen-row"><Button variant="primary"><Play size={15}/>主要操作示例</Button><Button>次要操作</Button><Button variant="quiet">低频操作</Button><Button disabled>不可用</Button></div><div className="pc-specimen-row"><Badge>草稿</Badge><Badge tone="info">已准备</Badge><Badge tone="warning">待核对</Badge><Badge tone="danger">被阻止</Badge></div></Panel>
   <Panel title="控件密度"><div className="pc-specimen-row"><label>组件状态<select aria-label="组件状态" value={variant} onChange={e=>setVariant(e.target.value)}><option value="default">默认</option><option value="invalid">无效输入</option><option value="locked">锁定</option></select></label><label>厚度示例 / mm<input aria-label="厚度组件示例" type="number" placeholder="输入尺寸" aria-invalid={variant==='invalid'} disabled={variant==='locked'}/></label></div><p className="pc-specimen-note">示例字段仅用于检查键盘、焦点和排版，不绑定工程状态。</p></Panel>
   <Panel title="读数只承载真实结果"><div className="pc-specimen-row"><MetricTile label="允许载流量" value="—" unit="A" detail="未执行计算" icon={<Box size={19}/>}/></div></Panel>
   <Panel title="提示层级"><SurfaceNotice title="结构定义待核对" tone="warning">物性来源与适用范围需独立确认，不能由外观模型推断。</SurfaceNotice><div className="pc-specimen-gap"/><SurfaceNotice title="显示操作不改工程参数"><Check size={13}/> 视图状态与求解输入分开。</SurfaceNotice></Panel>
   <Panel title="资源空状态"><CollectionEmpty icon={<FolderOpen size={26}/>} title="尚无可用资源">资源名称、数量和状态必须来自实际资料库，不填充虚构产品。</CollectionEmpty></Panel>
  </div>
 </WorkspacePage>;
}
