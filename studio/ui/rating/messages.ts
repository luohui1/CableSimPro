// The host's own words for a failed action, so a screen can say why in its own place.
import { ApiError } from '@/state/api';

export const messageOf = (error: unknown): string => (error instanceof ApiError ? error.issue.message : error instanceof Error ? error.message : '操作没有完成。');
