// A word before the page is left with changes that were not applied: going to another project, another part of the workbench, or
// closing the tab. Looking at another run record of the same project is not leaving: the changes belong to the project.
import { useBlocker } from '@tanstack/react-router';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export function LeaveGuard({ count }: { count: number }) {
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => count > 0 && current.pathname !== next.pathname,
    enableBeforeUnload: () => count > 0,
    withResolver: true,
  });
  return <AlertDialog open={blocker.status === 'blocked'} onOpenChange={open => { if (!open) blocker.reset?.(); }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>这些改动还没有应用</AlertDialogTitle>
        <AlertDialogDescription>离开这个页面，{count} 项还没应用的已知条件改动就丢掉了。</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>留在这里</AlertDialogCancel>
        <AlertDialogAction onClick={() => blocker.proceed?.()}>放弃改动并离开</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
