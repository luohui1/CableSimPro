import type { ChatStep } from '../../shared/types.ts';

/** Collapse repeated navigation and identical saved-run snapshots within one assistant message. Other saved cards stay independent. */
export function repeatedOpens(parts: readonly unknown[]): Set<string> {
  const object = (href: string) => href.split('?')[0];
  const cards = parts.flatMap(part => {
    const step = (part as { result?: ChatStep }).result;
    const card = step?.type === 'step' && step.status === 'done' ? step.card : undefined;
    const href = card && 'href' in card ? card.href : undefined;
    return step && card && href ? [{ id: step.id, kind: card.kind, href, card }] : [];
  });
  const withRunCard = new Set(cards.filter(item => item.kind === 'saved_run').map(item => object(item.href)));
  const offered = new Set<string>();
  const runSnapshots = new Set<string>();
  const repeated = new Set<string>();
  for (const item of cards) {
    // The approval receipt and a subsequent read can carry the exact same run snapshot. Include every card field so a
    // different run, freshness, limitation or value remains visible; only the later card is hidden, never its tool step.
    if (item.kind === 'saved_run') {
      const snapshot = JSON.stringify(item.card);
      if (runSnapshots.has(snapshot)) repeated.add(item.id);
      else runSnapshots.add(snapshot);
    }
    // A specification's artifact identity is its download URL, not its parent type's workbench URL. Other rich cards
    // must never be removed just because another card opens the same parent object.
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
