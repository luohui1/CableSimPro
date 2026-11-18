import { useNavigate } from '@tanstack/react-router';
import { usePageTheme } from './catalog-shell';
import { Button } from './ui/button';

/** The production conversation is shared by the full page and contextual panels. */
export default function AgentGallery() {
  const navigate = useNavigate();
  const { theme } = usePageTheme();
  return <>
    <p className="muted">Agent 使用同一套对话、结果卡与待审卡。改动由人在对话里接受，随后继续处理任务。</p>
    <Button onClick={() => void navigate({ to: '/agent', search: { theme } })}>打开 Agent 对话</Button>
  </>;
}
