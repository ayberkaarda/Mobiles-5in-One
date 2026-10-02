import { createDeletionNoticeStore } from './deletion';

/**
 * The deletion notice of this run, memory only. Kept apart from `instance.ts` (native push
 * module, build configuration) so the signed-out entry screen can read it cheaply.
 */
export const deletionNotice = createDeletionNoticeStore();
