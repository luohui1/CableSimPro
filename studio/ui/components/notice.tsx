// One place where a failed action says what went wrong, in the host's own words: a toast, which the shell's <Toaster /> shows.
import { toast } from 'sonner';
import { ApiError } from '@/state/api';

/** For mutation onError: the host's message when it has one. */
export const reportFailure = (error: unknown) => {
  toast.error(error instanceof ApiError ? error.issue.message : error instanceof Error ? error.message : '操作没有完成。', { duration: 8000 });
};
