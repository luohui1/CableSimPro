import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from './ai-elements/tool';
import { ToolTimeline } from './ai/tool-timeline';
export default function AgentGallery() {
  return <div className="run-records-content"><p className="muted">演示 · 以下仅展示组件状态，不连接工程或执行任务。</p>
    <Tool defaultOpen><ToolHeader title="读取文档 · 演示" type="tool-read" state="output-available" /><ToolContent><ToolInput input={{资料:'组件演示文本'}} /><ToolOutput output="演示读取完成；没有修改工程。" errorText={undefined} /></ToolContent></Tool>
    <ToolTimeline title="任务时间线 · 演示" items={[{id:'read',verb:'读取演示资料',status:'complete'},{id:'review',verb:'等待工程师审阅',status:'pending'}]} />
  </div>;
}
