// Selection and encoding stay in the composer. The message request stages the bytes on the existing platform after a chat exists.
import type { AttachmentAdapter } from '@assistant-ui/react';
import { STRUCTURE_ATTACHMENT_BYTES, type StructureAttachmentInput } from '@shared/fusion-types';
import { reportFailure } from '@/components/notice';

export type SelectedAttachments = Map<string, Extract<StructureAttachmentInput, { filename: string }>>;

async function encoded(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

export function structureAttachments(selected: SelectedAttachments): AttachmentAdapter {
  return {
    accept: '.csv,.xlsx',
    add: async ({ file }) => {
      try {
        if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error('请选择 CSV 或 XLSX 结构表。');
        if (!file.size || file.size > STRUCTURE_ATTACHMENT_BYTES) throw new Error('请选择非空且不超过 1 MiB 的结构表。');
        return { id: crypto.randomUUID(), type: 'document', name: file.name, contentType: file.type, file,
          status: { type: 'requires-action', reason: 'composer-send' } };
      } catch (error) { reportFailure(error); throw error; }
    },
    send: async attachment => {
      try {
        selected.set(attachment.id, { filename: attachment.file.name, content_base64: await encoded(attachment.file) });
        return { id: attachment.id, type: 'document', name: attachment.name, contentType: attachment.contentType,
          status: { type: 'complete' }, content: [] };
      } catch (error) { reportFailure(new Error('无法读取附件，请重新选择文件。')); throw error; }
    },
    remove: async attachment => { selected.delete(attachment.id); },
  };
}
