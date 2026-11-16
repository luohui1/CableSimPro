// The composer: one rounded field that floats above the conversation (the only shadow on the page), attachments above
// the text, attach on the left, send or stop on the right. Send is the screen's copper button once there is something to
// send, outlined while a proposal waits (`quiet`), and grey while it cannot send. Every part takes any props, so assistant-ui's ComposerPrimitive
// can render them (render={<ComposerSend />}); `composerInputClass` styles ComposerPrimitive.Input directly.
import type { ComponentProps, ReactNode } from 'react';
import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle } from '@/components/ui/attachment';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Icon, Spinner } from '../icon';

export function ComposerFrame({ dragging, className, ...props }: { dragging?: boolean } & ComponentProps<'div'>) {
  return <div data-dragging={dragging ? 'true' : undefined}
    className={cn('flex w-full cursor-text flex-col gap-2 rounded-composer border border-line-strong bg-surface p-2 shadow-composer transition-field focus-within:border-ink-3 data-[dragging=true]:border-dashed data-[dragging=true]:border-copper data-[dragging=true]:bg-copper-fill', className)}
    {...props} />;
}

export const composerInputClass = 'max-h-48 min-h-12 w-full resize-none bg-transparent px-3 pt-2 text-prose text-ink outline-none placeholder:text-ink-3';

export function ComposerInput({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea rows={1} aria-label="给 Agent 的消息" className={cn(composerInputClass, className)} {...props} />;
}

export function ComposerBar({ start, end }: { start?: ReactNode; end?: ReactNode }) {
  return <div className="flex items-center justify-between gap-2">
    <div className="flex items-center gap-1">{start}</div>
    <div className="flex items-center gap-2">{end}</div>
  </div>;
}

export function ComposerAttach(props: ComponentProps<typeof Button>) {
  return <Button variant="ghost" size="icon-sm" aria-label="附上结构表" title="附上 Excel、CSV 结构表" {...props}><Icon name="agent/attach" /></Button>;
}

/**
 * Send: copper once there is something to send; grey while it cannot send. `quiet` while a proposal waits in the
 * conversation: its 接受 is then the screen's one copper button, and send stays outlined even with something to send.
 */
export function ComposerSend({ quiet, ...props }: { quiet?: boolean } & ComponentProps<typeof Button>) {
  return <Button variant={props.disabled ? 'secondary' : quiet ? 'outline' : 'default'} size="icon-sm" aria-label="发送" {...props}><Icon name="action/arrow-up" /></Button>;
}

export function ComposerStop(props: ComponentProps<typeof Button>) {
  return <Button variant="outline" size="icon-sm" aria-label="停止" {...props}><Icon name="run/stop" className="size-3.5 fill-current" /></Button>;
}

/** A structure table attached to a message: uploading, ready, or refused (wrong type, too large). */
export function FileChip({ name, detail, state = 'done', onRemove }: { name: string; detail?: string; state?: 'uploading' | 'done' | 'error'; onRemove?: () => void }) {
  return <Attachment state={state} size="sm" className="max-w-64 bg-surface">
    <AttachmentMedia>{state === 'uploading' ? <Spinner /> : <Icon name={state === 'error' ? 'status/error' : 'result/table'} />}</AttachmentMedia>
    <AttachmentContent>
      <AttachmentTitle>{name}</AttachmentTitle>
      {detail && <AttachmentDescription>{detail}</AttachmentDescription>}
    </AttachmentContent>
    {onRemove && <AttachmentActions><AttachmentAction aria-label={`移除 ${name}`} onClick={onRemove}><Icon name="action/close" /></AttachmentAction></AttachmentActions>}
  </Attachment>;
}
