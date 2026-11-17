// The browser's explicit file selection is a chat input. Only the platform stages its bytes; pi keeps identifiers and hashes.
import { STRUCTURE_ATTACHMENT_BYTES, STRUCTURE_ATTACHMENT_COUNT, type StructureAttachment, type StructureAttachmentInput } from '../shared/fusion-types.ts';
import { StudioError } from '../host/core.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (message: string): never => { throw new StudioError({ code: 'ATTACHMENT_INVALID', message }, 422); };

/** Validate before any staging request; never include bytes or a failing value in an error. */
export function attachmentInputs(value: unknown): StructureAttachmentInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > STRUCTURE_ATTACHMENT_COUNT) return invalid('每条消息最多附上 4 份结构表。');
  let size = 0;
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return invalid('附件不完整，请重新选择结构表。');
    const file = item as Record<string, unknown>;
    if (typeof file.id === 'string' && Object.keys(file).length === 1 && UUID.test(file.id)) return { id: file.id };
    if (Object.keys(file).some(key => !['filename', 'content_base64'].includes(key))
      || typeof file.filename !== 'string' || !file.filename.trim() || file.filename !== file.filename.trim() || file.filename.length > 160
      || /[\x00-\x1f\x7f/\\<>:"|?*]/.test(file.filename) || !/\.(csv|xlsx)$/i.test(file.filename)) return invalid('附件须为名称完整的 CSV 或 XLSX 结构表，名称不能包含路径或特殊符号。');
    if (typeof file.content_base64 !== 'string' || !file.content_base64.length || file.content_base64.length > Math.ceil(STRUCTURE_ATTACHMENT_BYTES / 3) * 4
      || file.content_base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content_base64)) return invalid('附件内容无效或超过 1 MiB，请重新选择文件。');
    const bytes = Buffer.from(file.content_base64, 'base64');
    size += bytes.length;
    if (!bytes.length || size > STRUCTURE_ATTACHMENT_BYTES || bytes.toString('base64') !== file.content_base64) return invalid('每条消息的附件须非空，合计不超过 1 MiB。');
    return { filename: file.filename, content_base64: file.content_base64 };
  });
}

export function isStructureAttachment(value: unknown): value is StructureAttachment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && UUID.test(item.id) && typeof item.filename === 'string' && Boolean(item.filename)
    && typeof item.sha256 === 'string' && /^[0-9a-f]{64}$/.test(item.sha256)
    && typeof item.size === 'number' && Number.isInteger(item.size) && item.size > 0 && item.size <= STRUCTURE_ATTACHMENT_BYTES;
}
