import { Component, type ReactNode } from 'react';
import { ErrorState } from './states';
import { Button } from './ui/button';

type Props = { resetValue: unknown; title: string; children: ReactNode };
type State = { failed: boolean; resetValue: unknown };
/** Read-only view isolation. Do not wrap editable providers or claim to catch async event errors. */
export class ViewBoundary extends Component<Props, State> {
  state: State = { failed: false, resetValue: this.props.resetValue };
  static getDerivedStateFromError(): Partial<State> { return { failed: true }; }
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetValue !== state.resetValue ? { failed: false, resetValue: props.resetValue } : null;
  }
  render() {
    return this.state.failed ? <ErrorState title={this.props.title} description="当前显示内容无法完成渲染。可重新显示，或切换运行检查工件；此操作不会发起计算或修改保存结果。" action={<Button onClick={() => this.setState({ failed: false })}>重新显示</Button>} /> : this.props.children;
  }
}
