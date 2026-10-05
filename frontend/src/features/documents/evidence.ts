import type { Candidate, Extraction } from '@/api/documents';
import type { components } from '@/api/generated/schema';
import { optionalRecord, text } from '@/api/client';

export function printedValue(candidate: Pick<Candidate, 'quote' | 'raw_value'>): string {
  const tokens = candidate.quote.match(/[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) || [];
  const matches = [...new Set(tokens.filter(value => Number(value) === candidate.raw_value))];
  return matches.length === 1 ? matches[0] : String(candidate.raw_value);
}
export function specificationKey(run: Extraction) {
  const model = run.result?.model || optionalRecord(run.request.model);
  return JSON.stringify([text(model.designation), text(model.specification), text(model.identity_note)]);
}
export function specificationLabel(run: Extraction) {
  const model = run.result?.model || optionalRecord(run.request.model);
  return [text(model.designation), text(model.specification)].filter(Boolean).join(' · ');
}
export function matchesOriginal(candidate: Candidate, page?: components['schemas']['PageResponse']): boolean {
  if (!page || candidate.page !== page.page || candidate.evidence_source === 'ocr' || candidate.ambiguities.length) return false;
  const box = candidate.bbox_pt;
  if (box.length !== 4 || !box.every(Number.isFinite) || box[0] < 0 || box[1] < 0 || box[2] > page.width_pt || box[3] > page.height_pt || box[2] <= box[0] || box[3] <= box[1]) return false;
  const inside = page.words.filter(({bbox:b}) => (b[0]+b[2])/2 >= box[0] && (b[0]+b[2])/2 <= box[2] && (b[1]+b[3])/2 >= box[1] && (b[1]+b[3])/2 <= box[3]);
  const normalize = (s:string) => s.replace(/\s/g,'');
  const numbers = candidate.quote.match(/[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) || [];
  return !!inside.length && normalize(inside.map(w=>w.text).join(' ')) === normalize(candidate.quote)
    && numbers.length === 1 && Number(numbers[0]) === candidate.raw_value;
}
