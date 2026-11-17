import type { ChatStep } from '../../shared/types.ts';

/** Only navigation links repeat a way there. Saved cards carry distinct facts or files even when their workbench address is the same. */
export function repeatedOpens(parts: readonly unknown[]): Set<string> {
  const object = (href: string) => href.split('?')[0];
  const cards = parts.flatMap(part => {
    const step = (part as { result?: ChatStep }).result;
    const card = step?.type === 'step' && step.status === 'done' ? step.card : undefined;
    const href = card && 'href' in card ? card.href : undefined;
    return step && card && href ? [{ id: step.id, kind: card.kind, href }] : [];
  });
  const withRunCard = new Set(cards.filter(item => item.kind === 'saved_run').map(item => object(item.href)));
  const offered = new Set<string>();
  const repeated = new Set<string>();
  for (const item of cards) {
    // A specification's artifact identity is its download URL, not its parent type's workbench URL. This navigation-only
    // filter must never remove a file (or a saved input/result) just because another card opens the same parent object.
    if (item.kind !== 'open') {
      offered.add(item.href);
      continue;
    }
    const hasRun = /(?:\?|&)run=/.test(item.href);
    if ((!hasRun && withRunCard.has(object(item.href))) || offered.has(item.href)) repeated.add(item.id);
    else offered.add(item.href);
  }
  return repeated;
}
