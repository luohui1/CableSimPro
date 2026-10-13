import { Component, lazy, Suspense, useState, type ComponentProps, type ReactNode } from 'react';
import type { CreateStudyDialog as StudyDialog } from './create-study-dialog';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { ErrorState, LoadingState } from './states';

type Props = ComponentProps<typeof StudyDialog>;
// Opening a list/settings page should not download the entire study-creation editor.
const load = () => import('./create-study-dialog').then(module => ({ default: module.CreateStudyDialog }));
const LoadedDialog = lazy(load);
class DialogBoundary extends Component<{ children: ReactNode; onClose: () => void; open: boolean }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    return this.state.error ? <Dialog open={this.props.open} onOpenChange={open => { if (!open) this.props.onClose(); }} title="新建研究">
      <ErrorState title="创建界面读取失败" description="请关闭后刷新页面，再打开新建研究。" action={<Button onClick={this.props.onClose}>关闭</Button>} />
    </Dialog> : this.props.children;
  }
}
export function LazyCreateStudyDialog(props: Props) {
  const [used, setUsed] = useState(props.open);
  if (props.open && !used) setUsed(true);
  // After the first opening retain the original dialog lifecycle, including close motion.
  if (!props.open && !used) return null;
  return <DialogBoundary open={props.open} onClose={() => props.onOpenChange(false)}><Suspense fallback={
    <Dialog open={props.open} onOpenChange={props.onOpenChange} title="新建研究" initialFocus="preserve"><LoadingState title="正在打开创建界面" /></Dialog>
  }><LoadedDialog {...props} /></Suspense></DialogBoundary>;
}
