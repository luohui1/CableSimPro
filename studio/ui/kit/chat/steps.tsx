// The steps of one task, gathered into one line that opens into a timeline (shadcn/ui Trace). Closed by default: the
// line says how the task stands; opened, each step shows what it acted on and the facts worth a look.
import type { ReactNode } from 'react';
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle,
} from '@/components/ui/trace';
import { cn } from '@/lib/utils';
import { Icon, Spinner } from '../icon';

export type StepState = 'running' | 'done' | 'failed' | 'waiting' | 'rejected' | 'interrupted';

export interface Step {
  id: string;
  /** The operation as the workbench names it: 运行校核. */
  label: string;
  /** What it acted on, in a few words: 工程「YJV22-8.7/15 3×240 直埋载流量校核」. */
  target?: string;
  state: StepState;
  /** Facts from the result, shown when the step is opened. */
  notes?: string[];
  /** Why it failed or was refused. Always shown. */
  reason?: string;
  seconds?: number;
}

const ICON: Record<StepState, () => ReactNode> = {
  running: () => <Spinner />,
  done: () => <Icon name="action/check" />,
  failed: () => <Icon name="status/error" />,
  waiting: () => <Icon name="agent/proposal" />,
  rejected: () => <Icon name="agent/reject" />,
  interrupted: () => <Icon name="action/minus" />,
};
const LINE = { running: 'running', done: undefined, failed: 'error', waiting: 'waiting', rejected: 'error', interrupted: 'pending' } as const;

const duration = (seconds: number | undefined) =>
  seconds === undefined || seconds < 0.1 ? '' : `${seconds.toFixed(seconds >= 10 ? 0 : 1)} 秒`;

function StepLine({ step }: { step: Step }) {
  const head = <TraceLine status={LINE[step.state]}>
    <TraceIcon>{ICON[step.state]()}</TraceIcon>
    <TraceTitle>
      <span className="font-medium">{step.label}</span>
      {step.target && <span className="ml-2">{step.target}</span>}
    </TraceTitle>
    {duration(step.seconds) && <TraceDescription>{duration(step.seconds)}</TraceDescription>}
  </TraceLine>;
  const reason = step.reason && <p className="m-0 mt-1 ml-6 text-sm text-error">{step.reason}</p>;
  if (!step.notes?.length) return <div data-step={step.state}>{head}{reason}</div>;
  return <TraceCollapsible data-step={step.state}>
    <TraceCollapsibleTrigger>{head}</TraceCollapsibleTrigger>
    {reason}
    <TraceCollapsibleContent>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">{step.notes.map(note => <li key={note}>{note}</li>)}</ul>
    </TraceCollapsibleContent>
  </TraceCollapsible>;
}

/** One line for the whole task, from the steps' states: working, waiting for a person, failed, or done. */
function summary(steps: Step[]): { icon: ReactNode; title: ReactNode; detail: string; status: (typeof LINE)[StepState]; reason?: string } {
  const at = (step: Step) => `第 ${steps.indexOf(step) + 1} 步`;
  const failed = steps.find(step => step.state === 'failed' || step.state === 'rejected');
  if (failed) return { icon: ICON[failed.state](), title: `${failed.label}${failed.state === 'rejected' ? '被拒绝' : '没有完成'}`, detail: at(failed), status: 'error', reason: failed.reason };
  const waiting = steps.find(step => step.state === 'waiting');
  if (waiting) return { icon: ICON.waiting(), title: `等你审阅：${waiting.label}`, detail: at(waiting), status: 'waiting' };
  const running = steps.find(step => step.state === 'running');
  if (running) return { icon: ICON.running(), title: <>{running.label}{running.target && <span className="ml-2">{running.target}</span>}</>, detail: at(running), status: 'running' };
  const stopped = steps.find(step => step.state === 'interrupted');
  if (stopped) return { icon: ICON.interrupted(), title: '已中止', detail: at(stopped), status: 'pending' };
  const total = steps.reduce((sum, step) => sum + (step.seconds ?? 0), 0);
  return { icon: ICON.done(), title: `完成 ${steps.length} 步`, detail: duration(total), status: undefined };
}

export function StepTrace({ steps, defaultOpen = false, className }: { steps: Step[]; defaultOpen?: boolean; className?: string }) {
  const line = summary(steps);
  return <Trace className={cn('gap-0', className)} data-steps={steps.length}>
    <TraceCollapsible defaultOpen={defaultOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine status={line.status}>
          <TraceIcon>{line.icon}</TraceIcon>
          <TraceTitle>{line.title}</TraceTitle>
          {line.detail && <TraceDescription>{line.detail}</TraceDescription>}
        </TraceLine>
      </TraceCollapsibleTrigger>
      {line.reason && <p className="m-0 mt-1 ml-6 text-sm text-error">{line.reason}</p>}
      <TraceCollapsibleContent>
        <Trace className="gap-2">{steps.map(step => <StepLine key={step.id} step={step} />)}</Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  </Trace>;
}
