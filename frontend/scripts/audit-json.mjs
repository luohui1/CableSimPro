import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

/**
 * Keep the exact former parts.join('|') identity without retaining a full copy
 * of a long title/JSON text for every token found in that text. Hashes only
 * select a bucket: every hit in that bucket is still compared character-for-character as
 * a JavaScript string, including the former separator ambiguity.
 */
export function createCompactTextKeySet() {
  const buckets = new Map(), texts = new Map();
  let size = 0;
  return {
    add(parts, textIndex) {
      if (!Number.isInteger(textIndex) || textIndex < 0 || textIndex >= parts.length)
        throw new RangeError('A text key must identify its original text component');
      const text = parts[textIndex] == null ? '' : String(parts[textIndex]);
      const prefix = textIndex ? parts.slice(0, textIndex).join('|') + '|' : '';
      const suffix = textIndex + 1 < parts.length ? '|' + parts.slice(textIndex + 1).join('|') : '';
      const digest = createHash('sha256').update(prefix).update(text).update(suffix).digest('hex');
      const bucket = buckets.get(digest);
      if (bucket?.some(prior =>
        prior.prefix === prefix && prior.text.value === text && prior.suffix === suffix ||
        prior.prefix + prior.text.value + prior.suffix === prefix + text + suffix)) return false;
      let shared = texts.get(text);
      if (!shared) { shared = { value: text }; texts.set(text, shared); }
      const entry = { prefix, text: shared, suffix };
      if (bucket) bucket.push(entry); else buckets.set(digest, [entry]);
      size++;
      return true;
    },
    get size() { return size; },
    get textCount() { return texts.size; },
  };
}

const plainObject = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
  typeof value.toJSON !== 'function';

/**
 * Preserve the compatible, pretty-printed report without allocating a second
 * report-sized string. Only one collection item is stringified at a time.
 * Callers still retain every original record; this does not sample evidence.
 */
export async function writeAuditJson(file, report) {
  // Traversal is paused during persistence. Capture top-level memberships now;
  // late browser event appends remain available to the next/final checkpoint.
  const properties = Object.entries(report).map(([key, value]) => [key,
    Array.isArray(value) ? [...value] : plainObject(value) ? { ...value } : value]);
  for (let attempt = 0; ; attempt++) {
    let handle;
    try {
      handle = await fs.open(file + '.pending', 'w');
      let buffer = '';
      const write = async text => {
        buffer += text;
        if (buffer.length >= 16384) { await handle.writeFile(buffer, 'utf8'); buffer = ''; }
      };
      const encoded = value => JSON.stringify(value, null, 2);
      const indented = (text, spaces) => text.replaceAll('\n', '\n' + ' '.repeat(spaces));
      const collection = async value => {
        if (Array.isArray(value)) {
          if (!value.length) { await write('[]'); return; }
          await write('[\n');
          for (let i = 0; i < value.length; i++) {
            await write((i ? ',\n' : '') + '    ' + indented(encoded(value[i]) ?? 'null', 4));
          }
          await write('\n  ]');
        } else if (plainObject(value)) {
          let first = true;
          for (const [key, item] of Object.entries(value)) {
            const text = encoded(item);
            if (text === undefined) continue;
            await write((first ? '{\n' : ',\n') + '    ' + JSON.stringify(key) + ': ' + indented(text, 4));
            first = false;
          }
          await write(first ? '{}' : '\n  }');
        } else await write(indented(encoded(value), 2));
      };
      await write('{');
      let first = true;
      for (const [key, value] of properties) {
        if (!Array.isArray(value) && !plainObject(value) && encoded(value) === undefined) continue;
        await write((first ? '\n' : ',\n') + '  ' + JSON.stringify(key) + ': ');
        await collection(value);
        first = false;
      }
      await write(first ? '}' : '\n}');
      if (buffer) await handle.writeFile(buffer, 'utf8');
      await handle.close(); handle = null;
      await fs.rename(file + '.pending', file);
      return;
    } catch (error) {
      if (handle) {
        try { await handle.close(); }
        catch (closeError) {
          throw Object.assign(new AggregateError([error, closeError], 'Audit output and file cleanup both failed'), { auditPersistence: true });
        }
      }
      if (error.code !== 'EBUSY' || attempt === 4) throw Object.assign(error, { auditPersistence: true });
      // Retry only the same output I/O; never alter a measurement or its budget.
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}
